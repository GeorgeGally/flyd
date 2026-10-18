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

const intervals: Array<ReturnType<typeof setInterval>> = [];

const pending = (): string[] => Array.from(document.querySelectorAll(".msg.pending")).map((el) => el.textContent ?? "");

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  FakeEventSource.instances = [];
  sendResponse = { id: "note:1", timestamp: "2026-10-05T20:01:00.000Z" };
  blips = 0;
  vi.stubGlobal("EventSource", FakeEventSource);
  // Each test loads a fresh page; an earlier page's intervals must not keep running into it.
  const realSetInterval = globalThis.setInterval;
  vi.stubGlobal("setInterval", (...args: Parameters<typeof setInterval>) => {
    const id = realSetInterval(...args);
    intervals.push(id);
    return id;
  });
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/api/send" ? json(sendResponse) : url === "/api/plan" ? json({ plan: planResponse }) : url === "/api/commands" ? json({ commands: COMMANDS }) : json({ assistantLabel: "firstmate", sessions: SESSIONS }))));
  window.scrollTo = () => {};
});

afterEach(() => {
  intervals.splice(0).forEach((id) => clearInterval(id));
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

    release(json({ id: "note:9", timestamp: "2026-10-05T20:01:00.000Z", waiting: "Working on it - Good Neighbours" }));
    await settle();
    expect(lines()).toEqual(["Working on it - Good Neighbours"]);

    // The delivered note takes over the same line, then firstmate picks it up and works.
    const question = { id: "note:9", role: "user", html: "<p>fix the good neighbours site</p>" };
    stream.emit("update", { order: ["u1", "note:9"], messages: [{ ...question, waiting: "Working on it - Good Neighbours" }], working: true, lastActivity: new Date().toISOString() });
    expect(pending()).toEqual([]);
    const line = document.querySelector(".queued")!;
    expect(line.classList.contains("swap")).toBe(false);
    stream.emit("update", { order: ["u1", "note:9"], messages: [{ ...question, waiting: "Running the site's tests" }], working: true, lastActivity: new Date().toISOString() });
    expect(lines()).toEqual(["Running the site's tests"]);
    expect(document.querySelector(".queued")).toBe(line);
    expect(line.classList.contains("swap")).toBe(true);
    expect(dots()).toBe(true);

    // The answer replaces the line.
    stream.emit("update", { order: ["u1", "note:9", "r9"], messages: [{ ...question }, { id: "r9", role: "assistant", html: "<p>Fixed, sir.</p>", answers: "note:9" }], working: false });
    expect(lines()).toEqual([]);
  });

  it("makes the web addresses in a message's line real links, whole", async () => {
    load("");
    await settle();
    const stream = open("latest", [{ id: "u1", role: "user", html: "<p>hello</p>" }]);
    const question = { id: "note:5", role: "user", html: "<p>ship it</p>" };
    stream.emit("update", { order: ["u1", "note:5"], messages: [{ ...question, waiting: "Done and live on https://christmas.example.com/vendors. See [the board](https://example.com/b)", settled: true }], working: false });
    const links = Array.from(document.querySelectorAll(".receipt.outcome a")) as HTMLAnchorElement[];
    expect(links.map((link) => [link.textContent, link.getAttribute("href"), link.target])).toEqual([
      ["https://christmas.example.com/vendors", "https://christmas.example.com/vendors", "_blank"],
      ["the board", "https://example.com/b", "_blank"],
    ]);
    expect(document.querySelector(".receipt.outcome")!.textContent).toBe("Done and live on https://christmas.example.com/vendors. See the board");
  });

  it("puts firstmate's outcome on the read line, in its quiet face, and keeps the running line while work carries on", async () => {
    load("");
    await settle();
    const stream = open("latest", [{ id: "u1", role: "user", html: "<p>hello</p>" }]);
    const question = { id: "note:6", role: "user", html: "<p>next-word guessing is terrible</p>", receipt: "read" };
    stream.emit("update", { order: ["u1", "note:6"], messages: [{ ...question, waiting: "Looking at it" }], working: true, lastActivity: new Date().toISOString() });
    const note = document.querySelector('[data-id="note:6"]') ?? document.querySelectorAll(".msg")[1]!;
    expect(note.querySelector(":scope > .receipt")!.textContent).toBe("read by firstmate");

    stream.emit("update", { order: ["u1", "note:6"], messages: [{ ...question, waiting: "I've logged the poor next-word guessing as a Flyd fix.", settled: true, doing: "Writing the fix brief" }], working: true, lastActivity: new Date().toISOString() });
    const lines = note.querySelectorAll(":scope > .receipt");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toBe("I've logged the poor next-word guessing as a Flyd fix.");
    expect(lines[0]!.classList.contains("outcome")).toBe(true);
    expect(note.querySelector(":scope > .queued")!.textContent).toBe("Writing the fix brief");

    stream.emit("update", { order: ["u1", "note:6"], messages: [{ ...question, waiting: "I've logged the poor next-word guessing as a Flyd fix.", settled: true }], working: false });
    expect(note.querySelector(":scope > .queued")).toBeNull();
    expect(note.querySelector(":scope > .receipt")!.textContent).toBe("I've logged the poor next-word guessing as a Flyd fix.");
  });

  it("stills a line that says the answer failed, and keeps the working dots", async () => {
    load("");
    await settle();
    const stream = open("latest", [{ id: "u1", role: "user", html: "<p>hello</p>" }]);
    const question = { id: "ask:1", role: "user", html: "<p>what's the weather?</p>" };
    stream.emit("update", { order: ["u1", "ask:1"], messages: [{ ...question, waiting: "Working on it" }], working: true, lastActivity: new Date().toISOString() });
    const line = document.querySelector(".queued")!;
    expect(line.classList.contains("still")).toBe(false);
    expect(document.getElementById("working")!.hidden).toBe(true);

    stream.emit("update", { order: ["u1", "ask:1"], messages: [{ ...question, waiting: "Flyd couldn't answer this: offline", waitingFailed: true }], working: true, lastActivity: new Date().toISOString() });
    expect(document.querySelector(".queued")).toBe(line);
    expect(line.classList.contains("still")).toBe(true);
    expect(document.getElementById("working")!.hidden).toBe(false);

    stream.emit("update", { order: ["u1", "ask:1"], messages: [{ ...question, waiting: "Working on it" }], working: true, lastActivity: new Date().toISOString() });
    expect(line.classList.contains("still")).toBe(false);
  });

  it("says under each note whether firstmate has read it, and warns over the box when notes sit unread", async () => {
    load("");
    await settle();
    const fresh = new Date(Date.now() - 60_000).toISOString();
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    const stream = open("latest", [
      { id: "note:1", role: "user", html: "<p>fix the footer</p>", timestamp: old, receipt: "read" },
      { id: "note:2", role: "user", html: "<p>and the header</p>", timestamp: fresh, receipt: "sent" },
      { id: "note:3", role: "user", html: "<p>and the logo</p>", timestamp: old, receipt: "sent" },
      { id: "ask:4", role: "user", html: "<p>what time is it</p>", timestamp: old },
    ] as never);
    const receipt = (id: string) => document.querySelector(`[data-note="${id}"] > .receipt`);
    expect(receipt("note:1")!.textContent).toBe("read by firstmate");
    expect(receipt("note:2")!.textContent).toBe("sent");
    expect(receipt("note:2")!.classList.contains("late")).toBe(false);
    expect(receipt("note:3")!.textContent).toBe("sent · not read by firstmate yet");
    expect(receipt("note:3")!.classList.contains("late")).toBe(true);
    expect(document.querySelectorAll(".receipt")).toHaveLength(3);
    // It sits right under his words, above the screenshot the answer leads with, through every refill.
    stream.emit("update", { order: ["note:1", "note:2", "note:3", "ask:4"], messages: [{ id: "note:1", role: "user", html: "<p>fix the footer</p>", timestamp: old, receipt: "read", shots: ["/tmp/footer.png"] }], working: false });
    expect(receipt("note:1")!.previousElementSibling!.className).toBe("body");

    const banner = document.getElementById("unread")!;
    expect(banner.hidden).toBe(true);
    stream.emit("unread", { count: 1, oldest: old, text: "Firstmate has not read 1 note you sent 10 min ago." });
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toBe("Firstmate has not read 1 note you sent 10 min ago.");

    // Acknowledged: the note reads as read, and the warning goes.
    stream.emit("update", { order: ["note:1", "note:2", "note:3", "ask:4"], messages: [{ id: "note:3", role: "user", html: "<p>and the logo</p>", timestamp: old, receipt: "read" }], working: false });
    stream.emit("unread", { count: 0 });
    expect(receipt("note:3")!.textContent).toBe("read by firstmate");
    expect(receipt("note:3")!.classList.contains("late")).toBe(false);
    expect(banner.hidden).toBe(true);
  });

  it("says stuck coding work over the composer, and clears it when it moves", async () => {
    load("");
    await settle();
    const stream = open("latest", [{ id: "u1", role: "user", html: "<p>hello</p>" }]);
    const banner = document.getElementById("staff")!;
    expect(banner.hidden).toBe(true);
    stream.emit("staff", { text: "I've heard nothing back on \"the footer\" for 3 h." });
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toBe("I've heard nothing back on \"the footer\" for 3 h.");
    stream.emit("staff", { text: "" });
    expect(banner.hidden).toBe(true);
  });

  it("never sends again on its own when Flyd is gone, and gives his words back to send himself", async () => {
    load("");
    await settle();
    open("latest", [{ id: "u1", role: "user", html: "<p>hello</p>" }]);
    const real = vi.mocked(fetch).getMockImplementation()!;
    let down = true;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if ((url === "/api/send" || url === "/api/token") && down) throw new TypeError("Failed to fetch");
      return real(url as string, init);
    });
    await type("ship it after the update");
    expect(pending()[0]).toContain("not sent");
    expect((document.getElementById("input") as HTMLTextAreaElement).value).toBe("ship it after the update");
    down = false;
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await settle();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send")).toHaveLength(1);
  });

  it("never sends again on its own when Flyd answers right after a send failed, and resends once when he taps", async () => {
    load("");
    await settle();
    open("latest", [{ id: "u1", role: "user", html: "<p>hello</p>" }]);
    const real = vi.mocked(fetch).getMockImplementation()!;
    let drop = true;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (url === "/api/send" && drop) throw new TypeError("Failed to fetch");
      return real(url as string, init);
    });
    const sends = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").length;
    await type("merge the island fix");
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await settle();
    expect(sends()).toBe(1);
    expect(document.querySelector(".msg.failed")).toBeNull();
    expect(pending()[0]).toContain("may not have sent");
    // Selecting or clicking his words does not resend; only the resend control does.
    document.querySelector<HTMLElement>(".msg.pending .body")!.click();
    await settle();
    expect(sends()).toBe(1);
    drop = false;
    document.querySelector<HTMLElement>(".msg.pending .resend")!.click();
    await settle();
    expect(sends()).toBe(2);
    expect(pending()[0]).not.toContain("may not have sent");
    expect(document.querySelector(".msg.pending .resend")).toBeNull();
  });

  it("clears a doubtful send when his new note lands, however it was written, and never for an older message", async () => {
    load("");
    await settle();
    const stream = open("latest", [{ id: "u1", role: "user", html: "<p>hello</p>" }]);
    const real = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (url === "/api/send") throw new TypeError("Failed to fetch");
      return real(url as string, init);
    });
    const order = ["u1"];
    const doubtful = () => document.querySelector(".msg.pending .resend");
    async function sendUnsure(send: () => Promise<void>): Promise<void> {
      await send();
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      await settle();
      expect(doubtful()).not.toBeNull();
    }
    function lands(id: string, html: string, timestamp: string, extra: Record<string, unknown> = {}): void {
      order.push(id);
      stream.emit("update", { order: [...order], messages: [{ id, role: "user", html, timestamp, ...extra }], working: true });
    }

    await sendUnsure(() => type("fix **the** sidebar"));
    // An older message of his that only now shows up is not this one.
    lands("note:old", "<p>something from this morning</p>", "2026-10-05T08:00:00.000Z");
    expect(doubtful()).not.toBeNull();
    lands("note:10", "<p>fix <strong>the</strong> sidebar</p>", new Date().toISOString());
    expect(doubtful()).toBeNull();

    await sendUnsure(() => type("- one\n- two"));
    lands("note:11", "<ul><li>one</li><li>two</li></ul>", new Date().toISOString());
    expect(doubtful()).toBeNull();

    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    await sendUnsure(async () => {
      const paste = new Event("paste", { cancelable: true });
      Object.defineProperty(paste, "clipboardData", { value: { items: [{ kind: "file", getAsFile: () => new File([png], "shot.png", { type: "image/png" }) }] } });
      document.getElementById("input")!.dispatchEvent(paste);
      for (let i = 0; i < 20 && !document.querySelector(".attachment img"); i += 1) await settle();
      document.getElementById("composer")!.dispatchEvent(new Event("submit", { cancelable: true }));
      await settle();
    });
    lands("note:12", "", new Date().toISOString(), { images: ["t12.0"] });
    expect(doubtful()).toBeNull();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send")).toHaveLength(3);
  }, 15_000);

  it("keeps a doubtful send's resend control when only some other note of his lands", async () => {
    load("");
    await settle();
    const stream = open("latest", [{ id: "u1", role: "user", html: "<p>hello</p>" }]);
    const real = vi.mocked(fetch).getMockImplementation()!;
    let drop = true;
    let release: () => void = () => {};
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (url === "/api/send" && drop) throw new TypeError("Failed to fetch");
      if (url === "/api/send") {
        await new Promise<void>((resolve) => (release = resolve));
        return json({ id: "note:21", timestamp: new Date().toISOString() });
      }
      return real(url as string, init);
    });
    const order = ["u1"];
    const doubtful = () => document.querySelector(".msg.pending .resend");
    function lands(id: string, html: string, timestamp?: string): void {
      order.push(id);
      stream.emit("update", { order: [...order], messages: [{ id, role: "user", html, timestamp }], working: true });
    }
    await type("deploy the gnm mailer");
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await settle();
    expect(doubtful()).not.toBeNull();

    // His answer to a decision, from its own box, is a different note.
    lands("note:20", "<p>On \"Which layout?\": the second one</p>", new Date().toISOString());
    expect(doubtful()).not.toBeNull();
    // A second note of his streams in before its own send has answered, then the answer comes.
    drop = false;
    await type("and the island too");
    lands("note:21", "<p>and the island too</p>", new Date().toISOString());
    expect(doubtful()).not.toBeNull();
    release();
    await settle();
    expect(doubtful()).not.toBeNull();
    // A note with no time cannot be told apart from an old one.
    lands("note:22", "<p>deploy the gnm mailer</p>");
    expect(doubtful()).not.toBeNull();
  }, 15_000);

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

  it("starts clean on the new live session when the stream reconnects itself after a handoff", async () => {
    load("");
    await settle();
    const stream = open("live-a", [{ id: "a1", role: "assistant", html: "<p>old session reply</p>" }]);
    await type("a message that has not shown up yet");
    expect(pending()).toHaveLength(1);

    stream.emit("session", { id: "live-b", title: "live-b", updatedAt: "2026-10-05T20:05:00.000Z", assistantLabel: "firstmate" });
    stream.emit("update", { order: ["b1"], messages: [{ id: "b1", role: "assistant", html: "<p>new session reply</p>" }], working: false });
    expect(pending()).toEqual([]);
    expect(document.querySelectorAll(".msg")).toHaveLength(1);
    expect(document.querySelector(".msg")!.textContent).toContain("new session reply");
    expect(document.querySelectorAll(".msg.fresh")).toHaveLength(0);
  });

  it("names the conversation by its topic in the picker and the window title", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => (url === "/api/sessions" ? json({ sessions: [{ id: "latest", title: "Compund engineering skill review", updatedAt: "2026-10-05T20:00:00.000Z" }, SESSIONS[1]] }) : json({})));
    load("");
    await settle();
    const stream = FakeEventSource.instances.at(-1)!;
    stream.emit("session", { id: "latest", title: "Compund engineering skill review", updatedAt: "2026-10-05T20:00:00.000Z", assistantLabel: "Flyd" });
    await settle();
    const options = [...(document.getElementById("picker") as HTMLSelectElement).options].map((option) => option.textContent);
    expect(options[0]).toBe("Compund engineering skill review");
    expect(options[1]).toMatch(/^Older {2}·/);
    expect(document.title).toBe("Compund engineering skill review · Flyd");
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

  // Pasted words go out like typed ones: the box clears once. And a stored
  // draft still on its way back must never put a sent message back in the box.
  it("clears the box and the stored draft when a pasted message is sent", async () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let kept: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/draft") {
        const draft = (JSON.parse(String(init!.body)) as { draft: Record<string, unknown> & { text: string; attachments: unknown[] } }).draft;
        kept = draft.text || draft.attachments.length ? draft : null;
        return json({ ok: true });
      }
      if (url.startsWith("/api/draft?")) return json({ draft: kept });
      if (url === "/api/send") return json(sendResponse);
      return json({ sessions: SESSIONS });
    }));
    load("");
    await settle();
    open("latest", []);
    const input = document.getElementById("input") as HTMLTextAreaElement;
    input.value = "line one\nline two\nline three";
    input.dispatchEvent(new Event("input"));
    await wait(350);
    expect(kept).toMatchObject({ text: "line one\nline two\nline three" });
    document.getElementById("composer")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    await wait(400);
    expect(input.value).toBe("");
    expect(kept).toBeNull();
  });

  it("does not put a sent message back in the box when its stored draft arrives late", async () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let answer: ((response: Response) => void) | null = null;
    let kept: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/draft") {
        const draft = (JSON.parse(String(init!.body)) as { draft: Record<string, unknown> & { text: string; attachments: unknown[] } }).draft;
        kept = draft.text || draft.attachments.length ? draft : null;
        return json({ ok: true });
      }
      if (url.startsWith("/api/draft?")) return new Promise<Response>((resolve) => { answer = resolve; });
      if (url === "/api/send") return json(sendResponse);
      return json({ sessions: SESSIONS });
    }));
    load("");
    await settle();
    open("latest", []);
    const input = document.getElementById("input") as HTMLTextAreaElement;
    // Sent before the stored draft has been read back.
    input.value = "a long pasted message\nover several lines";
    input.dispatchEvent(new Event("input"));
    document.getElementById("composer")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(input.value).toBe("");
    // The read back lands after it, carrying the words that just went.
    answer!(json({ draft: { text: "a long pasted message\nover several lines", selectionStart: 0, selectionEnd: 0, attachments: [], savedAt: 1 } }));
    await settle();
    await wait(400);
    expect(input.value).toBe("");
    expect(kept).toBeNull();
  });

  it("brings back an older, different draft that arrives after a message was sent", async () => {
    let answer: ((response: Response) => void) | null = null;
    let kept: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/draft") {
        const draft = (JSON.parse(String(init!.body)) as { draft: Record<string, unknown> & { text: string; attachments: unknown[] } }).draft;
        kept = draft.text || draft.attachments.length ? draft : null;
        return json({ ok: true });
      }
      if (url.startsWith("/api/draft?")) return new Promise<Response>((resolve) => { answer = resolve; });
      if (url === "/api/send") return json(sendResponse);
      return json({ sessions: SESSIONS });
    }));
    load("");
    await settle();
    open("latest", []);
    const input = document.getElementById("input") as HTMLTextAreaElement;
    input.value = "a quick question";
    input.dispatchEvent(new Event("input"));
    document.getElementById("composer")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(input.value).toBe("");
    // The read back lands after it, carrying what he had left in the last window.
    answer!(json({ draft: { text: "notes from yesterday", selectionStart: 0, selectionEnd: 0, attachments: [], savedAt: 1 } }));
    await settle();
    expect(input.value).toBe("notes from yesterday");
    expect(kept).toMatchObject({ text: "notes from yesterday" });
  });

  it("clears the stored draft when a doubtful send turns out to have arrived", async () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let fail: ((error: Error) => void) | null = null;
    let kept: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/draft") {
        const draft = (JSON.parse(String(init!.body)) as { draft: Record<string, unknown> & { text: string; attachments: unknown[] } }).draft;
        kept = draft.text || draft.attachments.length ? draft : null;
        return json({ ok: true });
      }
      if (url.startsWith("/api/draft?")) return json({ draft: kept });
      if (url === "/api/send") return new Promise<Response>((_resolve, reject) => { fail = reject; });
      if (url === "/api/token") return json({ token: "a".repeat(48) });
      return json({ sessions: SESSIONS });
    }));
    load("");
    await settle();
    const stream = open("latest", [{ id: "u1", role: "user", html: "<p>hello</p>" }]);
    const input = document.getElementById("input") as HTMLTextAreaElement;
    input.value = "pasted words\nacross lines";
    input.dispatchEvent(new Event("input"));
    await wait(350);
    expect(kept).toMatchObject({ text: "pasted words\nacross lines" });
    document.getElementById("composer")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    // It shows up in the conversation, but the send itself never answered.
    stream.emit("update", { order: ["u1", "note:1"], messages: [{ id: "note:1", role: "user", html: "<p>pasted words<br>across lines</p>", timestamp: new Date().toISOString() }], working: true });
    fail!(new TypeError("Failed to fetch"));
    await settle();
    expect(document.querySelector(".msg.pending")).toBeNull();
    expect(input.value).toBe("");
    expect(kept).toBeNull();
  });

  it("clears the stored draft when a doubtful send shows up in the conversation later", async () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let kept: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/draft") {
        const draft = (JSON.parse(String(init!.body)) as { draft: Record<string, unknown> & { text: string; attachments: unknown[] } }).draft;
        kept = draft.text || draft.attachments.length ? draft : null;
        return json({ ok: true });
      }
      if (url.startsWith("/api/draft?")) return json({ draft: kept });
      if (url === "/api/send") throw new TypeError("Failed to fetch");
      if (url === "/api/token") return json({ token: "a".repeat(48) });
      return json({ sessions: SESSIONS });
    }));
    load("");
    await settle();
    const stream = open("latest", [{ id: "u1", role: "user", html: "<p>hello</p>" }]);
    const input = document.getElementById("input") as HTMLTextAreaElement;
    input.value = "pasted words\nacross lines";
    input.dispatchEvent(new Event("input"));
    await wait(350);
    document.getElementById("composer")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(document.querySelector(".msg.pending .resend")).not.toBeNull();
    expect(kept).toMatchObject({ text: "pasted words\nacross lines" });
    stream.emit("update", { order: ["u1", "note:1"], messages: [{ id: "note:1", role: "user", html: "<p>pasted words<br>across lines</p>", timestamp: new Date().toISOString() }], working: true });
    expect(document.querySelector(".msg.pending")).toBeNull();
    expect(kept).toBeNull();
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
    // The words are kept, with one clear line saying they did not go.
    expect((document.getElementById("input") as HTMLTextAreaElement).value).toBe("pong");
    expect(document.querySelector(".msg.failed .state")?.textContent).toContain("not sent: firstmate did not take the message: no");
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

  it("never sits on \"reconnecting…\" after the view restarts: a new view's token reloads the page, the same one reconnects", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      let token = "a".repeat(48);
      vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/api/token" ? json({ token }) : json({ sessions: SESSIONS }))));
      const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
      load("");
      await vi.runOnlyPendingTimersAsync();
      const first = open("latest", []);
      // A dropped stream the browser is still retrying: say so, and leave it to the browser.
      first.onerror!();
      expect(document.getElementById("problem")!.textContent).toBe("reconnecting…");
      await vi.advanceTimersByTimeAsync(20_000);
      expect(FakeEventSource.instances).toHaveLength(1);
      // The view refused the stream for good with the same token: connect again.
      (first as unknown as { readyState: number }).readyState = 2;
      first.onerror!();
      await vi.advanceTimersByTimeAsync(1_100);
      expect(FakeEventSource.instances).toHaveLength(2);
      expect(reload).not.toHaveBeenCalled();
      // A restarted view has a new token: the page reloads to take it, and its new code.
      token = "b".repeat(48);
      const second = FakeEventSource.instances.at(-1)!;
      (second as unknown as { readyState: number }).readyState = 2;
      second.onerror!();
      await vi.advanceTimersByTimeAsync(2_100);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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

    // One switch, Full replies, in Preferences: off is Flyd's reading, on is everything as written.
    const mode = document.getElementById("mode") as HTMLButtonElement;
    expect(mode.closest("#prefs")).not.toBeNull();
    expect(mode.getAttribute("role")).toBe("switch");
    expect(mode.querySelector(".prefs-name")!.textContent).toBe("Full replies");
    expect(mode.getAttribute("aria-checked")).toBe("false");
    mode.click();
    expect(document.documentElement.getAttribute("data-view")).toBe("full");
    expect(localStorage.getItem("flyd-view-mode")).toBe("full");
    expect(mode.getAttribute("aria-checked")).toBe("true");
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

  it("shows only the dots while the assistant works, never a narrated step under them", async () => {
    load("");
    await settle();
    const stream = open("latest", [{ id: "u1", role: "user", html: "<p>fix the cards</p>" }]);
    const recent = new Date().toISOString();
    stream.emit("update", { order: ["u1"], messages: [], working: true, activity: "Checking GNM deploy path and mailer setup", lastActivity: recent });
    const working = document.getElementById("working")!;
    expect(working.hidden).toBe(false);
    expect(working.querySelector(".dots")).not.toBeNull();
    expect(working.textContent).toBe("");
    expect(document.getElementById("stream")!.textContent).not.toContain("Checking GNM deploy path");
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
    expect(document.getElementById("rail")!.textContent).not.toMatch(/firstmate/i);
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
  it("sends a question a reply put to him back with one tap on the artefact", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const show: ShowScreen = { title: "Your move, sir.", summary: "", live: false, counts: { call: 1 }, items: [{ id: "call:reply:a#2", kind: "call", headline: "Want me to add all three?", why: "waiting on you", detail: "Three places would benefit from motion", ref: "reply:a#2", decision: { task: "reply:a#2", replyTo: "reply:a#2", question: "Want me to add all three?", choices: ["Yes, all three", "No"] } }] };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
    document.getElementById("flip")!.click();
    expect(document.querySelector(".scene-ask .art-chat-receipt")!.textContent).toBe("");
    document.querySelector<HTMLButtonElement>(".scene-ask .choice-pick")!.click();
    await settle();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, options]) => JSON.parse(String(options!.body)))).toEqual([{ session: "latest", replyTo: "reply:a#2", text: "Yes, all three" }]);
    expect(document.querySelector(".scene-ask .art-chat-receipt")!.textContent).toBe("Sent to Flyd");
    const picks = [...document.querySelectorAll<HTMLButtonElement>(".scene-ask .choice-pick")];
    expect(picks.map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(picks[1]!.disabled).toBe(true);
  });

  it("asks a reply's several questions on the artefact one at a time; a tap there never sends", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const steps = [
      { question: "Discard the old CapFive experiment branches?", options: ["Yes", "No"] },
      { question: "Should Flyd's sidebar show newest at the top again?", options: ["Yes", "No"] },
    ];
    const show: ShowScreen = { title: "Your move, sir.", summary: "", live: false, counts: { call: 1 }, items: [{ id: "call:reply:b#4", kind: "call", headline: "Still waiting on you", why: "waiting on you", ref: "reply:b#4", decision: { task: "reply:b#4", replyTo: "reply:b#4", question: "Still waiting on you", choices: [], steps } }] };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
    document.getElementById("flip")!.click();
    const sends = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, options]) => JSON.parse(String(options!.body)));
    const ask = document.querySelector<HTMLElement>(".scene-ask")!;
    const pick = (label: string) => [...ask.querySelectorAll<HTMLButtonElement>(".stepper .choice-pick")].find((button) => button.textContent === label)!.click();
    expect(ask.querySelector(".step-q")!.textContent).toBe("Discard the old CapFive experiment branches?");
    pick("Yes");
    pick("No");
    await settle();
    expect(sends()).toEqual([]);
    expect(ask.querySelector(".art-chat-receipt")!.textContent).toBe("");
    ask.querySelector<HTMLButtonElement>(".step-send")!.click();
    await settle();
    expect(sends()).toEqual([{ session: "latest", replyTo: "reply:b#4", text: "1. Discard the old CapFive experiment branches? Yes\n2. Should Flyd's sidebar show newest at the top again? No" }]);
    expect(ask.querySelector(".art-chat-receipt")!.textContent).toBe("Sent to Flyd");
    expect(ask.querySelector(".step-send")).toBeNull();
    expect(ask.querySelector(".step-count")!.textContent).toBe("Your answers");
  });

  it("answers a decision in one tap or in his own words, keeps Tab and typing in its chat box, and says where the answer is in plain words", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    try {
      load("");
      await settle();
      const stream = open("latest", []);
      const show: ShowScreen = { title: "Choose", summary: "", live: false, counts: { call: 1 }, items: [{ id: "call:visuals", kind: "call", headline: "Pick the Christmas direction for the site", why: "", task: "visuals", decision: { task: "visuals", question: "Choose from the lab", choices: ["Evergreen luxe", "Christmas card"], recommended: "Evergreen luxe" }, links: [{ label: "Open design review", url: "http://127.0.0.1:4387/session/review" }] }] };
      stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
      document.getElementById("flip")!.click();
      expect(document.querySelector("#scene-meta a")!.textContent).toBe("Open design review");
      expect(document.querySelector("#scene-meta .kind")!.textContent).toBe("needs you");
      // No heading over the box: the options, then one quiet line to type in.
      expect(document.querySelector(".scene-ask label, .scene-ask h2, .scene-ask h3")).toBeNull();
      const picks = [...document.querySelectorAll<HTMLButtonElement>(".scene-ask .choice-pick")];
      expect(picks.map((button) => button.textContent)).toEqual(["Evergreen luxerecommended", "Christmas card"]);
      const chat = document.querySelector<HTMLTextAreaElement>(".scene-ask .art-chat-input")!;
      chat.focus();
      const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      chat.dispatchEvent(tab);
      expect(tab.defaultPrevented).toBe(false);
      chat.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
      expect(document.documentElement.getAttribute("data-screen")).toBe("show");
      chat.value = "A mix of the two";
      chat.dispatchEvent(new Event("input"));
      chat.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await settle();
      expect(chat.value).toBe("");
      picks[0]!.click();
      await settle();
      expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, options]) => JSON.parse(String(options!.body)))).toEqual([
        { decision: "visuals", text: "A mix of the two" },
        { decision: "visuals", text: "Evergreen luxe" },
      ]);
      const receipt = document.querySelector(".scene-ask .art-chat-receipt")!;
      expect(receipt.textContent).toBe("Sent to Flyd");
      expect(picks[0]!.getAttribute("aria-pressed")).toBe("true");
      // Once firstmate takes the note, the line says so; never a note id.
      vi.mocked(fetch).mockImplementation(async (url) => json(String(url).startsWith("/api/note?") ? { receipt: "read" } : {}));
      vi.advanceTimersByTime(5000);
      await settle();
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith("/api/note?id=note%3A1&token="))).toBe(true);
      expect(receipt.textContent).toBe("Flyd has it");
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives every artefact a chat box that names it, and says a closed review page in words", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const show: ShowScreen = { title: "Map", summary: "", live: false, counts: {}, items: [{ id: "landed:map", kind: "landed", headline: "Christmas Nuanu map", why: "", task: "gnm-xmas-map", shots: [{ src: "/desk.png", label: "desktop-1440.png" }], links: [{ label: "Open design review", url: "http://127.0.0.1:4387/session/gone", closed: true }, { label: "flyd #9", url: "https://github.com/o/flyd/pull/9" }] }] };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
    document.getElementById("flip")!.click();
    const meta = document.getElementById("scene-meta")!;
    expect(meta.querySelector(".closed")!.textContent).toBe("The review page for this has closed");
    expect([...meta.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["https://github.com/o/flyd/pull/9"]);
    const chat = document.querySelector<HTMLTextAreaElement>(".scene-ask .art-chat-input")!;
    expect(chat.placeholder).toBe("Say something about this…");
    chat.value = "Make the pins bigger";
    chat.dispatchEvent(new Event("input"));
    document.querySelector(".scene-ask .art-chat")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, options]) => JSON.parse(String(options!.body)))).toEqual([
      { text: "Make the pins bigger", about: { title: "Christmas Nuanu map", task: "gnm-xmas-map", url: "https://github.com/o/flyd/pull/9" } },
    ]);
  });

  it("takes a screenshot pasted into an artefact's chat box, shows it before sending, and sends it with his words", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const show: ShowScreen = { title: "Map", summary: "", live: false, counts: {}, items: [{ id: "landed:map", kind: "landed", headline: "Christmas Nuanu map", why: "", task: "gnm-xmas-map", shots: [{ src: "/desk.png", label: "desktop-1440.png" }] }] };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
    document.getElementById("flip")!.click();
    const chat = document.querySelector<HTMLTextAreaElement>(".scene-ask .art-chat-input")!;
    const send = document.querySelector<HTMLButtonElement>(".scene-ask .art-chat-send")!;
    // His words and Send sit in one field, Send in sentence case.
    expect(chat.closest(".art-chat-field .art-chat-row")).not.toBeNull();
    expect(send.closest(".art-chat-row")).not.toBeNull();
    expect(send.textContent).toBe("Send");
    expect(send.disabled).toBe(true);
    const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const png = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const paste = new Event("paste", { cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { items: [{ kind: "file", type: "image/png", getAsFile: () => new File([png], "shot.png", { type: "image/png" }) }, { kind: "string", type: "text/plain", getAsFile: () => null }] },
    });
    chat.dispatchEvent(paste);
    // Text copied with the picture still lands in the box.
    expect(paste.defaultPrevented).toBe(false);
    for (let i = 0; i < 20 && !document.querySelector(".art-chat-images img"); i += 1) await settle();
    const images = document.querySelector<HTMLElement>(".scene-ask .art-chat-images")!;
    expect(images.hidden).toBe(false);
    expect(images.querySelectorAll(".attachment img")).toHaveLength(1);
    // A picture alone is enough to send about an artefact.
    expect(send.disabled).toBe(false);
    chat.value = "Like this";
    chat.dispatchEvent(new Event("input"));
    document.querySelector(".scene-ask .art-chat")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, options]) => JSON.parse(String(options!.body)))).toEqual([
      { text: "Like this", about: { title: "Christmas Nuanu map", task: "gnm-xmas-map" }, images: [{ mediaType: "image/png", data }] },
    ]);
    // Once it went, the box is empty again.
    expect(images.hidden).toBe(true);
    expect(images.querySelectorAll(".attachment")).toHaveLength(0);
  });

  it("shows the work on devices: the desktop capture in a browser with the phone in front, artwork at its own shape", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const show: ShowScreen = { title: "Map", summary: "", live: false, counts: {}, items: [{ id: "map", kind: "landed", headline: "Christmas Nuanu map", why: "", shots: [
      { src: "/desk.png", label: "desktop-1440.png" }, { src: "/phone.png", label: "phone.png" }, { src: "/art.png", label: "after.png" },
    ] }] };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
    // The work with pictures leads the cycle.
    expect(document.getElementById("scene-head")!.textContent).toBe("Christmas Nuanu map");
    const stage = () => document.querySelector<HTMLElement>(".scene-shot .devices")!;
    const shown = () => Array.from(stage().querySelectorAll<HTMLElement>(".device")).map((node) => [node.className, node.querySelector("img")!.getAttribute("src")!.split("?")[0]]);
    expect(stage().classList.contains("pair")).toBe(true);
    expect(shown()).toEqual([["device desk", "/desk.png"], ["device phone", "/phone.png"]]);
    expect(stage().querySelectorAll(".device.desk .bar i")).toHaveLength(3);
    // A thumbnail brings its own picture up; artwork keeps its shape, alone.
    const thumbs = document.querySelectorAll<HTMLImageElement>(".thumbs img");
    thumbs[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(stage().classList.contains("one")).toBe(true);
    expect(shown()).toEqual([["device art", "/art.png"]]);
    expect(thumbs[2]!.classList.contains("on")).toBe(true);
    thumbs[1]!.click();
    expect(shown()).toEqual([["device desk", "/desk.png"], ["device phone", "/phone.png"]]);
  });

  it("places a capture without a device in its name by its shape once it loads", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const show: ShowScreen = { title: "Map", summary: "", live: false, counts: {}, items: [{ id: "map", kind: "landed", headline: "Christmas Nuanu map", why: "", shots: [{ src: "/a.png", label: "after.png" }] }] };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
    const img = document.querySelector<HTMLImageElement>(".scene-shot .device img")!;
    expect(img.parentElement!.className).toBe("device art");
    Object.defineProperty(img, "naturalWidth", { value: 390, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 844, configurable: true });
    img.dispatchEvent(new Event("load"));
    expect(document.querySelector(".scene-shot .device")!.className).toBe("device phone");
    expect(document.querySelector<HTMLElement>(".scene-shot .devices")!.classList.contains("one")).toBe(true);
  });

  it("keeps a composite capture in its own shape, however wide it loads", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const show: ShowScreen = { title: "Map", summary: "", live: false, counts: {}, items: [{ id: "map", kind: "landed", headline: "Christmas Nuanu map", why: "", shots: [{ src: "/combo.png", label: "gnm-desktop-and-phone.png" }] }] };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
    const img = document.querySelector<HTMLImageElement>(".scene-shot .device img")!;
    expect(img.parentElement!.className).toBe("device art");
    Object.defineProperty(img, "naturalWidth", { value: 1800, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 900, configurable: true });
    img.dispatchEvent(new Event("load"));
    // A name listing more than one screen is neither frame: no browser, no phone.
    expect(document.querySelector(".scene-shot .device")!.className).toBe("device art");
  });

  it("wears a wide capture as a desktop, and a tall native-resolution phone shot as a phone", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const shapeAt = (width: number, height: number): string => {
      const show: ShowScreen = { title: "Map", summary: "", live: false, counts: {}, items: [{ id: `shot-${width}x${height}`, kind: "landed", headline: "Christmas Nuanu map", why: "", shots: [{ src: `/shot-${width}x${height}.png`, label: "after.png" }] }] };
      stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
      const img = document.querySelector<HTMLImageElement>(".scene-shot .device img")!;
      Object.defineProperty(img, "naturalWidth", { value: width, configurable: true });
      Object.defineProperty(img, "naturalHeight", { value: height, configurable: true });
      img.dispatchEvent(new Event("load"));
      return document.querySelector(".scene-shot .device")!.className;
    };
    // 1440 wide is a desktop capture even at a phone-ish height.
    expect(shapeAt(1440, 2400)).toBe("device desk");
    // An iPhone shot at 3x is over 1000px wide, but its portrait shape says phone.
    expect(shapeAt(1179, 2556)).toBe("device phone");
    // A full-page desktop capture is far taller than a phone, so it stays a desktop.
    expect(shapeAt(1440, 4000)).toBe("device desk");
    expect(shapeAt(1920, 6000)).toBe("device desk");
  });

  it("shows the right column: each conversation with its answer below, and a live preview artefact", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const rail = {
      conversations: [
        { id: "q1", question: "make a playlist", answer: "Nine tracks.", at: "2026-10-10T12:46:56Z", previews: [{ id: "image:x", title: "Screenshot", line: "after.png", image: "/api/rail-image?path=%2FUsers%2Fme%2Fafter.png" }] },
        { id: "q2", question: "and tickets?", waiting: "Working on it" },
      ],
      artefacts: [
        { id: "preview:http://127.0.0.1:8097/", title: "Live preview", line: "127.0.0.1:8097/", url: "http://127.0.0.1:8097/", preview: "http://127.0.0.1:8097/" },
        { id: "landed:x", title: "Christmas Nuanu map", line: "just landed" },
      ],
    };
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [] }, boxes: [], rail });
    await settle();
    const rail_ = document.getElementById("rail")!;
    expect(rail_.hidden).toBe(false);
    expect(document.documentElement.getAttribute("data-rail")).toBe("on");
    const talks = document.querySelectorAll(".rail-talk");
    expect(talks).toHaveLength(2);
    expect(talks[1]!.querySelector(".rail-q")!.textContent).toBe("And tickets?");
    // Where each stands, in a word, never the narrated step.
    expect(talks[1]!.querySelector(".rail-state")!.textContent).toBe("Under way");
    expect(talks[1]!.textContent).not.toContain("Working on it");
    expect(talks[0]!.querySelector(".rail-state")!.textContent).toBe("Done");
    expect(talks[0]!.querySelector(".rail-a")!.textContent).toBe("Nine tracks.");
    const shot = talks[0]!.querySelector<HTMLImageElement>(".rail-shot")!;
    expect(shot.src).toContain("/api/rail-image?path=%2FUsers%2Fme%2Fafter.png");
    expect(shot.src).toContain("token=");
    const frame = document.querySelector<HTMLIFrameElement>(".rail-frame")!;
    expect(frame.src).toBe("http://127.0.0.1:8097/");
    // The page is laid out at a desktop width and scaled down whole; clicking it opens it full size.
    expect(frame.parentElement!.classList.contains("rail-frame-box")).toBe(true);
    expect(frame.tabIndex).toBe(-1);
    const full = frame.parentElement!.querySelector<HTMLAnchorElement>(".rail-frame-open")!;
    expect(full.href).toBe("http://127.0.0.1:8097/");
    expect(full.target).toBe("_blank");
    const css = renderPage({ assistantLabel: "Flyd", sendToken: "a".repeat(48) });
    expect(css).toMatch(/\.rail-frame \{[^}]*width: 1280px; height: 800px;[^}]*transform: scale\(var\(--fit, 0\.3\)\); transform-origin: 0 0; pointer-events: none;/);
    expect(css).toMatch(/\.rail-frame-box \{[^}]*aspect-ratio: 1280 \/ 800; overflow: hidden;/);
    // Labels and dates stay tightly tracked.
    expect(css.match(/letter-spacing: 0?\.(0[5-9]|[1-9])\d*em/g)).toBeNull();
    document.getElementById("rail-hide")!.click();
    expect(document.getElementById("rail")!.hidden).toBe(true);
    expect(document.documentElement.getAttribute("data-rail")).toBe("off");
  });

  it("opens what needs him from the figure, each call with its question and answerable where it stands", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const calls = [
      { id: "call:a", kind: "call", headline: "Publish the apply page?", why: "", project: "GNM", decision: { task: "a", question: "Going live emails the stallholders.", choices: ["Publish", "Hold"] } },
      { id: "call:b", kind: "call", headline: "Merge the pagination PR?", why: "", decision: { task: "b", question: "Checks are green.", choices: [] } },
    ];
    const show = { title: "Your move", summary: "", live: false, counts: { call: 2, live: 1 }, items: [], calls };
    const bars = [{ label: "need you", value: 2, tone: "call" }, { label: "under way", value: 1, tone: "live" }];
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: [{ id: "work-state", kind: "bars", size: "small", title: "Where the work stands", why: "", bars }] });
    await settle();
    const figure = document.querySelector<HTMLButtonElement>("#readouts .ro-open")!;
    expect(figure.textContent).toBe("2 need you");
    // Only the figure that has a list behind it opens one.
    expect(document.querySelectorAll("#readouts button")).toHaveLength(1);
    figure.click();
    const sheet = document.getElementById("calls")!;
    expect(sheet.hidden).toBe(false);
    expect(document.getElementById("calls-title")!.textContent).toBe("2 decisions for you");
    const items = sheet.querySelectorAll(".call");
    expect(items).toHaveLength(2);
    expect(items[0]!.querySelector(".call-head")!.textContent).toBe("Publish the apply page?");
    expect(items[0]!.querySelector(".call-question")!.textContent).toBe("Going live emails the stallholders.");
    expect(Array.from(items[0]!.querySelectorAll(".choices button")).map((button) => button.textContent)).toEqual(["Publish", "Hold"]);
    // The same answer as on the artefact screen: one tap per option, then the chat box.
    expect(items[0]!.querySelector(".art-chat-input")!.getAttribute("placeholder")).toBe("Or say something else…");
    const answer = items[1]!.querySelector("textarea")!;
    answer.value = "Merge it";
    answer.dispatchEvent(new Event("input"));
    items[1]!.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    const sent = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(sent).toEqual([{ decision: "b", text: "Merge it" }]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(sheet.hidden).toBe(true);
  });

  it("offers a comment on words he selects in a message, and sends it quoting them", async () => {
    load("");
    await settle();
    open("latest", [{ id: "a1", role: "assistant", html: "<p>The island runs from the notch.</p>" }, { id: "u1", role: "user", html: "<p>Ship it</p>" }]);
    await settle();
    const pop = document.querySelector<HTMLElement>(".passage")!;
    const words = document.querySelector(".msg.assistant .body p")!.firstChild!;
    const select = (node: Node, start: number, end: number) => {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    };
    // Nothing until he selects something in a message.
    expect(pop.hidden).toBe(true);
    select(words, 4, 10);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(pop.hidden).toBe(false);
    expect(pop.querySelector<HTMLElement>(".passage-card")!.hidden).toBe(true);
    pop.querySelector<HTMLButtonElement>(".passage-open")!.click();
    expect(pop.querySelector<HTMLElement>(".passage-card")!.hidden).toBe(false);
    expect(pop.querySelector(".passage-quote")!.textContent).toBe("island");
    const input = pop.querySelector<HTMLTextAreaElement>(".passage-input")!;
    input.value = "Faster";
    pop.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    const sent = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(sent).toEqual([{ session: "latest", passage: { quote: "island", from: "assistant" }, text: "Faster" }]);
    expect(pop.querySelector(".reply-note")!.textContent).toBe("Sent to Flyd");
    pop.querySelector<HTMLButtonElement>(".reply-close")!.click();
    expect(pop.hidden).toBe(true);
    // His own words take one too, and say they were his.
    select(document.querySelector(".msg.user .body")!, 0, 1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(pop.hidden).toBe(false);
    // Words selected outside a message take none.
    const outside = document.body.appendChild(document.createElement("p"));
    outside.textContent = "Not a message";
    select(outside.firstChild!, 0, 3);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(pop.hidden).toBe(true);
    // Switching conversation with the card open still sends it about the one he picked from.
    select(document.querySelector(".msg.assistant .body p")!.firstChild!, 4, 10);
    await new Promise((resolve) => setTimeout(resolve, 40));
    pop.querySelector<HTMLButtonElement>(".passage-open")!.click();
    input.value = "Slower";
    open("other", [{ id: "o1", role: "assistant", html: "<p>Elsewhere</p>" }]);
    await settle();
    pop.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    const later = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(later.at(-1)).toEqual({ session: "latest", passage: { quote: "island", from: "assistant" }, text: "Slower" });
  });

  it("keeps a real copyable selection when the comment control appears", async () => {
    load("");
    await settle();
    open("latest", [{ id: "a1", role: "assistant", html: "<p>The island runs from the notch.</p>" }]);
    await settle();
    const words = document.querySelector(".msg.assistant .body p")!.firstChild!;
    const pop = document.querySelector<HTMLElement>(".passage")!;
    const range = document.createRange();
    range.setStart(words, 4);
    range.setEnd(words, 10);
    document.querySelector(".msg.assistant")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await settle();
    expect(pop.hidden).toBe(true);
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(pop.hidden).toBe(false);
    expect(window.getSelection()!.toString()).toBe("island");
    const copy = new Event("copy", { cancelable: true });
    document.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(false);
  });

  it("shows phone-width work on a phone, where a click on a spot sends a comment with the page and the spot", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const rail = {
      conversations: [],
      artefacts: [{ id: "live:http://127.0.0.1:8097/", title: "Live preview", url: "http://127.0.0.1:8097/#hero", preview: "http://127.0.0.1:8097/#hero", phone: true }],
    };
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [] }, boxes: [], rail });
    await settle();
    expect(document.querySelector(".rail-frame-box")).toBeNull();
    const frame = document.querySelector<HTMLIFrameElement>(".rail-phone-frame")!;
    expect(frame.src).toBe("http://127.0.0.1:8097/#hero");
    expect(renderPage({ assistantLabel: "Flyd", sendToken: "a".repeat(48) })).toMatch(/\.rail-phone-frame \{[^}]*width: 390px; height: 844px;/);
    const screen = document.querySelector<HTMLElement>(".rail-phone-screen")!;
    screen.getBoundingClientRect = () => ({ left: 0, top: 0, width: 195, height: 422, right: 195, bottom: 422, x: 0, y: 0, toJSON() {} });
    const toggle = document.querySelector<HTMLButtonElement>(".rail-phone-toggle")!;
    const say = document.querySelector<HTMLFormElement>(".rail-phone-say")!;
    // Comments are off until he turns them on: the page is used as it is.
    expect(say.hidden).toBe(true);
    toggle.click();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    document.querySelector(".rail-phone-pins")!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 60, clientY: 150 }));
    expect(say.hidden).toBe(false);
    expect(document.querySelector(".rail-phone-where")!.textContent).toMatch(/^At 120, 300\b.* on the 390×844 screen$/);
    expect(document.querySelectorAll(".rail-pin")).toHaveLength(1);
    say.querySelector("textarea")!.value = "Full width on phones";
    say.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    const sent = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ session: "latest", comment: { url: "http://127.0.0.1:8097/#hero", x: 120, y: 300, text: "Full width on phones" } });
    expect(say.hidden).toBe(true);
    expect(document.querySelector(".rail-pin.sent")).not.toBeNull();
    expect(document.querySelector(".rail-phone-hint")!.textContent).toBe("Sent. Click another spot to say more.");
  });

  it("takes a reply under an answer, keeps it through a redraw, threads replies, and sends it with what it answers", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const update = (rail: unknown) => stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [] }, boxes: [], rail });
    const answered = { id: "note:1", question: "other movements for bunny", answer: "Five moves now.", at: "2026-10-11T10:00:00Z" };
    update({ conversations: [answered, { id: "note:2", question: "and tickets?", waiting: "Working on it" }], artefacts: [] });
    await settle();
    const talks = document.querySelectorAll(".rail-talk");
    // Only an answer takes a reply, and its box stays shut until asked for.
    expect(talks[1]!.querySelector(".reply")).toBeNull();
    const opener = talks[0]!.querySelector<HTMLButtonElement>(".reply-open")!;
    expect(talks[0]!.querySelector<HTMLFormElement>(".reply form")!.hidden).toBe(true);
    opener.click();
    const box = talks[0]!.querySelector<HTMLTextAreaElement>(".reply-input")!;
    expect(document.activeElement).toBe(box);
    // Open, Reply steps aside and Close sits in the card's header row beside the Reply label; it shuts the box and keeps what he typed.
    expect(opener.hidden).toBe(true);
    const form = talks[0]!.querySelector<HTMLFormElement>(".reply form")!;
    expect([...form.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Close", "Send"]);
    box.value = "make";
    box.dispatchEvent(new Event("input"));
    form.querySelector<HTMLButtonElement>(".reply-close")!.click();
    expect(form.hidden).toBe(true);
    expect(opener.hidden).toBe(false);
    expect(document.activeElement).toBe(opener);
    opener.click();
    expect(box.value).toBe("make");
    box.value = "make the spin";
    box.dispatchEvent(new Event("input"));
    update({ conversations: [{ ...answered, answer: "Five moves now, all live." }, { id: "note:2", question: "and tickets?", waiting: "Working on it" }], artefacts: [] });
    await settle();
    expect(document.querySelector<HTMLTextAreaElement>(".rail-talk .reply-input")).toBe(box);
    // Speaking while the box is open fills it and sends it; the message box is left alone.
    const voice = (window as unknown as { flydVoice: Record<string, (text?: string) => void> }).flydVoice;
    voice.start!();
    voice.send!("slower");
    await settle();
    expect((document.getElementById("input") as HTMLTextAreaElement).value).toBe("");
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/send")!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ session: "latest", text: "make the spin slower", replyTo: "note:1" });
    update({ conversations: [{ ...answered, replies: [{ id: "note:3", question: "make the spin slower", waiting: "Working on it", replyTo: "note:1" }] }], artefacts: [] });
    await settle();
    expect(document.querySelector(".rail-talk .rail-replies .rail-q")!.textContent).toBe("Make the spin slower.");
  });

  it("puts a question a reply asks him in a card under it, answered by one tap or his own words", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const choice = { question: "Want me to add all three?", options: ["Yes, all three", "Only 1: Press feedback", "No"], replyTo: "reply:a#2" };
    const asked = { id: "reply:a#2", role: "assistant", html: "<p>Three places would benefit from motion.</p>", aside: true, choice };
    stream.emit("update", { order: ["u1", "reply:a#2"], messages: [{ id: "u1", role: "user", html: "<p>ok do it</p>" }, asked], working: false });
    await settle();
    const message = document.querySelector<HTMLElement>('.msg.aside')!;
    // Said to him, so it reads at full strength, with its own card instead of a reply link.
    expect(message.classList.contains("asks")).toBe(true);
    expect(message.querySelector(".reply")).toBeNull();
    expect(message.querySelector(".choice-q")!.textContent).toBe("Want me to add all three?");
    const buttons = [...message.querySelectorAll<HTMLButtonElement>(".choice-option")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Yes, all three", "Only 1: Press feedback", "No"]);
    buttons[0]!.click();
    await settle();
    const sends = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, options]) => JSON.parse(String(options!.body)));
    expect(sends()).toEqual([{ session: "latest", text: "Yes, all three", replyTo: "reply:a#2" }]);
    expect(message.querySelector(".choice .reply-note")!.textContent).toBe("Sent: “Yes, all three”");
    expect(buttons.every((button) => button.disabled)).toBe(true);
    // Once he has answered, the card goes; an open question takes his own words.
    stream.emit("update", { order: ["u1", "reply:a#2", "r3"], messages: [{ ...asked, choice: undefined }, { id: "r3", role: "assistant", html: "<p>Done.</p>", choice: { question: "What should the button say?", options: [], replyTo: "r3" } }], working: false });
    await settle();
    expect(message.querySelector(".choice")).toBeNull();
    const open3 = document.querySelectorAll<HTMLElement>(".msg")[2]!;
    expect(open3.querySelector(".choice-option")).toBeNull();
    const words = open3.querySelector<HTMLTextAreaElement>(".choice-input")!;
    words.value = "Book a stall";
    words.dispatchEvent(new Event("input"));
    words.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    expect(sends().at(-1)).toEqual({ session: "latest", text: "Book a stall", replyTo: "r3" });
  });

  it("asks several questions one at a time, sends nothing on a tap, and sends his answers together at the end", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const steps = [
      { question: "Discard the old CapFive experiment branches?", options: ["Yes", "No"] },
      { question: "Should Flyd's sidebar show newest at the top again?", options: ["Yes", "No"] },
    ];
    const asked = { id: "reply:b#4", role: "assistant", html: "<p>Both fixes are live.</p>", aside: true, choice: { question: "Still waiting on you", options: [], steps, replyTo: "reply:b#4" } };
    stream.emit("update", { order: ["u1", "reply:b#4"], messages: [{ id: "u1", role: "user", html: "<p>fix the admin</p>" }, asked], working: false });
    await settle();
    const card = document.querySelector<HTMLElement>(".msg.aside .choice")!;
    const sends = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, options]) => JSON.parse(String(options!.body)));
    const tap = (label: string) => [...card.querySelectorAll<HTMLButtonElement>(".stepper .choice-option")].find((button) => button.textContent === label)!.click();
    expect(card.querySelector(".choice-q")!.textContent).toBe("Still waiting on you");
    expect(card.querySelector(".step-count")!.textContent).toBe("Question 1 of 2");
    expect(card.querySelector(".step-q")!.textContent).toBe("Discard the old CapFive experiment branches?");
    // A tap answers this question and shows the next; nothing has gone anywhere.
    tap("Yes");
    await settle();
    expect(sends()).toEqual([]);
    expect(card.querySelector(".step-count")!.textContent).toBe("Question 2 of 2");
    expect(card.querySelector(".step-q")!.textContent).toBe("Should Flyd's sidebar show newest at the top again?");
    // Back keeps what he picked; his own words answer as well as a tap.
    card.querySelector<HTMLButtonElement>(".step-back")!.click();
    expect(card.querySelector(".stepper .choice-option[aria-pressed='true']")!.textContent).toBe("Yes");
    tap("Yes");
    const words = card.querySelector<HTMLTextAreaElement>(".step-input")!;
    words.value = "No, newest at the bottom";
    words.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    expect(sends()).toEqual([]);
    expect([...card.querySelectorAll(".step-review li")].map((item) => item.textContent)).toEqual([
      "Discard the old CapFive experiment branches?Yes",
      "Should Flyd's sidebar show newest at the top again?No, newest at the bottom",
    ]);
    card.querySelector<HTMLButtonElement>(".step-send")!.click();
    await settle();
    expect(sends()).toEqual([{ session: "latest", replyTo: "reply:b#4", text: "1. Discard the old CapFive experiment branches? Yes\n2. Should Flyd's sidebar show newest at the top again? No, newest at the bottom" }]);
    expect(card.querySelector(".reply-note")!.textContent).toBe("Sent your answers");
    expect(card.querySelector(".step-send")).toBeNull();
  });

  it("shows an answer Flyd gave for him as one quiet line with its rule, and takes it back on Undo", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const asked = { id: "reply:a#9", role: "assistant", html: "<p>Checks are green. Should I merge the Flyd change?</p>", aside: true };
    const flyds = { id: "note:6", role: "user", html: "<p>Yes</p>", replyTo: "reply:a#9", replyQuote: "Should I merge the Flyd change?", answeredFor: "Merge green Flyd PRs without asking", waiting: "Working on it" };
    stream.emit("update", { order: ["reply:a#9", "note:6"], messages: [asked, flyds], working: false });
    await settle();
    const note = document.querySelector<HTMLElement>('.msg.user.auto')!;
    // Flyd's words, not his: no highlighted bubble, the answer and the rule it stands on.
    expect(note.querySelector(".auto-line")!.textContent).toBe("Answered for you: “Yes” · your rule: Merge green Flyd PRs without asking.Undo");
    note.querySelector<HTMLButtonElement>(".auto-undo")!.click();
    await settle();
    const sends = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, options]) => JSON.parse(String(options!.body)));
    expect(sends).toEqual([{ session: "latest", undo: "note:6" }]);
    expect(note.querySelector(".auto-undo")!.textContent).toBe("Taken back");
    // Once taken back, it says so and offers no second Undo.
    stream.emit("update", { order: ["reply:a#9", "note:6"], messages: [{ ...flyds, undone: true }], working: false });
    await settle();
    expect(note.querySelector(".auto-what")!.textContent).toBe("You took back “Yes”");
    expect(note.querySelector(".auto-undo")).toBeNull();
  });

  it("shows what Flyd remembers here folded at the top, and what it learned as a card in the conversation, each one plain sentence", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const memory = {
      project: "GNM",
      remembering: [{ id: "taste:3bf30418", kind: "taste", title: "Animate text TV-style: a clean fade in place.", line: "Taste · Everywhere · seen 4 times", detail: "Animate text TV-style.\n\nLearned from:\n“should be TV style fade in. no pop.” — 2026-10-10", at: new Date(Date.now() - 120_000).toISOString() }],
      remembers: [{ id: "capture:2026-10-10-17-37-34.md", kind: "capture", title: "Gallery opens at ten.", line: "Capture · GNM" }],
    };
    const update = (rail: unknown) => stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [] }, boxes: [], rail });
    const learnedAt = memory.remembering[0]!.at;
    const before = new Date(Date.parse(learnedAt) - 60_000).toISOString();
    const after = new Date(Date.parse(learnedAt) + 60_000).toISOString();
    update({ conversations: [{ id: "q1", question: "should be TV style fade in. no pop.", answer: "Done.", at: before }, { id: "q2", question: "and the footer", answer: "Done.", at: after }], artefacts: [], memory });
    await settle();
    expect(document.getElementById("rail")!.hidden).toBe(false);
    const sections = [...document.querySelectorAll(".rail-section")].map((node) => node.textContent);
    expect(sections).toEqual(["Remembers · GNM 1", "Conversations"]);
    // What it already holds is folded under one line until he opens it, and stays as he left it.
    const held = document.querySelector<HTMLDetailsElement>(".rail-held")!;
    expect(held.open).toBe(false);
    held.open = true;
    held.dispatchEvent(new Event("toggle"));
    expect(localStorage.getItem("flyd-rail-held")).toBe("open");
    // What it learned is a card in the stream, right after the message it learned it from.
    const order = [...document.getElementById("rail-body")!.children].map((node) => node.className);
    expect(order).toEqual(["rail-held", "rail-section", "rail-talk", "rail-mem rail-mem--new", "rail-talk"]);
    const card = document.querySelector(".rail-mem--new")!;
    expect(card.querySelector(".rail-mem-kicker")!.textContent).toBe("Learned");
    // One sentence each: no kind/scope/seen/age line, no "Learned from" quote, no dates.
    expect([...document.querySelectorAll(".rail-mem-text")].map((node) => node.textContent)).toEqual(["Gallery opens at ten.", "Animate text TV-style: a clean fade in place."]);
    expect([...document.querySelectorAll(".rail-mem")].map((node) => node.textContent).join(" ")).not.toMatch(/Taste ·|seen 4 times|Learned from|2026-10-10|ago/);
    expect(document.getElementById("rail")!.textContent).not.toMatch(/firstmate/i);
  });

  it("labels work that got done as shipped, and keeps \"Learned\" for a rule or preference he taught it", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const at = new Date(Date.now() - 120_000).toISOString();
    const remembering = [
      { id: "memory:13-oct", kind: "shipped", title: "13 Oct: GNM's home hero fits short laptops; Flyd's artefact cards now send.", line: "Shipped", at },
      { id: "taste:3bf30418", kind: "taste", title: "Animate text TV-style: a clean fade in place.", line: "Taste · Everywhere", at },
      { id: "memory:bloom", kind: "memory", title: "George wants Bloom finished and hosted.", line: "Memory · Commitments", at },
    ];
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [] }, boxes: [], rail: { conversations: [], artefacts: [], memory: { remembers: [], remembering } } });
    await settle();
    const kickers = Object.fromEntries([...document.querySelectorAll(".rail-mem--new")].map((card) => [card.querySelector(".rail-mem-text")!.textContent, card.querySelector(".rail-mem-kicker")!.textContent]));
    expect(kickers).toEqual({
      "13 Oct: GNM's home hero fits short laptops; Flyd's artefact cards now send.": "Shipped",
      "Animate text TV-style: a clean fade in place.": "Learned",
      "George wants Bloom finished and hosted.": "Remembered",
    });
  });

  it("keeps the rail in chat order, newest message at the bottom, pinned there unless he scrolled up", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const memory = { project: "GNM", remembering: [], remembers: [{ id: "capture:a", kind: "capture", title: "Gallery opens at ten.", line: "" }] };
    const update = (conversations: unknown[]) => stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [] }, boxes: [], rail: { conversations, artefacts: [], memory } });
    // The detail pane scrolls as one column, so it is the pane that stays pinned.
    const body = document.getElementById("rail-body")!.parentElement!;
    let height = 1000;
    Object.defineProperty(body, "scrollHeight", { configurable: true, get: () => height });
    Object.defineProperty(body, "clientHeight", { configurable: true, get: () => 300 });
    update([{ id: "q1", question: "first", answer: "One." }]);
    await settle();
    expect([...document.querySelectorAll(".rail-section")].map((node) => node.textContent)).toEqual(["Remembers · GNM 1", "Conversations"]);
    expect(body.scrollTop).toBe(1000);
    height = 1200;
    update([{ id: "q1", question: "first", answer: "One." }, { id: "q2", question: "second", waiting: "Working on it" }]);
    await settle();
    expect([...document.querySelectorAll(".rail-q")].map((node) => node.textContent)).toEqual(["First.", "Second."]);
    expect(body.scrollTop).toBe(1200);
    // Scrolled up to read: a new message does not yank him back down.
    body.scrollTop = 100;
    height = 1400;
    update([{ id: "q1", question: "first", answer: "One." }, { id: "q2", question: "second", answer: "Two." }, { id: "q3", question: "third", waiting: "Working on it" }]);
    await settle();
    expect(body.scrollTop).toBe(100);
  });

  it("shows a page that does not answer as not running, never a blank frame, and an answer as Flyd tells it", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const rail = {
      conversations: [{ id: "q1", question: "swap the copy", answer: "Copy swap dispatched.", answerHtml: "<p>The copy swap is <strong>under way</strong>, sir.</p>" }],
      artefacts: [
        { id: "live:http://127.0.0.1:8088/", title: "Preview not running", line: "127.0.0.1:8088/", url: "http://127.0.0.1:8088/", down: true },
        { id: "live:http://127.0.0.1:9000/", title: "Live preview", line: "127.0.0.1:9000/", url: "http://127.0.0.1:9000/", checking: true },
      ],
    };
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [] }, boxes: [], rail });
    await settle();
    expect(document.querySelector(".rail-a")!.innerHTML).toBe("<p>The copy swap is <strong>under way</strong>, sir.</p>");
    expect(document.querySelector(".rail-frame")).toBeNull();
    const down = document.querySelector(".rail-card--down")!;
    expect(down.textContent).toContain("Preview not running");
    expect(down.textContent).toContain("127.0.0.1:8088/");
    expect(document.querySelectorAll(".rail-card-note")).toHaveLength(2);
  });

  it("sends what he typed under a preview card on SEND, clears the box and says it went to Flyd", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const rail = { conversations: [], artefacts: [{ id: "live:http://127.0.0.1:9000/", title: "Live preview", line: "127.0.0.1:9000/", url: "http://127.0.0.1:9000/", preview: "about:blank" }] };
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [] }, boxes: [], rail });
    await settle();
    const card = document.querySelector<HTMLElement>(".rail-card")!;
    const input = card.querySelector<HTMLTextAreaElement>(".art-chat-input")!;
    const send = card.querySelector<HTMLButtonElement>(".art-chat-send")!;
    input.focus();
    input.value = "move the top bit closer to the numbers";
    input.dispatchEvent(new Event("input"));
    // Pressing SEND keeps the caret in the box, so the box never shrinks out from under the click.
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    send.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    send.click();
    await settle();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, options]) => JSON.parse(String(options!.body)))).toEqual([
      { text: "move the top bit closer to the numbers", about: { title: "Live preview", url: "http://127.0.0.1:9000/" } },
    ]);
    expect(input.value).toBe("");
    const receipt = card.querySelector(".art-chat-receipt")!;
    expect(receipt.textContent).toBe("Sent to Flyd");
    expect(receipt.classList.contains("sent")).toBe(true);
  });

  it("shows a reply's options in Artefacts as a choice, answered by one tap, and its steps as a numbered list", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const rail = { conversations: [], artefacts: [
      { id: "reply:r1", title: "Two ways to fix it", choice: { question: "Two ways to fix it", options: ["Use a wildcard rule", "Keep separate rules"], replyTo: "note:1" } },
      { id: "reply:r2", title: "Fix the redirects", steps: ["Delete the ^/$ rule.", "Add ^/(.*)$ as a 301."] },
    ] };
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [] }, boxes: [], rail });
    await settle();
    const [options, steps] = [...document.querySelectorAll<HTMLElement>(".rail-card")];
    expect(options!.querySelector(".rail-card-steps")).toBeNull();
    expect(options!.querySelector(".choice-q")!.textContent).toBe("Two ways to fix it");
    const buttons = [...options!.querySelectorAll<HTMLButtonElement>(".choice-option")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Use a wildcard rule", "Keep separate rules"]);
    expect([...steps!.querySelectorAll(".rail-card-steps li")].map((item) => item.textContent)).toEqual(["Delete the ^/$ rule.", "Add ^/(.*)$ as a 301."]);
    expect(steps!.querySelector(".choice-option")).toBeNull();
    buttons[1]!.click();
    await settle();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, init]) => JSON.parse(String(init!.body)))).toEqual([
      { session: "latest", text: "Keep separate rules", replyTo: "note:1" },
    ]);
    // Once answered, the options are only listed, with nothing to tap.
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [] }, boxes: [], rail: { conversations: [], artefacts: [
      { id: "reply:r1", title: "Two ways to fix it", choice: { question: "Two ways to fix it", options: ["Use a wildcard rule", "Keep separate rules"] } },
    ] } });
    await settle();
    const listed = document.querySelector<HTMLElement>(".rail-card")!;
    expect(listed.querySelector(".choice-option")).toBeNull();
    expect([...listed.querySelectorAll(".rail-card-options li")].map((item) => item.textContent)).toEqual(["Use a wildcard rule", "Keep separate rules"]);
  });

  it("keeps the options he picked when the column redraws", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const show = { title: "", summary: "", live: false, counts: {}, items: [] };
    const choice = { question: "Pick the ones you want built", options: ["One", "Two", "Three", "Four", "Five"], replyTo: "note:9", multiple: true };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: [], rail: { conversations: [], artefacts: [{ id: "reply:r9", title: "Pick the ones you want built", choice }] } });
    await settle();
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(".rail-card .choice-option")];
    buttons[1]!.click();
    buttons[3]!.click();
    await settle();
    // A later column change redraws the card.
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: [], rail: { conversations: [], artefacts: [{ id: "reply:r9", title: "Pick the ones you want built", choice }, { id: "live:x", title: "Live preview", line: "x", url: "http://127.0.0.1:9000/" }] } });
    await settle();
    const after = [...document.querySelectorAll<HTMLButtonElement>(".rail-card .choice-option")];
    expect(after.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true", "false", "true", "false"]);
    document.querySelector<HTMLButtonElement>(".rail-card .choice-send")!.click();
    await settle();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, init]) => JSON.parse(String(init!.body)))).toEqual([
      { session: "latest", text: "Two, Four", replyTo: "note:9" },
    ]);
  });

  it("answers a Needs you line in place, delivering the answer to firstmate", async () => {
    sendResponse = { id: "note:7", timestamp: "2026-10-05T20:02:00.000Z" };
    load("");
    await settle();
    const stream = open("latest", []);
    const html = '<div class="status-card"><section class="sc-group k-call"><h4 class="sc-kicker">Needs you</h4><ul><li class="sc-row" data-ask="Sepia tint"><span class="sc-led"></span><span class="sc-what"><span class="sc-text">Sepia tint</span></span></li></ul></section></div>';
    stream.emit("update", { order: ["r1"], messages: [{ id: "r1", role: "assistant", html }], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [] }, boxes: [] });
    await settle();
    const input = document.querySelector<HTMLTextAreaElement>(".sc-ask-input")!;
    expect(input).toBeTruthy();
    input.value = "brands only";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const send = document.querySelector<HTMLButtonElement>(".sc-ask-send")!;
    expect(send.disabled).toBe(false);
    document.querySelector(".sc-ask")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    const calls = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send");
    expect(calls.map(([, options]) => JSON.parse(String(options!.body)))).toEqual([{ session: "latest", text: 'On "Sepia tint": brands only' }]);
    expect(document.querySelector(".sc-ask-receipt")!.textContent).toContain("Sent to firstmate");
  });
  const SHOW = {
    title: "Your move, sir.",
    summary: "1 call waits on you, 2 under way.",
    live: true,
    doing: "Running the Swift tests",
    counts: { call: 1, live: 2, landed: 30 },
    landedByDay: [{ day: "2026-10-09", count: 2 }, { day: "2026-10-10", count: 1 }],
    items: [
      { id: "call:jev", kind: "call", headline: "Review the Jev decision log", why: "", detail: "Captain decides keep or remove" },
      { id: "live:a", kind: "live", headline: "Header controls", why: "", detail: "A worker is on it", project: "Flyd",
        shots: [{ src: "/api/artefact-shot?task=a&file=after.png", label: "after.png" }], links: [{ label: "flyd #85", url: "https://github.com/GeorgeGally/flyd/pull/85" }] },
      { id: "news:memory-0", kind: "news", headline: "Bloom gets finished", why: "from your memory" },
    ],
  };

  it("uses one kind of control: a switch whose track says on or off, never brackets", async () => {
    load("");
    await settle();
    const controls = Array.from(document.querySelectorAll("header .controls button")).map((button) => button.textContent);
    expect(controls).toEqual(["activity", "preferences", "artefact"]);
    const switches = Array.from(document.querySelectorAll('header .controls button[role="switch"], #prefs button[role="switch"]')).map((button) => button.id);
    expect(switches).toEqual(["flip", "mode", "theme", "rail-toggle", "left-toggle"]);
    const flip = document.getElementById("flip")!;
    expect(flip.getAttribute("aria-checked")).toBe("false");
    flip.click();
    expect(document.documentElement.getAttribute("data-screen")).toBe("show");
    expect(flip.getAttribute("aria-checked")).toBe("true");
    expect(flip.textContent).toBe("artefact");
    const theme = document.getElementById("theme")!;
    theme.click();
    expect(theme.getAttribute("aria-checked")).toBe("true");
    expect(theme.querySelector(".prefs-name")!.textContent).toBe("Light theme");
  });

  it("keeps taste, full replies and the light theme in Preferences, out of the header until asked for", async () => {
    load("");
    await settle();
    const prefs = document.getElementById("prefs")!;
    const opener = document.getElementById("prefs-open")!;
    expect(prefs.hidden).toBe(true);
    expect(document.querySelector("header #mode, header #theme, header #taste-link")).toBeNull();
    opener.click();
    expect(prefs.hidden).toBe(false);
    expect(opener.getAttribute("aria-expanded")).toBe("true");
    expect([...prefs.querySelectorAll(".prefs-name")].map((node) => node.textContent)).toEqual(["Full replies", "Light theme", "Side column", "Activity column", "Local preparation", "Routines", "Taste"]);
    // A switch inside keeps it open; Escape or a click elsewhere closes it.
    document.getElementById("theme")!.click();
    expect(prefs.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(prefs.hidden).toBe(true);
    opener.click();
    document.getElementById("stream")!.click();
    expect(prefs.hidden).toBe(true);
    expect(opener.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the page the work is on in the header, local or live, with its section", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const site = document.getElementById("site") as HTMLAnchorElement;
    expect(site.hidden).toBe(true);
    stream.emit("update", { order: [], messages: [], working: false, page: { label: "/#location", url: "http://127.0.0.1:8088/index.html#location", host: "127.0.0.1:8088", local: true } });
    expect(site.hidden).toBe(false);
    expect(site.getAttribute("href")).toBe("http://127.0.0.1:8088/index.html#location");
    expect(site.textContent).toBe("local127.0.0.1:8088/#location");
    expect(site.getAttribute("aria-label")).toBe("Working on http://127.0.0.1:8088/index.html#location, a local preview");
    stream.emit("update", { order: [], messages: [], working: false, page: { label: "/vendor-apply", url: "https://goodneighboursmarket.com/vendor-apply", host: "goodneighboursmarket.com", local: false } });
    expect(site.classList.contains("site--live")).toBe(true);
    expect(document.getElementById("site-kind")!.textContent).toBe("live");
    // Still there in the artefact view.
    document.getElementById("flip")!.click();
    expect(site.hidden).toBe(false);
  });

  it("shows one row per note: answered ones step back with their answer folded, open ones stay prominent", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const rail = {
      conversations: [
        { id: "note:1", question: "put taste in preferences", answer: "Moved.", state: "done", at: "2026-10-12T09:00:00Z" },
        { id: "note:2", question: "the island is too tall and big.", about: { title: "Flyd island spans to the right edge", url: "https://github.com/GeorgeGally/flyd/pull/139" }, state: "underway", at: "2026-10-12T09:02:00Z" },
        { id: "note:3", question: "which layout?", answer: "Built both. Which do you want?", state: "needs", at: "2026-10-12T09:03:00Z" },
      ],
      artefacts: [],
    };
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [] }, boxes: [], rail });
    await settle();
    const rows = [...document.querySelectorAll<HTMLElement>("#rail-body > .rail-talk")];
    expect(rows.map((row) => row.querySelector(".rail-state")!.textContent)).toEqual(["Done", "Under way", "Needs you"]);
    expect(document.querySelector(".rail-topic, .rail-topic-toggle")).toBeNull();
    // An artefact note names the artefact, linked; no task id, no raw page line.
    const about = rows[1]!.querySelector<HTMLAnchorElement>(".rail-about a")!;
    expect(about.textContent).toBe("Flyd island spans to the right edge ↗");
    expect(about.href).toBe("https://github.com/GeorgeGally/flyd/pull/139");
    expect(rows[1]!.textContent).not.toMatch(/Task:|Page:/);
    // Only the answered one steps back; every row is folded, and a click opens it, and a redraw keeps it open.
    expect(rows.map((row) => row.classList.contains("is-done"))).toEqual([true, false, false]);
    expect(rows.map((row) => row.classList.contains("open"))).toEqual([false, false, false]);
    rows[0]!.querySelector<HTMLElement>(".rail-a")!.click();
    expect(rows[0]!.classList.contains("open")).toBe(true);
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [] }, boxes: [], rail: { ...rail, artefacts: [] } });
    await settle();
    expect(document.querySelector("#rail-body > .rail-talk")!.classList.contains("open")).toBe(true);
  });

  it("leads the column with one decision that needs him and its recommended choice, then every job under way and what got done", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const started = new Date(Date.now() - 25 * 60_000).toISOString();
    const calls = [
      { id: "call:a", kind: "call", headline: "Pick the vendor step layout.", why: "", project: "GNM (Good Neighbours Market)", detail: "Six layouts are built.", decision: { task: "a", question: "Pick one", choices: [] } },
      { id: "call:b", kind: "call", headline: "Keep the Jev rule?", why: "", decision: { task: "b", question: "Keep or remove", choices: ["Keep", "Remove"], recommended: "Keep" } },
    ];
    const underway = [{ id: "live:x", kind: "live", headline: "A worker is shrinking the island.", why: "", project: "Flyd", started }];
    const outcome = "The Block42 logo is now on the Good Neighbours Market homepage, with the full outcome readable";
    const done = [
      { id: "landed:1", kind: "landed", headline: outcome, why: "", at: started, project: "GNM (Good Neighbours Market)", open: { url: "https://example.com/pr/1" } },
      ...[2, 3, 4].map((n) => ({ id: `landed:${n}`, kind: "landed", headline: `Landed ${n}.`, why: "", at: started })),
    ];
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [], calls, underway, done }, boxes: [], rail: { conversations: [], artefacts: [] } });
    await settle();
    expect(document.getElementById("rail")!.hidden).toBe(false);
    const needs = document.getElementById("needs")!;
    // One at a time: the first, with a way to answer, and how many wait; no recommendation it never recorded.
    expect(needs.querySelector(".needs-head")!.textContent).toBe("Pick the vendor step layout.");
    expect(needs.querySelector(".needs-meta")!.textContent).toBe("GNM");
    expect(needs.querySelector(".needs-rec")).toBeNull();
    expect(needs.querySelector(".needs-nav")!.textContent).toContain("1 of 2");
    expect(needs.querySelector("textarea")).not.toBeNull();
    needs.querySelector<HTMLButtonElement>('[aria-label="The next one"]')!.click();
    expect(needs.querySelector(".needs-head")!.textContent).toBe("Keep the Jev rule?");
    expect(needs.querySelector(".needs-rec")!.textContent).toBe("RecommendedI'd pick Keep.");
    // The shown call stays shown across updates; answered and gone, the next takes its place.
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [], calls: [calls[1]], underway, done }, boxes: [], rail: { conversations: [], artefacts: [] } });
    expect(needs.querySelector(".needs-head")!.textContent).toBe("Keep the Jev rule?");
    expect(needs.querySelector(".needs-nav")).toBeNull();
    // Under way: one line per job, its project and how long it has run.
    const job = document.querySelector("#underway li")!;
    expect(job.querySelector(".brief-eyebrow")).toBeNull();
    expect(job.querySelector(".brief-line")!.textContent).toBe("A worker is shrinking the island.");
    expect(job.querySelector(".brief-meta")!.textContent).toBe("Flyd · Started 25m ago");
    // Done: one line each, the newest few until he asks for all.
    expect(document.querySelectorAll("#done li")).toHaveLength(3);
    const doneRow = document.querySelector("#done li")!;
    expect(doneRow.querySelector(".brief-eyebrow")).toBeNull();
    expect(doneRow.querySelector(".brief-line")!.textContent).toBe(outcome);
    expect(doneRow.querySelector(".brief-line a")!.getAttribute("href")).toBe("https://example.com/pr/1");
    expect(doneRow.querySelector(".brief-meta")!.textContent).toBe("GNM · 25m ago");
    document.querySelector<HTMLButtonElement>("#done .brief-more")!.click();
    expect(document.querySelectorAll("#done li")).toHaveLength(4);
    // Nothing waiting, running or done: the top of the column goes.
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [] }, boxes: [], rail: { conversations: [], artefacts: [] } });
    expect(document.getElementById("brief")!.hidden).toBe(true);
    expect(document.getElementById("rail")!.hidden).toBe(true);
  });

  it("draws each job and each piece of finished work as a typed card he can put away", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const started = new Date(Date.now() - 25 * 60_000).toISOString();
    const underway = [{ id: "live:x", kind: "live", headline: "A worker is shrinking the island.", why: "", project: "Flyd", started, task: "x" }];
    const done = [{ id: "landed:1", kind: "landed", headline: "It landed.", why: "", at: started, project: "GNM", task: "1" }];
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [], underway, done }, boxes: [], rail: { conversations: [], artefacts: [] } });
    await settle();
    // A card: an icon for what kind of thing it is, a chip that says so, then the line.
    const job = document.querySelector("#underway li")!;
    expect(job.classList.contains("card")).toBe(true);
    expect(job.querySelector(".card-icon svg")).not.toBeNull();
    expect(job.querySelector(".card-meta")!.textContent).toBe("Under way");
    const doneRow = document.querySelector("#done li")!;
    expect(doneRow.classList.contains("card")).toBe(true);
    expect(doneRow.querySelector(".card-icon svg")).not.toBeNull();
    expect(doneRow.querySelector(".card-meta")!.textContent).toBe("Done");
    // Putting one away: a click fades it out, and it stays away through the next reading of the fleet.
    const gone = document.querySelector("#done li .card-dismiss") as HTMLButtonElement;
    gone.click();
    await new Promise((resolve) => setTimeout(resolve, 260));
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [], underway, done }, boxes: [], rail: { conversations: [], artefacts: [] } });
    await settle();
    expect(document.querySelectorAll("#done li")).toHaveLength(0);
    localStorage.removeItem("flyd-dismissed");
  });

  it("opens a finished job's screenshot full size when he clicks the card's thumbnail", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const at = new Date(Date.now() - 25 * 60_000).toISOString();
    const done = [{ id: "landed:1", kind: "landed", headline: "It landed.", why: "", at, project: "GNM", task: "1", shots: [{ src: "/api/artefact-shot?task=1&file=after.png", label: "after.png" }] }];
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [], done }, boxes: [], rail: { conversations: [], artefacts: [] } });
    await settle();
    const thumb = document.querySelector("#done .card-thumb") as HTMLButtonElement;
    expect(thumb.querySelector("img")!.getAttribute("src")).toContain("/api/artefact-shot?task=1&file=after.png");
    const lightbox = document.getElementById("lightbox") as HTMLElement;
    expect(lightbox.hidden).toBe(true);
    thumb.click();
    expect(lightbox.hidden).toBe(false);
    expect(document.getElementById("lightbox-img")!.getAttribute("src")).toContain("/api/artefact-shot?task=1&file=after.png");
    // Clicking outside (or Escape) closes it again.
    lightbox.click();
    expect(lightbox.hidden).toBe(true);
  });

  it("offers no way to put away a brief card that has no task of its own, since its place in the list is all that names it", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const done = [{ id: "landed:landed-0", kind: "landed", headline: "It landed.", why: "", project: "GNM" }];
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [], underway: [], done }, boxes: [], rail: { conversations: [], artefacts: [] } });
    await settle();
    expect(document.querySelectorAll("#done li")).toHaveLength(1);
    expect(document.querySelector("#done li .card-dismiss")).toBeNull();
  });

  it("putting away a running job keeps that job's finished card", async () => {
    localStorage.setItem("flyd-left", "on");
    load("");
    await settle();
    const stream = open("latest", []);
    const at = new Date(Date.now() - 4 * 60_000).toISOString();
    stream.emit("update", { order: [], messages: [], working: false, leftColumn: { now: [{ id: "job:1", kind: "work", title: "Working on a job for you", at }], recent: [] } });
    (document.querySelector("#left-now .card-dismiss") as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 260));
    stream.emit("update", { order: [], messages: [], working: false, leftColumn: { now: [], recent: [{ id: "job:1", kind: "work", title: "Finished a job for you", at }] } });
    expect(document.querySelector("#left-recent .left-title")!.textContent).toBe("Finished a job for you");
    localStorage.removeItem("flyd-dismissed");
  });

  it("plays Flyd's boxes as scenes, one at a time, the pictured work first, with the numbers on one line under them", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const boxes = boxesOf(SHOW as ShowScreen, { plan: { source: "quota-axi", windows: [{ label: "weekly", percentRemaining: 10 }] } });
    stream.emit("update", { order: [], messages: [], working: true, show: SHOW, boxes });
    document.getElementById("flip")!.click();

    // One scene holds the stage: the work with its picture, never every box at once.
    expect(document.querySelectorAll("#show h1")).toHaveLength(1);
    expect(document.getElementById("scene-head")!.textContent).toBe("Header controls");
    expect(document.querySelector("#scene-meta a")!.textContent).toBe("flyd #85");
    expect(document.querySelector(".scene-shot .device img")!.getAttribute("src")).toBe(`/api/artefact-shot?task=a&file=after.png&token=${"a".repeat(48)}`);
    expect(document.getElementById("scene")!.classList.contains("has-shot")).toBe(true);
    // The pictured work, then the call, what Flyd sees coming (the plan limit), then the stories in words.
    const ticks = Array.from(document.querySelectorAll("#ticks button")).map((tick) => tick.getAttribute("aria-label"));
    expect(ticks).toEqual([
      "under way: Header controls",
      "needs you: Review the Jev decision log",
      "coming up: Claude weekly limit: 10% left.",
      "from your memory: Bloom gets finished",
    ]);

    // The arrow brings the next scene up like a title card: the call, with its ask.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(document.getElementById("scene-head")!.textContent).toBe("Review the Jev decision log");
    expect(document.getElementById("scene-line")!.textContent).toBe("Captain decides keep or remove.");
    expect(document.querySelector("#scene-meta .kind")!.textContent).toBe("needs you");
    expect(document.getElementById("scene")!.classList.contains("has-shot")).toBe(false);

    // The numbers are one quiet line of words and figures: no charts.
    expect(Array.from(document.querySelectorAll(".ro")).map((node) => (node as HTMLElement).dataset.id)).toEqual(["plan", "landed-week", "work-state"]);
    expect(document.getElementById("readouts")!.textContent).toBe("Claude weekly 90% used3 landed this week1 need you2 under way");
    expect(document.querySelector("#readouts .ro-cols, #readouts .ro-split")).toBeNull();
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

  it("shows Flyd's own activity in a left column that stays shut on a narrow window until asked", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const leftColumn = {
      now: [{ id: "job:1", kind: "work", title: "Working on a job for you", line: "Tidy the notes.", at: new Date(Date.now() - 4 * 60_000).toISOString() }],
      recent: [{ id: "log:memory", kind: "memory", title: "Kept its memory of you up to date", line: "Read 3 conversations.", at: new Date(Date.now() - 2 * 3_600_000).toISOString() }],
    };
    expect(document.getElementById("left-open")!.hidden).toBe(true);
    stream.emit("update", { order: [], messages: [], working: false, leftColumn });
    expect(document.getElementById("left-open")!.hidden).toBe(false);
    const left = document.getElementById("left")!;
    // Narrow window: nothing opens by itself, but the header offers it.
    expect(left.hidden).toBe(true);
    expect(document.documentElement.getAttribute("data-left")).toBe("off");
    document.getElementById("left-open")!.click();
    expect(left.hidden).toBe(false);
    expect(document.documentElement.getAttribute("data-left")).toBe("open");
    expect(localStorage.getItem("flyd-left")).toBe("on");
    const cards = (id: string) => Array.from(document.querySelectorAll(`#${id} .left-card`));
    expect(cards("left-now")).toHaveLength(1);
    expect(cards("left-now")[0]!.querySelector(".left-title")!.textContent).toBe("Working on a job for you");
    expect(cards("left-now")[0]!.querySelector(".left-meta")!.textContent).toBe("Started 4m ago");
    expect(cards("left-recent")[0]!.querySelector(".left-meta")!.textContent).toBe("2h ago");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(left.hidden).toBe(true);
    expect(localStorage.getItem("flyd-left")).toBe("off");
  });

  it("opens the left column by itself on a wide window, and says so plainly when nothing is under way", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("1480"), media: query, addEventListener() {}, removeEventListener() {} }));
    load("");
    await settle();
    const stream = open("latest", []);
    stream.emit("update", { order: [], messages: [], working: false, leftColumn: { now: [], recent: [{ id: "log:news", kind: "news", title: "Watched the news for you", at: new Date(Date.now() - 9 * 60_000).toISOString() }] } });
    expect(document.documentElement.getAttribute("data-left")).toBe("open");
    expect(document.querySelector("#left-now .left-title")!.textContent).toBe("Nothing under way right now.");
    expect(document.querySelector("#left-now .left-meta")!.textContent).toBe("Last active 9m ago");
    // He can still put it away; it stays away.
    document.getElementById("left-hide")!.click();
    expect(document.documentElement.getAttribute("data-left")).toBe("off");
    document.getElementById("left-toggle")!.click();
    expect(document.documentElement.getAttribute("data-left")).toBe("open");
  });

  it("folds the earlier activity to a few cards and opens the rest on request", async () => {
    localStorage.setItem("flyd-left", "on");
    load("");
    await settle();
    const stream = open("latest", []);
    const recent = Array.from({ length: 8 }, (_, index) => ({ id: `r${index}`, kind: "noted", title: `Thing ${index}`, at: new Date(Date.now() - (index + 1) * 60_000).toISOString() }));
    stream.emit("update", { order: [], messages: [], working: false, leftColumn: { now: [], recent } });
    const shown = () => document.querySelectorAll("#left-recent .left-card").length;
    const more = document.getElementById("left-more") as HTMLButtonElement;
    expect(shown()).toBe(5);
    expect(more.textContent).toBe("Show 3 more");
    more.click();
    expect(shown()).toBe(8);
    expect(more.textContent).toBe("Show fewer");
  });

  it("opens a card's fuller detail in place when he clicks it, and closes it again", async () => {
    localStorage.setItem("flyd-left", "on");
    load("");
    await settle();
    const stream = open("latest", []);
    const at = new Date(Date.now() - 4 * 60_000).toISOString();
    stream.emit("update", { order: [], messages: [], working: false, leftColumn: { now: [], recent: [
      { id: "job:1", kind: "done", title: "Finished a job for you", line: "Done.", detail: "Done. The file is at ~/Documents/Flyd/gnm.md, deduped and checked.", at },
    ] } });
    const card = (): HTMLElement => document.querySelector("#left-recent .left-card") as HTMLElement;
    const detail = (): HTMLElement => card().querySelector(".card-detail") as HTMLElement;
    expect(detail().hidden).toBe(true);
    card().click();
    // The one card stays put; its detail unfolds in place, with the exact time.
    expect(document.querySelectorAll("#left-recent .left-card")).toHaveLength(1);
    expect(card().dataset.key).toBe("job:1|done");
    expect(card().classList.contains("is-open")).toBe(true);
    expect(detail().hidden).toBe(false);
    expect(card().querySelector(".card-detail-text")!.textContent).toBe("Done. The file is at ~/Documents/Flyd/gnm.md, deduped and checked.");
    expect(card().querySelector(".card-detail-when")!.textContent).not.toBe("");
    // Clicking the card again closes it.
    card().click();
    expect(detail().hidden).toBe(true);
    // Escape closes an open card too, without taking the whole column away.
    card().click();
    expect(detail().hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(detail().hidden).toBe(true);
    expect(document.getElementById("left")!.hidden).toBe(false);
  });

  it("makes every card in the column clickable, even one with no more to say than its time", async () => {
    localStorage.setItem("flyd-left", "on");
    const html = renderPage({ assistantLabel: "firstmate", sendToken: "a".repeat(48) });
    document.head.innerHTML = /<style>[\s\S]*?<\/style>/.exec(html)![0]!;
    load("", html);
    await settle();
    const stream = open("latest", []);
    const at = new Date(Date.now() - 3 * 3_600_000).toISOString();
    stream.emit("update", { order: [], messages: [], working: false, leftColumn: { now: [], recent: [
      { id: "log:reviewed", kind: "reviewed", title: "Read back its own answers", line: "10 recent answers checked; all held up.", at },
    ] } });
    const card = (): HTMLElement => document.querySelector("#left-recent .left-card") as HTMLElement;
    expect(card().classList.contains("is-expandable")).toBe(true);
    expect(card().getAttribute("role")).toBe("button");
    // The pointer says it can be opened, and a hover rule answers the mouse.
    expect(getComputedStyle(card()).cursor).toBe("pointer");
    const hover = Array.from(document.styleSheets).flatMap((sheet) => Array.from(sheet.cssRules))
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText.endsWith(":hover"))
      .find((rule) => card().matches(rule.selectorText.replace(/:hover$/, "")));
    expect(hover).toBeDefined();
    card().click();
    // This card has no fuller outcome, so its detail is the exact time alone.
    expect(card().querySelector(".card-detail")!.hasAttribute("hidden")).toBe(false);
    expect(card().querySelector(".card-detail-text")).toBeNull();
    expect(card().querySelector(".card-detail-when")!.textContent).not.toBe("");
  });

  it("opens the quiet Right now card on what Flyd last did, and exactly when", async () => {
    localStorage.setItem("flyd-left", "on");
    load("");
    await settle();
    const stream = open("latest", []);
    const at = new Date(Date.now() - 9 * 60_000).toISOString();
    stream.emit("update", { order: [], messages: [], working: false, leftColumn: { now: [], recent: [{ id: "log:news", kind: "news", title: "Watched the news for you", at }] } });
    const card = (): HTMLElement => document.querySelector("#left-now .left-card") as HTMLElement;
    expect(card().classList.contains("is-expandable")).toBe(true);
    expect(card().querySelector<HTMLElement>(".card-detail")!.hidden).toBe(true);
    card().click();
    expect(card().querySelector<HTMLElement>(".card-detail")!.hidden).toBe(false);
    expect(card().querySelector(".card-detail-text")!.textContent).toBe("Watched the news for you");
    expect(card().querySelector(".card-detail-when")!.textContent).not.toBe("");
  });

  it("leaves the quiet Right now card plain when Flyd has done nothing yet", async () => {
    localStorage.setItem("flyd-left", "on");
    load("");
    await settle();
    const stream = open("latest", []);
    stream.emit("update", { order: [], messages: [], working: false, leftColumn: { now: [], recent: [] } });
    const card = document.querySelector("#left-now .left-card") as HTMLElement;
    expect(card.querySelector(".left-title")!.textContent).toBe("Nothing under way right now.");
    expect(card.classList.contains("is-expandable")).toBe(false);
    expect(card.querySelector(".card-detail")).toBeNull();
  });

  it("lets Enter on a card's ✕ hide it rather than open the card", async () => {
    localStorage.setItem("flyd-left", "on");
    load("");
    await settle();
    const stream = open("latest", []);
    const at = new Date(Date.now() - 4 * 60_000).toISOString();
    stream.emit("update", { order: [], messages: [], working: false, leftColumn: { now: [], recent: [{ id: "job:1", kind: "done", title: "Finished a job for you", detail: "Done.", at }] } });
    const card = document.querySelector("#left-recent .left-card") as HTMLElement;
    const close = card.querySelector(".card-dismiss") as HTMLButtonElement;
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    close.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(card.classList.contains("is-open")).toBe(false);
    card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(card.classList.contains("is-open")).toBe(true);
  });

  it("lets Escape take the column away when no shown card is open", async () => {
    localStorage.setItem("flyd-left", "on");
    load("");
    await settle();
    const stream = open("latest", []);
    const at = new Date(Date.now() - 4 * 60_000).toISOString();
    stream.emit("update", { order: [], messages: [], working: false, leftColumn: { now: [], recent: [{ id: "job:1", kind: "done", title: "Finished a job for you", detail: "Done.", at }] } });
    (document.querySelector("#left-recent .left-card") as HTMLElement).click();
    // The open card ages out of the panel; its key stays remembered but nothing open is shown.
    stream.emit("update", { order: [], messages: [], working: false, leftColumn: { now: [], recent: [{ id: "job:2", kind: "done", title: "Another job", at }] } });
    expect(document.querySelector("#left .card.is-open")).toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.getElementById("left")!.hidden).toBe(true);
  });

  it("offers no left column when Core sends no activity", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    stream.emit("update", { order: [], messages: [], working: false });
    expect(document.getElementById("left")!.hidden).toBe(true);
    expect(document.getElementById("left-open")!.hidden).toBe(true);
  });
});

describe("the side column's type", () => {
  // These drive the real page and read the computed style of what it rendered,
  // rather than matching text in the page's CSS. happy-dom resolves the page's
  // own stylesheet (font family and size, borders, backgrounds) onto the live
  // DOM; a property the stylesheet leaves unset (letter-spacing, text-transform)
  // it reports empty, which is asserted as "nothing set" rather than a value.
  const SANS = /sans-serif|system-ui|-apple-system/;
  const MONO = /mono|Menlo|Consolas|SF Mono/i;
  const WHITE = /^#f{3}(?:f{3})?$|^rgba?\(\s*255\s*,\s*255\s*,\s*255\b/i;

  async function drawColumn(): Promise<void> {
    const html = renderPage({ assistantLabel: "Flyd", sendToken: "a".repeat(48) });
    document.head.innerHTML = /<style>[\s\S]*?<\/style>/.exec(html)![0]!;
    load("", html);
    await settle();
    const stream = open("latest", []);
    const started = new Date(Date.now() - 25 * 60_000).toISOString();
    stream.emit("update", {
      order: [], messages: [], working: false, boxes: [],
      show: {
        title: "", summary: "", live: false, counts: {}, items: [],
        calls: [{ id: "call:a", kind: "call", headline: "Pick the vendor step layout.", why: "", project: "GNM", detail: "Six layouts are built.", decision: { task: "a", question: "Pick one", choices: [] } }],
        underway: [{ id: "live:x", kind: "live", headline: "A worker is shrinking the island.", why: "", project: "Flyd", started }],
        done: [{ id: "landed:1", kind: "landed", headline: "It landed.", why: "", at: started, project: "GNM" }],
      },
      rail: {
        conversations: [{ id: "q1", question: "make a playlist", answer: "Nine tracks.", state: "done", at: "2026-10-10T12:46:56Z" }],
        artefacts: [
          { id: "preview:http://127.0.0.1:8097/", title: "Live preview", line: "127.0.0.1:8097/", url: "http://127.0.0.1:8097/", preview: "http://127.0.0.1:8097/" },
          { id: "live:http://127.0.0.1:8097/phone", title: "Phone preview", url: "http://127.0.0.1:8097/", preview: "http://127.0.0.1:8097/", phone: true },
        ],
        memory: { project: "GNM", remembering: [], remembers: [{ id: "capture:a", kind: "capture", title: "Gallery opens at ten.", line: "" }] },
      },
    });
    await settle();
  }

  const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);

  it("sets every label in the column in one sans family, in sentence case at 13px or more", async () => {
    await drawColumn();
    for (const selector of [".brief-label", ".needs-meta", ".needs-head", ".brief-meta", ".rail-tabs button", ".rail-section", ".rail-when", ".rail-card-head"]) {
      const cs = style(selector);
      expect(cs.fontFamily, selector).toMatch(SANS);
      expect(cs.fontFamily, selector).not.toMatch(MONO);
      expect(cs.textTransform === "" || cs.textTransform === "none", `${selector} text-transform`).toBe(true);
      const spacing = parseFloat(cs.letterSpacing);
      expect(Number.isNaN(spacing) || spacing <= parseFloat(cs.fontSize) * 0.04 + 0.01, `${selector} letter-spacing`).toBe(true);
      expect(parseFloat(cs.fontSize), `${selector} font-size`).toBeGreaterThanOrEqual(13);
    }
  });

  it("sets the top bar and the empty page in the same sans", async () => {
    await drawColumn();
    for (const selector of ["header", "header .site", "header .controls a", ".empty"]) {
      expect(style(selector).fontFamily, selector).toMatch(SANS);
      expect(style(selector).fontFamily, selector).not.toMatch(MONO);
    }
  });

  it("gives the column one container style: no bordered boxes", async () => {
    await drawColumn();
    for (const selector of [".rail-card", ".brief-list li", ".rail-mem"]) {
      const cs = style(selector);
      const border = parseFloat(cs.borderTopWidth);
      expect(Number.isNaN(border) || border === 0, `${selector} border`).toBe(true);
      expect(cs.borderTopLeftRadius, `${selector} radius`).toBe("12px");
    }
  });

  it("never lets a preview card show white, desktop or phone", async () => {
    await drawColumn();
    for (const selector of [".rail-frame-box", ".rail-phone-screen", ".rail-frame", ".rail-phone-frame"]) {
      const background = style(selector).backgroundColor;
      expect(background === "" || background === "transparent" || background === "none" || !WHITE.test(background), `${selector} background ${background}`).toBe(true);
    }
  });
});

describe("what Flyd shows of its staff, at a glance", () => {
  it("draws a relayed update as a compact card: a dot and a word, one line, its link", async () => {
    load("");
    await settle();
    open("latest", [{
      id: "t1", role: "assistant", html: "<p>the staff's whole words</p>", aside: true,
      summary: { html: "<p>The island text fix is merged.</p>", source: "flyd" },
      card: { kind: "landed", line: "The island text fix is merged", url: "https://github.com/GeorgeGally/flyd/pull/162" },
    } as never]);
    await settle();
    const card = document.querySelector(".msg .card")!;
    expect(card.classList.contains("card-landed")).toBe(true);
    expect(card.querySelector(".card-meta")!.textContent).toBe("Done");
    expect(card.querySelector(".card-line")!.textContent).toBe("The island text fix is merged");
    expect(card.querySelector<HTMLAnchorElement>(".card-link")!.href).toBe("https://github.com/GeorgeGally/flyd/pull/162");
    expect(card.querySelector(".card-link")!.textContent).toBe("Open the change ↗");
    // The staff's own words stay folded behind "more".
    expect(document.querySelector(".msg")!.classList.contains("open")).toBe(false);
  });

  it("draws a reply about several pieces of work as a card each, never paragraphs", async () => {
    load("");
    await settle();
    open("latest", [{
      id: "t1", role: "assistant", html: "<ul><li>the staff's own words</li></ul>", aside: true,
      outcomes: { lead: "Here's where the three Flyd fixes stand:", items: [
        { title: "Flyd decides itself", line: "Still stuck on its checks.", state: "stuck" },
        { title: "Chief-of-staff voice", line: "The phantom island alerts are fixed.", state: "landed", url: "https://github.com/GeorgeGally/flyd/pull/170" },
        { title: "Activity artefacts", line: "Final checks are running.", state: "underway" },
      ] },
    } as never]);
    await settle();
    const cards = [...document.querySelectorAll(".outcomes .card")];
    expect(cards.map((card) => card.querySelector(".card-meta")!.textContent)).toEqual(["Stuck", "Done", "Under way"]);
    expect(cards.map((card) => card.querySelector(".card-line")!.textContent)).toEqual(["Flyd decides itself", "Chief-of-staff voice", "Activity artefacts"]);
    expect(cards[1]!.querySelector<HTMLAnchorElement>(".card-link")!.href).toBe("https://github.com/GeorgeGally/flyd/pull/170");
    expect(document.querySelector(".outcomes-lead")!.textContent).toBe("Here's where the three Flyd fixes stand:");
  });

  it("puts a column card away when he hides it, and keeps it away after a reload", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const done = [
      { id: "landed:left", task: "left", kind: "landed", headline: "Flyd now has a left column.", why: "", at: new Date().toISOString() },
      { id: "landed:island", task: "island", kind: "landed", headline: "The island text is readable again.", why: "", at: new Date().toISOString() },
    ];
    const update = { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [], done }, boxes: [], rail: { conversations: [], artefacts: [] } };
    stream.emit("update", update);
    await settle();
    expect(document.querySelectorAll("#done li")).toHaveLength(2);
    document.querySelector<HTMLButtonElement>("#done li .card-dismiss")!.click();
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect([...document.querySelectorAll("#done .brief-line")].map((line) => line.textContent)).toEqual(["The island text is readable again."]);
    // A reload keeps it hidden.
    load("");
    await settle();
    open("latest", []).emit("update", update);
    await settle();
    expect([...document.querySelectorAll("#done .brief-line")].map((line) => line.textContent)).toEqual(["The island text is readable again."]);
  });

  it("lets a Done card he has already seen fade from the column after a day", async () => {
    localStorage.setItem("flyd-done-seen", JSON.stringify({ "landed:old": Date.now() - 25 * 60 * 60 * 1000 }));
    load("");
    await settle();
    const done = [
      { id: "landed:old", task: "old", kind: "landed", headline: "Seen yesterday.", why: "", at: new Date().toISOString() },
      { id: "landed:new", task: "new", kind: "landed", headline: "New today.", why: "", at: new Date().toISOString() },
    ];
    open("latest", []).emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [], done }, boxes: [], rail: { conversations: [], artefacts: [] } });
    await settle();
    expect([...document.querySelectorAll("#done .brief-line")].map((line) => line.textContent)).toEqual(["New today."]);
  });

  it("forgets Done cards it saw that have long left the column, and keeps at most 300", async () => {
    const day = 24 * 60 * 60 * 1000;
    const old: Record<string, number> = { "landed:gone": Date.now() - 4 * day, "landed:still": Date.now() - 4 * day };
    for (let index = 0; index < 400; index += 1) old[`landed:recent-${index}`] = Date.now() - day - index;
    localStorage.setItem("flyd-done-seen", JSON.stringify(old));
    load("");
    await settle();
    const done = [
      { id: "landed:still", task: "still", kind: "landed", headline: "Seen days ago.", why: "", at: new Date().toISOString() },
      { id: "landed:new", task: "new", kind: "landed", headline: "New today.", why: "", at: new Date().toISOString() },
    ];
    open("latest", []).emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [], done }, boxes: [], rail: { conversations: [], artefacts: [] } });
    await settle();
    const seen = JSON.parse(localStorage.getItem("flyd-done-seen")!) as Record<string, number>;
    expect(Object.keys(seen)).toHaveLength(300);
    expect(seen["landed:gone"]).toBeUndefined();
    expect(seen["landed:still"]).toBe(old["landed:still"]);
    expect(seen["landed:new"]).toBeDefined();
    expect([...document.querySelectorAll("#done .brief-line")].map((line) => line.textContent)).toEqual(["New today."]);
  });
});
