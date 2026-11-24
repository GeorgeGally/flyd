import { request, type IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationViewServer, EARLIER_EXCHANGES, SnapshotDiffer, STREAM_EXCHANGES } from "../server.js";
import type { ConversationMessage, ConversationSnapshot, ConversationSource } from "../types.js";

// A long main chat keeps its whole history, but is drawn from its newest exchanges;
// the ones before come as he scrolls up, and nothing drawn ever drops off or moves.

function exchanges(count: number, from = 0): ConversationMessage[] {
  const at = (i: number, s: number) => new Date(Date.UTC(2026, 10, 1) + i * 60_000 + s * 1000).toISOString();
  return Array.from({ length: count }, (_, n) => n + from).flatMap((i) => [
    { id: `ask:${i}`, role: "user" as const, text: `Question ${i}`, timestamp: at(i, 0) },
    { id: `answer:${i}`, role: "assistant" as const, text: `Answer ${i}.`, timestamp: at(i, 30), answers: `ask:${i}` },
  ]);
}

const snapshot = (messages: ConversationMessage[]): ConversationSnapshot => ({ messages, working: false });

describe("the stream's window on a long conversation", () => {
  it("draws the newest exchanges, adds new ones at the bottom without dropping any, and brings earlier ones on asking", () => {
    const differ = new SnapshotDiffer();
    const history = exchanges(STREAM_EXCHANGES + 120);
    const first = differ.next(snapshot(history));
    expect(first.order).toHaveLength(STREAM_EXCHANGES * 2);
    expect(first.order[0]).toBe("ask:120");
    expect(first.order.at(-1)).toBe(`answer:${STREAM_EXCHANGES + 119}`);
    expect(first.earlier).toBe(120);
    expect(first.messages).toHaveLength(STREAM_EXCHANGES * 2);
    // A new exchange goes at the bottom; the top of what he sees stays where it was.
    const longer = [...history, ...exchanges(1, STREAM_EXCHANGES + 120)];
    const next = differ.next(snapshot(longer));
    expect(next.order[0]).toBe("ask:120");
    expect(next.order.slice(-2)).toEqual([`ask:${STREAM_EXCHANGES + 120}`, `answer:${STREAM_EXCHANGES + 120}`]);
    expect(next.messages.map((message) => message.id)).toEqual([`ask:${STREAM_EXCHANGES + 120}`, `answer:${STREAM_EXCHANGES + 120}`]);
    // Scrolled to the top: one batch earlier, sent fresh, the drawn ones untouched.
    differ.showEarlier();
    const earlier = differ.next(snapshot(longer));
    expect(earlier.order[0]).toBe(`ask:${120 - EARLIER_EXCHANGES}`);
    expect(earlier.earlier).toBe(120 - EARLIER_EXCHANGES);
    expect(earlier.order.slice(EARLIER_EXCHANGES * 2)).toEqual(next.order);
    expect(earlier.messages.map((message) => message.id)).toEqual(earlier.order.slice(0, EARLIER_EXCHANGES * 2));
    // And the rest, until nothing is left above.
    differ.showEarlier();
    const all = differ.next(snapshot(longer));
    expect(all.order).toEqual(longer.map((message) => message.id));
    expect(all.earlier).toBeUndefined();
  });

  it("draws again from the page's oldest message when it comes back to the same conversation, else from the newest", () => {
    const history = exchanges(STREAM_EXCHANGES + 120);
    const back = new SnapshotDiffer();
    back.startAt("ask:20");
    const again = back.next(snapshot(history));
    expect(again.order[0]).toBe("ask:20");
    expect(again.order).toEqual(history.slice(40).map((message) => message.id));
    expect(again.earlier).toBe(20);
    const unknown = new SnapshotDiffer();
    unknown.startAt("ask:elsewhere");
    expect(unknown.next(snapshot(history)).order[0]).toBe("ask:120");
  });

  it("draws a short conversation whole", () => {
    const update = new SnapshotDiffer().next(snapshot(exchanges(3)));
    expect(update.order).toEqual(exchanges(3).map((message) => message.id));
    expect(update.earlier).toBeUndefined();
  });
});

describe("loading earlier exchanges over the view's stream", () => {
  let server: ConversationViewServer | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  function call(port: number, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path, method: options.method ?? "GET", headers: { host: `127.0.0.1:${port}`, ...options.headers } }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on("error", reject);
      req.end(options.body);
    });
  }

  /** The stream's events as they come, until it is closed. */
  function follow(port: number, path: string): Promise<{ events: () => Array<{ event: string; data: { [key: string]: unknown } }>; close: () => void }> {
    return new Promise((resolve, reject) => {
      let text = "";
      const req = request({ host: "127.0.0.1", port, path, headers: { host: `127.0.0.1:${port}` } }, (res: IncomingMessage) => {
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (text += chunk));
        resolve({
          events: () => text.split("\n\n").flatMap((block) => {
            const event = /^event: (.+)$/m.exec(block)?.[1];
            const data = /^data: (.+)$/m.exec(block)?.[1];
            return event && data ? [{ event, data: JSON.parse(data) as { [key: string]: unknown } }] : [];
          }),
          close: () => req.destroy(),
        });
      });
      req.on("error", (error) => { if (!text) reject(error); });
      req.end();
    });
  }

  async function until<T>(read: () => T | undefined): Promise<T> {
    for (let i = 0; i < 100; i += 1) {
      const value = read();
      if (value !== undefined) return value;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("timed out");
  }

  it("brings the exchanges above what the page has drawn when it asks by its stream, and refuses without the view's token", async () => {
    const history = exchanges(STREAM_EXCHANGES + 10);
    const source: ConversationSource = {
      assistantLabel: "Flyd",
      canSend: false,
      listSessions: async () => [{ id: "window:main-chat-1", title: "Conversation", updatedAt: new Date().toISOString() }],
      read: async () => snapshot(history),
      follow: (_session, onUpdate) => { onUpdate(snapshot(history)); return { close: () => {} }; },
      send: async () => { throw new Error("read only"); },
      commands: async () => [],
      image: async () => null,
    };
    server = new ConversationViewServer(source);
    const port = await server.listen(0);
    const token = (JSON.parse((await call(port, "/api/token")).body) as { token: string }).token;
    const stream = await follow(port, `/api/stream?token=${encodeURIComponent(token)}`);
    try {
      const session = await until(() => stream.events().find((event) => event.event === "session")?.data);
      const first = await until(() => stream.events().find((event) => event.event === "update")?.data);
      expect(first.earlier).toBe(10);
      expect((first.order as string[])[0]).toBe("ask:10");
      const ask = (headers: Record<string, string>, body = JSON.stringify({ stream: session.stream })) =>
        call(port, "/api/earlier", { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
      expect((await ask({})).status).toBe(403);
      expect((await ask({ "x-flyd-view-token": token }, JSON.stringify({ stream: "someone-else" }))).status).toBe(404);
      expect((await ask({ "x-flyd-view-token": token })).status).toBe(200);
      const more = await until(() => stream.events().filter((event) => event.event === "update")[1]?.data);
      expect(more.order).toEqual(history.map((message) => message.id));
      expect(more.earlier).toBeUndefined();
      expect((more.messages as Array<{ id: string }>).map((message) => message.id)).toEqual(history.slice(0, 20).map((message) => message.id));
    } finally {
      stream.close();
    }
  });
});
