import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeCodeTranscriptSource } from "../claude-code-source.js";
import type { CaptainInbox } from "../firstmate-inbox.js";
import type { ConversationMessage } from "../types.js";
import { renderMarkdown } from "../markdown.js";
import { ConversationViewServer, SnapshotDiffer } from "../server.js";
import { assistantText, captain } from "./transcript-fixture.js";

describe("renderMarkdown", () => {
  it("renders tables, lists, code and links", () => {
    const html = renderMarkdown("## Done\n\n- **one**\n- `two`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[pr](https://github.com/x/y/pull/1)");
    expect(html).toContain("<h2>Done</h2>");
    expect(html).toContain("<strong>one</strong>");
    expect(html).toContain("<code>two</code>");
    expect(html).toContain("<table>");
    expect(html).toContain('<a href="https://github.com/x/y/pull/1" target="_blank" rel="noopener noreferrer">pr</a>');
  });

  it("escapes raw HTML and drops unsafe links and remote images", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\nsee <img src=x onerror=alert(1)> [x](javascript:alert(1)) ![logo](https://tracker.example/p.png)');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('<span class="pill">logo</span>');
  });

  it("marks pasted screenshots", () => {
    expect(renderMarkdown("[Image #3] squashed")).toContain('<span class="pill">image 3</span>');
  });
});

describe("SnapshotDiffer", () => {
  it("sends each message once and again only when its text changes", () => {
    const differ = new SnapshotDiffer();
    const first = differ.next({ messages: [{ id: "a", role: "user", text: "hi" }], working: true });
    expect(first.messages.map((m) => m.id)).toEqual(["a"]);
    const second = differ.next({ messages: [{ id: "a", role: "user", text: "hi" }, { id: "b", role: "assistant", text: "**yo**" }], working: false });
    expect(second.order).toEqual(["a", "b"]);
    expect(second.messages).toEqual([{ id: "b", role: "assistant", html: "<p><strong>yo</strong></p>\n" }]);
    expect(differ.next({ messages: [{ id: "a", role: "user", text: "hi" }], working: false }).messages).toEqual([]);
  });
});

describe("ConversationViewServer", () => {
  let server: ConversationViewServer | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    await server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
    server = null;
    dir = null;
  });

  function get(port: number, path: string, host = `127.0.0.1:${port}`): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path, headers: { host } }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
          // The stream never ends; one update event is enough.
          if (path.startsWith("/api/stream") && body.includes("event: update")) {
            req.destroy();
            resolve({ status: res.statusCode ?? 0, body });
          }
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  function post(port: number, body: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/api/send", method: "POST", headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
      });
      req.on("error", reject);
      req.end(body);
    });
  }

  /** In-memory stand-in for firstmate's inbox. */
  class MemoryInbox implements CaptainInbox {
    readonly sent: ConversationMessage[] = [];
    async send(text: string) {
      const message = { id: `note:${this.sent.length + 1}`, role: "user" as const, text, timestamp: new Date().toISOString() };
      this.sent.push(message);
      return { id: message.id, timestamp: message.timestamp! };
    }
    notes() {
      return this.sent;
    }
  }

  async function start(inbox?: CaptainInbox): Promise<number> {
    dir = mkdtempSync(join(tmpdir(), "flyd-view-server-"));
    writeFileSync(join(dir, "s1.jsonl"), [captain("hello"), assistantText("Hi, **Captain**.")].join("\n") + "\n");
    server = new ConversationViewServer(new ClaudeCodeTranscriptSource({ projectDir: dir, assistantLabel: "firstmate", ...(inbox ? { inbox } : {}) }));
    return server.listen(0);
  }

  const tokenOf = (page: string): string => /data-send-token="([0-9a-f]+)"/.exec(page)?.[1] ?? "";

  it("serves the page, sessions and a rendered stream on loopback", async () => {
    const port = await start();
    const page = await get(port, "/");
    expect(page.status).toBe(200);
    expect(page.body).toContain("<title>firstmate</title>");

    const sessions = JSON.parse((await get(port, "/api/sessions")).body);
    expect(sessions.sessions.map((s: { id: string }) => s.id)).toEqual(["s1"]);

    const stream = await get(port, "/api/stream");
    expect(stream.body).toContain("event: session");
    const update = JSON.parse(stream.body.split("event: update\ndata: ")[1]!.split("\n")[0]!);
    expect(update.messages.map((m: { html: string }) => m.html)).toEqual(["<p>hello</p>\n", "<p>Hi, <strong>Captain</strong>.</p>\n"]);
  });

  it("rejects requests carrying a foreign Host header", async () => {
    const port = await start();
    expect((await get(port, "/api/sessions", "attacker.example")).status).toBe(403);
  });

  it("delivers the captain's message only from its own page", async () => {
    const inbox = new MemoryInbox();
    const port = await start(inbox);
    const token = tokenOf((await get(port, "/")).body);
    expect(token).toHaveLength(48);
    const json = { "content-type": "application/json" };
    const body = JSON.stringify({ session: "s1", text: "run the flyd viewer" });

    expect((await post(port, body, json)).status).toBe(403);
    expect((await post(port, body, { ...json, "x-flyd-view-token": "0".repeat(48) })).status).toBe(403);
    expect((await post(port, body, { ...json, "x-flyd-view-token": token, origin: "https://attacker.example" })).status).toBe(403);
    expect((await post(port, body, { "content-type": "text/plain", "x-flyd-view-token": token })).status).toBe(415);
    expect((await post(port, JSON.stringify({ session: "s1", text: "  " }), { ...json, "x-flyd-view-token": token })).status).toBe(400);
    expect((await post(port, JSON.stringify({ session: "../x", text: "hi" }), { ...json, "x-flyd-view-token": token })).status).toBe(502);
    expect(inbox.sent).toEqual([]);

    const ok = await post(port, body, { ...json, "x-flyd-view-token": token, origin: `http://127.0.0.1:${port}` });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toMatchObject({ id: "note:1" });
    expect(inbox.sent.map((m) => m.text)).toEqual(["run the flyd viewer"]);

    const stream = await get(port, "/api/stream");
    const update = JSON.parse(stream.body.split("event: update\ndata: ")[1]!.split("\n")[0]!);
    expect(update.order).toEqual([expect.any(String), expect.any(String), "note:1"]);
  });

  it("offers no message box and refuses sends when the source is read-only", async () => {
    const port = await start();
    const page = (await get(port, "/")).body;
    expect(tokenOf(page)).toBe("");
    expect((await post(port, JSON.stringify({ session: "s1", text: "hi" }), { "content-type": "application/json" })).status).toBe(405);
  });
});
