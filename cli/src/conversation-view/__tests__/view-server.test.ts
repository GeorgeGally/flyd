import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeCodeTranscriptSource } from "../claude-code-source.js";
import type { CaptainInbox } from "../firstmate-inbox.js";
import type { ConversationMessage } from "../types.js";
import { fenceCaptainCode, renderCaptainMarkdown, renderMarkdown } from "../markdown.js";
import { ConversationViewServer, SnapshotDiffer } from "../server.js";
import { ReplySummarizer } from "../summaries.js";
import { assistantText, captain, captainBlocks } from "./transcript-fixture.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

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

describe("pasted code in the captain's messages", () => {
  const paste = "change to @media (max-width: 640px) {\n    body .adviser-section .adviser-inner h2 {\n        font-size: 10vw;\n    }\n}";

  it("renders an indented multi-line paste as one preformatted block with its indentation", () => {
    const html = renderCaptainMarkdown(paste);
    expect(html).toBe(
      "<p>change to</p>\n<pre><code>@media (max-width: 640px) {\n    body .adviser-section .adviser-inner h2 {\n        font-size: 10vw;\n    }\n}\n</code></pre>\n",
    );
    expect(html).not.toContain("<br>");
  });

  it("leaves prose, single lines and existing fences alone", () => {
    expect(fenceCaptainCode("make the menu smaller\nand the footer wider")).toBe("make the menu smaller\nand the footer wider");
    expect(fenceCaptainCode("set .x { color: red; }")).toBe("set .x { color: red; }");
    const fenced = "look:\n```\n  a {\n  }\n```";
    expect(fenceCaptainCode(fenced)).toBe(fenced);
  });

  it("keeps code that follows a sentence on its own lines", () => {
    expect(fenceCaptainCode("for mobile:\n.hero {\n  padding: 18px;\n}")).toBe("for mobile:\n```\n.hero {\n  padding: 18px;\n}\n```");
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

describe("SnapshotDiffer summaries", () => {
  const long = "Captain, the menu bar now sits ten pixels higher on every page, including the member login. " +
    "I checked it in the browser on desktop and mobile, and the change is committed but not pushed yet. ".repeat(2);
  const message = (id: string, text: string) => ({ id, role: "assistant" as const, text });

  function withModel(answer: () => Promise<string>) {
    let landed = 0;
    const cacheFile = join(mkdtempSync(join(tmpdir(), "flyd-view-sum-")), "s.json");
    const summarizer = new ReplySummarizer({ providers: [{ name: "fake", summarize: answer }], cacheFile });
    return { summarizer, landed: () => landed, onSummary: () => (landed += 1) };
  }

  it("leads with the reply's own » summary and keeps the rest as the reply, without calling a model", () => {
    let calls = 0;
    const model = withModel(async () => (calls++, "x"));
    const differ = new SnapshotDiffer(model);
    const [rendered] = differ.next({ messages: [message("r1", `» Menu bar fixed.\n» Pushed.\n\n${long}`)], working: false }).messages;
    expect(rendered!.summary).toEqual({ html: "<p>Menu bar fixed. Pushed.</p>\n", source: "author" });
    expect(rendered!.html).not.toContain("Menu bar fixed");
    expect(calls).toBe(0);
  });

  it("shows the first sentence while a model summary is on its way, then pushes the model's", async () => {
    let resolve!: (summary: string) => void;
    const model = withModel(() => new Promise((r) => (resolve = r)));
    const differ = new SnapshotDiffer(model);
    const snapshot = { messages: [message("short", "Done."), message("r1", long)], working: false };
    const first = differ.next(snapshot).messages;
    expect(first[0]!.summary).toBeUndefined();
    expect(first[1]!.summary).toMatchObject({ source: "first-sentence", pending: true });
    expect(first[1]!.summary!.html).toContain("Captain, the menu bar now sits ten pixels higher");

    await new Promise((r) => setTimeout(r, 0));
    resolve("The menu bar is a little higher and saved, not yet published.");
    await new Promise((r) => setTimeout(r, 0));
    expect(model.landed()).toBe(1);
    const second = differ.next(snapshot).messages;
    expect(second.map((m) => m.id)).toEqual(["r1"]);
    expect(second[0]!.summary).toEqual({ html: "<p>The menu bar is a little higher and saved, not yet published.</p>\n", source: "model" });
  });

  it("only asks the model about the newest twenty replies, two at a time", async () => {
    let calls = 0;
    const model = withModel(() => (calls++, new Promise(() => {})));
    const messages = Array.from({ length: 25 }, (_unused, i) => message(`r${i}`, `${i} ${long}`));
    const rendered = new SnapshotDiffer(model).next({ messages, working: false }).messages;
    expect(rendered.map((m) => m.summary?.pending === true)).toEqual([...Array(5).fill(false), ...Array(20).fill(true)]);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(2);
  });

  it("with always on, also asks the model about replies that carry their own summary, to compare", async () => {
    const model = withModel(async () => "Grok's take.");
    const differ = new SnapshotDiffer({ ...model, always: true });
    const snapshot = { messages: [message("r1", `» Menu bar fixed.\n\n${long}`)], working: false };
    expect(differ.next(snapshot).messages[0]!.compare).toEqual({ html: "", pending: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(differ.next(snapshot).messages[0]).toMatchObject({
      summary: { source: "author" },
      compare: { html: "<p>Grok&#39;s take.</p>\n" },
    });
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

  function get(port: number, path: string, host = `127.0.0.1:${port}`): Promise<{ status: number; body: string; type?: string }> {
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
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, type: res.headers["content-type"] }));
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
    readonly uploads: unknown[] = [];
    async send(text: string, images: unknown[] = []) {
      this.uploads.push(...images);
      const message = { id: `note:${this.sent.length + 1}`, role: "user" as const, text, timestamp: new Date().toISOString() };
      this.sent.push(message);
      return { id: message.id, timestamp: message.timestamp! };
    }
    notes() {
      return this.sent;
    }
    image() {
      return null;
    }
  }

  async function start(inbox?: CaptainInbox, lines = [captain("hello"), assistantText("Hi, **Captain**.")]): Promise<number> {
    dir = mkdtempSync(join(tmpdir(), "flyd-view-server-"));
    writeFileSync(join(dir, "s1.jsonl"), lines.join("\n") + "\n");
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

  it("feeds the island a compact status of the newest session", async () => {
    const port = await start(undefined, [captain("push it"), assistantText("» Pushed to main. Want me to merge the PR?")]);
    const body = await new Promise<string>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/api/status", headers: { host: `127.0.0.1:${port}` } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
          if (text.includes("event: status")) { req.destroy(); resolve(text); }
        });
      });
      req.on("error", reject);
      req.end();
    });
    const status = JSON.parse(body.split("event: status\ndata: ")[1]!.split("\n")[0]!);
    expect(status).toMatchObject({ session: "s1", working: false, reply: { headline: "Pushed to main. Want me to merge the PR?", asks: true } });
  });

  it("ends the island's feed when a newer session starts, so it reconnects to that one", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const port = await start(undefined, [captain("push it"), assistantText("» Pushed to main.")]);
      let text = "";
      let firstStatus!: () => void;
      const statusSeen = new Promise<void>((resolve) => (firstStatus = resolve));
      const ended = new Promise<void>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port, path: "/api/status", headers: { host: `127.0.0.1:${port}` } }, (res) => {
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            text += chunk;
            if (text.includes("event: status")) firstStatus();
          });
          res.on("end", resolve);
        });
        req.on("error", reject);
        req.end();
      });
      await statusSeen;

      await vi.advanceTimersByTimeAsync(30_000);
      while (!text.includes(": keep-alive")) await new Promise((resolve) => setTimeout(resolve, 5));

      writeFileSync(join(dir!, "s2.jsonl"), [captain("new session")].join("\n") + "\n");
      const later = new Date(Date.now() + 60_000);
      utimesSync(join(dir!, "s2.jsonl"), later, later);
      await vi.advanceTimersByTimeAsync(30_000);
      await ended;
    } finally {
      vi.useRealTimers();
    }
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

  it("hands its current token to its own origin so an open tab can recover after a restart", async () => {
    const port = await start(new MemoryInbox());
    const token = tokenOf((await get(port, "/")).body);
    expect(JSON.parse((await get(port, "/api/token")).body)).toEqual({ token });
    expect((await get(port, "/api/token", "attacker.example")).status).toBe(403);
  });

  it("offers no message box and refuses sends when the source is read-only", async () => {
    const port = await start();
    const page = (await get(port, "/")).body;
    expect(tokenOf(page)).toBe("");
    expect((await get(port, "/api/token")).status).toBe(404);
    expect((await post(port, JSON.stringify({ session: "s1", text: "hi" }), { "content-type": "application/json" })).status).toBe(405);
  });

  it("serves a pasted transcript image as an image, and nothing for unknown ids", async () => {
    const port = await start(undefined, [captainBlocks([{ type: "text", text: "[Image #1] broken" }, { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }])]);
    const stream = await get(port, "/api/stream");
    const update = JSON.parse(stream.body.split("event: update\ndata: ")[1]!.split("\n")[0]!);
    expect(update.messages[0].html).toBe("<p>broken</p>\n");
    const [id] = update.messages[0].images;

    const image = await get(port, `/api/image?session=s1&id=${encodeURIComponent(id)}`);
    expect(image.status).toBe(200);
    expect(image.type).toBe("image/png");
    expect((await get(port, "/api/image?session=s1&id=t1.9")).status).toBe(404);
    expect((await get(port, `/api/image?session=..%2Fx&id=${encodeURIComponent(id)}`)).status).toBe(404);
  });

  it("passes pasted images through to the inbox, and accepts an image with no text", async () => {
    const inbox = new MemoryInbox();
    const port = await start(inbox);
    const token = tokenOf((await get(port, "/")).body);
    const headers = { "content-type": "application/json", "x-flyd-view-token": token };
    const images = [{ mediaType: "image/png", data: PNG }];
    expect((await post(port, JSON.stringify({ session: "s1", text: "", images }), headers)).status).toBe(200);
    expect(inbox.uploads).toEqual(images);
    expect((await post(port, JSON.stringify({ session: "s1", text: "", images: [{ mediaType: 1 }] }), headers)).status).toBe(400);
    expect((await post(port, JSON.stringify({ session: "s1", text: "  ", images: [] }), headers)).status).toBe(400);
  });
});
