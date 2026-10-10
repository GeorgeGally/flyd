import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeCodeTranscriptSource } from "../claude-code-source.js";
import type { CaptainInbox } from "../firstmate-inbox.js";
import type { ConversationMessage } from "../types.js";
import { fenceCaptainCode, renderCaptainMarkdown, renderMarkdown } from "../markdown.js";
import type { ArtefactFeed } from "../artefact.js";
import { ConversationViewServer, SnapshotDiffer } from "../server.js";
import { ComposerPredictions } from "../composer-predictions.js";
import { ReplySummarizer } from "../summaries.js";
import { readTaste, writeTaste } from "../../council/taste.js";
import { KINSTA_RULES, KINSTA_TABLE } from "./fixtures/replies.js";
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

describe("SnapshotDiffer relays", () => {
  it("drops routine relayed updates, keeps ones with an outcome, and carries the pairing to the page", () => {
    const differ = new SnapshotDiffer();
    const update = differ.next({
      messages: [
        { id: "note:1", role: "user", text: "whats on in bkk tonight?", waiting: "passed to firstmate" },
        { id: "t1", role: "assistant", text: "Sir, standing by.", aside: true },
        { id: "t2", role: "assistant", text: "Sir, the island filter is still paused on your call. A or B?", aside: true },
      ],
      working: false,
    });
    expect(update.order).toEqual(["note:1", "t2"]);
    expect(update.messages.map((m) => [m.id, m.waiting, m.aside])).toEqual([["note:1", "passed to firstmate", undefined], ["t2", undefined, true]]);

    const answered = differ.next({
      messages: [
        { id: "note:1", role: "user", text: "whats on in bkk tonight?" },
        { id: "note-reply:1", role: "assistant", text: "Art bangkok, sir.", answers: "note:1" },
        { id: "t2", role: "assistant", text: "Sir, the island filter is still paused on your call. A or B?", aside: true },
      ],
      working: false,
    });
    expect(answered.order).toEqual(["note:1", "note-reply:1", "t2"]);
    expect(answered.messages.map((m) => [m.id, m.waiting, m.answers])).toEqual([["note:1", undefined, undefined], ["note-reply:1", undefined, "note:1"]]);
  });

  it("tells the page when a question's line says its answer failed", () => {
    const differ = new SnapshotDiffer();
    const asking = differ.next({ messages: [{ id: "ask:1", role: "user", text: "weather?", waiting: "Answering" }], working: false });
    expect(asking.messages[0]!.waitingFailed).toBeUndefined();
    const failed = differ.next({ messages: [{ id: "ask:1", role: "user", text: "weather?", waiting: "Flyd couldn't answer this: offline", waitingFailed: true }], working: false });
    expect(failed.messages.map((m) => [m.waiting, m.waitingFailed])).toEqual([["Flyd couldn't answer this: offline", true]]);
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

  it("shows a local digest while a model summary is on its way, then pushes the model's", async () => {
    let resolve!: (summary: string) => void;
    const model = withModel(() => new Promise((r) => (resolve = r)));
    const differ = new SnapshotDiffer(model);
    const snapshot = { messages: [message("short", "Done."), message("r1", long)], working: false };
    const first = differ.next(snapshot).messages;
    expect(first[0]!.summary).toBeUndefined();
    expect(first[1]!.summary).toMatchObject({ source: "digest", pending: true });
    expect(first[1]!.summary!.html).toContain("The menu bar now sits ten pixels higher");

    await new Promise((r) => setTimeout(r, 0));
    resolve("The menu bar is a little higher and saved, not yet published.");
    await new Promise((r) => setTimeout(r, 0));
    expect(model.landed()).toBe(1);
    const second = differ.next(snapshot).messages;
    expect(second.map((m) => m.id)).toEqual(["r1"]);
    expect(second[0]!.summary).toEqual({ html: "<p>The menu bar is a little higher and saved, not yet published.</p>\n", source: "model" });
  });

  it("leads a long reply with Flyd's whole reading, not a one-line digest, when no model summary is coming", () => {
    const [rendered] = new SnapshotDiffer().next({ messages: [message("r1", long)], working: false }).messages;
    expect(rendered!.summary).toMatchObject({ source: "brief" });
    expect(rendered!.summary!.pending).toBeUndefined();
    expect(rendered!.summary!.html).toContain("the menu bar now sits ten pixels higher on every page, including the member login");
    expect(rendered!.summary!.html).toContain("the change is committed but not pushed yet");
  });

  it("never folds a reply that hands the captain something to act on behind its summary", () => {
    // The captain asked "what rules bro": the folded view showed "Kinsta won't
    // accept #." while the four rules he had to paste sat behind "more".
    const differ = new SnapshotDiffer();
    const [rendered, table] = differ.next({ messages: [message("r1", KINSTA_RULES), message("r3", KINSTA_TABLE)], working: false }).messages;
    expect(rendered).toMatchObject({ summary: { source: "brief" }, expanded: true });
    expect(rendered!.summary!.html).toContain("Set each to 301 and All domains");
    expect(rendered!.html).toContain("^/members-and-firms/?$");
    expect(table).toMatchObject({ summary: { source: "brief" }, expanded: true });
    expect(table!.html).toContain("https://capfive.com/professionals/");
    const [authored] = new SnapshotDiffer().next({ messages: [message("r2", `» Four rules for Kinsta.\n\n${KINSTA_RULES}`)], working: false }).messages;
    expect(authored).toMatchObject({ summary: { source: "author" }, expanded: true });
    expect(authored!.html).toContain("https://capfive.com/$1");
  });

  it("mutes routine chatter, and a reply the model finds routine shrinks to one line", async () => {
    const differ = new SnapshotDiffer(withModel(async () => "**ROUTINE.**"));
    const [shipshape] = differ.next({ messages: [message("r1", "Captain, shipshape.")], working: false }).messages;
    expect(shipshape).toMatchObject({ routine: true });
    const snapshot = { messages: [message("r2", long)], working: false };
    differ.next(snapshot);
    await new Promise((r) => setTimeout(r, 0));
    const [routine] = differ.next(snapshot).messages;
    expect(routine).toMatchObject({ routine: true, summary: { source: "model" } });
    expect(routine!.summary!.html).not.toContain("ROUTINE");
  });

  it("passes what the assistant is doing while it works, and nothing once it stops", () => {
    const differ = new SnapshotDiffer();
    expect(differ.next({ messages: [], working: true, activity: "Checking the About page on iPhone SE" }).activity).toBe("Checking the About page on iPhone SE");
    expect(differ.next({ messages: [], working: false, activity: "stale" }).activity).toBeUndefined();
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
  let viewToken: string | undefined;

  afterEach(async () => {
    await server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
    server = null;
    dir = null;
    viewToken = undefined;
  });

  function get(port: number, path: string, host = `127.0.0.1:${port}`, authenticated = true): Promise<{ status: number; body: string; type?: string }> {
    return new Promise((resolve, reject) => {
      const streamPath = path.startsWith("/api/stream") && authenticated && viewToken
        ? `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(viewToken)}`
        : path;
      const req = request({ host: "127.0.0.1", port, path: streamPath, headers: { host } }, (res) => {
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

  function post(port: number, body: string, headers: Record<string, string>, path = "/api/send"): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path, method: "POST", headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
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
    readonly documents: unknown[] = [];
    async send(text: string, images: unknown[] = [], _command?: string, files: unknown[] = []) {
      this.uploads.push(...images);
      this.documents.push(...files);
      const message = { id: `note:${this.sent.length + 1}`, role: "user" as const, text, timestamp: new Date().toISOString() };
      this.sent.push(message);
      return { id: message.id, timestamp: message.timestamp! };
    }
    notes() {
      return this.sent.map((question) => ({ question, waiting: "passed to firstmate" }));
    }
    image() {
      return null;
    }
  }

  async function start(inbox?: CaptainInbox, lines = [captain("hello"), assistantText("Hi, **Captain**.")], predictions?: ComposerPredictions): Promise<number> {
    dir = mkdtempSync(join(tmpdir(), "flyd-view-server-"));
    writeFileSync(join(dir, "s1.jsonl"), lines.join("\n") + "\n");
    server = new ConversationViewServer(new ClaudeCodeTranscriptSource({ projectDir: dir, assistantLabel: "firstmate", ...(inbox ? { inbox } : {}) }), undefined, undefined, undefined, undefined, undefined, predictions);
    const port = await server.listen(0);
    await get(port, "/");
    viewToken = JSON.parse((await get(port, "/api/token")).body).token;
    return port;
  }

  const tokenOf = (page: string): string => /data-send-token="([0-9a-f]+)"/.exec(page)?.[1] ?? "";

  it("authenticates predictions, uses current conversation context and never dispatches the suggestion", async () => {
    const root = mkdtempSync(join(tmpdir(), "flyd-prediction-server-"));
    let calls = 0, prompt = "";
    const predictions = new ComposerPredictions({ root, provider: async (p) => { calls++; prompt = p; return { text: " and check the tests" }; } });
    const inbox = new MemoryInbox();
    try {
      const port = await start(inbox, [captain("change the composer"), assistantText("I can do that.")], predictions);
      const body = JSON.stringify({ session: "s1", draft: "implement it" });
      const headers = { "content-type": "application/json", "x-flyd-view-token": viewToken! };
      expect((await post(port, body, { "content-type": "application/json" }, "/api/predict")).status).toBe(403);
      expect((await post(port, body, { ...headers, origin: "https://evil.example" }, "/api/predict")).status).toBe(403);
      expect(calls).toBe(0);
      const reply = await post(port, body, headers, "/api/predict");
      expect(reply.status).toBe(200); expect(JSON.parse(reply.body).prediction.suffix).toBe(" and check the tests");
      expect(prompt).toContain("change the composer"); expect(prompt).toContain("implement it"); expect(inbox.sent).toEqual([]);
      expect((await get(port, "/api/prediction-status")).status).toBe(403);
      expect((await get(port, "/api/prediction-status?token=" + viewToken)).status).toBe(200);
      expect((await post(port, JSON.stringify({ session: "s1", draft: "x".repeat(2001) }), headers, "/api/predict")).status).toBe(400);
    } finally { predictions.close(); rmSync(root, { recursive: true, force: true }); }
  });

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

  it("rejects an unauthenticated stream before exposing artefact data", async () => {
    const port = await start();
    expect((await get(port, "/api/stream", `127.0.0.1:${port}`, false)).status).toBe(403);
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
    expect(status).toMatchObject({ session: "s1", working: false, reply: { headline: "Pushed to main. Want me to merge the change?", asks: true } });
  });

  it("shows what Flyd knows about the captain's taste, and lets only its own page reword or veto a rule", async () => {
    writeTaste({
      rules: [{ id: "abc12345", text: "No shadows on icon boxes.", scope: "personal", count: 2, projects: [], last: "2026-10-06",
        evidence: [{ quote: "no shadows on the icon boxes", source: "Claude Code", date: "2026-10-06" }] }],
      vetoed: [],
      retired: [{ id: "retired01", text: "Never hard-code an API key.", scope: "personal", count: 1, projects: [],
        evidence: [{ quote: "put the key on the server", source: "Claude Code", date: "2026-10-06" }] }],
      names: {},
    });
    const port = await start();
    const denied = await get(port, "/taste");
    expect(denied.status).toBe(403);
    expect(denied.body).not.toContain("No shadows on icon boxes.");
    const page = await get(port, `/taste?token=${encodeURIComponent(viewToken!)}`);
    expect(page.status).toBe(200);
    expect(page.body).toContain("No shadows on icon boxes.");
    expect(page.body).toContain("no shadows on the icon boxes");
    expect(page.body).toContain("Set aside as too generic");
    expect(page.body).toContain("Never hard-code an API key.");
    expect(page.body).toContain("put the key on the server");
    const token = /data-token="([0-9a-f]+)"/.exec(page.body)![1]!;
    const json = { "content-type": "application/json" };
    const veto = JSON.stringify({ action: "veto", id: "abc12345" });
    expect((await post(port, veto, json, "/api/taste")).status).toBe(403);
    expect((await post(port, veto, { ...json, "x-flyd-view-token": token, origin: "https://attacker.example" }, "/api/taste")).status).toBe(403);
    expect((await post(port, JSON.stringify({ action: "reword", id: "abc12345", text: "Never shadows on icon boxes." }), { ...json, "x-flyd-view-token": token }, "/api/taste")).status).toBe(200);
    expect(readTaste().rules[0]!.text).toBe("Never shadows on icon boxes.");
    expect((await post(port, veto, { ...json, "x-flyd-view-token": token }, "/api/taste")).status).toBe(200);
    expect(readTaste()).toMatchObject({ rules: [], vetoed: [{ id: "abc12345" }] });
    expect((await post(port, veto, { ...json, "x-flyd-view-token": token }, "/api/taste")).status).toBe(404);
    expect((await post(port, JSON.stringify({ action: "reword", id: "retired01", text: "Keep keys on the server." }), { ...json, "x-flyd-view-token": token }, "/api/taste")).status).toBe(200);
    expect(readTaste().retired?.[0]!.text).toBe("Keep keys on the server.");
    expect((await post(port, JSON.stringify({ action: "restore", id: "retired01" }), { ...json, "x-flyd-view-token": token }, "/api/taste")).status).toBe(200);
    expect(readTaste().rules.map((rule) => rule.id)).toContain("retired01");
  });

  it("lists no slash commands for a read-only conversation", async () => {
    const port = await start();
    expect(JSON.parse((await get(port, "/api/commands")).body)).toEqual({ commands: [] });
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
    expect((await get(port, "/api/token")).status).toBe(200);
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

  it("serves a fleet task's screenshot only with the token and only when the artefact listed it", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-view-server-"));
    writeFileSync(join(dir, "s1.jsonl"), [captain("hello")].join("\n") + "\n");
    const shot = join(dir, "after.png");
    writeFileSync(shot, Buffer.from(PNG, "base64"));
    const feed = { start() {}, stop() {}, current: () => ({ memories: [], news: [], taste: [] }), onRefresh: () => () => {}, shotPath: (task: string, file: string) => (task === "a" && file === "after.png" ? shot : null) };
    server = new ConversationViewServer(new ClaudeCodeTranscriptSource({ projectDir: dir, assistantLabel: "firstmate" }), undefined, undefined, undefined, feed as unknown as ArtefactFeed);
    const port = await server.listen(0);
    const token = JSON.parse((await get(port, "/api/token")).body).token;
    expect((await get(port, "/api/artefact-shot?task=a&file=after.png")).status).toBe(403);
    const image = await get(port, `/api/artefact-shot?task=a&file=after.png&token=${token}`);
    expect(image.status).toBe(200);
    expect(image.type).toBe("image/png");
    expect((await get(port, `/api/artefact-shot?task=a&file=..%2Fs1.jsonl&token=${token}`)).status).toBe(404);
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

  it("passes dropped documents through to the inbox, and accepts a document with no text", async () => {
    const inbox = new MemoryInbox();
    const port = await start(inbox);
    const token = tokenOf((await get(port, "/")).body);
    const headers = { "content-type": "application/json", "x-flyd-view-token": token };
    const files = [{ name: "brief.pdf", data: Buffer.from("%PDF-1.3").toString("base64") }];
    expect((await post(port, JSON.stringify({ session: "s1", text: "", files }), headers)).status).toBe(200);
    expect(inbox.documents).toEqual(files);
    expect((await post(port, JSON.stringify({ session: "s1", text: "", files: [{ name: 1, data: "" }] }), headers)).status).toBe(400);
    expect((await post(port, JSON.stringify({ session: "s1", text: " ", files: [] }), headers)).status).toBe(400);
  });
});
