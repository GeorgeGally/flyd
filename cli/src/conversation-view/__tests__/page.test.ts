// @vitest-environment happy-dom
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boxesOf } from "../boxes.js";
import { RECEIVED } from "../living.js";
import { renderPage } from "../page.js";
import type { ShowScreen } from "../show.js";

// Runs the real page script against a fake server: EventSource streams and
// fetch responses are scripted by each test.

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, (event: { data: string }) => void>();
  closed = false;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: { data: string }) => void): void {
    this.listeners.set(type, listener);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data: unknown): void {
    this.listeners.get(type)?.({ data: JSON.stringify(data) });
  }
}

const SESSIONS = [
  { id: "latest", title: "Latest", updatedAt: "2026-10-05T20:00:00.000Z" },
  { id: "older", title: "Older", updatedAt: "2026-10-04T20:00:00.000Z" },
];
let sendResponse: Record<string, unknown>;
const COMMANDS = [
  { name: "caveman:caveman", description: "Terse mode" },
  { name: "design-review", description: "Designer's eye QA" },
  { name: "design-shotgun", description: "Five design variants" },
  { name: "review", description: "Pre-landing PR review" },
];
let planResponse: unknown = null;
let blips = 0;

/** Counts blips: each one is an oscillator started. */
class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  resume() {}
  createOscillator() {
    const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    return { type: "", frequency: param, connect() {}, start: () => (blips += 1), stop() {} };
  }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function load(search: string, html = renderPage({ assistantLabel: "firstmate", sendToken: "a".repeat(48) })): void {
  window.history.replaceState(null, "", `/${search}`);
  const body = /<body([^>]*)>([\s\S]*)<\/body>/.exec(html)!;
  document.body.setAttribute("data-send-token", /data-send-token="([^"]+)"/.exec(body[1]!)![1]!);
  document.body.innerHTML = body[2]!.replace(/<script>[\s\S]*<\/script>/, "");
  const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]!;
  new Function(script)();
}

function open(sessionId: string, messages: Array<{ id: string; role: string; html: string; timestamp?: string }>): FakeEventSource {
  const stream = FakeEventSource.instances.at(-1)!;
  stream.emit("session", { id: sessionId, title: sessionId, updatedAt: "2026-10-05T20:00:00.000Z", assistantLabel: "firstmate" });
  stream.emit("update", { order: messages.map((m) => m.id), messages, working: false });
  return stream;
}

async function type(text: string): Promise<void> {
  const input = document.getElementById("input") as HTMLTextAreaElement;
  input.value = text;
  input.dispatchEvent(new Event("input"));
  document.getElementById("composer")!.dispatchEvent(new Event("submit", { cancelable: true }));
  await settle();
}

const pending = (): string[] => Array.from(document.querySelectorAll(".msg.pending")).map((el) => el.textContent ?? "");

beforeEach(() => {
  localStorage.clear();
  FakeEventSource.instances = [];
  sendResponse = { id: "note:1", timestamp: "2026-10-05T20:01:00.000Z" };
  blips = 0;
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/api/send" ? json(sendResponse) : url === "/api/plan" ? json({ plan: planResponse }) : url === "/api/commands" ? json({ commands: COMMANDS }) : json({ assistantLabel: "firstmate", sessions: SESSIONS }))));
  window.scrollTo = () => {};
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("conversation page", () => {
  it("runs the page Core serves under tsx, where inlined functions carry __name", async () => {
    const page = join(dirname(fileURLToPath(import.meta.url)), "..", "page.ts");
    const render = `import { renderPage } from ${JSON.stringify(page)}; process.stdout.write(renderPage({ assistantLabel: "firstmate", sendToken: "${"a".repeat(48)}" }));`;
    const html = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", render], { encoding: "utf8" });
    expect(html).toContain("__name(");
    load("", html);
    await settle();
    open("latest", [{ id: "u1", role: "user", html: "<p>hello</p>" }]);
    expect(document.querySelectorAll(".msg")).toHaveLength(1);
    expect(document.getElementById("prediction-toggle")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("says at once what it is doing, then updates that one line in place until the answer replaces it", async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn((url: string) => (url === "/api/send"
      ? new Promise<Response>((resolve) => { release = resolve; })
      : Promise.resolve(url === "/api/plan" ? json({ plan: null }) : url === "/api/commands" ? json({ commands: [] }) : json({ sessions: SESSIONS })))));
    load("");
    await settle();
    const stream = open("latest", [{ id: "u1", role: "user", html: "<p>hello</p>" }]);
    stream.emit("update", { order: ["u1"], messages: [], working: true, activity: "Reading the inbox", lastActivity: new Date().toISOString() });
    const lines = () => Array.from(document.querySelectorAll(".queued")).map((el) => el.textContent);
    const dots = () => document.getElementById("working")!.hidden;

    // Before the server has answered: Flyd already says it has it.
    await type("fix the good neighbours site");
    expect(lines()).toEqual([RECEIVED]);
    expect(dots()).toBe(true);

    release(json({ id: "note:9", timestamp: "2026-10-05T20:01:00.000Z", waiting: "Passing this to firstmate - Good Neighbours" }));
    await settle();
    expect(lines()).toEqual(["Passing this to firstmate - Good Neighbours"]);

    // The delivered note takes over the same line, then firstmate picks it up and works.
    const question = { id: "note:9", role: "user", html: "<p>fix the good neighbours site</p>" };
    stream.emit("update", { order: ["u1", "note:9"], messages: [{ ...question, waiting: "Passing this to firstmate - Good Neighbours" }], working: true, lastActivity: new Date().toISOString() });
    expect(pending()).toEqual([]);
    const line = document.querySelector(".queued")!;
    expect(line.classList.contains("swap")).toBe(false);
    stream.emit("update", { order: ["u1", "note:9"], messages: [{ ...question, waiting: "Firstmate is on it: running the site's tests" }], working: true, lastActivity: new Date().toISOString() });
    expect(lines()).toEqual(["Firstmate is on it: running the site's tests"]);
    expect(document.querySelector(".queued")).toBe(line);
    expect(line.classList.contains("swap")).toBe(true);
    expect(dots()).toBe(true);

    // The answer replaces the line.
    stream.emit("update", { order: ["u1", "note:9", "r9"], messages: [{ ...question }, { id: "r9", role: "assistant", html: "<p>Fixed, sir.</p>", answers: "note:9" }], working: false });
    expect(lines()).toEqual([]);
  });

  it("stills a line that says the answer failed, and keeps the working dots", async () => {
    load("");
    await settle();
    const stream = open("latest", [{ id: "u1", role: "user", html: "<p>hello</p>" }]);
    const question = { id: "ask:1", role: "user", html: "<p>what's the weather?</p>" };
    stream.emit("update", { order: ["u1", "ask:1"], messages: [{ ...question, waiting: "Answering" }], working: true, lastActivity: new Date().toISOString() });
    const line = document.querySelector(".queued")!;
    expect(line.classList.contains("still")).toBe(false);
    expect(document.getElementById("working")!.hidden).toBe(true);

    stream.emit("update", { order: ["u1", "ask:1"], messages: [{ ...question, waiting: "Flyd couldn't answer this: offline", waitingFailed: true }], working: true, lastActivity: new Date().toISOString() });
    expect(document.querySelector(".queued")).toBe(line);
    expect(line.classList.contains("still")).toBe(true);
    expect(document.getElementById("working")!.hidden).toBe(false);

    stream.emit("update", { order: ["u1", "ask:1"], messages: [{ ...question, waiting: "Answering" }], working: true, lastActivity: new Date().toISOString() });
    expect(line.classList.contains("still")).toBe(false);
  });

  it("swaps the optimistic copy for the delivered note when it arrives", async () => {
    load("");
    await settle();
    const stream = open("latest", [{ id: "u1", role: "user", html: "<p>hello</p>" }]);
    await type("run the flyd viewer");
    expect(pending()).toEqual([expect.stringContaining("run the flyd viewer")]);
    expect(pending()[0]).toContain("Sent");

    stream.emit("update", { order: ["u1", "note:1"], messages: [{ id: "note:1", role: "user", html: "<p>run the flyd viewer</p>" }], working: true });
    expect(pending()).toEqual([]);
    expect(document.querySelectorAll(".msg.user .hl")).toHaveLength(2);
  });

  it("drops a pending copy when the reader switches session", async () => {
    load("?session=latest");
    await settle();
    open("latest", []);
    await type("a message that has not shown up yet");
    expect(pending()).toHaveLength(1);

    const picker = document.getElementById("picker") as HTMLSelectElement;
    picker.value = "older";
    picker.dispatchEvent(new Event("change"));
    open("older", [{ id: "o1", role: "assistant", html: "<p>old reply</p>" }]);
    expect(pending()).toEqual([]);
    expect(document.querySelectorAll(".msg")).toHaveLength(1);
  });

  it("says where a message sent from an older session will show", async () => {
    load("?session=older");
    await settle();
    open("older", []);
    await type("hi from the archive");
    expect(pending()[0]).toContain("shows in the latest session");
  });

  it("keeps a saved-but-not-woken warning on the delivered note instead of reporting it unsent", async () => {
    sendResponse = { id: "note:1", timestamp: "2026-10-05T20:01:00.000Z", warning: "fm-inbox: firstmate was NOT woken" };
    load("");
    await settle();
    const stream = open("latest", []);
    await type("are you there?");
    expect(document.querySelector(".msg.failed")).toBeNull();
    expect((document.getElementById("input") as HTMLTextAreaElement).value).toBe("");

    stream.emit("update", { order: ["note:1"], messages: [{ id: "note:1", role: "user", html: "<p>are you there?</p>" }], working: false });
    expect(pending()).toEqual([]);
    expect(document.querySelector(".msg.user .state")?.textContent).toBe("saved, but not passed on yet");
  });

  it("previews a pasted image, sends it with the message, and shows transcript images as thumbnails", async () => {
    load("");
    await settle();
    const stream = open("latest", [{ id: "u1", role: "user", html: "<p>broken</p>", images: ["t10.0"] } as never]);
    const shot = document.querySelector(".msg.user .shot img") as HTMLImageElement;
    expect(shot.getAttribute("src")).toBe("/api/image?session=latest&id=t10.0");
    (document.querySelector(".msg.user .shot") as HTMLElement).click();
    expect((document.getElementById("lightbox") as HTMLElement).hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect((document.getElementById("lightbox") as HTMLElement).hidden).toBe(true);

    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const paste = new Event("paste", { cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { items: [{ kind: "file", getAsFile: () => new File([png], "shot.png", { type: "image/png" }) }] },
    });
    document.getElementById("input")!.dispatchEvent(paste);
    for (let i = 0; i < 20 && !document.querySelector(".attachment img"); i += 1) await settle();
    expect(document.querySelectorAll(".attachment img")).toHaveLength(1);
    expect((document.getElementById("send") as HTMLButtonElement).disabled).toBe(false);

    await type("");
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/send")!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ session: "latest", text: "", images: [{ mediaType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" }], files: [] });
    expect(document.querySelectorAll(".attachment")).toHaveLength(0);
    expect(document.querySelectorAll(".msg.pending .shot img")).toHaveLength(1);
    void stream;
  });

  it("attaches a document dropped from Finder as a removable chip and sends it under its own name", async () => {
    load("");
    await settle();
    open("latest", [{ id: "u1", role: "user", html: "<p>the brief</p>", files: ["Brief v2.pdf"] } as never]);
    expect(document.querySelector(".msg.user .doc")?.textContent).toBe("PDFBrief v2.pdf");

    const drop = (files: File[]): void => {
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: { files } });
      document.body.dispatchEvent(event);
    };
    const pdf = new File(["%PDF-1.3 hello"], "Q3 report.pdf", { type: "application/pdf" });
    const notes = new File(["# notes"], "notes.md", { type: "" });
    drop([pdf, new File(["MZ"], "setup.exe", { type: "application/x-msdownload" })]);
    for (let i = 0; i < 20 && !document.querySelector(".attachment.file"); i += 1) await settle();
    expect(Array.from(document.querySelectorAll(".attachment.file .name")).map((n) => n.textContent)).toEqual(["Q3 report.pdf"]);
    expect(document.getElementById("problem")!.textContent).toContain("setup.exe");
    expect((document.getElementById("send") as HTMLButtonElement).disabled).toBe(false);

    (document.querySelector(".attachment.file button") as HTMLButtonElement).click();
    expect(document.querySelectorAll(".attachment")).toHaveLength(0);
    expect((document.getElementById("send") as HTMLButtonElement).disabled).toBe(true);

    drop([pdf, notes]);
    for (let i = 0; i < 20 && document.querySelectorAll(".attachment.file").length < 2; i += 1) await settle();
    await type("read these");
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/send")!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      session: "latest",
      text: "read these",
      images: [],
      files: [{ name: "Q3 report.pdf", data: btoa("%PDF-1.3 hello") }, { name: "notes.md", data: btoa("# notes") }],
    });
    expect(Array.from(document.querySelectorAll(".msg.pending .doc .name")).map((n) => n.textContent)).toEqual(["Q3 report.pdf", "notes.md"]);
  });

  it("keeps what he was typing and attaching through a restart, caret and chips included, until it is sent", async () => {
    // Core's draft record; the page's own storage is lost too, as when the view comes back on another port.
    let kept: Record<string, unknown> | null = null;
    const stored = new Map<string, Record<string, unknown>>();
    let release: ((response: Response) => void) | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/draft/attachment") {
        const id = String(stored.size + 1).padStart(24, "0");
        const body = JSON.parse(String(init!.body)) as Record<string, unknown>;
        stored.set(id, { id, ...body });
        const { data: _data, ...meta } = stored.get(id)!;
        return json(meta);
      }
      if (url === "/api/draft") {
        const draft = (JSON.parse(String(init!.body)) as { draft: Record<string, unknown> & { text: string; attachments: Array<{ id: string }> } }).draft;
        kept = draft.text || draft.attachments.length ? draft : null;
        return json({ ok: true });
      }
      if (url.startsWith("/api/draft?")) {
        return json({ draft: kept && { ...kept, attachments: (kept.attachments as Array<{ id: string }>).map((a) => stored.get(a.id)) } });
      }
      if (url === "/api/send") return new Promise<Response>((resolve) => { release = resolve; });
      return json({ sessions: SESSIONS });
    }));
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    load("");
    await settle();
    open("latest", []);

    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const paste = new Event("paste", { cancelable: true });
    // A screenshot and a document pasted together (earlier tests' pages still listen for drops on the document).
    const pdf = new File(["%PDF-1.3 hello"], "Q3 report.pdf", { type: "application/pdf" });
    Object.defineProperty(paste, "clipboardData", { value: { items: [{ kind: "file", getAsFile: () => new File([png], "shot.png", { type: "image/png" }) }, { kind: "file", getAsFile: () => pdf }] } });
    document.getElementById("input")!.dispatchEvent(paste);
    for (let i = 0; i < 20 && stored.size < 2; i += 1) await settle();
    const input = document.getElementById("input") as HTMLTextAreaElement;
    input.value = "make the hero calmer and the footer wider";
    input.setSelectionRange(9, 14);
    input.dispatchEvent(new Event("input"));
    await wait(350);
    expect(kept).toMatchObject({ text: "make the hero calmer and the footer wider", selectionStart: 9, selectionEnd: 14 });
    expect((kept!.attachments as unknown[])).toHaveLength(2);

    // Flyd is reinstalled: a new page, nothing in its own storage, the draft from Core.
    localStorage.clear();
    load("");
    await settle();
    open("latest", []);
    for (let i = 0; i < 20 && !document.querySelector(".attachment.file"); i += 1) await settle();
    const back = document.getElementById("input") as HTMLTextAreaElement;
    expect(back.value).toBe("make the hero calmer and the footer wider");
    expect([back.selectionStart, back.selectionEnd]).toEqual([9, 14]);
    expect(document.querySelectorAll(".attachment img")).toHaveLength(1);
    expect(Array.from(document.querySelectorAll(".attachment.file .name")).map((n) => n.textContent)).toEqual(["Q3 report.pdf"]);
    expect(document.getElementById("usage")!.getAttribute("data-note")).toBe("your draft is safe");

    // On its way: still kept, in case the window goes before it lands.
    document.getElementById("composer")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await wait(350);
    expect(kept).toMatchObject({ text: "make the hero calmer and the footer wider" });
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/send")!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({ text: "make the hero calmer and the footer wider", images: [{ mediaType: "image/png" }], files: [{ name: "Q3 report.pdf", data: btoa("%PDF-1.3 hello") }] });

    // Landed: gone, and a later restart brings back an empty box.
    release!(json(sendResponse));
    await settle();
    expect(kept).toBeNull();
    load("");
    await settle();
    expect((document.getElementById("input") as HTMLTextAreaElement).value).toBe("");
    expect(document.querySelectorAll(".attachment")).toHaveLength(0);
  });

  it("brings back what was typed from the page's own copy when Core missed the last change", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.startsWith("/api/draft?") ? json({ draft: { text: "older", selectionStart: 5, selectionEnd: 5, attachments: [], savedAt: 1 } }) : json({ sessions: SESSIONS }))));
    localStorage.setItem("flyd-view-draft:latest", JSON.stringify({ text: "older and newer", selectionStart: 3, selectionEnd: 3, attachments: [], savedAt: 2 }));
    load("");
    await settle();
    expect((document.getElementById("input") as HTMLTextAreaElement).value).toBe("older and newer");
  });

  it("never overwrites Core's draft before it has been read back", async () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    // Earlier tests' pages finish their own pending saves first.
    await wait(350);
    localStorage.clear();
    const posts: Array<Record<string, unknown>> = [];
    let answer: ((response: Response) => void) | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/draft") { posts.push((JSON.parse(String(init!.body)) as { draft: Record<string, unknown> }).draft); return json({ ok: true }); }
      if (url.startsWith("/api/draft?")) return new Promise<Response>((resolve) => { answer = resolve; });
      return json({ sessions: SESSIONS });
    }));
    load("");
    await settle();
    // He clicks into the box while the stored draft is still on its way back.
    const input = document.getElementById("input") as HTMLTextAreaElement;
    input.focus();
    document.dispatchEvent(new Event("selectionchange"));
    await wait(350);
    expect(posts).toEqual([]);
    answer!(json({ draft: { text: "the long note", selectionStart: 13, selectionEnd: 13, attachments: [], savedAt: 1 } }));
    for (let i = 0; i < 10 && !input.value; i += 1) await settle();
    expect(input.value).toBe("the long note");
    expect(posts.every((draft) => draft.text === "the long note")).toBe(true);
  });

  it("blips once for a message that went out, and stays quiet when it did not", async () => {
    load("");
    await settle();
    open("latest", []);
    await type("ping");
    expect(blips).toBe(1);

    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/api/send" ? json({ error: "firstmate did not take the message: no" }, 502) : json({ sessions: SESSIONS }))));
    await type("pong");
    expect(document.querySelector(".msg.failed")).not.toBeNull();
    expect(blips).toBe(1);
  });

  it("recovers from a restarted viewer's new token by fetching it and retrying once", async () => {
    const fresh = "b".repeat(48);
    const sends: Array<string | null> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/token") return json({ token: fresh });
      if (url === "/api/send") {
        const token = new Headers(init?.headers).get("x-flyd-view-token");
        sends.push(token);
        return token === fresh ? json(sendResponse) : json({ error: "missing or wrong token" }, 403);
      }
      return json({ sessions: SESSIONS });
    }));
    load("");
    await settle();
    open("latest", []);
    await type("still there?");
    expect(sends).toEqual(["a".repeat(48), fresh]);
    expect(pending()[0]).toContain("Sent");

    // The new token sticks; and a token that keeps failing gives up after one retry.
    await type("again");
    expect(sends.slice(2)).toEqual([fresh]);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/api/token" ? json({ token: fresh }) : url === "/api/send" ? json({ error: "missing or wrong token" }, 403) : json({ sessions: SESSIONS }))));
    await type("third");
    expect(document.querySelector(".msg.failed .state")?.textContent).toContain("missing or wrong token");
  });

  it("leads long replies with their summary, opens the full reply on demand, and switches to full view", async () => {
    load("");
    await settle();
    open("latest", [
      { id: "r1", role: "assistant", html: "<p>The whole long reply.</p>", summary: { html: "<p>Menu bar fixed.</p>", source: "model" } } as never,
      { id: "r2", role: "assistant", html: "<p>Short and whole.</p>" },
    ]);
    const reply = document.querySelector("article.assistant") as HTMLElement;
    expect(reply.querySelector(".summary")!.textContent).toBe("Menu bar fixed.");
    expect(document.documentElement.getAttribute("data-view")).toBe("summary");
    expect(reply.classList.contains("open")).toBe(false);
    const more = reply.querySelector(".more") as HTMLButtonElement;
    expect(more.textContent).toBe("more");
    more.click();
    expect(reply.classList.contains("open")).toBe(true);
    expect(more.textContent).toBe("less");
    expect(document.querySelectorAll("article.assistant")[1]!.querySelector(".summary")).toBeNull();

    // One switch, FULL: off is Flyd's reading, on is everything as written.
    const mode = document.getElementById("mode") as HTMLButtonElement;
    expect(mode.getAttribute("role")).toBe("switch");
    expect(mode.textContent).toBe("full");
    expect(mode.getAttribute("aria-checked")).toBe("false");
    mode.click();
    expect(document.documentElement.getAttribute("data-view")).toBe("full");
    expect(localStorage.getItem("flyd-view-mode")).toBe("full");
    expect(mode.getAttribute("aria-checked")).toBe("true");
    expect(mode.textContent).toBe("full");
    mode.click();
    expect(document.documentElement.getAttribute("data-view")).toBe("summary");
    expect(mode.getAttribute("aria-checked")).toBe("false");
  });

  it("offers firstmate's own words as written under Flyd's whole reading", async () => {
    load("");
    await settle();
    open("latest", [{ id: "r1", role: "assistant", html: "<p>Raw words, PR #12.</p>", summary: { html: "<p>The whole reply, briefed.</p>", source: "brief" } } as never]);
    const reply = document.querySelector("article.assistant") as HTMLElement;
    expect(reply.querySelector(".summary")!.textContent).toBe("The whole reply, briefed.");
    expect(reply.querySelector(".more")!.textContent).toBe("as written");
  });

  it("shows what the assistant is doing in small text under the dots, and clears it when it stops", async () => {
    load("");
    await settle();
    const stream = open("latest", [{ id: "u1", role: "user", html: "<p>fix the cards</p>" }]);
    const recent = new Date().toISOString();
    stream.emit("update", { order: ["u1"], messages: [], working: true, activity: "Recolouring the cards", lastActivity: recent });
    expect(document.getElementById("working")!.hidden).toBe(false);
    expect(document.getElementById("doing")!.textContent).toBe("Recolouring the cards");
    stream.emit("update", { order: ["u1"], messages: [], working: false, lastActivity: recent });
    expect(document.getElementById("doing")!.textContent).toBe("");
  });

  it("opens a reply with something to act on, and mutes routine ones", async () => {
    load("");
    await settle();
    open("latest", [
      { id: "r1", role: "assistant", html: "<pre><code>rule</code></pre>", summary: { html: "<p>Four rules.</p>", source: "author" }, expanded: true } as never,
      { id: "r2", role: "assistant", html: "<p>Captain, shipshape.</p>", routine: true } as never,
    ]);
    const [rules, routine] = Array.from(document.querySelectorAll(".msg.assistant"));
    expect(rules!.classList.contains("open")).toBe(true);
    expect(rules!.querySelector(".more")!.textContent).toBe("less");
    expect(routine!.classList.contains("routine")).toBe(true);
  });

  it("asks for a message to Flyd in Flyd's window", () => {
    document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(renderPage({ assistantLabel: "Flyd", sendToken: "a".repeat(48) }))![1]!.replace(/<script>[\s\S]*<\/script>/, "");
    const input = document.getElementById("input") as HTMLTextAreaElement;
    expect(input.placeholder).toBe("Message Flyd");
    expect(document.body.textContent).not.toMatch(/firstmate/i);
  });

  it("shows a question waiting under itself until its own answer arrives, with relayed updates set apart", async () => {
    load("");
    await settle();
    const stream = open("latest", [
      { id: "note:1", role: "user", html: "<p>whats on in bkk tonight?</p>", waiting: "passed to firstmate" } as never,
      { id: "t1", role: "assistant", html: "<p>Sir, the island filter is still paused.</p>", aside: true } as never,
      { id: "t2", role: "assistant", html: "<p>Sir, PR 61 is green.</p>", aside: true } as never,
    ]);
    const question = document.querySelector(".msg.user")!;
    expect(question.querySelector(".queued")!.textContent).toBe("passed to firstmate");
    const relays = Array.from(document.querySelectorAll(".msg.aside"));
    expect(relays.map((el) => el.classList.contains("aside-first"))).toEqual([true, false]);
    expect(relays[0]!.querySelector(".aside-label")!.textContent).toBe("update");

    stream.emit("update", {
      order: ["note:1", "note-reply:1", "t1", "t2"],
      messages: [
        { id: "note:1", role: "user", html: "<p>whats on in bkk tonight?</p>" },
        { id: "note-reply:1", role: "assistant", html: "<p>Art bangkok, sir.</p>", answers: "note:1", timestamp: "2026-10-09T03:22:45Z" },
      ],
      working: false,
    });
    expect(question.querySelector(".queued")).toBeNull();
    const shown = Array.from(document.querySelectorAll(".msg")).map((el) => el.querySelector(".body")!.textContent);
    expect(shown).toEqual(["whats on in bkk tonight?", "Art bangkok, sir.", "Sir, the island filter is still paused.", "Sir, PR 61 is green."]);
    expect(document.querySelector(".msg.answer")!.classList.contains("aside")).toBe(false);
  });

  it("swaps a pending digest summary for the model's when it arrives", async () => {
    load("");
    await settle();
    const stream = open("latest", [
      { id: "r1", role: "assistant", html: "<p>Long.</p>", summary: { html: "<p>First sentence.</p>", source: "digest", pending: true } } as never,
    ]);
    expect(document.querySelector(".summary")!.classList.contains("pending")).toBe(true);
    stream.emit("update", { order: ["r1"], messages: [{ id: "r1", role: "assistant", html: "<p>Long.</p>", summary: { html: "<p>Plain English.</p>", source: "model" } }], working: false });
    expect(document.querySelectorAll(".summary")).toHaveLength(1);
    expect(document.querySelector(".summary")!.textContent).toBe("Plain English.");
    expect(document.querySelector(".summary")!.classList.contains("pending")).toBe(false);
  });

  it("recalls earlier messages with Up on the first line and restores the draft with Down", async () => {
    load("");
    await settle();
    open("latest", [
      { id: "u1", role: "user", html: "<p>first ask</p>" },
      { id: "r1", role: "assistant", html: "<p>reply</p>" },
      { id: "u2", role: "user", html: "<p>second ask</p>" },
      { id: "u3", role: "user", html: "<p>second ask</p>" },
    ]);
    const input = document.getElementById("input") as HTMLTextAreaElement;
    const press = (key: string) => {
      const event = new KeyboardEvent("keydown", { key, cancelable: true });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    };
    input.value = "half-typed draft";
    input.setSelectionRange(input.value.length, input.value.length);

    expect(press("ArrowUp")).toBe(true);
    expect(input.value).toBe("second ask");
    press("ArrowUp");
    expect(input.value).toBe("first ask");
    press("ArrowUp");
    expect(input.value).toBe("first ask");
    press("ArrowDown");
    expect(input.value).toBe("second ask");
    press("ArrowDown");
    expect(input.value).toBe("half-typed draft");
    expect(press("ArrowDown")).toBe(false);
  });

  it("leaves Up to move the caret inside a multi-line draft, and includes messages just sent", async () => {
    load("");
    await settle();
    open("latest", [{ id: "u1", role: "user", html: "<p>older</p>" }]);
    const input = document.getElementById("input") as HTMLTextAreaElement;
    input.value = "line one\nline two";
    input.setSelectionRange(input.value.length, input.value.length);
    const up = new KeyboardEvent("keydown", { key: "ArrowUp", cancelable: true });
    input.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(false);
    expect(input.value).toBe("line one\nline two");

    input.value = "";
    await type("just sent");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", cancelable: true }));
    expect(input.value).toBe("just sent");
  });

  it("shows context use and the plan's limits where the key hints used to be", async () => {
    planResponse = { source: "quota-axi", windows: [{ label: "session", percentRemaining: 72.4 }, { label: "week", percentRemaining: 41 }] };
    load("");
    await settle();
    const stream = open("latest", []);
    stream.emit("update", { order: [], messages: [], working: false, context: { tokens: 629_918, window: 1_000_000 } });
    const usage = document.getElementById("usage")!.textContent!;
    expect(usage).toContain("context 63% · 630k of 1M");
    expect(usage).toContain("session 72% left");
    expect(usage).toContain("week 41% left");
    expect(document.body.textContent).not.toContain("enter to send");
    planResponse = null;
  });

  it("labels the send button AHOY, with a spoken name that says what it does", async () => {
    load("");
    await settle();
    const send = document.getElementById("send") as HTMLButtonElement;
    expect(send.textContent).toBe("AHOY");
    expect(send.getAttribute("aria-label")).toBe("Send to firstmate");
  });

  it("takes push-to-talk: shows the words as they are heard and sends them on release", async () => {
    load("");
    await settle();
    open("latest", []);
    const input = document.getElementById("input") as HTMLTextAreaElement;
    const composer = document.getElementById("composer")!;
    const voice = (window as unknown as { flydVoice: Record<string, (text?: string) => void> }).flydVoice;

    voice.start!();
    expect(composer.classList.contains("listening")).toBe(true);
    voice.draft!("open the");
    expect(input.value).toBe("open the");
    voice.draft!("open the deals page");
    voice.transcribing!();
    expect(composer.classList.contains("transcribing")).toBe(true);
    voice.send!("Open the deals page.");
    await settle();

    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/send")!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({ session: "latest", text: "Open the deals page." });
    expect(pending()[0]).toContain("Open the deals page.");
    expect(composer.classList.contains("listening")).toBe(false);
    expect(input.value).toBe("");
  });

  it("keeps what was typed before talking, and restores it when nothing was heard", async () => {
    load("");
    await settle();
    open("latest", []);
    const input = document.getElementById("input") as HTMLTextAreaElement;
    const voice = (window as unknown as { flydVoice: Record<string, (text?: string) => void> }).flydVoice;
    input.value = "about the menu:";

    voice.start!();
    voice.draft!("make it smaller");
    expect(input.value).toBe("about the menu: make it smaller");
    voice.cancel!("I didn't catch that - try again");
    expect(input.value).toBe("about the menu:");
    expect(document.getElementById("problem")!.textContent).toBe("I didn't catch that - try again");
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/send")).toBe(false);
  });

  it("sends a push-to-talk message once the conversation has loaded, without taking focus", async () => {
    load("");
    await settle();
    const voice = (window as unknown as { flydVoice: Record<string, (text?: string) => void> }).flydVoice;
    const before = document.activeElement;
    voice.start!();
    expect(document.activeElement).toBe(before);
    voice.send!("Check the deals page.");
    await settle();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/send")).toBe(false);

    open("latest", []);
    await new Promise((resolve) => setTimeout(resolve, 450));
    await settle();
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/send")!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({ session: "latest", text: "Check the deals page." });
  });

  it("highlights pasted code as one block, not line by line", async () => {
    load("");
    await settle();
    open("latest", [{ id: "u1", role: "user", html: "<p>change to</p>\n<pre><code>@media (max-width: 640px) {\n    h2 {\n        font-size: 10vw;\n    }\n}\n</code></pre>" }]);
    const message = document.querySelector(".msg.user")!;
    expect(message.querySelectorAll(".hl")).toHaveLength(1);
    expect(message.querySelector("pre .hl")).toBeNull();
    expect(message.querySelector("pre code")!.textContent).toContain("    h2 {");
  });

  // Reproduction (2026-10-07): typing "/" in the message box did nothing.
  it("lists skills when '/' is typed, filters, completes with Enter and runs on send", async () => {
    load("");
    await settle();
    open("latest", [{ id: "u1", role: "user", html: "<p>older</p>" }]);
    const input = document.getElementById("input") as HTMLTextAreaElement;
    const menu = document.getElementById("commands")!;
    const typeText = async (text: string) => {
      input.value = text;
      input.dispatchEvent(new Event("input"));
      await settle();
    };
    const key = (name: string) => {
      const event = new KeyboardEvent("keydown", { key: name, cancelable: true });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    };

    await typeText("/");
    expect(menu.hidden).toBe(false);
    expect(Array.from(menu.querySelectorAll(".name")).map((n) => n.textContent)).toEqual(["/caveman:caveman", "/design-review", "/design-shotgun", "/review"]);

    await typeText("/des");
    expect(Array.from(menu.querySelectorAll(".name")).map((n) => n.textContent)).toEqual(["/design-review", "/design-shotgun"]);
    expect(key("ArrowDown")).toBe(true);
    expect(menu.querySelector(".selected .name")!.textContent).toBe("/design-shotgun");
    expect(key("ArrowUp")).toBe(true);
    expect(input.value).toBe("/des");
    expect(key("Enter")).toBe(true);
    expect(input.value).toBe("/design-review ");
    expect(menu.hidden).toBe(true);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/send")).toBe(false);

    input.value = "/design-review the cards look flat";
    key("Enter");
    await settle();
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/send")!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({ text: "/design-review the cards look flat" });
  });

  it("says when nothing matches and closes on Escape", async () => {
    load("");
    await settle();
    open("latest", []);
    const input = document.getElementById("input") as HTMLTextAreaElement;
    const menu = document.getElementById("commands")!;
    input.value = "/zzz";
    input.dispatchEvent(new Event("input"));
    await settle();
    expect(menu.textContent).toContain("No skill or command matches /zzz");
    const esc = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    input.dispatchEvent(esc);
    expect(menu.hidden).toBe(true);
  });
});

describe("header and artefact view", () => {
  const SHOW = {
    title: "Your move, sir.",
    summary: "1 call waits on you, 2 under way.",
    live: true,
    doing: "Running the Swift tests",
    counts: { call: 1, live: 2, landed: 30 },
    landedByDay: [{ day: "2026-10-09", count: 2 }, { day: "2026-10-10", count: 1 }],
    items: [
      { id: "call:jev", kind: "call", headline: "Review the Jev decision log", why: "", detail: "Captain decides keep or remove" },
      { id: "live:a", kind: "live", headline: "Header controls", why: "", detail: "Working on it now", project: "Flyd",
        shots: [{ src: "/api/artefact-shot?task=a&file=after.png", label: "after.png" }], links: [{ label: "flyd #85", url: "https://github.com/GeorgeGally/flyd/pull/85" }] },
      { id: "news:memory-0", kind: "news", headline: "Bloom gets finished", why: "from your memory" },
    ],
  };

  it("uses one kind of control: a switch whose track says on or off, never brackets", async () => {
    load("");
    await settle();
    const controls = Array.from(document.querySelectorAll("header .controls button")).map((button) => button.textContent);
    expect(controls).toEqual(["taste", "full", "light", "artefact"]);
    const switches = Array.from(document.querySelectorAll('header .controls button[role="switch"]')).map((button) => button.id);
    expect(switches).toEqual(["mode", "theme", "flip"]);
    const flip = document.getElementById("flip")!;
    expect(flip.getAttribute("aria-checked")).toBe("false");
    flip.click();
    expect(document.documentElement.getAttribute("data-screen")).toBe("show");
    expect(flip.getAttribute("aria-checked")).toBe("true");
    expect(flip.textContent).toBe("artefact");
    const theme = document.getElementById("theme")!;
    theme.click();
    expect(theme.getAttribute("aria-checked")).toBe("true");
    expect(theme.textContent).toBe("light");
  });

  it("plays Flyd's boxes as scenes, one at a time, calls first, with the readouts under them", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const boxes = boxesOf(SHOW as ShowScreen, { plan: { source: "quota-axi", windows: [{ label: "weekly", percentRemaining: 10 }] } });
    stream.emit("update", { order: [], messages: [], working: true, show: SHOW, boxes });
    document.getElementById("flip")!.click();

    // One scene holds the stage: the call, never every box at once.
    expect(document.querySelectorAll("#show h1")).toHaveLength(1);
    expect(document.getElementById("scene-head")!.textContent).toBe("Review the Jev decision log");
    expect(document.getElementById("scene-line")!.textContent).toBe("Captain decides keep or remove.");
    expect(document.querySelector("#scene-meta .kind")!.textContent).toBe("needs you");
    // The call, then what Flyd sees coming (the plan limit), then the stories.
    const ticks = Array.from(document.querySelectorAll("#ticks button")).map((tick) => tick.getAttribute("aria-label"));
    expect(ticks).toEqual([
      "needs you: Review the Jev decision log",
      "coming up: Claude weekly limit: 10% left.",
      "under way: Header controls",
      "from your memory: Bloom gets finished",
    ]);

    // The arrow brings the next scene up like a title card; the story's screenshot shows large.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(document.getElementById("scene-head")!.textContent).toBe("Header controls");
    expect(document.querySelector("#scene-meta a")!.textContent).toBe("flyd #85");
    expect(document.querySelector(".scene-shot .main")!.getAttribute("src")).toBe(`/api/artefact-shot?task=a&file=after.png&token=${"a".repeat(48)}`);
    expect(document.getElementById("scene")!.classList.contains("has-shot")).toBe(true);

    // The instruments are small readouts, each label on its own line.
    expect(Array.from(document.querySelectorAll(".ro")).map((node) => (node as HTMLElement).dataset.id)).toEqual(["plan", "landed-week", "work-state"]);
    expect(Array.from(document.querySelectorAll(".ro-row b")).map((node) => node.textContent)).toEqual(["90%"]);
    expect(document.querySelector('.ro[data-id="landed-week"] .ro-value')!.textContent).toBe("3 landed this week");
    expect(Array.from(document.querySelectorAll('.ro[data-id="work-state"] .ro-legend span')).map((node) => node.textContent)).toEqual(["1 need you", "2 under way"]);
    expect(document.getElementById("show-doing")!.textContent).toBe("Running the Swift tests");
  });

  it("goes back to the whole conversation, and typing there talks to Flyd", async () => {
    load("");
    await settle();
    const stream = open("latest", [{ id: "r1", role: "assistant", html: "<p>The whole reply.</p>" }]);
    stream.emit("update", { order: ["r1"], messages: [], working: false, show: SHOW, boxes: boxesOf(SHOW as ShowScreen) });
    const flip = document.getElementById("flip")!;
    flip.click();
    expect(document.documentElement.getAttribute("data-screen")).toBe("show");
    // The conversation is never squeezed onto the artefact screen.
    expect(document.querySelector("#show .msg, #show .strip")).toBeNull();
    flip.click();
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(document.documentElement.getAttribute("data-screen")).toBe("terminal");
    expect((document.getElementById("show") as HTMLElement).hidden).toBe(true);
    expect(localStorage.getItem("flyd-view-screen")).toBe("terminal");

    flip.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "h" }));
    expect(document.documentElement.getAttribute("data-screen")).toBe("terminal");
    expect(document.activeElement).toBe(document.getElementById("input"));
  });

  it("falls back to the situation when Core sends no boxes", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    stream.emit("update", { order: [], messages: [], working: false, show: { ...SHOW, live: false } });
    expect(document.getElementById("scene-head")!.textContent).toBe("Your move, sir.");
    expect(document.getElementById("show-doing")!.textContent).toBe("Standby");
  });
});
