// @vitest-environment happy-dom
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerBody, answerHtml } from "../answer-form.js";
import { boxesOf } from "../boxes.js";
import { RECEIVED } from "../living.js";
import { renderPage } from "../page.js";
import { fillScreen } from "../screen/patterns.js";
import type { ShowItem, ShowScreen } from "../show.js";

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
  const fresh = /data-new-session="([^"]+)"/.exec(body[1]!)?.[1];
  if (fresh) document.body.setAttribute("data-new-session", fresh);
  else document.body.removeAttribute("data-new-session");
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
  it("reads a shaped answer whole: every label once, and no run long enough to skim past", async () => {
    load("");
    await settle();
    const parts = [
      { label: "What #200 changed", text: "It rebuilt the screen and left the draw path alone." },
      { label: "Why nothing drew", text: "The renderer was never wired to the new surface." },
      { label: "What the tests proved", text: "They exercised the screen markup, not the drawing." },
      { label: "Where the gap opened", text: "Between the screen and the renderer call." },
      { label: "What closes it", text: "One call from the screen to the renderer." },
    ];
    open("latest", [
      { id: "u1", role: "user", html: "<p>Why didn't PR #200 fix generative UI?</p>" },
      { id: "a1", role: "assistant", html: answerHtml(answerBody({ lead: "It fixed the screen, not the reason nothing drew.", form: "diagnosis", parts, next: "Ship the missing call?" })) },
    ]);
    const form = document.querySelector(".msg.assistant [data-form=diagnosis]")!;
    expect(form.querySelectorAll(".answer-part")).toHaveLength(5);
    expect(Array.from(form.querySelectorAll("dt")).map((dt) => dt.textContent)).toEqual(parts.map((part) => part.label));
    const runs = [form.querySelector(".answer-lead")!, ...Array.from(form.querySelectorAll(".answer-part dd"))].map((node) => node.textContent!.length);
    expect(Math.max(...runs)).toBeLessThan(420);
    expect(form.textContent).toContain("Ship the missing call?");
    expect(document.querySelector(".msg.assistant .summary")).toBeNull();
  });

  it("shows a comparison as one table, every option a column and every criterion a row", async () => {
    load("");
    await settle();
    open("latest", [
      { id: "u1", role: "user", html: "<p>Pink or blue for the ruler?</p>" },
      { id: "a1", role: "assistant", html: answerHtml(answerBody({
        lead: "Pink for reading, blue for counting.",
        form: "comparison",
        criteria: ["Warmth", "Legibility"],
        alternatives: [{ name: "Pink", values: ["high", "soft"] }, { name: "Blue", values: ["low", "sharp"] }],
        next: "Pink for the page?",
      })) },
    ]);
    const table = document.querySelector(".msg.assistant .answer-compare")!;
    expect(Array.from(table.querySelectorAll("thead th")).map((node) => node.textContent)).toEqual(["Pink", "Blue"]);
    expect(Array.from(table.querySelectorAll("tbody th")).map((node) => node.textContent)).toEqual(["Warmth", "Legibility"]);
    expect(table.querySelectorAll("tbody tr")[0]!.querySelectorAll("td")).toHaveLength(2);
    expect(document.querySelector(".msg.assistant .summary")).toBeNull();
  });

  it("shows, changes and clears the resolved project badge", async () => {
    load("");
    await settle();
    const stream = open("latest", [{ id: "u1", role: "user", html: "<p>hello</p>" }]);
    const badge = document.getElementById("project-badge")!;
    expect(badge.hidden).toBe(true);
    stream.emit("update", { order: ["u1"], messages: [], working: false, project: "Atomise" });
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("Atomise");
    expect(badge.classList.contains("shown")).toBe(true);
    stream.emit("update", { order: ["u1"], messages: [], working: false, project: "GNM" });
    expect(badge.textContent).toBe("GNM");
    stream.emit("update", { order: ["u1"], messages: [], working: false });
    expect(badge.hidden).toBe(true);
    expect(badge.textContent).toBe("");
  });

  it("fades the project badge in at a restrained size with no movement or hover rule", async () => {
    const html = renderPage({ assistantLabel: "firstmate", sendToken: "a".repeat(48) });
    const style = document.createElement("style");
    style.textContent = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
    document.head.appendChild(style);
    try {
      load("", html);
      await settle();
      const stream = open("latest", [{ id: "u1", role: "user", html: "<p>hello</p>" }]);
      stream.emit("update", { order: ["u1"], messages: [], working: false, project: "Atomise" });
      const badge = document.getElementById("project-badge")!;
      const computed = getComputedStyle(badge);
      const animation = computed.animation.split(" ")[0];
      const keyframes = [...style.sheet!.cssRules].find((rule): rule is CSSKeyframesRule => rule instanceof CSSKeyframesRule && rule.name === animation);
      expect(keyframes).toBeDefined();
      expect([...keyframes!.cssRules].flatMap((frame) => { const declared = (frame as CSSKeyframeRule).style; return Array.from({ length: declared.length }, (_, i) => declared.item(i)); })).toEqual(["opacity", "opacity"]);
      expect(parseFloat(computed.fontSize)).toBeLessThanOrEqual(12);
      expect(computed.transform || "none").toBe("none");
      expect(computed.transitionProperty || "").toBe("");
      const hover = [...style.sheet!.cssRules].filter((rule) => rule instanceof CSSStyleRule && /project-badge[^,]*:hover/.test(rule.selectorText));
      expect(hover).toEqual([]);
    } finally { style.remove(); }
  });

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

  it("says under each note whether firstmate has read it, and says nothing over the box when notes sit unread", async () => {
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

    const banner = document.getElementById("unread");
    // No banner for notes left waiting: that is Flyd's to chase, not his to hear.
    expect(banner).toBeNull();

    // Acknowledged: the note reads as read.
    stream.emit("update", { order: ["note:1", "note:2", "note:3", "ask:4"], messages: [{ id: "note:3", role: "user", html: "<p>and the logo</p>", timestamp: old, receipt: "read" }], working: false });
    expect(receipt("note:3")!.textContent).toBe("read by firstmate");
    expect(receipt("note:3")!.classList.contains("late")).toBe(false);
  });

  it("says stuck coding work over the composer, and clears it when it moves", async () => {
    load("");
    await settle();
    const stream = open("latest", [{ id: "u1", role: "user", html: "<p>hello</p>" }]);
    const banner = document.getElementById("staff")!;
    expect(banner.hidden).toBe(true);
    stream.emit("staff", { text: "Nobody has been looking after your coding work for 3 h." });
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toBe("Nobody has been looking after your coding work for 3 h.");
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

  it("drops a pending copy when the reader opens a past session from history", async () => {
    load("?session=latest");
    await settle();
    open("latest", []);
    await type("a message that has not shown up yet");
    expect(pending()).toHaveLength(1);

    await settle();
    document.querySelector<HTMLButtonElement>('.history-item-title')?.closest("button")?.click();
    expect(FakeEventSource.instances.at(-1)?.url).toContain("session=older");
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

  it("groups past conversations by project with their title and age", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => (url === "/api/sessions" ? json({ sessions: [
      { id: "latest", title: "Current thread", updatedAt: "2026-10-05T20:00:00.000Z", project: "Flyd" },
      { id: "older", title: "Fix the history labels", updatedAt: "2026-10-04T20:00:00.000Z", project: "Flyd" },
      { id: "oldest", title: "Older Flyd session", updatedAt: "2026-10-02T20:00:00.000Z", project: "Flyd" },
      { id: "general", title: "Weekend plans", updatedAt: "2026-10-03T20:00:00.000Z" },
    ] }) : json({})));
    load("");
    await settle();
    const stream = FakeEventSource.instances.at(-1)!;
    stream.emit("session", { id: "latest", title: "Current thread", updatedAt: "2026-10-05T20:00:00.000Z", assistantLabel: "Flyd" });
    await settle();
    const groups = [...document.querySelectorAll(".history-group")];
    expect(groups.map((group) => group.querySelector("summary")?.textContent)).toEqual(["Flyd", "General"]);
    expect([...groups[0]!.querySelectorAll(".history-item-title")].map((title) => title.textContent)).toEqual(["Fix the history labels", "Older Flyd session"]);
    expect(groups.map((group) => (group as HTMLDetailsElement).open)).toEqual([true, false]);
    const item = document.querySelector(".history-item")!;
    expect(item.textContent).toContain("Fix the history labels");
    expect(item.textContent).toMatch(/ago/);
    expect(document.querySelector("#conversation-title")?.textContent).toBe("Current thread");
    expect(document.title).toBe("Current thread · Flyd");
    expect(document.body.textContent).not.toContain("main ?2");
    groups[0]!.removeAttribute("open");
    stream.emit("session", { id: "latest", title: "Current thread", updatedAt: "2026-10-05T20:00:00.000Z", assistantLabel: "Flyd" });
    await settle();
    expect((document.querySelector(".history-group") as HTMLDetailsElement).open).toBe(false);
  });

  it("keeps the history list in place while nothing in it has changed", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => (url === "/api/sessions" ? json({ sessions: [
      { id: "latest", title: "Current thread", updatedAt: "2026-10-05T20:00:00.000Z" },
      { id: "older", title: "Fix the history labels", updatedAt: "2026-10-04T20:00:00.000Z" },
    ] }) : json({})));
    load("");
    await settle();
    const stream = FakeEventSource.instances.at(-1)!;
    stream.emit("session", { id: "latest", title: "Current thread", updatedAt: "2026-10-05T20:00:00.000Z", assistantLabel: "Flyd" });
    await settle();
    const item = document.querySelector<HTMLButtonElement>(".history-item")!;
    item.focus();
    stream.emit("session", { id: "latest", title: "Current thread", updatedAt: "2026-10-05T20:00:00.000Z", assistantLabel: "Flyd" });
    await settle();
    expect(document.querySelector(".history-item")).toBe(item);
    expect(document.activeElement).toBe(item);
  });

  it("does not open history over the thread on load at phone width", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    load("?session=latest");
    await settle();
    open("latest", []);
    await settle();
    expect(document.querySelectorAll(".history-item").length).toBeGreaterThan(0);
    expect(document.getElementById("rail")!.hidden).toBe(true);
    const toggle = document.getElementById("rail-toggle")!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    document.getElementById("prefs-open")!.click();
    toggle.click();
    expect(document.getElementById("rail")!.hidden).toBe(false);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem("flyd-rail")).toBe("on");
  });

  it("starts a newly opened window on its own conversation and keeps it across a reload", async () => {
    const html = renderPage({ assistantLabel: "Flyd", sendToken: "a".repeat(48), newSession: "window:fresh-one" });
    load("", html);
    await settle();
    expect(FakeEventSource.instances.at(-1)!.url).toContain("session=window%3Afresh-one");
    load("", renderPage({ assistantLabel: "Flyd", sendToken: "a".repeat(48), newSession: "window:fresh-two" }));
    await settle();
    expect(FakeEventSource.instances.at(-1)!.url).toContain("session=window%3Afresh-one");
  });

  it("reopens the history column from Preferences on phone width", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    load("?session=latest");
    await settle();
    open("latest", []);
    await settle();
    document.querySelector<HTMLButtonElement>(".history-item")!.click();
    expect(document.getElementById("rail")!.hidden).toBe(true);

    document.getElementById("prefs-open")!.click();
    const toggle = document.getElementById("rail-toggle")!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    toggle.click();
    expect(document.getElementById("rail")!.hidden).toBe(false);
    expect(localStorage.getItem("flyd-rail")).toBe("on");
  });

  it("says where a message sent from an older session will show", async () => {
    load("?session=older");
    await settle();
    open("older", []);
    await type("hi from the archive");
    expect(pending()[0]).toContain("shows in the latest session");
  });

  it("waits in place for the answer when the source answers in the session it was sent to", async () => {
    sendResponse = { id: "ask:older-1", timestamp: "2026-10-05T20:01:00.000Z", waiting: "Thinking it over" };
    load("?session=older");
    await settle();
    const stream = FakeEventSource.instances.at(-1)!;
    stream.emit("session", { id: "older", title: "older", updatedAt: "2026-10-05T20:00:00.000Z", assistantLabel: "Flyd", answersInSession: true });
    stream.emit("update", { order: [], messages: [], working: false });
    await type("carry on from here");
    expect(pending()[0]).not.toContain("shows in the latest session");
    stream.emit("update", { order: ["ask:older-1"], messages: [{ id: "ask:older-1", role: "user", html: "<p>carry on from here</p>" }], working: true });
    await settle();
    expect(pending()).toEqual([]);
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
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
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
    expect(document.getElementById("notice")!.textContent).toContain("setup.exe");
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

  it("says in the box why a dropped file was not attached, instead of looking ignored", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const drop = (files: File[]): void => {
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: { files } });
      document.body.dispatchEvent(event);
    };
    const deck = new File(["%PDF-1.7 deck"], "GNM Sponsor Deck.pdf", { type: "application/pdf" });
    Object.defineProperty(deck, "size", { value: 40 * 1024 * 1024 });
    vi.useFakeTimers();
    try {
      drop([deck, new File(["PK"], "assets.zip", { type: "application/zip" })]);
      vi.advanceTimersByTime(60_000);
    } finally {
      vi.useRealTimers();
    }
    const notice = document.getElementById("notice")!;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain("GNM Sponsor Deck.pdf is 40MB; documents can be up to 32MB");
    expect(notice.textContent).toContain("assets.zip can't be attached");
    expect(document.querySelectorAll(".attachment")).toHaveLength(0);
    // A later stream update never wipes it; only the next file, typing or a send does.
    stream.emit("update", { order: [], messages: [], working: true });
    expect(notice.textContent).toContain("GNM Sponsor Deck.pdf");

    drop([new File(["%PDF-1.3 small"], "brief.pdf", { type: "application/pdf" })]);
    for (let i = 0; i < 20 && !document.querySelector(".attachment.file"); i += 1) await settle();
    expect(notice.hidden).toBe(true);
    expect(document.querySelectorAll(".attachment.file")).toHaveLength(1);
  });

  it("brings the message box back when a file lands on the artefact screen", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "Work", summary: "", live: false, counts: {}, items: [] } });
    document.getElementById("flip")!.click();
    expect(document.documentElement.getAttribute("data-screen")).toBe("show");
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [new File(["%PDF-1.3"], "deck.pdf", { type: "application/pdf" })] } });
    document.body.dispatchEvent(event);
    expect(document.documentElement.getAttribute("data-screen")).toBe("terminal");
    expect((document.getElementById("show") as HTMLElement).hidden).toBe(true);
    for (let i = 0; i < 20 && !document.querySelector(".attachment.file"); i += 1) await settle();
    expect(document.querySelector(".attachment.file .name")!.textContent).toBe("deck.pdf");
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/send")).toBe(false);
  });

  it("keeps a file dropped while a reply is streaming in the box, unsent, until he sends it", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    stream.emit("update", { order: ["u1"], messages: [{ id: "u1", role: "user", html: "<p>look at the deck</p>" }], working: true, activity: "Reading the deck" });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [new File(["%PDF-1.3"], "deck.pdf", { type: "application/pdf" })] } });
    document.body.dispatchEvent(event);
    for (let i = 0; i < 20 && !document.querySelector(".attachment.file"); i += 1) await settle();
    expect(document.querySelector(".attachment.file .name")!.textContent).toBe("deck.pdf");
    expect((document.getElementById("send") as HTMLButtonElement).disabled).toBe(false);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/send")).toBe(false);
    // The reply streaming on does not take the chip with it.
    stream.emit("update", { order: ["u1", "a1"], messages: [{ id: "u1", role: "user", html: "<p>look at the deck</p>" }, { id: "a1", role: "assistant", html: "<p>Read it.</p>" }], working: true });
    await settle();
    expect(document.querySelectorAll(".attachment.file")).toHaveLength(1);
    await type("summarise it");
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/send")!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({ text: "summarise it", files: [{ name: "deck.pdf" }] });
    expect(document.querySelectorAll(".attachment")).toHaveLength(0);
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

  it("labels the send button Send, with a spoken name that says what it does", async () => {
    load("");
    await settle();
    const send = document.getElementById("send") as HTMLButtonElement;
    expect(send.textContent).toBe("Send");
    expect(send.getAttribute("aria-label")).toBe("Send to firstmate");
  });

  it("attaches a native Scrawl to the unsent composer and removes its context with the thumbnail", async () => {
    load("");
    await settle();
    open("latest", []);
    const input = document.getElementById("input") as HTMLTextAreaElement;
    input.value = "Please fix this";
    const attach = (window as unknown as { flydScrawl: (path: string, data: string) => boolean }).flydScrawl;
    expect(attach("/tmp/native.scrawl", "cG5n")).toBe(true);
    expect(attach("/tmp/second.scrawl", "cG5n")).toBe(false);
    await settle();
    expect(input.value).toBe("Please fix this\n\n[scrawl: /tmp/native.scrawl]");
    expect(document.querySelector("#attachments img")?.getAttribute("src")).toBe("data:image/png;base64,cG5n");
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/send")).toBe(false);
    document.querySelector<HTMLButtonElement>("#attachments button")!.click();
    expect(input.value).toBe("Please fix this");
    expect(document.querySelectorAll("#attachments img")).toHaveLength(0);
  });

  it("sends native Scrawl through the ordinary send action with the sheet attached", async () => {
    load("");
    await settle();
    open("latest", []);
    const attach = (window as unknown as { flydScrawl: (path: string, data: string) => void }).flydScrawl;
    attach("/tmp/native.scrawl", "cG5n");
    document.getElementById("composer")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/send")!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({
      text: "[scrawl: /tmp/native.scrawl]", images: [{ mediaType: "image/png", data: "cG5n" }],
    });
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

  it("completes a skill in a reply without sending or switching views", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    stream.emit("update", { order: ["a1"], messages: [{ id: "a1", role: "assistant", html: "<p>The island is smaller.</p>", answers: "note:1" }], working: false });
    document.querySelector<HTMLButtonElement>(".msg.assistant .reply-open")!.click();
    const input = document.querySelector<HTMLTextAreaElement>(".reply-input")!;
    input.value = "/des";
    input.dispatchEvent(new Event("input"));
    await settle();
    const menu = input.closest("form")!.querySelector<HTMLElement>(".commands")!;
    expect(menu?.hidden).toBe(false);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(input.value).toBe("/design-shotgun ");
    expect(menu.hidden).toBe(true);
    expect(document.documentElement.getAttribute("data-screen")).toBe("terminal");
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/send")).toBe(false);
  });

  it.each(["calls", "drill"])("returns to a usable main textbox after leaving an artefact with its %s sheet open", async (kind) => {
    load("");
    await settle();
    const stream = open("latest", []);
    const show = {
      title: "Work", summary: "", live: true, counts: { call: 1, live: 1 }, items: [],
      calls: [{ id: "call:a", kind: "call", headline: "Choose a layout", why: "", decision: { task: "a", question: "Which layout?", choices: ["A", "B"] } }],
      underway: [{ id: "live:a", kind: "live", headline: "Building the layout", why: "" }],
    };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: [{ id: "work-state", kind: "bars", size: "small", title: "Where the work stands", why: "", bars: [{ label: "need you", value: 1, tone: "call" }, { label: "under way", value: 1, tone: "live" }] }] });
    document.getElementById("flip")!.click();
    const figure = document.querySelector<HTMLButtonElement>(kind === "calls" ? "#readouts button.k-call" : "#readouts button.k-live")!;
    figure.click();
    const sheet = document.getElementById(kind)!;
    expect(sheet.hidden).toBe(false);
    if (kind === "drill") document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    else document.getElementById("flip")!.click();
    await new Promise((resolve) => setTimeout(resolve, 190));
    expect(document.documentElement.getAttribute("data-screen")).toBe("terminal");
    const input = document.getElementById("input") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(input);
    expect(sheet.hidden).toBe(true);
    input.value = "Continue with the layout";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    const sends = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send");
    expect(sends).toHaveLength(1);
    expect(JSON.parse(String(sends[0]![1]!.body))).toMatchObject({ text: "Continue with the layout" });
  });

  it("uses the shared skill picker in an artefact and dismisses it before closing the decision sheet", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    stream.emit("update", {
      order: [], messages: [], working: false,
      show: { title: "Choose", summary: "", live: false, counts: { call: 1 }, items: [], calls: [{ id: "call:a", kind: "call", headline: "Choose a layout", why: "", decision: { task: "a", question: "Which layout?", choices: ["A", "B"] } }] },
      boxes: [{ id: "work-state", kind: "bars", size: "small", title: "Where the work stands", why: "", bars: [{ label: "need you", value: 1, tone: "call" }] }],
    });
    document.getElementById("flip")!.click();
    document.querySelector<HTMLButtonElement>("#readouts .ro-open")!.click();
    const sheet = document.getElementById("calls")!;
    const input = sheet.querySelector<HTMLTextAreaElement>(".art-chat-input")!;
    input.focus();
    input.value = "/des";
    input.dispatchEvent(new Event("input"));
    await settle();
    const menu = sheet.querySelector<HTMLElement>(".commands")!;
    expect(menu.hidden).toBe(false);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(menu.hidden).toBe(true);
    expect(sheet.hidden).toBe(false);
    input.dispatchEvent(new Event("input"));
    await settle();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(input.value).toBe("/design-review ");
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/send")).toBe(false);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    const sent = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/send")!;
    expect(JSON.parse(String(sent[1]!.body))).toEqual({ session: "latest", decision: "a", text: "/design-review" });
  });

  // George, 2026-10-25: "i send a message to flyd and it keeps my message in the textbox":
  // the page redrew the card while the message was on its way and refilled the box from the draft.
  it("empties a card's box as he sends, and a redraw while it goes never brings his words back", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const update = {
      order: [], messages: [], working: false,
      show: { title: "Choose", summary: "", live: false, counts: { call: 1 }, items: [], calls: [{ id: "call:a", kind: "call", headline: "Choose a layout", why: "", decision: { task: "a", question: "Which layout?", choices: ["A", "B"] } }] },
      boxes: [{ id: "work-state", kind: "bars", size: "small", title: "Where the work stands", why: "", bars: [{ label: "need you", value: 1, tone: "call" }] }],
    };
    stream.emit("update", update);
    document.getElementById("flip")!.click();
    document.querySelector<HTMLButtonElement>("#readouts .ro-open")!.click();
    const original = vi.mocked(fetch).getMockImplementation();
    vi.mocked(fetch).mockImplementation(((url: string, init?: RequestInit) => url === "/api/send" ? new Promise(() => {}) : original!(url, init)) as typeof fetch);
    const input = document.getElementById("calls")!.querySelector<HTMLTextAreaElement>(".art-chat-input")!;
    input.value = "all bad";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(input.value).toBe("");
    stream.emit("update", update);
    await settle();
    expect(Array.from(document.querySelectorAll<HTMLTextAreaElement>(".art-chat-input")).map((box) => box.value)).not.toContain("all bad");
  });

  it("completes a skill in a selected-passage comment and keeps its quote", async () => {
    load("");
    await settle();
    open("latest", [{ id: "a1", role: "assistant", html: "<p>The island is smaller.</p>" }]);
    const range = document.createRange();
    const words = document.querySelector(".msg.assistant .body p")!.firstChild!;
    range.setStart(words, 4);
    range.setEnd(words, 10);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise((resolve) => setTimeout(resolve, 40));
    document.querySelector<HTMLButtonElement>(".passage-open")!.click();
    const input = document.querySelector<HTMLTextAreaElement>(".passage-input")!;
    input.value = "/des";
    input.dispatchEvent(new Event("input"));
    await settle();
    document.querySelector<HTMLElement>(".passage .commands li")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(input.value).toBe("/design-review ");
    expect(document.querySelector<HTMLElement>(".passage-card")!.hidden).toBe(false);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    const sent = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/send")!;
    expect(JSON.parse(String(sent[1]!.body))).toEqual({ session: "latest", text: "/design-review", passage: { quote: "island", from: "assistant" } });
    window.getSelection()!.removeAllRanges();
  });
});

describe("semantic main stage", () => {
  // Reproduction (2026-10-21): a call George was watching settled on a background
  // refresh, and its card vanished from the artefact view.
  it("keeps a settled call's card on the artefact when the refresh moves the focus on", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const settled: ShowItem = { id: "call:call-x", kind: "clear", headline: "Choose a color", detail: "Settled, nothing needed.", why: "", task: "x", at: "2026-10-21T07:00:00.000Z" };
    const show: ShowScreen = {
      title: "Good news, sir.",
      summary: "",
      live: true,
      counts: {},
      items: [settled],
      focus: { id: "show:live", kind: "activity", lifecycle: "active", subject: "Work is under way", summary: "Claude is on it now", evidence: [], actions: [], source: { showItemId: "live" } },
    };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
    document.getElementById("flip")!.click();
    await settle();
    expect(document.getElementById("scene-head")!.textContent).toBe("Choose a color");
    expect(document.getElementById("scene-line")!.textContent).toBe("Settled, nothing needed.");
  });

  it("leads with a call that needs him over a settled card", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const settled: ShowItem = { id: "call:call-x", kind: "clear", headline: "Choose a color", detail: "Settled, nothing needed.", why: "", task: "x" };
    const show: ShowScreen = {
      title: "Your move, sir.",
      summary: "",
      live: false,
      counts: {},
      items: [settled],
      focus: { id: "task:build", kind: "activity", lifecycle: "interrupted", subject: "Pick the launch date", summary: "Friday fits.", evidence: [], actions: [], source: { showItemId: "decision:launch" } },
    };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
    document.getElementById("flip")!.click();
    await settle();
    expect(document.getElementById("scene-head")!.textContent).toBe("Pick the launch date");
  });

  it("renders semantic focus instead of a higher-ranked legacy box", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const show: ShowScreen = {
      title: "Legacy situation",
      summary: "Old presentation state",
      live: false,
      counts: { landed: 1, call: 1 },
      items: [],
      focus: {
        id: "decision:launch",
        kind: "decision",
        lifecycle: "interrupted",
        subject: "Choose the launch date",
        summary: "The evidence points to Friday.",
        evidence: [],
        actions: [],
        source: { showItemId: "decision:launch" },
        decision: { target: "launch-date", question: "Launch Friday?", alternatives: ["Friday", "Saturday"], recommended: "Friday" },
      },
    };
    const legacy = [{ id: "legacy", kind: "story", size: "wide", title: "Legacy landed card", line: "This used to win by rank.", why: "landed", tone: "landed" }];
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: legacy });
    expect(document.getElementById("scene-head")!.textContent).toBe("Choose the launch date");
    expect(document.getElementById("scene-line")!.textContent).toContain("The evidence points to Friday");
    expect(document.querySelectorAll(".scene-ask .choice-pick")).toHaveLength(2);
    // The focus is the only card, so there are no card arrows that would do nothing.
    expect((document.getElementById("show-nav") as HTMLElement).hidden).toBe(true);
  });

  it("turns semantic mode into a work-first workspace with a quiet context edge", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const decision = {
      id: "decision:launch", kind: "decision" as const, lifecycle: "interrupted" as const,
      subject: "Choose the launch date", summary: "Friday has the strongest evidence.", evidence: [], actions: [],
      source: { showItemId: "decision:launch" },
      decision: { target: "launch-date", question: "Launch Friday?", alternatives: ["Friday", "Saturday"] },
    };
    const activity = {
      id: "task:site", kind: "activity" as const, lifecycle: "active" as const,
      subject: "Building launch page", summary: "Firstmate is implementing it.", evidence: [], actions: [],
      source: { showItemId: "task:site" }, activity: { phase: "working" as const },
    };
    const artifact = {
      id: "artifact:deck", kind: "artifact" as const, lifecycle: "resolved" as const,
      subject: "Launch deck", summary: "Ready.", evidence: [], actions: [], source: { showItemId: "artifact:deck" },
      artifact: { type: "document" as const, phase: "ready" as const },
    };
    const monitor = {
      id: "monitor:response", kind: "monitor" as const, lifecycle: "active" as const,
      subject: "Watch launch response", summary: "Quiet.", evidence: [], actions: [], source: { showItemId: "monitor:response" },
      monitor: { phase: "quiet" as const, condition: "Surface a meaningful response change" },
    };
    const show: ShowScreen = { title: "Work", summary: "", live: true, counts: { call: 1, live: 1, landed: 1 }, items: [], focus: decision, semantic: [decision, activity, artifact, monitor] };
    stream.emit("update", {
      order: [], messages: [], working: false, show,
      boxes: [
        { id: "legacy", kind: "story", title: "Legacy card", line: "Old UI", tone: "landed" },
        { id: "plan", kind: "gauge", size: "small", title: "Claude plan", gauges: [{ label: "weekly", used: 90 }] },
        { id: "work-state", kind: "bars", size: "small", title: "Where the work stands", bars: [{ label: "under way", value: 1, tone: "live" }] },
      ],
    });
    expect(document.getElementById("show")!.classList.contains("semantic-workspace")).toBe(true);
    expect(document.getElementById("scene")!.dataset.semantic).toBe("decision");
    expect((document.getElementById("ticks") as HTMLElement).hidden).toBe(true);
    // The plan gauge is the only instrument left beside the counts; the old stage's
    // cards and figures that repeat the counts are not shown.
    expect(document.getElementById("readouts")!.textContent).toBe("Claude weekly 90% used");
    expect(document.getElementById("semantic-context")!.textContent).toContain("1 working");
    expect(document.getElementById("semantic-context")!.textContent).toContain("1 landed");
    expect(document.getElementById("semantic-context")!.textContent).toContain("1 watching");
    expect(document.getElementById("semantic-context")!.textContent).not.toContain("Legacy");
    expect(document.getElementById("semantic-context")!.textContent).not.toContain("Where the work stands");
    // Counts come first, the gauge reads under them.
    const edge = document.querySelector(".semantic-context")!;
    expect(edge.nextElementSibling!.id).toBe("readouts");
  });

  it("keeps interrupted and failed work in the edge, and each count opens exactly its own rows", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const object = (id: string, kind: string, lifecycle: string, subject: string, extra: Record<string, unknown> = {}): any => ({
      id, kind, lifecycle, subject, summary: subject + ".", evidence: [], actions: [], source: { showItemId: id }, ...extra,
    });
    const decision = object("decision:launch", "decision", "interrupted", "Choose the launch date", { decision: { target: "launch", question: "Launch Friday?", alternatives: ["Friday", "Saturday"] } });
    const working = object("task:site", "activity", "active", "Building launch page", { activity: { phase: "working" } });
    const review = object("task:copy", "investigation", "active", "Audit the copy");
    const stuck = object("task:export", "activity", "interrupted", "Fix the export", { activity: { phase: "needs_you" } });
    const broken = object("task:import", "activity", "failed", "Import the CSV", { activity: { phase: "paused" } });
    const deck = object("artifact:deck", "artifact", "resolved", "Launch deck", { artifact: { type: "document", phase: "ready" } });
    const monitor = object("monitor:response", "monitor", "active", "Watch launch response", { monitor: { phase: "quiet", condition: "Surface a change" } });
    const show: ShowScreen = {
      title: "Work", summary: "", live: true, counts: { call: 1, live: 2, landed: 1 }, items: [],
      focus: decision, semantic: [decision, working, review, stuck, broken, deck, monitor] as never,
    };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: [] });

    const edge = document.getElementById("semantic-context")!;
    // Interrupted and failed work is named, not silently dropped: failed work has
    // its own group, so it is visible in exactly one place.
    expect(edge.textContent).toContain("1 needs you");
    expect(edge.textContent).toContain("2 working");
    expect(edge.textContent).toContain("1 failed");
    expect(edge.textContent).toContain("1 landed");
    expect(edge.textContent).toContain("1 watching");

    // Every count opens a sheet with exactly that many rows.
    const button = (cls: string) => edge.querySelector<HTMLButtonElement>("." + cls)!;
    button("working").click();
    expect((document.getElementById("drill") as HTMLElement).hidden).toBe(false);
    expect(document.getElementById("drill-title")!.textContent).toBe("Working");
    expect(document.querySelectorAll("#drill-list .drill-card")).toHaveLength(2);
    // Clicking the figure it already shows closes it.
    button("working").click();
    expect((document.getElementById("drill") as HTMLElement).hidden).toBe(true);

    button("failed").click();
    expect(document.getElementById("drill-title")!.textContent).toBe("Failed");
    const rows = document.querySelectorAll("#drill-list .drill-card");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Import the CSV");
    // Leave nothing open: a sheet left up eats Escape for the next screen.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect((document.getElementById("drill") as HTMLElement).hidden).toBe(true);
  });

  it("manifests focused Artifact evidence as the work itself", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const show: ShowScreen = {
      title: "Done",
      summary: "",
      live: false,
      counts: { landed: 1 },
      items: [],
      focus: {
        id: "artifact:map",
        kind: "artifact",
        lifecycle: "resolved",
        subject: "Christmas market map",
        summary: "The final map is ready.",
        evidence: [{ kind: "image", ref: "/shots/map.png", label: "Christmas market map" }],
        actions: [],
        source: { showItemId: "artifact:map" },
      },
    };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: [] });
    expect(document.getElementById("scene-head")!.textContent).toBe("Christmas market map");
    expect(document.querySelector(".scene-shot img")?.getAttribute("src")).toContain("/shots/map.png");
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
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, options]) => JSON.parse(String(options!.body)))).toEqual([{ session: "latest", replyTo: "reply:a#2", questionText: "Want me to add all three?", text: "Yes, all three" }]);
    expect(document.querySelector(".scene-ask .art-chat-receipt")!.textContent).toBe("Sent to Flyd");
    const picks = [...document.querySelectorAll<HTMLButtonElement>(".scene-ask .choice-pick")];
    expect(picks.map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(picks[1]!.disabled).toBe(true);
  });

  it("answers a question card into the session that drew it, not the one the page follows now", async () => {
    load("");
    await settle();
    const stream = open("asked-session", []);
    const calls = [{ id: "call:reply:a#2", kind: "call", headline: "Want me to add all three?", why: "waiting on you", ref: "reply:a#2", decision: { task: "reply:a#2", replyTo: "reply:a#2", question: "Want me to add all three?", choices: ["Yes, all three", "No"] } }];
    const show = { title: "Your move, sir.", summary: "", live: false, counts: { call: 1 }, items: [], calls };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: [{ id: "work-state", kind: "bars", size: "small", title: "Where the work stands", why: "", bars: [{ label: "need you", value: 1, tone: "call" }] }] });
    await settle();
    // Another session takes the lock before he opens the decision that session drew.
    stream.emit("session", { id: "later-session", title: "later-session", updatedAt: "2026-10-05T20:05:00.000Z", assistantLabel: "firstmate" });
    await settle();
    document.querySelector<HTMLButtonElement>("#readouts .ro-open")!.click();
    document.querySelector<HTMLButtonElement>("#calls .choice-pick")!.click();
    await settle();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, options]) => JSON.parse(String(options!.body)))).toEqual([{ session: "asked-session", replyTo: "reply:a#2", questionText: "Want me to add all three?", text: "Yes, all three" }]);
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
    expect(sends()).toEqual([{ session: "latest", replyTo: "reply:b#4", questionText: "Still waiting on you", text: "1. Discard the old CapFive experiment branches? Yes\n2. Should Flyd's sidebar show newest at the top again? No" }]);
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
        { session: "latest", decision: "visuals", text: "A mix of the two" },
        { session: "latest", decision: "visuals", text: "Evergreen luxe" },
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

  it("keeps his message in the card's own thread the moment he sends it, then lands the reply under it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    try {
      load("");
      await settle();
      const stream = open("latest", []);
      const show: ShowScreen = { title: "Choose", summary: "", live: false, counts: { call: 1 }, items: [{ id: "call:visuals", kind: "call", headline: "Pick the Christmas direction for the site", why: "", task: "visuals", decision: { task: "visuals", question: "Choose from the lab", choices: ["Evergreen luxe", "Christmas card"] } }] };
      stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
      document.getElementById("flip")!.click();
      const ask = document.querySelector<HTMLElement>(".scene-ask")!;
      const thread = ask.querySelector<HTMLElement>(".art-thread")!;
      // No thread until he says something.
      expect(thread.hidden).toBe(true);
      const chat = ask.querySelector<HTMLTextAreaElement>(".art-chat-input")!;
      chat.value = "A mix of the two";
      chat.dispatchEvent(new Event("input"));
      ask.querySelector(".art-chat")!.dispatchEvent(new Event("submit", { cancelable: true }));
      await settle();
      // His words stand in the thread at once, with nothing under them yet.
      expect(thread.hidden).toBe(false);
      expect([...thread.querySelectorAll(".art-msg--you")].map((node) => node.textContent)).toEqual(["A mix of the two"]);
      expect(thread.querySelector(".art-msg--them")).toBeNull();
      // The reply about his note lands under it when it comes.
      vi.mocked(fetch).mockImplementation(async (url) => json(String(url).startsWith("/api/note?") ? { receipt: "read", answer: { text: "A mix it is, sir.", timestamp: "2026-10-05T20:03:00.000Z" } } : {}));
      vi.advanceTimersByTime(5000);
      await settle();
      expect([...thread.querySelectorAll(".art-msg--them")].map((node) => node.textContent)).toEqual(["A mix it is, sir."]);
    } finally {
      vi.useRealTimers();
    }
  });

  // George, 2026-10-29: "Why doesn't Flyd show me that it's working and give me information about
  // what's happening? I typed something in and it just... nothing happens."
  it("says what Flyd is doing about a card's message, then replaces that line with the answer in place", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    try {
      load("");
      await settle();
      const stream = open("latest", []);
      const show: ShowScreen = { title: "Choose", summary: "", live: false, counts: { call: 1 }, items: [{ id: "call:visuals", kind: "call", headline: "Pick the Christmas direction for the site", why: "", task: "visuals", decision: { task: "visuals", question: "Choose from the lab", choices: ["Evergreen luxe", "Christmas card"] } }] };
      stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
      document.getElementById("flip")!.click();
      const ask = document.querySelector<HTMLElement>(".scene-ask")!;
      const thread = ask.querySelector<HTMLElement>(".art-thread")!;
      const chat = ask.querySelector<HTMLTextAreaElement>(".art-chat-input")!;
      chat.value = "what are those decisions?";
      chat.dispatchEvent(new Event("input"));
      vi.mocked(fetch).mockImplementation(async (url) => json(url === "/api/send" ? { id: "ask:7" } : {}));
      ask.querySelector(".art-chat")!.dispatchEvent(new Event("submit", { cancelable: true }));
      await settle();
      // It is sent and nothing has come back: the card says what is happening, never just "Sent".
      expect(thread.querySelector(".art-working")!.textContent).toBe("Queued");
      // The step being taken replaces that one line, in place.
      vi.mocked(fetch).mockImplementation(async (url) => json(String(url).startsWith("/api/note?") ? { receipt: "sent", doing: "Reading the report" } : {}));
      vi.advanceTimersByTime(4000);
      await settle();
      expect(thread.querySelectorAll(".art-working")).toHaveLength(1);
      expect(thread.querySelector(".art-working")!.textContent).toBe("Reading the report");
      // Handed to the work that runs it: the card still says what is happening, not who has it.
      vi.mocked(fetch).mockImplementation(async (url) => json(String(url).startsWith("/api/note?") ? { receipt: "read", handoff: "taken" } : {}));
      vi.advanceTimersByTime(4000);
      await settle();
      expect(thread.querySelector(".art-working")!.textContent).toBe("Working on it");
      // The answer takes its place: the working line is gone, the answer is under his words.
      vi.mocked(fetch).mockImplementation(async (url) => json(String(url).startsWith("/api/note?") ? { receipt: "read", answer: { text: "Two: ship the fixes, then pick a direction.", timestamp: "2026-10-05T20:03:00.000Z" } } : {}));
      vi.advanceTimersByTime(4000);
      await settle();
      expect(thread.querySelector(".art-working")).toBeNull();
      expect(thread.querySelector(".art-msg--them")!.textContent).toBe("Two: ship the fixes, then pick a direction.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a failed answer as the card's error, with no working line, and stops asking about it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    try {
      load("");
      await settle();
      const stream = open("latest", []);
      const show: ShowScreen = { title: "Choose", summary: "", live: false, counts: { call: 1 }, items: [{ id: "call:visuals", kind: "call", headline: "Pick the Christmas direction for the site", why: "", task: "visuals", decision: { task: "visuals", question: "Choose from the lab", choices: ["Evergreen luxe", "Christmas card"] } }] };
      stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
      document.getElementById("flip")!.click();
      const ask = document.querySelector<HTMLElement>(".scene-ask")!;
      const chat = ask.querySelector<HTMLTextAreaElement>(".art-chat-input")!;
      chat.value = "what are those decisions?";
      chat.dispatchEvent(new Event("input"));
      vi.mocked(fetch).mockImplementation(async (url) => json(url === "/api/send" ? { id: "ask:7" } : String(url).startsWith("/api/note?") ? { receipt: "sent", failed: "Flyd couldn't answer this: model timed out" } : {}));
      ask.querySelector(".art-chat")!.dispatchEvent(new Event("submit", { cancelable: true }));
      await settle();
      vi.advanceTimersByTime(4000);
      await settle();
      expect(ask.querySelector(".art-working")).toBeNull();
      const receipt = ask.querySelector<HTMLElement>(".art-chat-receipt")!;
      expect(receipt.textContent).toBe("Flyd couldn't answer this: model timed out");
      expect(receipt.classList.contains("problem")).toBe(true);
      const asked = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith("/api/note?")).length;
      const before = asked();
      vi.advanceTimersByTime(9000);
      await settle();
      expect(asked()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets him answer an answer where it stands, in the card's own thread", async () => {
    localStorage.setItem("flyd-decision:visuals:Choose from the lab", JSON.stringify([{ text: "A mix of the two", id: "note:1", answer: "A mix it is, sir." }]));
    load("");
    await settle();
    const stream = open("latest", []);
    const show: ShowScreen = { title: "Choose", summary: "", live: false, counts: { call: 1 }, items: [{ id: "call:visuals", kind: "call", headline: "Pick the Christmas direction for the site", why: "", task: "visuals", decision: { task: "visuals", question: "Choose from the lab", choices: ["Evergreen luxe", "Christmas card"] } }] };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
    document.getElementById("flip")!.click();
    const ask = document.querySelector<HTMLElement>(".scene-ask")!;
    const reply = ask.querySelector<HTMLButtonElement>(".art-reply")!;
    expect(reply.textContent).toBe("Reply");
    reply.click();
    await settle();
    // A box opens under the answer, and what he sends there goes back as a reply to it.
    const box = ask.querySelector<HTMLTextAreaElement>(".art-chat--nested .art-chat-input")!;
    box.value = "make it quieter";
    box.dispatchEvent(new Event("input"));
    ask.querySelector(".art-chat--nested")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    const sent = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/send")!;
    const body = JSON.parse(String((sent[1] as RequestInit).body));
    expect(body.text).toBe("make it quieter");
    expect(body.replyTo).toBe("note:1");
  });

  it("lets him reply to his own message too, and keeps a half-typed reply while the card redraws", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    try {
      localStorage.setItem("flyd-decision:visuals", JSON.stringify([{ text: "A mix of the two", id: "note:1" }]));
      load("");
      await settle();
      const stream = open("latest", []);
      const show: ShowScreen = { title: "Choose", summary: "", live: false, counts: { call: 1 }, items: [{ id: "call:visuals", kind: "call", headline: "Pick the Christmas direction for the site", why: "", task: "visuals", decision: { task: "visuals", question: "Choose from the lab", choices: ["Evergreen luxe", "Christmas card"] } }] };
      stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
      document.getElementById("flip")!.click();
      const ask = document.querySelector<HTMLElement>(".scene-ask")!;
      const reply = ask.querySelector<HTMLButtonElement>(".art-reply")!;
      expect(reply.getAttribute("aria-label")).toBe("Reply to this message");
      reply.click();
      await settle();
      const box = ask.querySelector<HTMLTextAreaElement>(".art-chat--nested .art-chat-input")!;
      box.value = "and make it quieter";
      box.dispatchEvent(new Event("input"));
      // What Flyd is doing changes under his message: the card redraws, his reply box stays.
      vi.mocked(fetch).mockImplementation(async (url) => json(String(url).startsWith("/api/note?") ? { receipt: "sent", doing: "Reading the lab" } : {}));
      vi.advanceTimersByTime(4000);
      await settle();
      expect(ask.querySelector(".art-working")!.textContent).toBe("Reading the lab");
      expect(ask.querySelector(".art-chat--nested .art-chat-input")).toBe(box);
      expect(box.isConnected).toBe(true);
      expect(box.value).toBe("and make it quieter");
      expect(document.activeElement).toBe(box);
      ask.querySelector(".art-chat--nested")!.dispatchEvent(new Event("submit", { cancelable: true }));
      await settle();
      const sent = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/send")!;
      const body = JSON.parse(String((sent[1] as RequestInit).body));
      expect(body.replyTo).toBe("note:1");
      // His own words go back as his note, never as a question the session asked.
      expect(body.questionText).toBeUndefined();
      // The note he replied under leaves the inbox: his reply and its box stay where they are.
      vi.mocked(fetch).mockImplementation(async (url) => json(String(url).startsWith("/api/note?") ? { receipt: null } : {}));
      for (let tick = 0; tick < 4; tick++) {
        vi.advanceTimersByTime(4000);
        await settle();
      }
      const nested = ask.querySelector<HTMLElement>(".art-chat--nested")!;
      expect(nested.isConnected).toBe(true);
      expect([...nested.querySelectorAll(".art-msg--you")].map((node) => node.textContent)).toEqual(["and make it quieter"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers a reply under every sent message, its own words or an answer, whether or not the note is still in the inbox", async () => {
    localStorage.setItem("flyd-decision:visuals", JSON.stringify([{ text: "Evergreen luxe", id: "decision:visuals" }, { text: "A mix of the two", id: "note:1" }, { text: "Gone from the inbox", id: "note:2", done: true }, { text: "Answered", id: "note:3", done: true, answer: "Done, sir." }]));
    load("");
    await settle();
    const stream = open("latest", []);
    const show: ShowScreen = { title: "Choose", summary: "", live: false, counts: { call: 1 }, items: [{ id: "call:visuals", kind: "call", headline: "Pick the Christmas direction for the site", why: "", task: "visuals", decision: { task: "visuals", question: "Choose from the lab", choices: ["Evergreen luxe", "Christmas card"] } }] };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
    document.getElementById("flip")!.click();
    const entries = [...document.querySelectorAll(".scene-ask .art-entry")];
    expect(entries.map((entry) => Boolean(entry.querySelector(".art-reply")))).toEqual([true, true, true, true]);
  });

  it("keeps a card's message out of its thread and back in the box when it does not go", async () => {    load("");
    await settle();
    const stream = open("latest", []);
    const show: ShowScreen = { title: "Choose", summary: "", live: false, counts: { call: 1 }, items: [{ id: "call:visuals", kind: "call", headline: "Pick the Christmas direction for the site", why: "", task: "visuals", decision: { task: "visuals", question: "Choose from the lab", choices: ["Evergreen luxe"] } }] };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
    document.getElementById("flip")!.click();
    const ask = document.querySelector<HTMLElement>(".scene-ask")!;
    const chat = ask.querySelector<HTMLTextAreaElement>(".art-chat-input")!;
    chat.value = "Make the pins bigger";
    chat.dispatchEvent(new Event("input"));
    vi.mocked(fetch).mockImplementation(async (url) => (url === "/api/send" ? json({ error: "firstmate did not take the message" }, 502) : json({})));
    ask.querySelector(".art-chat")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(ask.querySelector<HTMLElement>(".art-thread")!.hidden).toBe(true);
    expect(chat.value).toBe("Make the pins bigger");
    expect(ask.querySelector(".art-chat-receipt")!.textContent).toBe("firstmate did not take the message");
  });

  it("shows a card's thread again after a reload, answers and all", async () => {
    localStorage.setItem("flyd-decision:visuals:Choose from the lab", JSON.stringify([{ text: "A mix of the two", id: "note:1" }, { text: "Make the pins bigger", id: "note:2", answer: "Bigger pins it is, sir." }]));
    load("");
    await settle();
    const stream = open("latest", []);
    const show: ShowScreen = { title: "Choose", summary: "", live: false, counts: { call: 1 }, items: [{ id: "call:visuals", kind: "call", headline: "Pick the Christmas direction for the site", why: "", task: "visuals", decision: { task: "visuals", question: "Choose from the lab", choices: ["Evergreen luxe", "Christmas card"] } }] };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
    document.getElementById("flip")!.click();
    const thread = document.querySelector<HTMLElement>(".scene-ask .art-thread")!;
    expect(thread.hidden).toBe(false);
    expect([...thread.querySelectorAll(".art-msg--you")].map((node) => node.textContent)).toEqual(["A mix of the two", "Make the pins bigger"]);
    expect([...thread.querySelectorAll(".art-msg--them")].map((node) => node.textContent)).toEqual(["Bigger pins it is, sir."]);
  });

  it("keeps asking about a taken card note until it goes from the inbox, and keeps only the thread past the session", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    try {
      localStorage.setItem("flyd-decision:visuals", JSON.stringify([{ text: "A mix of the two", id: "note:1" }, { text: "Gone", id: "note:2" }, { text: "Draining", id: "note:3" }]));
      load("");
      await settle();
      const stream = open("latest", []);
      const show: ShowScreen = { title: "Choose", summary: "", live: false, counts: { call: 1 }, items: [{ id: "call:visuals", kind: "call", headline: "Pick the Christmas direction for the site", why: "", task: "visuals", decision: { task: "visuals", question: "Choose from the lab", choices: ["Evergreen luxe", "Christmas card"] } }] };
      stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
      document.getElementById("flip")!.click();
      const asked = (id = "") => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith("/api/note?id=" + id)).length;
      vi.mocked(fetch).mockImplementation(async (url) => {
        const at = String(url);
        // Taken but unanswered: the card never treats that as finished with, so it keeps asking.
        if (at.startsWith("/api/note?id=note%3A1")) return json({ receipt: "read" });
        if (at.startsWith("/api/note?id=note%3A3") && asked("note%3A3") > 1) return json({ receipt: "read", answer: { text: "Done, sir." } });
        // One miss is firstmate moving the note to handled/; the reply that follows still lands.
        return json(at.startsWith("/api/note?") ? { receipt: null } : {});
      });
      for (let tick = 0; tick < 5; tick++) {
        vi.advanceTimersByTime(5000);
        await settle();
      }
      expect([asked("note%3A1"), asked("note%3A2"), asked("note%3A3")]).toEqual([5, 3, 2]);
      expect([...document.querySelectorAll(".scene-ask .art-msg--them")].map((node) => node.textContent)).toEqual(["Done, sir."]);
      const kept = JSON.parse(localStorage.getItem("flyd-decision:visuals")!);
      expect(kept.map((entry: { text: string }) => entry.text)).toEqual(["A mix of the two", "Gone", "Draining"]);
      expect(JSON.parse(sessionStorage.getItem("flyd-decision:visuals")!).thread).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("folds in what another copy of the same card stored instead of writing over it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    try {
      const key = "flyd-decision:visuals";
      localStorage.setItem(key, JSON.stringify([{ text: "A mix of the two", id: "note:1" }]));
      load("");
      await settle();
      const stream = open("latest", []);
      const show: ShowScreen = { title: "Choose", summary: "", live: false, counts: { call: 1 }, items: [{ id: "call:visuals", kind: "call", headline: "Pick the Christmas direction for the site", why: "", task: "visuals", decision: { task: "visuals", question: "Choose from the lab", choices: ["Evergreen luxe", "Christmas card"] } }] };
      stream.emit("update", { order: [], messages: [], working: false, show, boxes: boxesOf(show) });
      document.getElementById("flip")!.click();
      // Another copy of this card sent a second message, and already heard that a third is finished with.
      localStorage.setItem(key, JSON.stringify([{ text: "A mix of the two", id: "note:1" }, { text: "Make the pins bigger", id: "note:2" }, { text: "Old", id: "note:0", done: true }]));
      vi.mocked(fetch).mockImplementation(async (url) => json(String(url).startsWith("/api/note?id=note%3A1") ? { receipt: "read", answer: { text: "A mix it is, sir." } } : String(url).startsWith("/api/note?") ? { receipt: "sent" } : {}));
      vi.advanceTimersByTime(5000);
      await settle();
      const kept = JSON.parse(localStorage.getItem(key)!);
      expect(kept).toEqual([
        { text: "A mix of the two", id: "note:1", answer: "A mix it is, sir." },
        { text: "Make the pins bigger", id: "note:2" },
        { text: "Old", id: "note:0", done: true },
      ]);
      const thread = document.querySelector<HTMLElement>(".scene-ask .art-thread")!;
      expect([...thread.querySelectorAll(".art-msg--you")].map((node) => node.textContent)).toEqual(["A mix of the two", "Make the pins bigger", "Old"]);
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
      { session: "latest", text: "Make the pins bigger", about: { title: "Christmas Nuanu map", task: "gnm-xmas-map", url: "https://github.com/o/flyd/pull/9" } },
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
      { session: "latest", text: "Like this", about: { title: "Christmas Nuanu map", task: "gnm-xmas-map" }, images: [{ mediaType: "image/png", data }] },
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
    // A phone-wide picture that is not portrait is not a phone: a square icon, a landscape crop.
    expect(shapeAt(512, 512)).toBe("device art");
    expect(shapeAt(500, 300)).toBe("device art");
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
    // Only a figure with its own work behind it opens one; the rest stay readings.
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
    expect(sent).toEqual([{ session: "latest", decision: "b", text: "Merge it" }]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(sheet.hidden).toBe(true);
  });

  it("opens any figure onto its own group, one line each newest first, each opening its card detail", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const underway = [
      { id: "live:a", kind: "live", headline: "CapFive tiles show the closed year", why: "", status: "half done", at: "2026-10-18T08:00:00Z" },
      { id: "live:b", kind: "live", headline: "Fix the island filter", why: "", at: "2026-10-18T09:00:00Z" },
    ];
    const held = [{ id: "held:a", kind: "waiting", headline: "Stopped a job before it finished", why: "", status: "paused", at: "2026-10-18T07:00:00Z" }];
    const show = { title: "", summary: "", live: false, counts: { live: 2, waiting: 1 }, items: [], underway, held };
    const bars = [{ label: "under way", value: 2, tone: "live" }, { label: "held up", value: 1, tone: "waiting" }];
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: [{ id: "work-state", kind: "bars", size: "small", title: "Where the work stands", why: "", bars }] });
    await settle();
    const figures = document.querySelectorAll<HTMLButtonElement>("#readouts .ro-open");
    expect(figures[0]!.textContent).toBe("2 under way");
    figures[0]!.click();
    const drill = document.getElementById("drill")!;
    expect(drill.hidden).toBe(false);
    expect(document.getElementById("drill-title")!.textContent).toBe("Under way");
    const items = [...drill.querySelectorAll<HTMLElement>("#drill-list > .card")];
    // Newest first, one plain line each.
    expect(items.map((node) => node.querySelector(".card-line")!.textContent)).toEqual(["Fix the island filter", "CapFive tiles show the closed year"]);
    // An item opens its card detail where it stands.
    expect(items[0]!.classList.contains("is-open")).toBe(false);
    items[0]!.click();
    expect(items[0]!.querySelector<HTMLElement>(".card-detail")!.hidden).toBe(false);
    // Clicking the same figure again closes it.
    figures[0]!.click();
    expect(drill.hidden).toBe(true);
    // Another figure opens its own group.
    figures[1]!.click();
    expect(document.getElementById("drill-title")!.textContent).toBe("Held up");
    expect(drill.querySelectorAll("#drill-list > .card")).toHaveLength(1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(drill.hidden).toBe(true);
  });

  it("opens the week's landed figure onto its own week's work, not the column's list", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const landedWeek = [
      { id: "landed-week:a", kind: "landed", headline: "Ticket modal", why: "", status: "merged", project: "GNM", at: "2026-10-17" },
      { id: "landed-week:b", kind: "landed", headline: "Slide-in", why: "", at: "2026-10-15" },
    ];
    const show = { title: "", summary: "", live: false, counts: { landed: 2 }, items: [], landedWeek, landedByDay: [{ day: "2026-10-17", count: 2 }] };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: [{ id: "landed-week", kind: "bars", size: "small", title: "2 landed this week", why: "" }] });
    await settle();
    const figure = document.querySelector<HTMLButtonElement>("#readouts .ro-open")!;
    expect(figure.textContent).toBe("2 landed this week");
    figure.click();
    expect(document.getElementById("drill-title")!.textContent).toBe("Landed");
    const items = [...document.querySelectorAll<HTMLElement>("#drill-list > .card")];
    expect(items.map((node) => node.querySelector(".card-line")!.textContent)).toEqual(["Ticket modal", "Slide-in"]);
    // "merged" only repeats the chip: the project reads where it stands instead.
    expect(items[0]!.querySelector(".card-sub")!.textContent).toBe("GNM");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(document.getElementById("drill")!.hidden).toBe(true);
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

  it("puts a question a reply asks him in a card under it, answered by one tap or his own words", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const choice = { question: "Want me to add all three?", options: ["Yes, all three", "Only 1: Press feedback", "No"], replyTo: "reply:a#2", session: "asked-session" };
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
    expect(sends()).toEqual([{ session: "asked-session", text: "Yes, all three", replyTo: "reply:a#2", questionText: choice.question }]);
    expect(message.querySelector(".choice .reply-note")!.textContent).toBe("Sent: “Yes, all three”");
    expect(buttons.every((button) => button.disabled)).toBe(true);
    // Once he has answered, the card goes; an open question takes his own words.
    stream.emit("update", { order: ["u1", "reply:a#2", "r3"], messages: [{ ...asked, choice: undefined }, { id: "r3", role: "assistant", html: "<p>Done.</p>", choice: { question: "What should the button say?", options: [], replyTo: "r3", session: "asked-session" } }], working: false });
    await settle();
    expect(message.querySelector(".choice")).toBeNull();
    const open3 = document.querySelectorAll<HTMLElement>(".msg")[2]!;
    expect(open3.querySelector(".choice-option")).toBeNull();
    const words = open3.querySelector<HTMLTextAreaElement>(".choice-input")!;
    words.value = "Book a stall";
    words.dispatchEvent(new Event("input"));
    words.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    expect(sends().at(-1)).toEqual({ session: "asked-session", text: "Book a stall", replyTo: "r3", questionText: "What should the button say?" });
  });

  it("asks several questions one at a time, sends nothing on a tap, and sends his answers together at the end", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const steps = [
      { question: "Discard the old CapFive experiment branches?", options: ["Yes", "No"] },
      { question: "Should Flyd's sidebar show newest at the top again?", options: ["Yes", "No"] },
    ];
    const asked = { id: "reply:b#4", role: "assistant", html: "<p>Both fixes are live.</p>", aside: true, choice: { question: "Still waiting on you", options: [], steps, replyTo: "reply:b#4", session: "asked-session" } };
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
    expect(sends()).toEqual([{ session: "asked-session", replyTo: "reply:b#4", questionText: "Still waiting on you", text: "1. Discard the old CapFive experiment branches? Yes\n2. Should Flyd's sidebar show newest at the top again? No, newest at the bottom" }]);
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

  it("keeps the same scene on stage while an enlarged picture is open, and after he closes it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    try {
      load("");
      await settle();
      const stream = open("latest", []);
      stream.emit("update", { order: [], messages: [], working: true, show: SHOW, boxes: boxesOf(SHOW as ShowScreen) });
      document.getElementById("flip")!.click();
      expect(document.getElementById("scene-head")!.textContent).toBe("Header controls");
      (document.querySelector(".scene-shot .device") as HTMLElement).click();
      const lightbox = document.getElementById("lightbox") as HTMLElement;
      expect(lightbox.hidden).toBe(false);
      vi.advanceTimersByTime(9_500);
      await new Promise((resolve) => setTimeout(resolve, 300));
      lightbox.click();
      expect(lightbox.hidden).toBe(true);
      expect(document.getElementById("scene-head")!.textContent).toBe("Header controls");
    } finally {
      vi.useRealTimers();
    }
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
    expect(controls).toEqual(["Needs you", "preferences", "artefact"]);
    const switches = Array.from(document.querySelectorAll('header .controls button[role="switch"], #prefs button[role="switch"]')).map((button) => button.id);
    expect(switches).toEqual(["flip", "mode", "theme", "rail-toggle", "left-toggle"]);
    const flip = document.getElementById("flip")!;
    expect(flip.getAttribute("aria-checked")).toBe("false");
    flip.click();
    expect(document.documentElement.getAttribute("data-screen")).toBe("show");
    expect(flip.getAttribute("aria-checked")).toBe("true");
    expect(flip.textContent).toBe("artefact");
    // The front page is paper by default; the switch turns it dark.
    const theme = document.getElementById("theme")!;
    expect(theme.getAttribute("aria-checked")).toBe("true");
    theme.click();
    expect(theme.getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
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
    expect([...prefs.querySelectorAll(".prefs-name")].map((node) => node.textContent)).toEqual(["Full replies", "Light theme", "Right column", "Needs you", "Local preparation", "Routines", "Taste"]);
    // A switch inside keeps it open; Escape or a click elsewhere closes it.
    document.getElementById("theme")!.click();
    expect(prefs.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
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

  it("puts one decision that needs him in the left column with its recommended choice, and what got done on the right", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const started = new Date(Date.now() - 25 * 60_000).toISOString();
    const calls = [
      { id: "call:a", kind: "call", headline: "Pick the vendor step layout.", why: "", project: "GNM (Good Neighbours Market)", detail: "Six layouts are built.", decision: { task: "a", question: "Pick one", choices: [] } },
      { id: "call:b", kind: "call", headline: "Keep the Jev rule?", why: "", decision: { task: "b", question: "Keep or remove", choices: ["Keep", "Remove"], recommended: "Keep" } },
    ];
    const underway = [{ id: "live:x", kind: "live", headline: "A worker is shrinking the island.", why: "", project: "Flyd", started }];
    const done = [
      { id: "landed:1", kind: "landed", headline: "The Block42 logo is on the homepage.", why: "", detail: "Visitors see it above the fold.", at: started, project: "GNM (Good Neighbours Market)", open: { label: "Open", url: "https://example.com/pr/1" } },
      ...[2, 3, 4, 5, 6, 7].map((n) => ({ id: `landed:${n}`, kind: "landed", headline: `Landed ${n}.`, why: "", at: started })),
    ];
    const update = (show: Record<string, unknown>) => stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [], ...show }, boxes: [] });
    update({ calls, underway, done });
    await settle();
    const needs = document.querySelector("#left #needs")!;
    // A narrow window keeps it shut; the header button counts what waits and opens it.
    expect(document.getElementById("left")!.hidden).toBe(true);
    expect(document.getElementById("left-open")!.textContent).toBe("Needs you · 2");
    document.getElementById("left-open")!.click();
    expect(document.getElementById("left")!.hidden).toBe(false);
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
    update({ calls: [calls[1]], underway, done });
    expect(needs.querySelector(".needs-head")!.textContent).toBe("Keep the Jev rule?");
    expect(needs.querySelector(".needs-nav")).toBeNull();
    // The right column holds only done work: never a job under way, never the decision.
    const rail = document.getElementById("rail")!;
    expect(rail.hidden).toBe(false);
    expect(rail.textContent).not.toMatch(/shrinking the island|Jev rule|vendor step/);
    expect(document.querySelectorAll("#done li")).toHaveLength(6);
    const doneRow = document.querySelector("#done li")!;
    expect(doneRow.querySelector(".brief-line")!.textContent).toBe("The Block42 logo is on the homepage.");
    expect(doneRow.querySelector(".brief-outcome")!.textContent).toBe("Visitors see it above the fold.");
    expect(doneRow.querySelector(".brief-meta a")!.getAttribute("href")).toBe("https://example.com/pr/1");
    expect(doneRow.querySelector(".brief-meta")!.textContent).toBe("open25m ago");
    document.querySelector<HTMLButtonElement>("#done .brief-more")!.click();
    expect(document.querySelectorAll("#done li")).toHaveLength(7);
    // Nothing waiting or done: the history column remains for earlier sessions.
    update({});
    expect(document.getElementById("brief")!.hidden).toBe(true);
    expect(rail.hidden).toBe(false);
    expect(document.getElementById("history")!.hidden).toBe(false);
    expect(document.getElementById("left")!.hidden).toBe(true);
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
    const nextImage = document.createElement("img");
    nextImage.src = "/api/artefact-shot?task=1&file=before.png";
    document.body.appendChild(nextImage);
    const lightbox = document.getElementById("lightbox") as HTMLElement;
    expect(lightbox.hidden).toBe(true);
    thumb.click();
    expect(lightbox.hidden).toBe(false);
    expect(document.getElementById("lightbox-img")!.getAttribute("src")).toContain("/api/artefact-shot?task=1&file=after.png");
    (document.querySelector(".lightbox-next") as HTMLButtonElement).click();
    expect(document.getElementById("lightbox-img")!.getAttribute("src")).toContain("/api/artefact-shot?task=1&file=before.png");
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
    // The pictured work, what Flyd sees coming (the plan limit), then the stories in words. A call with
    // nothing to see waits in Needs you rather than taking a scene (George, 2026-10-25).
    const ticks = Array.from(document.querySelectorAll("#ticks button")).map((tick) => tick.getAttribute("aria-label"));
    expect(ticks).toEqual([
      "under way: Header controls",
      "coming up: Claude weekly limit: 10% left.",
      "from your memory: Bloom gets finished",
    ]);

    // The arrow brings the next scene up like a title card: what Flyd sees coming.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(document.getElementById("scene-head")!.textContent).toBe("Claude weekly limit: 10% left.");
    expect(document.getElementById("scene")!.classList.contains("has-shot")).toBe(false);
    expect((document.getElementById("show-nav") as HTMLElement).hidden).toBe(false);
    (document.getElementById("show-prev") as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(document.getElementById("scene-head")!.textContent).toBe("Header controls");

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

  it("offers no left column and no header button while nothing needs him, even with the column switched on", async () => {
    localStorage.setItem("flyd-left", "on");
    load("");
    await settle();
    const stream = open("latest", []);
    stream.emit("update", { order: [], messages: [], working: false, leftColumn: { now: [], recent: [], semantic: [] } });
    expect(document.getElementById("left-open")!.hidden).toBe(true);
    expect(document.getElementById("left")!.hidden).toBe(true);
    expect(document.documentElement.getAttribute("data-left")).toBe("off");
  });

  it("shows only what he can act on now, with its action, and never Flyd's own routing trouble or a stale stall", async () => {
    localStorage.setItem("flyd-left", "on");
    load("");
    await settle();
    const stream = open("latest", []);
    const recent = new Date(Date.now() - 60 * 60_000).toISOString();
    const old = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
    const activity = (id: string, phase: string, lifecycle: string, extra: Record<string, unknown> = {}) => ({
      id, kind: "activity", lifecycle, subject: `${id} subject`, summary: "", evidence: [], actions: [], source: { showItemId: id, task: id }, activity: { phase }, ...extra,
    });
    stream.emit("update", { order: [], messages: [], working: false, leftColumn: { now: [], recent: [], semantic: [
      activity("task:review", "ready", "active", { evidence: [{ kind: "web", ref: "https://github.com/example/repo/pull/7", label: "PR" }] }),
      activity("task:paused", "paused", "interrupted", { updatedAt: recent }),
      activity("task:stale", "paused", "interrupted", { updatedAt: old }),
      activity("task:stale-failed", "working", "failed", { updatedAt: old }),
      activity("task:stale-decision", "needs_you", "interrupted", { updatedAt: old, decision: { target: "x", question: "Ship it?", alternatives: ["Yes", "No"] } }),
      activity("task:routing", "paused", "failed", { updatedAt: recent, detail: "Flyd couldn't route this to the crew." }),
      activity("task:working", "working", "active", { updatedAt: recent }),
      activity("task:route-decision", "needs_you", "interrupted", { subject: "Routing tests fail on Node 22, skip them?", decision: { target: "y", question: "Skip them?", alternatives: ["Yes", "No"] } }),
      activity("task:route-review", "ready", "active", { subject: "Fix the /login route error" }),
    ] } });
    await settle();
    const cards = [...document.querySelectorAll<HTMLElement>("#left-semantic .semantic-activity")];
    // A decision or review stays even when its own words mention routes and errors.
    expect(cards.map((card) => card.dataset.semanticId)).toEqual(["task:review", "task:stale-decision", "task:route-decision", "task:route-review"]);
    expect(document.getElementById("left-open")!.textContent).toBe("Needs you · 4");
    // A review says so and opens the work; no status chip, icon or dot on any card.
    expect(cards[0]!.querySelector(".card-line")!.textContent).toBe("Review: task:review subject");
    const openLink = cards[0]!.querySelector<HTMLAnchorElement>(".card-link")!;
    expect(openLink.textContent).toBe("Open ↗");
    expect(openLink.href).toBe("https://github.com/example/repo/pull/7");
    expect(document.querySelector("#left .card-icon, #left .card-meta")).toBeNull();
    expect(document.getElementById("left")!.textContent).not.toMatch(/Held up/i);
  });

  it("keeps the column when Escape closes preferences or comes from the message box", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("1480"), media: query, addEventListener() {}, removeEventListener() {} }));
    load("");
    await settle();
    const stream = open("latest", []);
    stream.emit("update", { order: [], messages: [], working: false, boxes: [], show: { title: "", summary: "", live: false, counts: {}, items: [], calls: [{ id: "call:a", kind: "call", headline: "Choose a.", why: "", decision: { task: "a", question: "Which?", choices: ["A", "B"] } }] } });
    await settle();
    const left = document.getElementById("left")!;
    expect(left.hidden).toBe(false);
    document.getElementById("prefs-open")!.click();
    expect(document.getElementById("prefs")!.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(document.getElementById("prefs")!.hidden).toBe(true);
    expect(left.hidden).toBe(false);
    expect(localStorage.getItem("flyd-left")).toBeNull();
    document.getElementById("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(left.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(left.hidden).toBe(true);
  });

  it("keeps paused work out of George's left column", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const at = new Date(Date.now() - 4 * 60_000).toISOString();
    stream.emit("update", { order: [], messages: [], working: false, leftColumn: { now: [], recent: [], semantic: [{ id: "task:held", kind: "activity", lifecycle: "interrupted", subject: "The island rework is paused.", summary: "Paused for review.", detail: "Paused before merging; the diff is ready to read.", evidence: [], actions: [], source: { showItemId: "held:1", task: "held" }, activity: { phase: "paused", started: at } }] } });
    expect(document.querySelectorAll("#left-semantic .left-card")).toHaveLength(0);
  });

  it("does not turn a paused job into an action card", async () => {
    const html = renderPage({ assistantLabel: "firstmate", sendToken: "a".repeat(48) });
    document.head.innerHTML = /<style>[\s\S]*?<\/style>/.exec(html)![0]!;
    load("", html);
    await settle();
    const stream = open("latest", []);
    const at = new Date(Date.now() - 3 * 3_600_000).toISOString();
    stream.emit("update", { order: [], messages: [], working: false, leftColumn: { now: [], recent: [], semantic: [{ id: "task:held", kind: "activity", lifecycle: "interrupted", subject: "The island rework is paused.", summary: "Paused for review.", detail: "Paused before merging; the diff is ready to read.", evidence: [], actions: [], source: { showItemId: "held:1", task: "held" }, activity: { phase: "paused", started: at } }] } });
    expect(document.querySelectorAll("#left-semantic .left-card")).toHaveLength(0);
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
    for (const selector of [".brief-label", ".needs-meta", ".needs-head", ".brief-meta", ".left-tab"]) {
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
    for (const selector of ["#done li"]) {
      const cs = style(selector);
      const border = parseFloat(cs.borderTopWidth);
      expect(Number.isNaN(border) || border === 0, `${selector} border`).toBe(true);
      expect(cs.borderTopLeftRadius, `${selector} radius`).toBe("12px");
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

  it("renders one native standalone Decision and leaves task-bound choices inside Activity", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const show: ShowScreen = {
      title: "", summary: "", live: false, counts: { call: 2 }, items: [],
      calls: [
        { id: "call:task", kind: "call", task: "task", headline: "Ship the task?", why: "waiting on you", decision: { task: "task", question: "Ship?", choices: ["Ship", "Hold"] } },
        { id: "call:reply:a#2", kind: "call", headline: "Which direction?", why: "waiting on you", ref: "reply:a#2", decision: { task: "reply:a#2", replyTo: "reply:a#2", question: "Which direction?", choices: ["A", "B"], recommended: "B" } },
      ],
      decisions: [{
        id: "message:reply:a#2", kind: "decision", lifecycle: "interrupted", subject: "Which direction?", summary: "waiting on you",
        evidence: [
          { kind: "image", ref: "/api/rail-image?path=choice.png", label: "Choice" },
          { kind: "web", ref: "https://example.com/live", label: "Open preview" },
          { kind: "web", ref: "http://127.0.0.1:4000/dead", label: "Closed preview", closed: true },
        ],
        actions: [
          { id: "choose:A", kind: "choose", label: "A", value: "A" },
          { id: "choose:B", kind: "choose", label: "B", value: "B" },
        ],
        source: { showItemId: "call:reply:a#2", ref: "reply:a#2" },
        decision: { target: "reply:a#2", replyTo: "reply:a#2", question: "Which direction?", alternatives: ["A", "B"], recommended: "B" },
      }],
    };
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: [] });
    await settle();

    const needs = document.getElementById("needs")!;
    expect(needs.dataset.semanticId).toBe("message:reply:a#2");
    expect(needs.querySelector(".needs-head")!.textContent).toBe("Which direction?");
    expect(needs.textContent).not.toContain("Ship the task?");
    expect(needs.querySelector(".needs-rec")!.textContent).toContain("I'd pick B.");
    expect(needs.querySelectorAll(".decision-evidence .shot")).toHaveLength(1);
    expect([...needs.querySelectorAll(".call-link")].map((link) => link.textContent)).toEqual(["Open preview ↗"]);
    expect([...needs.querySelectorAll<HTMLButtonElement>(".choice-pick")].map((button) => button.textContent)).toEqual(["A", "Brecommended"]);

    needs.querySelectorAll<HTMLButtonElement>(".choice-pick")[1]!.click();
    await settle();
    const sends = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, options]) => JSON.parse(String(options!.body)));
    expect(sends.at(-1)).toEqual({ session: "latest", replyTo: "reply:a#2", questionText: "Which direction?", text: "B" });
  });

  it("shows a call's designs, named, over the message box when he clicks its card", async () => {
    localStorage.setItem("flyd-left", "on");
    load("");
    await settle();
    const stream = open("latest", []);
    stream.emit("update", {
      order: [], messages: [], working: false,
      leftColumn: {
        now: [], recent: [], week: [],
        semantic: [{
          id: "task:pick", kind: "activity", lifecycle: "interrupted", subject: "Pick one of ten left-column card designs for Flyd.",
          summary: "Ten designs are ready.", project: "Flyd", actions: [], activity: { phase: "needs_you" },
          source: { showItemId: "call:pick", task: "pick" },
          decision: { target: "pick", question: "Which design (1-10) should Flyd use?", alternatives: [] },
          evidence: [
            { kind: "image", ref: "/api/rail-image?path=a%2F01-hairline.png", label: "01-hairline.png" },
            { kind: "image", ref: "/api/rail-image?path=a%2F03-side-pane.png", label: "03-side-pane.png" },
            { kind: "web", ref: "https://example.com/review", label: "Open design review" },
          ],
        }],
      },
    });
    await settle();
    const card = document.querySelector("#left-semantic .semantic-activity") as HTMLElement;
    // The card itself is just its title.
    expect(card.querySelector(".card-sub")).toBeNull();
    card.click();
    const shots = Array.from(document.querySelectorAll<HTMLButtonElement>("#about-body .about-shot"));
    expect(shots.map((shot) => shot.querySelector(".about-shot-name")!.textContent)).toEqual(["01 hairline", "03 side pane"]);
    expect(shots[0]!.querySelector("img")!.getAttribute("src")).toContain("token=");
    expect(document.querySelector<HTMLAnchorElement>("#about-body .card-link")!.href).toBe("https://example.com/review");
    expect(Array.from(document.querySelectorAll("#about-body .about-text")).map((p) => p.textContent)).toEqual(["Ten designs are ready.", "Which design (1-10) should Flyd use?"]);
  });

  it("keeps one semantic object in the left column while it needs him, and lets it go once it is finished", async () => {
    localStorage.setItem("flyd-left", "on");
    load("");
    await settle();
    const stream = open("latest", []);
    const base = {
      id: "task:t1", kind: "activity", subject: "Reworking Flyd activity", summary: "Firstmate is on it",
      project: "Flyd", evidence: [], actions: [], source: { showItemId: "live:t1", task: "t1" },
    };
    const update = (semantic: unknown) => stream.emit("update", { order: [], messages: [], working: false, leftColumn: { now: [], recent: [], semantic: [semantic] } });
    const cards = () => [...document.querySelectorAll<HTMLElement>("#left-semantic .semantic-activity")];
    // Work under way is not something that needs him.
    update({ ...base, lifecycle: "active", activity: { phase: "working", started: "2026-10-18T09:00:00Z" } });
    await settle();
    expect(cards()).toHaveLength(0);
    update({
      ...base, lifecycle: "interrupted", activity: { phase: "needs_you" },
      source: { showItemId: "call:t1", task: "t1" },
      decision: { question: "Ship it?", alternatives: ["Ship", "Hold"] },
      actions: [{ id: "choose:Ship", kind: "choose", label: "Ship", value: "Ship" }],
    });
    await settle();
    expect(cards().map((card) => [card.dataset.semanticId, card.dataset.phase])).toEqual([["task:t1", "needs_you"]]);
    update({ ...base, lifecycle: "interrupted", activity: { phase: "paused" } });
    await settle();
    expect(cards()).toHaveLength(0);
    update({ ...base, lifecycle: "resolved", activity: { phase: "finished" }, source: { showItemId: "landed:t1", task: "t1" }, updatedAt: "2026-10-18T10:00:00Z" });
    await settle();
    expect(cards()).toHaveLength(0);
  });

  it("keeps attention items on the left and only finished outcomes in Done", async () => {
    localStorage.setItem("flyd-left", "on");
    load("");
    await settle();
    const stream = open("latest", []);
    const semantic = (id: string, phase: string, lifecycle: string) => ({
      id, kind: "activity", lifecycle, subject: `${id} needs review`, summary: "Review this item.",
      evidence: [], actions: [], source: { showItemId: id, task: id }, activity: { phase },
    });
    stream.emit("update", {
      order: [], messages: [], working: false,
      show: {
        title: "", summary: "", live: false, counts: {}, items: [],
        calls: [{ id: "call:decision", kind: "call", headline: "Choose the final layout.", why: "", decision: { task: "layout", question: "Which layout?", choices: ["A", "B"] } }],
        underway: [{ id: "live:active", kind: "live", headline: "Still building the page.", why: "" }],
        done: [{ id: "landed:done", task: "done", kind: "landed", headline: "The page is live.", why: "", detail: "Visitors now see the new gallery.", project: "GNM", status: "merged", at: new Date(Date.now() - 4 * 60_000).toISOString(), shots: [{ src: "/api/shot/1.png", label: "after.png" }], links: [{ label: "Pull request", url: "https://github.com/example/repo/pull/1" }] }],
      },
      boxes: [],
      rail: { conversations: [{ id: "note:conversation", question: "conversation-only question", answer: "conversation-only answer" }], artefacts: [{ id: "preview:live", title: "Live preview", url: "http://127.0.0.1:8097/", preview: "http://127.0.0.1:8097/" }] },
      leftColumn: { now: [], recent: [], semantic: [semantic("task:held", "paused", "interrupted"), semantic("task:active", "working", "active"), semantic("task:finished", "finished", "resolved")] },
    });
    await settle();
    const leftIds = [...document.querySelectorAll<HTMLElement>("#left-semantic .semantic-activity")].map((item) => item.dataset.semanticId);
      expect(leftIds).toEqual([]);
    expect(document.querySelector("#needs .needs-head")!.textContent).toBe("Choose the final layout.");
    const done = [...document.querySelectorAll<HTMLElement>("#done li")];
    expect(done.map((item) => item.dataset.key)).toEqual(["landed:done"]);
    // A Done card is its thumbnail, its title, one short outcome line, then "open" and how long ago.
    expect([...done[0]!.children].map((node) => node.className)).toEqual(["card-thumb", "card-text", "card-dismiss"]);
    expect([...done[0]!.querySelector(".card-text")!.children].map((node) => node.textContent)).toEqual(["The page is live.", "Visitors now see the new gallery.", "open4m ago"]);
    const openLink = done[0]!.querySelector<HTMLAnchorElement>(".brief-meta a")!;
    expect(openLink.textContent).toBe("open");
    expect(openLink.href).toBe("https://github.com/example/repo/pull/1");
    expect(done[0]!.querySelector(".card-icon, .card-meta")).toBeNull();
    expect(done[0]!.textContent).not.toMatch(/GNM|merged|Preview|live preview|Under way|Still building|conversation-only/i);
    expect(document.getElementById("rail")!.hidden).toBe(false);
    expect(document.querySelectorAll("#rail .rail-talk, #rail .rail-card, #rail .rail-mem")).toHaveLength(0);
    // The artefact beside the work is drawn in its own section: the page framed as its picture, its title, and "open".
    const artefacts = document.getElementById("artefacts")!;
    expect(artefacts.hidden).toBe(false);
    expect(artefacts.querySelector(".brief-label")!.textContent).toBe("Artefacts");
    expect(artefacts.querySelector<HTMLIFrameElement>(".art-frame iframe")!.getAttribute("src")).toBe("http://127.0.0.1:8097/");
    // Its name is the link: no "open" word under it.
    const previewName = artefacts.querySelector<HTMLAnchorElement>(".art-title")!;
    expect(previewName.textContent).toBe("Live preview");
    expect(previewName.getAttribute("href")).toBe("http://127.0.0.1:8097/");
    expect(artefacts.querySelector(".brief-open")).toBeNull();
    expect(leftIds).not.toContain(done[0]!.dataset.key);
    expect(done.map((item) => item.textContent).join(" ")).not.toContain("Still building the page");
  });

  it("shows today's news in the Done column with every story a working link, and nothing when no card has stories", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const stories = Array.from({ length: 14 }, (_, i) => ({ title: `Story ${i + 1}`, url: `https://www.reddit.com/r/Bitcoin/comments/story${i + 1}/story-${i + 1}/`, ...(i === 0 ? { mark: "Hot" } : i === 13 ? { mark: "Rabbit hole" } : {}), gist: `Why ${i + 1}`, source: "r/Bitcoin" }));
    const update = (recent: unknown[]) => stream.emit("update", {
      order: [], messages: [], working: false, boxes: [],
      leftColumn: { now: [], recent, semantic: [] },
    });
    update([
      { id: "record:scout-edition", kind: "news", title: "Put together today's news", line: "14 stories from your sources.", stories, at: "2026-10-21T06:00:00.000Z" },
      { id: "record:scout-edition-old", kind: "news", title: "Put together today's news", line: "2 stories from your sources.", stories: stories.slice(0, 2), at: "2026-10-20T06:00:00.000Z" },
      { id: "log:memory", kind: "memory", title: "Tidied memory", at: "2026-10-21T05:00:00.000Z" },
    ]);
    await settle();
    expect(document.getElementById("rail")!.hidden).toBe(false);
    const news = document.getElementById("news")!;
    expect(news.hidden).toBe(false);
    expect(news.querySelector(".brief-label")!.textContent).toBe("Put together today's news");
    expect(news.textContent).toContain("14 stories from your sources.");
    // The headline is the link to the piece, as the picture is: no "open" under the card.
    const links = Array.from(news.querySelectorAll<HTMLAnchorElement>("a.card-story-head"));
    expect(links.map((a) => a.textContent)).toEqual(stories.map((story) => story.title));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(stories.map((story) => story.url));
    expect(links.every((a) => a.target === "_blank" && a.rel === "noopener noreferrer")).toBe(true);
    expect(news.querySelector(".story-open")).toBeNull();
    expect(news.querySelectorAll("button.story-ask")).toHaveLength(stories.length);
    // No eyebrow over a headline: what the scout judged of a story is a word in its source line.
    expect(news.querySelector(".card-story-mark")).toBeNull();
    expect(Array.from(news.querySelectorAll(".story-mark")).map((mark) => mark.textContent)).toEqual(["Hot", "Rabbit hole"]);
    // A line that only says the headline again ("Charlie Brown Halloween GIF") is not shown twice.
    update([{ id: "record:scout-edition", kind: "news", title: "Put together today's news", stories: [{ title: "Charlie Brown Halloween GIF", gist: "Charlie Brown Halloween GIF", source: "reddit", url: "https://example.test/gif" }], at: "2026-10-21T06:00:00.000Z" }]);
    await settle();
    expect(document.getElementById("news")!.querySelectorAll(".card-story-line")).toHaveLength(0);
    update([{ id: "log:memory", kind: "memory", title: "Tidied memory", at: "2026-10-21T05:00:00.000Z" }]);
    await settle();
    expect(news.hidden).toBe(true);
    expect(document.getElementById("rail")!.hidden).toBe(false);
    expect(document.getElementById("history")!.hidden).toBe(false);
  });

  it("lets him ask for more or less like an edition story, and says so once told", async () => {
    load("");
    await settle();
    const posted: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/scout-feedback") posted.push({ url, body: JSON.parse(String(init!.body)) });
      return new Response(JSON.stringify({ ok: true, sessions: SESSIONS }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const stream = open("latest", []);
    const stories = [
      { title: "Edition story", url: "https://www.reddit.com/r/Bitcoin/comments/a/one/", source: "r/Bitcoin", n: 4 },
      { title: "Watch story", url: "https://www.reddit.com/r/Bitcoin/comments/b/two/", source: "r/Bitcoin" },
    ];
    stream.emit("update", { order: [], messages: [], working: false, boxes: [], leftColumn: { now: [], recent: [{ id: "record:scout-edition", kind: "news", title: "Put together today's news", stories, at: "2026-10-21T06:00:00.000Z" }], semantic: [] } });
    await settle();
    const items = [...document.querySelectorAll("#news .card-stories > li")];
    // A hot story the watch kept has no edition number, but he can rate it all the same, by its link.
    expect(items[1]!.querySelectorAll(".story-rate button")).toHaveLength(2);
    const buttons = [...items[0]!.querySelectorAll<HTMLButtonElement>(".story-rate button")];
    expect(buttons.map((button) => button.textContent)).toEqual(["more", "less"]);
    buttons[1]!.click();
    await settle();
    expect(posted).toEqual([{ url: "/api/scout-feedback", body: { n: 4, url: stories[0]!.url, verdict: "less" } }]);
    expect(document.querySelector("#news .story-told")!.textContent).toBe("Less like this");
  });

  it("shows a fetched picture, a bigger headline when there is none, and never a remote image address", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const pictured = { title: "A course", url: "https://magazine.example/course", source: "Magazine", gist: "The machinery, not a wrapper.", image: "/api/story-image?id=abc123abc123abcd", published: "2026-10-12T08:00:00.000Z", minutes: 18 };
    const plain = { title: "A paper", url: "https://www.nature.com/articles/x", source: "Nature", gist: "State that outlives the prompt." };
    const remote = { title: "A remote picture", url: "https://cdn.example/story", source: "CDN", gist: "Not ours to point at.", image: "https://cdn.example/a.jpg" };
    stream.emit("update", { order: [], messages: [], working: false, boxes: [], leftColumn: { now: [], recent: [{ id: "record:scout-edition", kind: "news", title: "Put together today's news", stories: [pictured, plain, remote], at: "2026-10-21T06:00:00.000Z" }], semantic: [] } });
    await settle();
    const items = [...document.querySelectorAll("#news .card-stories > li")];
    const img = items[0]!.querySelector("img")!;
    expect(img.getAttribute("src")).toContain("/api/story-image?id=abc123abc123abcd");
    expect(img.getAttribute("src")).toContain("token=");
    expect(items[0]!.textContent).toContain("Magazine · 12 Oct · 18 min");
    expect(items[0]!.querySelector("a.card-story-media")!.getAttribute("href")).toBe(pictured.url);
    expect(items[0]!.querySelector(".story-rate .story-save")).toBeNull();
    img.dispatchEvent(new Event("error"));
    expect(items[0]!.querySelector("img")).toBeNull();
    expect(items[0]!.querySelector(".story-pic")).toBeNull();
    expect(items[0]!.classList.contains("story-bare")).toBe(true);
    expect(items[1]!.querySelector("img, .story-pic")).toBeNull();
    expect(items[1]!.classList.contains("story-bare")).toBe(true);
    expect(items[2]!.querySelector("img, .story-pic")).toBeNull();
    expect(items[2]!.classList.contains("story-bare")).toBe(true);
    const save = items[1]!.querySelector<HTMLButtonElement>(".story-save")!;
    expect(save.textContent).toBe("save");
    save.click();
    await settle();
    expect(save.textContent).toBe("saved");
    const posted = vi.mocked(fetch).mock.calls.find((call) => call[0] === "/api/story-save");
    expect(posted?.[1]).toEqual(expect.objectContaining({ method: "POST", body: JSON.stringify({ url: plain.url }) }));
  });

  it("opens an article conversation from Ask, and the piece itself from the card, with starter questions and a link back", async () => {
    load("");
    await settle();
    const opened = { session: "window:article-0123456789abcdef", title: "State that lasts", url: "https://magazine.example/state", starters: ["What's new here?", "How does this apply to Flyd?"], link: { href: "https://magazine.example/state", label: "Article" } };
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      if (url === "/api/article-chat") return json(opened);
      if (url === "/api/send") return json(sendResponse);
      if (url === "/api/sessions") return json({ sessions: [{ ...opened, id: opened.session, updatedAt: "2026-10-21T06:00:00.000Z" }, ...SESSIONS] });
      return json({ assistantLabel: "Flyd", sessions: SESSIONS });
    });
    const stream = open("latest", []);
    const story = { title: "State that lasts", url: "https://magazine.example/state", source: "Magazine", gist: "The machinery, not a wrapper." };
    stream.emit("update", { order: [], messages: [], working: false, boxes: [], leftColumn: { now: [], recent: [{ id: "record:scout-edition", kind: "news", title: "Put together today's news", stories: [story], at: "2026-10-21T06:00:00.000Z" }], semantic: [] } });
    await settle();
    document.querySelector<HTMLButtonElement>("#news .story-ask")!.click();
    await settle();
    const ask = document.querySelector<HTMLButtonElement>("#news .story-ask");
    console.log("DBG", JSON.stringify({ ask: !!ask, layout: document.documentElement.dataset.layout, newsHidden: document.getElementById("news")!.hidden, calls: vi.mocked(fetch).mock.calls.map((c) => String(c[0])), job: document.documentElement.getAttribute("data-job") }));
    const post = vi.mocked(fetch).mock.calls.find((call) => call[0] === "/api/article-chat");
    expect(post?.[1]).toEqual(expect.objectContaining({ method: "POST", body: JSON.stringify({ url: story.url, title: story.title, media: "article", text: story.gist, description: story.gist, figure: "", attribution: "" }) }));
    expect(FakeEventSource.instances.at(-1)!.url).toContain(encodeURIComponent(opened.session));
    FakeEventSource.instances.at(-1)!.emit("session", { id: opened.session, title: opened.title, link: opened.link, starters: opened.starters, assistantLabel: "Flyd" });
    FakeEventSource.instances.at(-1)!.emit("update", { order: [], messages: [], working: false });
    await settle();
    expect(document.getElementById("conversation-title")!.textContent).toBe("State that lasts");
    expect(document.getElementById("article-back")!.getAttribute("href")).toBe(story.url);
    const starters = [...document.querySelectorAll<HTMLButtonElement>("#article-starters button")];
    expect(starters.map((button) => button.textContent)).toEqual(opened.starters);
    starters[0]!.click();
    await settle();
    const sent = vi.mocked(fetch).mock.calls.find((call) => call[0] === "/api/send");
    expect(String(sent?.[1]?.body)).toContain("What's new here?");
    stream.emit("session", { id: "latest", title: "Current thread", assistantLabel: "Flyd" });
    await settle();
    stream.emit("update", { order: [], messages: [], working: false, boxes: [], leftColumn: { now: [], recent: [{ id: "record:scout-edition", kind: "news", title: "Put together today's news", stories: [story, { title: "Other", url: "https://magazine.example/other", source: "Magazine", gist: "Another." }], at: "2026-10-21T06:00:00.000Z" }], semantic: [] } });
    await settle();
    const other = document.querySelectorAll<HTMLAnchorElement>("#news .card-story-head")[1]!;
    other.addEventListener("click", (event) => event.preventDefault());
    document.querySelectorAll("#news .card-story-line")[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(vi.mocked(fetch).mock.calls.filter((call) => call[0] === "/api/article-chat")).toHaveLength(1);
    expect(other.getAttribute("href")).toBe("https://magazine.example/other");
  });

  it("opens a story's piece from anywhere on its card, by pointer or by keyboard, and leaves the rating alone", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const story = { title: "State that lasts", url: "https://magazine.example/state", source: "Magazine", gist: "The machinery, not a wrapper.", n: 3 };
    stream.emit("update", { order: [], messages: [], working: false, boxes: [], leftColumn: { now: [], recent: [{ id: "record:scout-edition", kind: "news", title: "Put together today's news", stories: [story], at: "2026-10-21T06:00:00.000Z" }], semantic: [] } });
    await settle();
    const card = document.querySelector<HTMLElement>("#news .card-stories > li")!;
    const link = card.querySelector<HTMLAnchorElement>("a.card-story-head")!;
    expect(link.getAttribute("href")).toBe(story.url);
    expect(card.tabIndex).toBe(0);
    expect(card.getAttribute("role")).toBe("link");
    const opened: string[] = [];
    link.addEventListener("click", (event) => {
      event.preventDefault();
      opened.push(link.getAttribute("href")!);
    });
    card.querySelector(".card-story-line")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    card.querySelector(".card-story-head")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(opened).toEqual([story.url, story.url, story.url]);
    card.querySelector<HTMLButtonElement>(".story-rate button")!.click();
    card.querySelector<HTMLButtonElement>(".story-ask")!.click();
    await settle();
    expect(opened).toHaveLength(3);
  });

  it("lists an article conversation under earlier ones and links back to the piece", async () => {
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => (url === "/api/sessions" ? json({ sessions: [
      { id: "latest", title: "Current thread", updatedAt: "2026-10-05T20:00:00.000Z" },
      { id: "window:article-0123456789abcdef", title: "State that lasts", updatedAt: "2026-10-04T20:00:00.000Z", link: { href: "https://magazine.example/state", label: "Article" } },
    ] }) : json({})));
    load("");
    await settle();
    open("latest", []);
    await settle();
    const row = document.querySelector(".history-item")!;
    expect(row.querySelector(".history-item-title")!.textContent).toBe("State that lasts");
    const link = row.parentElement!.querySelector<HTMLAnchorElement>("a.history-article")!;
    expect(link.getAttribute("href")).toBe("https://magazine.example/state");
    expect(link.target).toBe("_blank");
  });

  it("asks in the conversation before remembering something from an article", async () => {
    load("");
    await settle();
    const posted: unknown[] = [];
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      if (url === "/api/article-confirm") posted.push(JSON.parse(String(init?.body)));
      return json({ ok: true, sessions: SESSIONS });
    });
    const stream = open("window:article-0123456789abcdef", []);
    stream.emit("update", { order: [], messages: [], working: true, confirm: { id: "ask-1", prompt: "Flyd wants to save to memory: \"weights\" (from an article; confirm before saving). Allow?" } });
    await settle();
    const bar = document.getElementById("article-confirm")!;
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toContain("from an article");
    document.getElementById("article-confirm-no")!.click();
    await settle();
    expect(posted).toEqual([{ id: "ask-1", allow: false }]);
    expect(bar.hidden).toBe(true);
  });

  it("draws a stat, a quote, a video, a gif, an image and a thread as their own cards", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const stories = [
      { title: "Studios shipping", url: "https://en.wikipedia.org/wiki/Studio", source: "Wikipedia", media: "stat", figure: "12%", gist: "12% of studios shipped a tool." },
      { title: "A line", url: "https://en.wikiquote.org/wiki/Line", source: "Wikiquote", media: "quote", quote: "The weights live beside the prompt.", attribution: "A note", gist: "A line worth keeping." },
      { title: "A talk", url: "https://archive.org/details/talk", source: "Internet Archive", media: "video", image: "/api/story-image?id=abc123abc123abcd", gist: "A talk." },
      { title: "A landing", url: "https://www.pexels.com/video/landing-1/", source: "Pexels", media: "video", clip: "/api/story-clip?id=9f9f9f9f9f9f9f9f", gist: "0:11 · UAVDrone youngman" },
      { title: "A loop", url: "https://commons.wikimedia.org/wiki/File:Loop.gif", source: "Wikimedia Commons", media: "gif", image: "/api/story-image?id=fed123fed123fed1", clip: "/api/story-clip?id=abc123abc123abcd", gist: "A loop." },
      { title: "A print", url: "https://commons.wikimedia.org/wiki/File:Print.jpg", source: "Wikimedia Commons", media: "image", image: "/api/story-image?id=def123def123def1", gist: "A print." },
      { title: "A thread", url: "https://news.ycombinator.com/item?id=1", source: "Hacker News", media: "thread", gist: "Thread about a small host." },
    ];
    stream.emit("update", { order: [], messages: [], working: false, boxes: [], leftColumn: { now: [], recent: [{ id: "record:scout-edition", kind: "news", title: "Put together today's news", stories, at: "2026-10-21T06:00:00.000Z" }], semantic: [] } });
    await settle();
    const news = document.getElementById("news")!;
    expect(news.querySelector(".story-stat b")!.textContent).toBe("12%");
    expect(news.querySelector(".story-quote")!.textContent).toContain("The weights live beside the prompt.");
    expect(news.querySelector(".story-quote span")!.textContent).toBe("A note");
    // A video plays itself, muted, in its own card; a video with only a poster shows the poster and no play mark.
    const preview = news.querySelector<HTMLVideoElement>(".story-preview video")!;
    expect(preview.getAttribute("src")).toContain("/api/story-clip?id=9f9f9f9f9f9f9f9f");
    expect(preview.muted).toBe(true);
    expect(preview.loop).toBe(true);
    expect(preview.hasAttribute("playsinline")).toBe(true);
    expect(news.querySelector(".story-preview .card-story-caption")).toBeNull();
    expect(news.querySelector(".story-video .story-play")).toBeNull();
    expect(news.querySelectorAll(".story-video .story-pic img")).toHaveLength(1);
    expect(news.querySelector(".story-image .story-pic img")!.getAttribute("src")).toContain("/api/story-image?id=def123def123def1");
    // A photo is the card: its own words are a caption under it, not a headline over it.
    expect(news.querySelector(".story-image .card-story-head")).toBeNull();
    expect(news.querySelector(".story-image .card-story-caption")!.textContent).toBe("A print");
    // A thread is a thread by its own words; nothing labels it.
    expect(news.querySelector(".story-thread .card-story-mark")).toBeNull();
    expect(news.querySelectorAll("button.story-ask")).toHaveLength(stories.length);
    const gif = news.querySelector<HTMLElement>(".story-gif")!;
    gif.dispatchEvent(new MouseEvent("mouseenter"));
    expect(gif.querySelector("img")!.getAttribute("src")).toContain("/api/story-clip?id=abc123abc123abcd");
    gif.dispatchEvent(new MouseEvent("mouseleave"));
    expect(gif.querySelector("img")!.getAttribute("src")).toContain("/api/story-image?id=fed123fed123fed1");
    news.querySelector<HTMLButtonElement>(".story-stat .story-ask")!.click();
    await settle();
    const post = vi.mocked(fetch).mock.calls.find((call) => call[0] === "/api/article-chat");
    expect(JSON.parse(String((post?.[1] as RequestInit | undefined)?.body))).toMatchObject({ media: "stat", figure: "12%" });
  });

  it("counts what needs him on the header button and never forces the column open on a narrow window", async () => {
    localStorage.setItem("flyd-left", "off");
    load("");
    await settle();
    const stream = open("latest", []);
    const update = (calls: unknown[]) => stream.emit("update", {
      order: [], messages: [], working: false, boxes: [],
      show: { title: "", summary: "", live: false, counts: {}, items: [], calls },
      leftColumn: { now: [], recent: [], semantic: [] },
    });
    const call = { id: "call:decision", kind: "call", headline: "Choose the final layout.", why: "", decision: { task: "layout", question: "Which layout?", choices: ["A", "B"] } };
    const button = document.getElementById("left-open")!;
    const left = document.getElementById("left")!;
    update([call]);
    await settle();
    expect(left.hidden).toBe(true);
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe("Needs you · 1");
    button.click();
    expect(left.hidden).toBe(false);
    expect(document.getElementById("left-hide")!.hidden).toBe(false);
    expect(document.querySelector("#left #needs .needs-head")!.textContent).toBe("Choose the final layout.");
    document.getElementById("left-hide")!.click();
    expect(left.hidden).toBe(true);
    update([]);
    await settle();
    expect(button.textContent).toBe("Needs you");
  });

  it("opens the column once by itself on a wide window when something new needs him, and lets him close it", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("1480"), media: query, addEventListener() {}, removeEventListener() {} }));
    localStorage.setItem("flyd-left", "off");
    load("");
    await settle();
    const stream = open("latest", []);
    const update = (calls: unknown[]) => stream.emit("update", {
      order: [], messages: [], working: false, boxes: [],
      show: { title: "", summary: "", live: false, counts: {}, items: [], calls },
      leftColumn: { now: [], recent: [], semantic: [] },
    });
    const call = (id: string) => ({ id, kind: "call", headline: `Choose ${id}.`, why: "", decision: { task: id, question: "Which?", choices: ["A", "B"] } });
    const left = document.getElementById("left")!;
    update([call("a")]);
    await settle();
    expect(left.hidden).toBe(false);
    document.getElementById("left-hide")!.click();
    expect(left.hidden).toBe(true);
    // The same item again leaves it closed; a new one opens it once more, and Escape closes it.
    update([call("a")]);
    await settle();
    expect(left.hidden).toBe(true);
    update([call("a"), call("b")]);
    await settle();
    expect(left.hidden).toBe(false);
    expect(document.getElementById("left-open")!.textContent).toBe("Needs you · 2");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(left.hidden).toBe(true);
    // Opening by itself never rewrites his choice, and a reload with the same items, held work included, keeps it closed.
    expect(localStorage.getItem("flyd-left")).toBe("off");
    const held = (id: string) => ({ id, kind: "activity", lifecycle: "interrupted", subject: `${id} is paused.`, summary: "", evidence: [], actions: [], source: { showItemId: id, task: id }, activity: { phase: "paused" } });
    const reload = async (semantic: unknown[]) => {
      load("");
      await settle();
      const next = open("latest", []);
      next.emit("update", {
        order: [], messages: [], working: false, boxes: [],
        show: { title: "", summary: "", live: false, counts: {}, items: [], calls: [call("a"), call("b")] },
        leftColumn: { now: [], recent: [], semantic },
      });
      await settle();
      return document.getElementById("left")!;
    };
    update([call("a"), call("b")]);
    stream.emit("update", { order: [], messages: [], working: false, boxes: [], show: { title: "", summary: "", live: false, counts: {}, items: [], calls: [call("a"), call("b")] }, leftColumn: { now: [], recent: [], semantic: [held("task:held")] } });
    await settle();
    document.getElementById("left-hide")!.click();
    await settle();
    expect((await reload([held("task:held")])).hidden).toBe(true);
    expect(document.getElementById("left-open")!.textContent).toBe("Needs you · 2");
    expect((await reload([held("task:held"), held("task:new")])).hidden).toBe(true);
    expect(localStorage.getItem("flyd-left")).toBe("off");
  });

  it("never lists an unrun plan under Done", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const at = new Date(Date.now() - 10 * 60_000).toISOString();
    const artifact = (id: string, type: string, subject: string) => ({ id, kind: "artifact", lifecycle: "resolved", subject, summary: "", evidence: [], actions: [], createdAt: at, artifact: { type, phase: "ready" } });
    const update = (artifacts: unknown[]) => stream.emit("update", { order: [], messages: [], working: false, boxes: [], show: { title: "", summary: "", live: false, counts: {}, items: [], artifacts } });
    update([artifact("artifact:plan", "plan", "Plan the gallery rework."), artifact("artifact:task:1", "result", "The gallery is live.")]);
    await settle();
    expect([...document.querySelectorAll("#done .brief-line")].map((line) => line.textContent)).toEqual(["The gallery is live."]);
    update([artifact("artifact:plan", "plan", "Plan the gallery rework.")]);
    await settle();
    expect(document.getElementById("done")!.hidden).toBe(true);
    expect(document.getElementById("rail")!.hidden).toBe(false);
    expect(document.getElementById("history")!.hidden).toBe(false);
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

  it("keeps a Done card he has already seen, and marks only what came since he last looked as new", async () => {
    localStorage.setItem("flyd-done-seen", JSON.stringify({ "landed:old": Date.now() - 25 * 60 * 60 * 1000 }));
    localStorage.setItem("flyd-done-looked", String(Date.now() - 60 * 60 * 1000));
    load("");
    await settle();
    const done = [
      { id: "landed:old", task: "old", kind: "landed", headline: "Seen yesterday.", why: "", at: new Date().toISOString() },
      { id: "landed:new", task: "new", kind: "landed", headline: "New today.", why: "", at: new Date().toISOString() },
    ];
    open("latest", []).emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [], done }, boxes: [], rail: { conversations: [], artefacts: [] } });
    await settle();
    expect([...document.querySelectorAll("#done .brief-line")].map((line) => line.textContent)).toEqual(["Seen yesterday.", "New today."]);
    expect([...document.querySelectorAll<HTMLElement>("#done li.is-new")].map((li) => li.dataset.key)).toEqual(["landed:new"]);
    expect(document.querySelector("#done li.is-new .brief-new")!.textContent).toBe("New");
  });

  it("marks nothing new on the very first visit", async () => {
    load("");
    await settle();
    const done = [{ id: "landed:a", task: "a", kind: "landed", headline: "Landed.", why: "", at: new Date().toISOString() }];
    open("latest", []).emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [], done }, boxes: [] });
    await settle();
    expect(document.querySelectorAll("#done li")).toHaveLength(1);
    expect(document.querySelectorAll("#done li.is-new")).toHaveLength(0);
    expect(Number(localStorage.getItem("flyd-done-looked"))).toBeGreaterThan(0);
  });

  it("keeps the column open for artefacts alone", async () => {
    load("");
    await settle();
    open("latest", []).emit("update", {
      order: [], messages: [], working: false, boxes: [],
      rail: { conversations: [], artefacts: [
        { id: "file:deck", title: "The launch deck", line: "gnm · HTML + PDF", url: "/rail-file/x/deck.pdf", image: "/api/rail-image?path=%2Ftmp%2Fdeck.png", at: new Date(Date.now() - 5 * 60_000).toISOString() },
        { id: "reply:r1", title: "Steps to follow", steps: ["Open the page", "Pick a photo", "Save", "Publish"] },
      ] },
    });
    await settle();
    expect(document.getElementById("rail")!.hidden).toBe(false);
    expect(document.getElementById("brief")!.hidden).toBe(false);
    const cards = [...document.querySelectorAll<HTMLElement>("#artefacts .art-card")];
    expect(cards.map((card) => card.dataset.key)).toEqual(["file:deck", "reply:r1"]);
    expect(cards[0]!.querySelector("img")!.getAttribute("src")).toMatch(/^\/api\/rail-image\?path=%2Ftmp%2Fdeck\.png&token=/);
    // One line of what it is and when (the separator is drawn by the page's style), then "open".
    expect(cards[0]!.querySelector(".art-meta")!.textContent).toBe("gnm · HTML + PDF5m ago");
    expect(cards[0]!.querySelector(".art-line + .art-ago")).not.toBeNull();
    // The picture and the name open it; there is no "open" word under the card.
    expect(cards[0]!.querySelector<HTMLAnchorElement>("a.art-pic")!.getAttribute("href")).toMatch(/^\/rail-file\/x\/deck\.pdf&token=|^\/rail-file\/x\/deck\.pdf$/);
    expect(cards[0]!.querySelector<HTMLAnchorElement>("a.art-title")!.textContent).toBe("The launch deck");
    expect(cards[0]!.querySelector(".brief-open")).toBeNull();
    expect([...cards[1]!.querySelectorAll(".art-steps li")].map((li) => li.textContent)).toEqual(["Open the page", "Pick a photo", "Save", "1 more"]);
  });

  it("leads the column with pictured artefacts, shows a few and the rest behind Show all, and never draws a merged change twice", async () => {
    load("");
    await settle();
    const pictures = Array.from({ length: 8 }, (_, index) => ({ id: `file:${index}`, title: `Lab ${index}`, line: `lab-${index} · HTML`, image: `/api/rail-image?path=%2Ftmp%2F${index}.png`, url: `/rail-file/x/${index}.html` }));
    open("latest", []).emit("update", {
      order: [], messages: [], working: false, boxes: [],
      rail: { conversations: [], artefacts: [
        { id: "news:link", title: "Link WhatsApp", line: "Scan the code" },
        { id: "landed:pr", title: "The change is merged: fix(x)", url: "https://github.com/o/r/pull/1" },
        ...pictures,
      ] },
    });
    await settle();
    // The pictures lead, in a grid; a merged change without a picture is left to Done.
    const keys = () => [...document.querySelectorAll<HTMLElement>("#artefacts .art-card")].map((card) => card.dataset.key);
    expect(keys()).toEqual(["file:0", "file:1", "file:2", "file:3", "file:4", "file:5"]);
    expect(document.querySelectorAll("#artefacts .art-grid .art-card")).toHaveLength(6);
    const more = document.querySelector<HTMLButtonElement>("#artefacts .brief-more")!;
    expect(more.textContent).toBe("Show all 9");
    more.click();
    expect(keys()).toEqual([...pictures.map((card) => card.id), "news:link"]);
    expect(document.querySelectorAll("#artefacts .art-plain .art-card")).toHaveLength(1);
  });

  it("shows History a few rows a project, the rest behind Show all, below the artefacts", async () => {
    const sessions = [{ id: "latest", title: "Latest", updatedAt: new Date().toISOString() }, ...Array.from({ length: 9 }, (_, index) => ({ id: `s${index}`, title: `Talk ${index}`, updatedAt: new Date(Date.now() - (index + 1) * 60_000).toISOString() }))];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/api/commands" ? json({ commands: [] }) : json({ assistantLabel: "firstmate", sessions }))));
    load("?session=latest");
    await settle();
    open("latest", []);
    await settle();
    const rows = () => document.querySelectorAll("#history-list .history-item").length;
    expect(rows()).toBe(5);
    const more = document.querySelector<HTMLButtonElement>("#history-list .history-more")!;
    expect(more.textContent).toBe("Show all 9");
    more.click();
    expect(rows()).toBe(9);
    // On the front page History sits under the jobs; the artefact column keeps the work, then the news.
    expect([...document.querySelectorAll(".rail-pane > *")].map((node) => node.id)).toEqual(["brief", "brief-news"]);
    expect(document.getElementById("history")!.closest("#jobs")).not.toBeNull();
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
    expect([...document.querySelectorAll("#done .brief-line")].map((line) => line.textContent)).toEqual(["Seen days ago.", "New today."]);
  });
});

describe("screen gates", () => {
  it("never puts the type-to-talk hint back in the foot", () => {
    const html = renderPage({ assistantLabel: "firstmate", sendToken: "a".repeat(48) });
    expect(html).not.toContain("type to talk");
    expect(html).not.toContain("tab for the conversation");
  });

  const object = (id: string, kind: string, lifecycle: string, subject: string, extra: Record<string, unknown> = {}): any => ({
    id, kind, lifecycle, subject, summary: subject + ".", evidence: [], actions: [], source: { showItemId: id }, ...extra,
  });
  const screened = (value: any): any => ({ ...value, screen: fillScreen(value) });

  it("gives the headline, the corner and the edge one number, and opens exactly that set", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const a = object("task:a", "decision", "interrupted", "Choose A", { decision: { target: "a", question: "A?", alternatives: ["Yes", "No"] } });
    const b = object("task:b", "decision", "interrupted", "Choose B", { decision: { target: "b", question: "B?", alternatives: ["Yes", "No"] } });
    const c = object("task:c", "activity", "interrupted", "Review C", { activity: { phase: "ready" } });
    const focus = object("task:focus", "activity", "active", "Building the page", { activity: { phase: "working" } });
    const show = { title: "Work", summary: "", live: false, counts: { call: 3 }, items: [], focus, semantic: [focus, a, b, c], needs: [a, b, c] } as unknown as ShowScreen;
    const boxes = boxesOf(show);
    stream.emit("update", { order: [], messages: [], working: false, show, boxes });
    await settle();
    // The headline the lead group names.
    expect(boxes[0]!.title).toBe("3 need you");
    // The corner.
    expect(document.getElementById("left-open")!.textContent).toBe("Needs you · 3");
    // The edge, and the sheet it opens: exactly those three.
    const edge = document.getElementById("semantic-context")!;
    expect(edge.textContent).toContain("3 needs you");
    edge.querySelector<HTMLButtonElement>(".needs")!.click();
    expect(document.querySelectorAll("#drill-list .drill-card")).toHaveLength(3);
  });

  it("keeps the keyboard focus on the edge through a screen update, and announces the change", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const first = object("task:a", "activity", "active", "Build A", { activity: { phase: "working" } });
    const focus = object("task:focus", "activity", "active", "Building the page", { activity: { phase: "working" } });
    const show = (extra: unknown[]) => ({ title: "", summary: "", live: false, counts: {}, items: [], focus, semantic: [focus, first, ...extra], needs: [] }) as unknown as ShowScreen;
    stream.emit("update", { order: [], messages: [], working: false, show: show([]), boxes: [] });
    await settle();
    const button = document.querySelector<HTMLButtonElement>("#semantic-context .working")!;
    button.focus();
    expect(document.activeElement).toBe(button);
    const second = object("task:b", "activity", "active", "Build B", { activity: { phase: "working" } });
    stream.emit("update", { order: [], messages: [], working: false, show: show([second]), boxes: [] });
    await settle();
    const after = document.querySelector<HTMLButtonElement>("#semantic-context .working")!;
    expect(after).not.toBe(button);
    expect(document.activeElement).toBe(after);
    expect(document.getElementById("semantic-context")!.getAttribute("aria-live")).toBe("polite");
  });

  it("draws a decision's question and its choices, not a headline over empty space", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const focus = screened(object("task:launch", "decision", "interrupted", "Choose the launch date", {
      summary: "Friday has the strongest evidence.",
      detail: "The sponsor is away Thursday.",
      decision: { target: "launch", question: "Launch Friday or Saturday?", alternatives: ["Friday", "Saturday"], recommended: "Friday" },
    }));
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [], focus, semantic: [focus] } as unknown as ShowScreen, boxes: [] });
    await settle();
    const scene = document.getElementById("scene")!;
    expect(scene.querySelector(".screen-question")!.textContent).toBe("Launch Friday or Saturday?");
    expect([...scene.querySelectorAll(".scene-ask .choice-pick")].map((button) => button.textContent)).toEqual(["Fridayrecommended", "Saturday"]);
    expect(scene.dataset.pattern).toBe("decision-choice");
  });

  it("says a decision once when its headline, line and question are the same words", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const said = "Choose the default screen direction: adaptive single stage or columns with on-demand rail; decide whether only high-confidence housekeeping interrupts or all findings enter a digest";
    // The same decision, as the fleet hands it over: no full stop on the headline, one on the detail, different case on the question.
    const focus = screened(object("task:direction", "decision", "interrupted", said, {
      summary: "",
      detail: `${said}.`,
      decision: { target: "direction", question: `${said.toLowerCase()}.`, alternatives: [] },
    }));
    expect(focus.screen.lead).toBe("");
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [], focus, semantic: [focus] } as unknown as ShowScreen, boxes: [] });
    await settle();
    const count = (root: Element) => (root.textContent ?? "").toLowerCase().split("choose the default screen direction").length - 1;
    expect(count(document.getElementById("scene")!)).toBe(1);
    expect(count(document.getElementById("inline-screen")!)).toBe(1);
    // A line that adds a sentence keeps only that sentence.
    const more = screened(object("task:direction", "decision", "interrupted", said, {
      summary: "",
      detail: `${said}. The lab has both versions side by side.`,
      decision: { target: "direction", question: said, alternatives: [] },
    }));
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [], focus: more, semantic: [more] } as unknown as ShowScreen, boxes: [] });
    await settle();
    expect(count(document.getElementById("scene")!)).toBe(1);
    expect(document.getElementById("scene-line")!.textContent).toBe("The lab has both versions side by side.");
  });

  it("draws an investigation's findings and an approval's operation and its action", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const findings = screened(object("task:audit", "investigation", "active", "Audit the checkout copy", {
      summary: "Three claims are unsupported.",
      investigation: { question: "Does the copy overclaim?", findings: [{ heading: "Delivery time", summary: "The carrier does not promise next day.", confidence: "high", evidenceIds: ["e1"] }], uncertainties: [], conflicts: [], sourceCount: 1 },
    }));
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [], focus: findings, semantic: [findings] } as unknown as ShowScreen, boxes: [] });
    await settle();
    expect(document.querySelectorAll("#scene .screen-findings li")).toHaveLength(1);
    expect(document.querySelector("#scene .screen-findings h4")!.textContent).toBe("Delivery time");

    const approval = screened(object("action:send", "action", "interrupted", "Send the reply to Gareth", {
      summary: "The draft is ready to send.",
      action: { phase: "proposed", operation: "Send the drafted WhatsApp reply", category: "outward", requiresApproval: true },
    }));
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [], focus: approval, semantic: [approval] } as unknown as ShowScreen, boxes: [] });
    await settle();
    expect(document.querySelector("#scene .screen-operation")!.textContent).toContain("Send the drafted WhatsApp reply");
    expect([...document.querySelectorAll("#scene .scene-ask .choice-pick")].map((button) => button.textContent)).toEqual(["Approve", "Revise"]);
  });

  it("puts the artefact in the conversation, with its visual beside the words", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const focus = screened(object("artifact:deck", "artifact", "resolved", "Sponsor deck", {
      summary: "The final deck is ready.",
      detail: "The final deck is ready.",
      artifact: { type: "document", phase: "ready" },
      evidence: [{ kind: "image", ref: "/api/artefact-shot?task=deck&file=shot.png", label: "deck.png" }, { kind: "web", ref: "https://example.com/deck", label: "Open the deck" }],
    }));
    stream.emit("update", { order: [], messages: [], working: false, show: { title: "", summary: "", live: false, counts: {}, items: [], focus, semantic: [focus] } as unknown as ShowScreen, boxes: [] });
    await settle();
    const card = document.querySelector<HTMLElement>("#inline-screen .inline-card")!;
    expect(card).not.toBeNull();
    expect(card.querySelector(".inline-head")!.textContent).toBe("Sponsor deck");
    expect(card.querySelectorAll(".inline-shots img")).toHaveLength(1);
    expect(card.querySelector(".screen-document")!.textContent).toContain("The final deck is ready");
    // The scene's own headline opens it in the conversation, never a side view.
    expect((document.getElementById("scene-head") as HTMLElement).dataset.inline).toBe("1");
    expect((document.getElementById("inline-screen") as HTMLElement).hidden).toBe(false);
  });
});

describe("the front page", () => {
  const SHOW = {
    title: "Your move.", summary: "", items: [], counts: { call: 1 }, live: false, read: "2026-10-25T00:00:00Z",
    calls: [{
      id: "call:pick", kind: "call", headline: "Which bezel should CopyCopy build?", why: "", status: "Needs your choice", project: "CopyCopy",
      at: "2026-10-24T15:30:00.000Z", task: "bezel", detail: "Both read well at small sizes.",
      shots: [{ src: "/api/artefact-shot?task=bezel&file=v2-spindle.png", label: "v2-spindle.png" }, { src: "/api/artefact-shot?task=bezel&file=v6-numeral.png", label: "v6-numeral.png" }],
      decision: { task: "bezel", decisionId: "d1", question: "Which bezel should CopyCopy build?", choices: ["V2 Spindle", "V6 Numeral"] },
    }],
    landedWeek: [{ id: "landed:fix", kind: "landed", headline: "Restore dropping files onto Flyd", why: "", at: "2026-10-24", project: "Flyd", task: "file-drop", links: [{ label: "flyd #224", url: "https://github.com/GeorgeGally/flyd/pull/224" }] }],
  };
  const groups = () => Array.from(document.querySelectorAll("#jobs-list .fgroup")).map((group) => [
    group.querySelector(".fhead span")!.textContent,
    group.querySelector(".fempty")?.textContent ?? group.querySelectorAll(".job").length,
  ]);
  async function opened(): Promise<FakeEventSource> {
    load("");
    await settle();
    return open("latest", [{ id: "u1", role: "user", html: "<p>hello</p>" }]);
  }
  function after(act: () => void): void {
    vi.useFakeTimers();
    try { act(); vi.advanceTimersByTime(250); } finally { vi.useRealTimers(); }
  }

  it("leaves the open job for the article when Ask opens a piece from its card", async () => {
    // The page's own markup puts the front layout on the root; the test's document has no such root.
    document.documentElement.setAttribute("data-layout", "front");
    const stream = await opened();
    const story = { title: "State that lasts", url: "https://magazine.example/state", source: "Magazine", gist: "The machinery, not a wrapper." };
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, leftColumn: { now: [], recent: [{ id: "record:scout-edition", kind: "news", title: "Put together today's news", stories: [story], at: "2026-10-21T06:00:00.000Z" }], semantic: [] } });
    await settle();
    after(() => document.querySelector<HTMLElement>('.job[data-job="call:pick"]')!.click());
    expect(document.documentElement.getAttribute("data-job")).toBe("call:pick");
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => (
      url === "/api/article-chat" ? json({ session: "window:article-0123456789abcdef", title: story.title, url: story.url, starters: [], link: { href: story.url, label: "Article" } }) : json({ assistantLabel: "Flyd", sessions: SESSIONS })
    ));
    document.querySelector<HTMLButtonElement>("#news .story-ask")!.click();
    await settle();
    // The conversation takes the middle back: the article is not opened behind the job.
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(document.documentElement.hasAttribute("data-job")).toBe(false);
    document.documentElement.removeAttribute("data-layout");
  });

  it("lists the jobs as cards, and an unread fleet as unknown rather than empty", async () => {
    const stream = await opened();
    // The conversation is the middle of the page, not a card: he starts one by typing in it.
    expect(groups()).toEqual([["Needs you", "Not read yet."], ["Working", "Not read yet."], ["Done", "Not read yet."]]);
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW });
    expect(groups()).toEqual([["Needs you", 1], ["Working", "Nothing is running right now."], ["Done", 1]]);
    const needs = document.querySelector<HTMLElement>('.job[data-job="call:pick"]')!;
    expect(needs.querySelector(".frame img")).not.toBeNull();
    // Under "Needs you" the dot says it; the card names the project.
    expect(needs.querySelector(".s")).toBeNull();
    expect(needs.querySelector(".p")!.textContent).toBe("CopyCopy");
    expect(document.getElementById("stage-crumb")!.textContent).toContain("With firstmate");
  });

  it("opens one job on the sheet, with its pictures, its choices and its own box, and Escape brings the conversation back", async () => {
    const stream = await opened();
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW });
    after(() => document.querySelector<HTMLElement>('.job[data-job="call:pick"]')!.click());
    expect(document.documentElement.getAttribute("data-job")).toBe("call:pick");
    expect(document.getElementById("stage-title")!.textContent).toBe("Which bezel should CopyCopy build?");
    expect(Array.from(document.querySelectorAll(".job-view .ver .n")).map((name) => name.textContent)).toEqual(["V2 · Spindle", "V6 · Numeral"]);
    expect(Array.from(document.querySelectorAll(".job-view .choice-pick")).map((button) => button.textContent)).toEqual(["V2 Spindle", "V6 Numeral"]);
    expect(document.querySelector(".job-view .jv-msg p")!.textContent).toBe("Both read well at small sizes.");
    expect(document.querySelector(".job-view .art-chat")).not.toBeNull();
    after(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.documentElement.hasAttribute("data-job")).toBe(false);
  });

  it("gives an open job a back button that returns to the conversation and forgets the job", async () => {
    const stream = await opened();
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW });
    after(() => document.querySelector<HTMLElement>('.job[data-job="call:pick"]')!.click());
    expect(document.documentElement.getAttribute("data-job")).toBe("call:pick");
    expect(sessionStorage.getItem("flyd-front-job")).toBe("call:pick");
    const back = document.querySelector<HTMLButtonElement>("#stage-head button#stage-back")!;
    expect(back.textContent).toBe("Back to the conversation");
    after(() => back.click());
    expect(document.documentElement.hasAttribute("data-job")).toBe(false);
    expect(sessionStorage.getItem("flyd-front-job")).toBe("talk");
    expect(document.querySelector(".job.on")).toBeNull();
  });

  it("opens a decision that carries candidate previews: every design shown, its phone view beside it, and its choices with them", async () => {
    const stream = await opened();
    const lab = {
      id: "call:new-lab", kind: "call", headline: "Which /new version should obj0 build?", why: "", status: "Needs your choice", project: "obj0",
      at: "2026-10-24T15:30:00.000Z", task: "obj0-new-direction", detail: "Twelve versions, all in the existing look.",
      shots: [{ src: "/api/artefact-shot?task=obj0-new-lab-r2&file=shots%2Fv2-desktop.png", label: "v2-desktop.png" }],
      previews: [
        { label: "V2 · Live page", image: "/api/artefact-shot?task=obj0-new-lab-r2&file=shots%2Fv2-desktop.png", phone: "/api/artefact-shot?task=obj0-new-lab-r2&file=shots%2Fv2-phone.png" },
        { label: "V10 · Edit the page", image: "/api/artefact-shot?task=obj0-new-lab-r2&file=shots%2Fv10-desktop.png", phone: "/api/artefact-shot?task=obj0-new-lab-r2&file=shots%2Fv10-phone.png" },
      ],
      decision: { task: "obj0-new-direction", decisionId: "d2", question: "Which /new version should obj0 build?", choices: ["V2 Live page", "V10 Edit the page"], recommended: "V10 Edit the page" },
    };
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: { ...SHOW, calls: [lab], counts: { call: 1 } } });
    after(() => document.querySelector<HTMLElement>('.job[data-job="call:new-lab"]')!.click());
    const candidates = [...document.querySelectorAll<HTMLElement>(".job-view .jv-candidate")];
    expect(candidates.map((candidate) => candidate.querySelector("figcaption")!.textContent)).toEqual(["V2 · Live page", "V10 · Edit the page"]);
    expect(candidates[0]!.querySelector<HTMLImageElement>(".jv-view img")!.getAttribute("src")).toBe(`/api/artefact-shot?task=obj0-new-lab-r2&file=shots%2Fv2-desktop.png&token=${"a".repeat(48)}`);
    expect(candidates[0]!.querySelector<HTMLImageElement>(".jv-phone img")!.getAttribute("src")).toContain("shots%2Fv2-phone.png");
    expect(candidates[1]!.querySelector(".jv-phone img")).not.toBeNull();
    // The choice stays under the designs, so he picks without leaving the card.
    expect([...document.querySelectorAll(".job-view .choice-pick")].map((button) => button.textContent)).toEqual(["V2 Live page", "V10 Edit the pagerecommended"]);
  });

  it("states a working row in Flyd's words: no framing, no George, and one line of state and what happens next", async () => {
    const stream = await opened();
    stream.emit("update", {
      order: ["u1"], messages: [], working: false,
      show: {
        ...SHOW, calls: [], counts: {},
        underway: [{
          id: "live:answer", kind: "live", project: "flyd", status: "Working",
          // The shape Core used to hand firstmate: it is rewritten, not shown.
          headline: "Act on George's answer to: Which one(s) to build for real, or another round?",
          detail: "Building V5 with a framed hero. Then the editorial image goes in.",
        }, {
          id: "live:hero", kind: "waiting", project: "hftw",
          headline: "The HFTW shop hero images currently use product shots, and V5 is ready for review with a framed hero and a plain product card row",
          detail: "Waiting for your pick: V5 framed hero.",
        }],
      },
    });
    const answer = document.querySelector<HTMLElement>('.job[data-job="live:answer"]')!;
    expect(answer.querySelector(".t")!.textContent).toBe("Carrying out your choice on flyd");
    expect(answer.querySelector(".next")!.textContent).toBe("Building V5 with a framed hero.");
    expect(answer.textContent).not.toMatch(/George|answer to:/);
    const hero = document.querySelector<HTMLElement>('.job[data-job="live:hero"]')!;
    // A long run-on gives the card its first sentence, cut; the line says the state and the next step.
    const heroTitle = hero.querySelector(".t")!.textContent!;
    expect(heroTitle.endsWith("…")).toBe(true);
    expect(heroTitle.length).toBeLessThanOrEqual(93);
    expect(hero.querySelector(".next")!.textContent).toBe("Waiting for your pick: V5 framed hero.");
  });

  it("lists what needs him from the one list, a finished design lab among them, led by its picture", async () => {
    const stream = await opened();
    const lab = {
      id: "lab:run-7", kind: "activity", lifecycle: "active", subject: "Ten directions for the CapFive deal alert", summary: "Ready for your review.",
      project: "capfive", evidence: [{ kind: "web", ref: "https://example.test/lab.html", label: "Open the lab" }, { kind: "image", ref: "/api/rail-image?path=%2Ftmp%2Fv1.png", label: "v1.png" }],
      actions: [], source: { showItemId: "lab:run-7", ref: "run-7" }, activity: { phase: "ready", started: "2026-10-24T08:00:00.000Z" }, updatedAt: "2026-10-24T09:00:00.000Z",
    };
    const focus = { id: "task:bezel", kind: "decision", lifecycle: "interrupted", subject: "Which bezel should CopyCopy build?", source: { showItemId: "call:pick", task: "bezel" } };
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: { ...SHOW, focus, needs: [lab] }, leftColumn: { now: [], recent: [], week: [], monitors: [], semantic: [lab] } });
    expect(Array.from(document.querySelectorAll("#jobs-list .job.needs")).map((card) => card.getAttribute("data-job"))).toEqual(["call:pick", "lab:run-7"]);
    const card = document.querySelector<HTMLElement>('.job[data-job="lab:run-7"]')!;
    expect(card.querySelector(".s")!.textContent).toBe("Lab ready for review");
    expect(card.querySelector(".frame img")!.getAttribute("src")).toContain("/api/rail-image?path=");
    after(() => card.click());
    expect(document.querySelector<HTMLAnchorElement>(".job-view .fbtn")!.href).toBe("https://example.test/lab.html");
    expect(document.querySelector(".job-view .art-chat")).not.toBeNull();
  });

  it("renders stored job digests and says what an empty list actually is", async () => {
    const stream = await opened();
    stream.emit("update", { order: ["u1"], messages: [], working: false, jobs: [], jobsFleetKnown: false, show: { title: "", summary: "", items: [], counts: {}, live: false } });
    expect(document.body.textContent).not.toContain("Not read yet");
    expect(groups()).toEqual([
      ["Needs you", "No decision is waiting."],
      ["Working", "No run has reported yet."],
      ["Waiting", "Nothing is waiting."],
      ["Done", "Nothing has landed lately."],
    ]);
    stream.emit("update", {
      order: ["u1"], messages: [], working: false, jobsFleetKnown: true,
      show: { title: "", summary: "", items: [], counts: {}, live: false },
      jobs: [{
        id: "cap5", group: "waiting", state: "Waiting", title: "Cap5", project: "Client", at: "2026-10-26T12:00:00.000Z",
        next: "Send the revised deck", owner: "you", ask: "", because: "No open run",
        shots: [], links: [{ label: "Deck", url: "https://example.com/deck" }], files: [{ label: "deck.pdf" }], threads: [],
        digest: { changed: "The deck dropped the third pricing tier.", means: "Cap5 can review one offer.", needed: "Send it.", link: "https://example.com/deck" },
      }, {
        id: "pick", group: "needs", state: "Needs you", title: "Which hero", project: "Client", at: "2026-10-26T13:00:00.000Z",
        next: "Pick a hero", owner: "you", ask: "Which hero should ship?", because: "decision",
        shots: [], links: [], files: [], threads: [{ id: "s1", title: "Hero thread", at: "2026-10-26T13:00:00.000Z", kind: "conversation" }],
        digest: null,
      }],
    });
    const cap = document.querySelector<HTMLElement>('.job[data-job="cap5"]')!;
    expect(cap.querySelector(".digest")!.textContent).toContain("The deck dropped the third pricing tier.");
    expect(cap.querySelector(".digest")!.textContent).toContain("Send it.");
    expect(cap.querySelector("a")).toBeNull();
    expect(document.querySelector('.job[data-job="pick"] .next')!.textContent).toContain("Pick a hero");
    after(() => document.querySelector<HTMLElement>('.job[data-job="pick"]')!.click());
    expect(document.querySelector(".jv-ask")!.textContent).toBe("Which hero should ship?");
    expect(document.querySelector(".jv-thread")!.textContent).toBe("Hero thread");
    after(() => document.querySelector<HTMLElement>('.job[data-job="cap5"]')!.click());
    expect(document.querySelector(".jv-digest")!.textContent).toContain("Cap5 can review one offer.");
    expect(document.querySelector<HTMLAnchorElement>(".jv-digest .fbtn")!.href).toBe("https://example.com/deck");
    expect(document.querySelector(".jv-files")!.textContent).toBe("deck.pdf");
  });
});
