// @vitest-environment happy-dom
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerBody, answerHtml } from "../answer-form.js";
import { communicationIntent, manifestationPlan } from "../communication.js";
import { comparisonContent, diagnosticContent } from "./fixtures/communication.js";
import { boxesOf } from "../boxes.js";
import { jobsFrom, type JobRun } from "../jobs.js";
import { RECEIVED } from "../living.js";
import { renderPage } from "../page.js";
import { fillScreen } from "../screen/patterns.js";
import type { ShowItem, ShowScreen } from "../show.js";

// Core's one board (jobs.ts) is built here as the live view builds it. Its imports read Flyd's install root
// through \`new URL(…, import.meta.url)\`, which vitest turns into a web address under happy-dom: the
// config they read is Flyd's directory alone, somewhere throwaway.
vi.mock("../../lib/config.js", async () => {
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  return { FLYD_DIR: join(tmpdir(), "flyd-page-test"), FLYD_APPLICATION_ROOT: join(tmpdir(), "flyd-page-test-root") };
});

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
  document.body.setAttribute("data-send-token", /data-send-token="([^"]*)"/.exec(body[1]!)![1]!);
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
  it("evolves an investigation from cause to comparison while keeping its evidence open and focused", async () => {
    load("");
    await settle();
    const content = diagnosticContent();
    const first = manifestationPlan(content, await communicationIntent(content, "Why?", { calibrated: async () => false }));
    const stream = open("latest", [{ id: "a1", role: "assistant", html: answerHtml(first) }]);
    const root = document.querySelector('[data-comm-object="answer:review:1"]')!;
    expect(root.getAttribute("data-communication")).toBe("explain_cause");
    expect(root.querySelector(".comm-contrast")?.textContent).toContain("Expected");
    const evidence = root.querySelector("details")!;
    (root.querySelector("button[data-comm-source]") as HTMLButtonElement).click();
    expect(evidence.open).toBe(true);
    const link = evidence.querySelector("a")!;
    link.focus();
    expect(document.activeElement).toBe(link);
    const next = comparisonContent();
    const changed = manifestationPlan(next, await communicationIntent(next, "Which fix?", { calibrated: async () => false }));
    stream.emit("update", { order: ["a1"], messages: [{ id: "a1", role: "assistant", html: answerHtml(changed) }], working: false });
    expect(document.querySelector("[data-comm-object]")).toBe(root);
    expect(root.getAttribute("data-semantic-kind")).toBe("investigation");
    expect(root.getAttribute("data-communication")).toBe("compare_options");
    expect(root.querySelector("table")?.textContent).toContain("Intent planner");
    expect(root.querySelector(".comm-contrast")).toBeNull();
    expect(root.querySelector("details")).toBe(evidence);
    expect(evidence.open).toBe(true);
    expect(evidence.querySelector("a")).toBe(link);
    expect(document.activeElement).toBe(link);
    expect(link.href).toBe("https://example.test/review/200");
  });

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

  it("puts no small uppercase or letter-spaced label above a line: only buttons may shout", () => {
    const html = renderPage({ assistantLabel: "firstmate", sendToken: "a".repeat(48) });
    const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]!).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1]!.trim(), body: match[2]! }));
    const shouting = rules.filter((rule) => /text-transform:\s*uppercase|letter-spacing:\s*0?\.\d+em/.test(rule.body));
    const buttons = /send|button|#send/;
    expect(shouting.filter((rule) => !buttons.test(rule.selector)).map((rule) => rule.selector)).toEqual([]);
    for (const gone of ["card-meta", "sc-kicker", "aside-label", "inline-kind", "jtag", "wx-tag", "step-count", "screen-confidence", "about-chip"]) {
      expect(html).not.toContain(gone);
    }
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
    expect(pending()[0]).toContain("Not sent");
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

  it("puts his just-sent message last, below a job message said after the empty-state boxes", async () => {
    load("");
    await settle();
    const stream = open("latest", [{ id: "u1", role: "user", html: "<p>first</p>", timestamp: "2026-10-05T19:00:00.000Z" }]);
    const main = document.getElementById("stream")!;
    const work = document.createElement("article");
    work.className = "msg assistant work";
    work.dataset.ts = "2026-10-05T19:30:00.000Z";
    main.insertBefore(work, document.getElementById("working"));
    await type("are you there?");
    stream.emit("update", { order: ["u1", "note:1"], messages: [{ id: "note:1", role: "user", html: "<p>are you there?</p>", timestamp: "2026-10-05T20:01:00.000Z" }], working: true });
    await settle();
    const shown = Array.from(main.querySelectorAll(":scope > .msg"));
    expect(shown.at(-1)!.textContent).toContain("are you there?");
    expect(shown.indexOf(work)).toBeLessThan(shown.length - 1);
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
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ session: "latest", text: "", scope: "", images: [{ mediaType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" }], files: [] });
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
      scope: "",
      images: [],
      files: [{ name: "Q3 report.pdf", data: btoa("%PDF-1.3 hello") }, { name: "notes.md", data: btoa("# notes") }],
    });
    expect(Array.from(document.querySelectorAll(".msg.pending .doc .name")).map((n) => n.textContent)).toEqual(["Q3 report.pdf", "notes.md"]);
  });

  it("attaches an image and a document picked with the + button and sends them with the message", async () => {
    load("");
    await settle();
    open("latest", []);
    const picker = document.getElementById("attach-input") as HTMLInputElement;
    let opened = false;
    picker.addEventListener("click", () => { opened = true; });
    (document.getElementById("attach") as HTMLButtonElement).click();
    expect(opened).toBe(true);
    expect(picker.accept).toContain("image/png");
    expect(picker.accept).toContain(".pdf");

    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const picked = [new File([png], "shot.png", { type: "image/png" }), new File(["%PDF-1.3 hi"], "brief.pdf", { type: "application/pdf" })];
    Object.defineProperty(picker, "files", { value: picked, configurable: true });
    picker.dispatchEvent(new Event("change"));
    for (let i = 0; i < 20 && document.querySelectorAll(".attachment").length < 2; i += 1) await settle();
    expect(document.querySelectorAll(".attachment img")).toHaveLength(1);
    expect(document.querySelector(".attachment.file .name")?.textContent).toBe("brief.pdf");

    await type("look at these");
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/send")!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      session: "latest",
      text: "look at these",
      scope: "",
      images: [{ mediaType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" }],
      files: [{ name: "brief.pdf", data: btoa("%PDF-1.3 hi") }],
    });
    expect(document.querySelectorAll(".attachment")).toHaveLength(0);
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
    expect(document.querySelector(".msg.failed .state")?.textContent).toContain("Not sent. It's back in the box to try again");
    // The server's reason is never his to read.
    expect(document.querySelector(".msg.failed .state")?.textContent).not.toContain("firstmate");
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
    expect(document.querySelector(".msg.failed .state")?.textContent).toContain("Not sent");
    expect(document.querySelector(".msg.failed .state")?.textContent).not.toContain("token");
  });

  it("never sits on \"reconnecting…\" after the view restarts: a new view's token reloads the page, the same one reconnects", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      let token = "a".repeat(48);
      vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/api/token" ? json({ token }) : json({ sessions: SESSIONS }))));
      const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
      load("");
      await vi.runOnlyPendingTimersAsync();
      const drawn = [
        { id: "m0", role: "user", html: "<p>m0</p>" },
        { id: "m1", role: "assistant", html: "<p>m1</p>" },
      ];
      const first = open("latest", drawn);
      // A dropped stream with the same token: say so, and connect again from the oldest message drawn, keeping it.
      first.onerror!();
      expect(document.getElementById("problem")!.textContent).toBe("reconnecting…");
      expect(first.closed).toBe(true);
      await vi.advanceTimersByTimeAsync(1_100);
      expect(FakeEventSource.instances).toHaveLength(2);
      expect(new URL(FakeEventSource.instances[1]!.url, "http://view").searchParams.get("from")).toBe("m0");
      expect([...document.querySelectorAll("#stream > .msg .body")].map((node) => node.textContent)).toEqual(["m0", "m1"]);
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

  it("stays on the conversation he picks while a dropped stream waits to reconnect", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/api/token" ? json({ token: "a".repeat(48) }) : json({ sessions: SESSIONS }))));
      load("?session=latest");
      await vi.runOnlyPendingTimersAsync();
      const first = open("latest", [{ id: "m0", role: "user", html: "<p>m0</p>" }]);
      await vi.advanceTimersByTimeAsync(0);
      first.onerror!();
      document.querySelector<HTMLButtonElement>(".history-item-title")?.closest("button")?.click();
      const picked = FakeEventSource.instances.at(-1)!;
      expect(picked.url).toContain("session=older");
      open("older", [{ id: "o1", role: "assistant", html: "<p>old reply</p>" }]);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(FakeEventSource.instances.at(-1)).toBe(picked);
      expect(picked.closed).toBe(false);
      expect([...document.querySelectorAll("#stream > .msg .body")].map((node) => node.textContent)).toEqual(["old reply"]);
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

  it("uses a plain message placeholder without naming Flyd", () => {
    document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(renderPage({ assistantLabel: "Flyd", sendToken: "a".repeat(48) }))![1]!.replace(/<script>[\s\S]*<\/script>/, "");
    const input = document.getElementById("input") as HTMLTextAreaElement;
    expect(input.placeholder).toBe("Message");
    expect(input.getAttribute("aria-label")).toBe("Message");
    expect(document.getElementById("scope")!.textContent).toBe("Project");
    expect(document.body.textContent).not.toContain("To: Flyd");
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
    expect(relays[0]!.querySelector(".aside-label")).toBeNull();

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

  it("says where a message goes, general unless he is in a project's thread, and changes it in one click", async () => {
    load("");
    await settle();
    open("latest", []);
    const scope = document.getElementById("scope") as HTMLButtonElement;
    expect(scope.textContent).toBe("Project");
    const sentScope = () => JSON.parse(String((vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").at(-1)![1] as RequestInit).body)).scope;
    await type("Preferences should be full-page");
    expect(sentScope()).toBe("");

    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/api/projects" ? json({ ready: true, projects: [{ id: "project:hftw", name: "HFTW", count: 3 }, { id: "project:flyd", name: "Flyd", count: 2 }] }) : url === "/api/send" ? json(sendResponse) : json({ assistantLabel: "firstmate", sessions: SESSIONS }))));
    scope.click();
    await settle();
    const menu = document.getElementById("scope-menu")!;
    expect(menu.hidden).toBe(false);
    expect([...menu.querySelectorAll("button")].map((choice) => choice.textContent)).toEqual(["No project", "HFTW", "Flyd (project)"]);
    menu.querySelector<HTMLButtonElement>('[data-scope="HFTW"]')!.click();
    expect(menu.hidden).toBe(true);
    expect(scope.textContent).toBe("HFTW");
    await type("swap the hero image");
    expect(sentScope()).toBe("HFTW");

    // The stream reconnecting to the same conversation keeps his pick.
    FakeEventSource.instances.at(-1)!.emit("session", { id: "latest", title: "latest", updatedAt: "2026-10-05T20:00:00.000Z", assistantLabel: "firstmate" });
    expect(scope.textContent).toBe("HFTW");
    await type("and the footer");
    expect(sentScope()).toBe("HFTW");

    // A project's thread speaks for that project; leaving it is general again.
    FakeEventSource.instances.at(-1)!.emit("session", { id: "project:dir", title: "DIR", updatedAt: "2026-10-05T20:00:00.000Z", assistantLabel: "firstmate" });
    expect(scope.textContent).toBe("DIR");
    FakeEventSource.instances.at(-1)!.emit("session", { id: "latest", title: "latest", updatedAt: "2026-10-05T20:00:00.000Z", assistantLabel: "firstmate" });
    expect(scope.textContent).toBe("Project");
  });

  it("recalls earlier messages with Up from the first line and restores the draft with Down", async () => {
    load("");
    await settle();
    open("latest", [
      { id: "u1", role: "user", html: "<p>first ask</p>" },
      { id: "r1", role: "assistant", html: "<p>reply</p>" },
      { id: "u2", role: "user", html: "<p>second ask</p>" },
      { id: "u3", role: "user", html: "<p>second ask</p>" },
    ]);
    const input = document.getElementById("input") as HTMLTextAreaElement;
    const press = (key: string, shiftKey = false) => {
      const event = new KeyboardEvent("keydown", { key, shiftKey, cancelable: true });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    };
    input.value = "half-typed draft";
    input.setSelectionRange(input.value.length, input.value.length);

    expect(press("ArrowDown")).toBe(false);
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

    expect(press("ArrowUp", true)).toBe(true);
    expect(input.value).toBe("second ask");
    press("ArrowDown", true);
    expect(input.value).toBe("half-typed draft");
  });

  it("leaves plain Up and Down to move the caret inside a multi-line message, and includes messages just sent", async () => {
    load("");
    await settle();
    open("latest", [{ id: "u1", role: "user", html: "<p>older</p>" }]);
    const input = document.getElementById("input") as HTMLTextAreaElement;
    const press = (key: string) => {
      const event = new KeyboardEvent("keydown", { key, cancelable: true });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    };
    input.value = "line one\nline two";
    input.setSelectionRange(input.value.length, input.value.length);
    expect(press("ArrowUp")).toBe(false);
    expect(input.value).toBe("line one\nline two");
    input.setSelectionRange(0, 0);
    expect(press("ArrowDown")).toBe(false);
    expect(press("ArrowUp")).toBe(true);
    expect(input.value).toBe("older");

    input.value = "";
    await type("just sent");
    input.value = "";
    input.dispatchEvent(new Event("input"));
    expect(press("ArrowUp")).toBe(true);
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
    expect(send.getAttribute("aria-label")).toBe("Send message");
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

  it("shows the island's loader in the message box from the end of speech until Flyd stops working on it", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const loader = document.getElementById("voice-wait")!;
    const composer = document.getElementById("composer")!;
    const voice = (window as unknown as { flydVoice: Record<string, (text?: string) => void> }).flydVoice;

    voice.start!();
    voice.draft!("open the deals page");
    // Still talking: the box listens, no loader yet.
    expect(loader.hidden).toBe(true);
    voice.transcribing!();
    expect(loader.hidden).toBe(false);
    expect(loader.getAttribute("role")).toBe("status");
    expect(loader.textContent).toBe("Writing down what you said");
    voice.send!("Open the deals page.");
    await settle();
    // Sent: still waiting, now on the answer, and the box is empty for the next message.
    expect(loader.hidden).toBe(false);
    expect(composer.classList.contains("voice-waiting")).toBe(true);
    expect(loader.textContent).toContain("to answer");

    const asked = { id: "note:1", role: "user", html: "<p>Open the deals page.</p>" };
    stream.emit("update", { order: ["note:1"], messages: [asked], working: true });
    await settle();
    expect(loader.hidden).toBe(false);
    const reply = { id: "a1", role: "assistant", html: "<p>Opening it.</p>" };
    const now = new Date().toISOString();
    // A first reply while the island still shows Flyd working: the box keeps its loader too.
    stream.emit("update", { order: ["note:1", "a1"], messages: [asked, reply], working: true, lastActivity: now });
    await settle();
    expect(loader.hidden).toBe(false);
    // The work ends, as the island's spinner does: the loader goes.
    stream.emit("update", { order: ["note:1", "a1"], messages: [asked, reply], working: false, lastActivity: now });
    await settle();
    expect(loader.hidden).toBe(true);
    expect(composer.classList.contains("voice-waiting")).toBe(false);
    expect(loader.textContent).toBe("");
  });

  it("takes the box's loader away when a recording fails or its message does not send", async () => {
    load("");
    await settle();
    open("latest", []);
    const loader = document.getElementById("voice-wait")!;
    const voice = (window as unknown as { flydVoice: Record<string, (text?: string) => void> }).flydVoice;

    voice.start!();
    voice.transcribing!();
    expect(loader.hidden).toBe(false);
    voice.cancel!("Voice did not finish - try again");
    expect(loader.hidden).toBe(true);

    vi.mocked(fetch).mockImplementation(async (url) => (url === "/api/send" ? json({ error: "down" }, 500) : json({ assistantLabel: "firstmate", sessions: SESSIONS })));
    voice.start!();
    voice.transcribing!();
    voice.send!("Open the deals page.");
    await settle();
    expect(loader.hidden).toBe(true);
  });

  it("never shows the voice loader for a typed message", async () => {
    load("");
    await settle();
    open("latest", []);
    await type("hello");
    expect(document.getElementById("voice-wait")!.hidden).toBe(true);
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

  // George, 2026-10-25: "i send a message to flyd and it keeps my message in the textbox":
  // the page redrew the card while the message was on its way and refilled the box from the draft.
});

describe("header and artefact view", () => {
  // George, 2026-10-29: "Why doesn't Flyd show me that it's working and give me information about
  // what's happening? I typed something in and it just... nothing happens."
  it("offers a comment on words he selects in a message, typed in the one message box under a chip that quotes them", async () => {
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
    // Nothing until he selects something in a message, and no second box when he does.
    expect(pop.hidden).toBe(true);
    select(words, 4, 10);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(pop.hidden).toBe(false);
    expect(pop.querySelector("textarea")).toBeNull();
    pop.querySelector<HTMLButtonElement>(".passage-open")!.click();
    expect(pop.hidden).toBe(true);
    expect(document.getElementById("replying")!.hidden).toBe(false);
    expect(document.getElementById("replying-title")!.textContent).toBe("“island”");
    expect(document.getElementById("replying")!.parentElement).toBe(document.querySelector(".field"));
    const input = document.getElementById("input") as HTMLTextAreaElement;
    input.value = "Faster";
    document.getElementById("composer")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    const sent = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(sent).toEqual([{ session: "latest", passage: { quote: "island", from: "assistant" }, text: "Faster" }]);
    // The chip goes with the message: the next one is plain talk again.
    expect(document.getElementById("replying")!.hidden).toBe(true);
    // Words selected outside a message take none.
    const outside = document.body.appendChild(document.createElement("p"));
    outside.textContent = "Not a message";
    select(outside.firstChild!, 0, 3);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(pop.hidden).toBe(true);
    window.getSelection()!.removeAllRanges();
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

  it("keeps an attachment in the box when the reply he is writing goes as words only", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const choice = { question: "Want me to add all three?", options: ["Yes", "No"], replyTo: "reply:a#2", session: "asked-session" };
    stream.emit("update", { order: ["reply:a#2"], messages: [{ id: "reply:a#2", role: "assistant", html: "<p>Motion.</p>", aside: true, choice }], working: false });
    await settle();
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const paste = new Event("paste", { cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { items: [{ kind: "file", getAsFile: () => new File([png], "shot.png", { type: "image/png" }) }] } });
    document.getElementById("input")!.dispatchEvent(paste);
    for (let i = 0; i < 20 && !document.querySelector(".attachment img"); i += 1) await settle();
    document.querySelector<HTMLButtonElement>(".own-words")!.click();
    await type("Only the first");
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/send")!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({ session: "asked-session", text: "Only the first", replyTo: "reply:a#2" });
    expect(document.querySelectorAll(".attachment img")).toHaveLength(1);
  });

  it("keeps an image in the box when he replies with no words", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const choice = { question: "Want me to add all three?", options: ["Yes", "No"], replyTo: "reply:a#2", session: "asked-session" };
    stream.emit("update", { order: ["reply:a#2"], messages: [{ id: "reply:a#2", role: "assistant", html: "<p>Motion.</p>", aside: true, choice }], working: false });
    await settle();
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const paste = new Event("paste", { cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { items: [{ kind: "file", getAsFile: () => new File([png], "shot.png", { type: "image/png" }) }] } });
    document.getElementById("input")!.dispatchEvent(paste);
    for (let i = 0; i < 20 && !document.querySelector(".attachment img"); i += 1) await settle();
    document.querySelector<HTMLButtonElement>(".own-words")!.click();
    await type("");
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/send")).toBe(false);
    expect(document.querySelectorAll(".attachment img")).toHaveLength(1);
    expect(document.getElementById("replying")!.hidden).toBe(false);
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
    expect(card.querySelector(".step-count")).toBeNull();
    expect(card.querySelector(".step-q")!.textContent).toBe("Discard the old CapFive experiment branches?");
    // A tap answers this question and shows the next; nothing has gone anywhere.
    tap("Yes");
    await settle();
    expect(sends()).toEqual([]);
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

  it("says on News whether the news is working, and what stopped, without being asked", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const status = document.getElementById("news-status")!;
    expect(status.hidden).toBe(true);
    const line = "News feeds are running from 64 sources. Today's edition came in at 12:19 with 11 stories, and your morning brief was ready at 07:02.";
    stream.emit("update", { order: [], messages: [], working: false, leftColumn: { now: [], recent: [], semantic: [], news: { running: true, line, warning: "The news writer's model account is out of credit, so the news has stopped updating." } } });
    expect(status.hidden).toBe(false);
    expect(document.getElementById("news-status-line")!.textContent).toBe(line);
    expect(document.getElementById("news-status-warn")!.textContent).toContain("out of credit");
    stream.emit("update", { order: [], messages: [], working: false, leftColumn: { now: [], recent: [], semantic: [], news: { running: true, line } } });
    expect(document.getElementById("news-status-warn")!.hidden).toBe(true);
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
  it("draws a relayed update as a compact card: a dot, one line, its link, no label above it", async () => {
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
    expect(card.querySelector(".card-meta")).toBeNull();
    expect(card.querySelector(".card-line")!.textContent).toBe("The island text fix is merged");
    expect(card.querySelector<HTMLAnchorElement>(".card-link")!.href).toBe("https://github.com/GeorgeGally/flyd/pull/162");
    expect(card.querySelector(".card-link")!.textContent).toBe("Open the change ↗");
    // The staff's own words stay folded behind "more".
    expect(document.querySelector(".msg")!.classList.contains("open")).toBe(false);
  });

  it("draws a reply with no artefact as a message, whatever lists, links or headings it holds", async () => {
    load("");
    await settle();
    open("latest", [{
      id: "t1", role: "assistant", aside: true,
      html: "<h2>Where it stands</h2><ul><li>The island fix is merged: <a href=\"https://github.com/GeorgeGally/flyd/pull/170\">#170</a></li><li>The voice fix is under way.</li></ul>",
      summary: { html: "<p>The island fix is merged.</p>", source: "flyd" },
    } as never]);
    await settle();
    const message = document.querySelector(".msg")!;
    expect(message.querySelector(".card")).toBeNull();
    expect(message.classList.contains("carded")).toBe(false);
    expect(message.querySelector(".summary")!.textContent).toBe("The island fix is merged.");
  });

  it("renders the canonical needs list even when the legacy decision list disagrees", async () => {
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
    show.needs = show.decisions;
    show.decisions = [];
    stream.emit("update", { order: [], messages: [], working: false, show, boxes: [] });
    await settle();

    const needs = document.getElementById("needs")!;
    expect(needs.dataset.semanticId).toBe("message:reply:a#2");
    expect(needs.querySelector(".needs-head")!.textContent).toBe("Which direction?");
    expect(needs.textContent).not.toContain("Ship the task?");
    expect(needs.querySelector(".needs-rec")!.textContent).toContain("I'd pick B.");
    expect(needs.querySelectorAll(".decision-evidence .shot")).toHaveLength(1);
    expect([...needs.querySelectorAll(".call-link")].map((link) => link.textContent)).toEqual(["Open preview ↗"]);
    expect([...needs.querySelectorAll<HTMLButtonElement>(".choice-pick")].map((button) => button.textContent)).toEqual(["Brecommended", "A"]);

    needs.querySelectorAll<HTMLButtonElement>(".choice-pick")[0]!.click();
    await settle();
    const sends = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").map(([, options]) => JSON.parse(String(options!.body)));
    expect(sends.at(-1)).toEqual({ session: "latest", replyTo: "reply:a#2", questionText: "Which direction?", text: "B", clientId: expect.stringMatching(/^note-/) });
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
    // On the front page earlier conversations fold away at the top of the timeline; the artefact column keeps the work, then the news.
    expect([...document.querySelectorAll(".rail-pane > *")].map((node) => node.id)).toEqual(["brief", "brief-news"]);
    expect(document.getElementById("history")!.closest("details.earlier")!.parentElement!.id).toBe("stream");
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
  // The board Core placed from that fleet (placement.ts): the page draws it and never re-sorts it.
  const PICK = {
    id: "call:pick", group: "needs", state: "Needs you", title: "Which bezel should CopyCopy build?", project: "CopyCopy", at: "2026-10-24T15:30:00.000Z",
    next: "", owner: "you", ask: "Which bezel should CopyCopy build?", because: "", detail: "Both read well at small sizes.",
    shots: SHOW.calls[0]!.shots, links: [], files: [], threads: [], digest: null, decision: SHOW.calls[0]!.decision,
  };
  const LANDED = {
    id: "landed:fix", group: "done", state: "Done", title: "Restore dropping files onto Flyd", project: "Flyd", at: "2026-10-24T09:00:00.000Z",
    next: "", owner: "", ask: "", because: "", shots: [], links: SHOW.landedWeek[0]!.links, files: [], threads: [], digest: null,
  };
  const BOARD = [PICK, LANDED];
  const groups = () => Array.from(document.querySelectorAll("#jobs-list .fgroup")).map((group) => [
    group.querySelector(".fhead span")!.textContent,
    group.querySelector(".fempty")?.textContent ?? group.querySelectorAll(".job").length,
  ]);
  // News, with a story picked by its "Chat about this" link (none when pick is null).
  function showNews(pick: number | null = 0): void {
    document.querySelector<HTMLElement>('.ctab[data-centre="news"]')!.click();
    if (pick !== null) document.querySelectorAll<HTMLElement>("#news-cols .story-chat")[pick]?.click();
  }
  // The story the message box names, or "" when it names none.
  function chip(): string {
    return document.getElementById("story-chip")!.hidden ? "" : document.getElementById("story-chip-name")!.textContent ?? "";
  }
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
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, jobs: BOARD, leftColumn: { now: [], recent: [{ id: "record:scout-edition", kind: "news", title: "Put together today's news", stories: [story], at: "2026-10-21T06:00:00.000Z" }], semantic: [] } });
    await settle();
    document.querySelector<HTMLElement>('.ctab[data-centre="talk"]')!.click();
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
    expect(document.documentElement.getAttribute("data-centre")).toBe("talk");
    expect(FakeEventSource.instances.at(-1)!.url).toContain("session=window%3Aarticle-0123456789abcdef");
    document.documentElement.removeAttribute("data-layout");
  });

  it("tells what needs him, what is under way and what finished today as messages in the one conversation, in time order", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const now = new Date();
    const at = (hour: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 5).toISOString();
    const job = (over: Record<string, unknown>) => ({ project: "", next: "", owner: "", ask: "", because: "", shots: [], links: [], files: [], threads: [], digest: null, ...over });
    stream.emit("update", {
      order: [], messages: [], working: false, show: SHOW, jobsFleetKnown: true,
      jobs: [
        job({ id: "ask", group: "needs", state: "Needs you", title: "Which hero ships", at: at(2) }),
        job({ id: "cx", group: "moving", state: "Working", title: "CleanX credit packs", at: at(1) }),
        job({ id: "queued", group: "moving", state: "Queued", title: "Waiting its turn", at: at(1) }),
        job({ id: "landed", group: "done", state: "Done", title: "Conversations split by project", at: at(0), shots: [{ src: "/api/artefact-shot?task=l&file=a.png", label: "a.png" }] }),
        job({ id: "old", group: "done", state: "Done", title: "Something from last week", at: "2026-10-01T09:00:00.000Z" }),
      ],
    });
    await settle();
    const work = [...document.querySelectorAll<HTMLElement>("#stream > .msg.work")];
    expect(work.map((node) => node.dataset.job)).toEqual(["landed", "cx", "ask"]);
    expect(work[2]!.classList.contains("needs")).toBe(true);
    expect(work[1]!.querySelector(".work-meta .fdot.pulse")).not.toBeNull();
    expect(work[0]!.querySelector(".work-shot img")!.getAttribute("src")).toContain("/api/artefact-shot?task=l");
    expect([...work[0]!.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Reply", "OK"]);
    expect(work[0]!.querySelector(".work-shot")!.tagName).toBe("DIV");
    work[0]!.querySelector<HTMLButtonElement>(".work-reply")!.click();
    expect(document.getElementById("replying")!.hidden).toBe(false);
    work[0]!.querySelector<HTMLButtonElement>(".work-ok")!.click();
    expect(document.querySelector('[data-job="landed"].work')).toBeNull();
    // Open unfolds the job in place, under its own message.
    work[2]!.querySelector<HTMLButtonElement>(".work-open")!.click();
    expect(document.querySelector(".job-view")!.closest(".msg.work")).toBe(work[2]);
    stream.emit("update", { order: [], messages: [], working: false, show: SHOW, jobsFleetKnown: true, jobs: [job({ id: "landed", group: "done", state: "Done", title: "Conversations split by project", at: at(0) })] });
    await settle();
    expect(document.querySelector('[data-job="landed"].work')).toBeNull();
  });

  it("leaves the conversation and its job messages standing across a refresh, and a reader scrolled up where he was", async () => {
    // happy-dom lays nothing out: every child of the pane is 100px tall, stacked in DOM order, under a window scrolled to y.
    let y = 0;
    const stack = () => [...document.getElementById("stream")!.children];
    const rect = (top: number) => ({ x: 0, y: top, top, left: 0, right: 600, bottom: top + 100, width: 600, height: 100, toJSON: () => ({}) }) as DOMRect;
    const box = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const at = stack().indexOf(this);
      return at === -1 ? rect(0) : rect(at * 100 - y);
    });
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, get: () => stack().length * 100 });
    window.scrollBy = ((_x: number, dy: number) => { y += dy; }) as typeof window.scrollBy;
    window.scrollTo = ((_x: number, to: number) => { y = to; }) as typeof window.scrollTo;
    try {
      load("");
      await settle();
      const now = new Date();
      const at = (hour: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 5).toISOString();
      const messages = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? "assistant" : "user", html: `<p>line ${i}</p>`, timestamp: at(i * 2) }));
      const stream = open("latest", messages);
      const job = (id: string, hour: number) => ({ id, group: "needs", state: "Needs you", title: `Ask ${id}`, at: at(hour), project: "", next: "", owner: "", ask: "", because: "", shots: [], links: [], files: [], threads: [], digest: null });
      // Jobs between his words, two of them at the same moment.
      const refresh = { order: messages.map((m) => m.id), messages: [], working: false, show: SHOW, jobsFleetKnown: true, jobs: [job("b", 3), job("a", 3), job("c", 9), job("d", 15)] };
      stream.emit("update", refresh);
      await settle();
      // He scrolls up to read.
      y = 300;
      window.dispatchEvent(new Event("scroll"));
      const before = stack();
      const moved: Node[] = [];
      const watch = new MutationObserver((records) => records.forEach((r) => [...r.addedNodes, ...r.removedNodes].forEach((n) => { if ((n as Element).classList?.contains("msg")) moved.push(n); })));
      watch.observe(document.getElementById("stream")!, { childList: true });
      stream.emit("update", refresh);
      await settle();
      watch.disconnect();
      // Nothing in the pane was taken out and put back, and he is still where he was.
      expect(moved).toHaveLength(0);
      expect(stack()).toEqual(before);
      expect(y).toBe(300);
    } finally {
      box.mockRestore();
      delete (window as { scrollY?: number }).scrollY;
      delete (document.documentElement as { scrollHeight?: number }).scrollHeight;
    }
  });

  it("keeps the main chat append-only when his words name a job's project: the job's message never moves", async () => {
    // The bug: Core's one board (jobsFrom) gives a project's job the newest time of any conversation tagged
    // with that project, and the timeline placed each job message by that time on every redraw. So talking
    // about CleanX in the main chat pulled CleanX's message down under his newest words, and naming another
    // project sent it back up: the conversation jumped while he read it.
    load("");
    await settle();
    const base = Date.now() - 6 * 60 * 60_000;
    const iso = (minutes: number) => new Date(base + minutes * 60_000).toISOString();
    const said = (id: string, role: string, minutes: number) => ({ id, role, html: `<p>${id}</p>`, timestamp: iso(minutes) });
    const messages = [said("m0", "user", 0), said("m1", "assistant", 5), said("m2", "user", 120), said("m3", "assistant", 125)];
    const stream = open("latest", messages);
    const cleanx = { id: "cleanx", name: "CleanX", what: "Credit packs", kind: "client" as const, status: "active" as const, now: "", next: "", people: [], repos: [], updated: "2026-11-01" };
    // A worker on CleanX, last heard from between his two questions.
    const worker: JobRun = { id: "run-cx", status: "working", project: "CleanX", outcome: "Build the CleanX credit packs", owner: "FirstMate", updatedAt: iso(60), artifacts: [] };
    const board = (sessionAt: number, project: string, status = "working") => jobsFrom({
      projects: [cleanx], runs: [{ ...worker, status }], now: Date.now(),
      sessions: [{ id: "latest", title: "Latest", project, updatedAt: iso(sessionAt) }],
    }).jobs;
    const refresh = (order: typeof messages, jobs: unknown[], fresh: typeof messages = []) => ({ order: order.map((m) => m.id), messages: fresh, working: false, show: SHOW, jobsFleetKnown: true, jobs });
    const panes = () => [...document.querySelectorAll<HTMLElement>("#stream > .msg")].map((node) => node.dataset.job ? `job:${node.dataset.job}` : node.querySelector(".body")!.textContent);
    // His newest words already name CleanX, so the board dates its job at them.
    const first = board(125, "CleanX");
    expect(first.map((job) => job.id)).toEqual(["run:run-cx"]);
    expect(first[0]!.at).toBe(iso(125));
    stream.emit("update", refresh(messages, first));
    await settle();
    // It is said where its own record puts it, never at the time the conversation lent it.
    expect(panes()).toEqual(["m0", "m1", "job:run:run-cx", "m2", "m3"]);
    const work = document.querySelector<HTMLElement>('#stream > .msg.work[data-job="run:run-cx"]')!;
    const moved: Node[] = [];
    const watch = new MutationObserver((records) => records.forEach((r) => [...r.addedNodes, ...r.removedNodes].forEach((n) => { if (n === work) moved.push(n); })));
    watch.observe(document.getElementById("stream")!, { childList: true });
    // He asks about CleanX again: a new exchange, and the session's time moves on with it.
    const next = [...messages, said("m4", "user", 240), said("m5", "assistant", 245)];
    stream.emit("update", refresh(next, board(245, "CleanX"), next.slice(4)));
    await settle();
    expect(panes()).toEqual(["m0", "m1", "job:run:run-cx", "m2", "m3", "m4", "m5"]);
    // He moves on to another project: CleanX's time falls back to its own.
    stream.emit("update", refresh(next, board(245, "Northwind")));
    await settle();
    watch.disconnect();
    expect(panes()).toEqual(["m0", "m1", "job:run:run-cx", "m2", "m3", "m4", "m5"]);
    expect(moved).toHaveLength(0);
    // The worker is queued for a while (the board files it under the project then) and starts again:
    // its message comes back where it was said, never as something new at the bottom.
    stream.emit("update", refresh(next, board(245, "Northwind", "queued")));
    await settle();
    expect(panes()).toEqual(["m0", "m1", "m2", "m3", "m4", "m5"]);
    stream.emit("update", refresh(next, board(245, "CleanX")));
    await settle();
    expect(panes()).toEqual(["m0", "m1", "job:run:run-cx", "m2", "m3", "m4", "m5"]);
  });

  it("adds a job that comes after the page did at the bottom of the conversation, and a reload keeps it there", async () => {
    load("");
    await settle();
    const base = Date.now() - 6 * 60 * 60_000;
    const iso = (minutes: number) => new Date(base + minutes * 60_000).toISOString();
    const messages = [0, 5, 120, 125].map((minutes, i) => ({ id: `m${i}`, role: i % 2 ? "assistant" : "user", html: `<p>m${i}</p>`, timestamp: iso(minutes) }));
    const job = (id: string, at: string) => ({ id, group: "needs", state: "Needs you", title: `Ask ${id}`, at, toldAt: at, project: "", next: "", owner: "", ask: "", because: "", shots: [], links: [], files: [], threads: [], digest: null });
    const panes = () => [...document.querySelectorAll<HTMLElement>("#stream > .msg")].map((node) => node.dataset.job ? `job:${node.dataset.job}` : node.querySelector(".body")!.textContent);
    let stream = open("latest", messages);
    stream.emit("update", { order: messages.map((m) => m.id), messages: [], working: false, show: SHOW, jobsFleetKnown: true, jobs: [] });
    await settle();
    // An ask the staff raised an hour ago reaches the board only now: it is new to him, so it is said last.
    stream.emit("update", { order: messages.map((m) => m.id), messages: [], working: false, show: SHOW, jobsFleetKnown: true, jobs: [job("late", iso(60))] });
    await settle();
    expect(panes()).toEqual(["m0", "m1", "m2", "m3", "job:late"]);
    // The page comes back: the ask stands where he saw it, not where its own time would first have put it.
    intervals.splice(0).forEach((id) => clearInterval(id));
    FakeEventSource.instances = [];
    load("");
    await settle();
    stream = open("latest", messages);
    stream.emit("update", { order: messages.map((m) => m.id), messages: [], working: false, show: SHOW, jobsFleetKnown: true, jobs: [job("late", iso(60))] });
    await settle();
    expect(panes()).toEqual(["m0", "m1", "m2", "m3", "job:late"]);
  });

  it("places a job already on the board at its own time when the first update came before Core knew the board", async () => {
    load("");
    await settle();
    const base = Date.now() - 6 * 60 * 60_000;
    const iso = (minutes: number) => new Date(base + minutes * 60_000).toISOString();
    const messages = [0, 5, 120, 125].map((minutes, i) => ({ id: `m${i}`, role: i % 2 ? "assistant" : "user", html: `<p>m${i}</p>`, timestamp: iso(minutes) }));
    const job = (id: string, at: string) => ({ id, group: "needs", state: "Needs you", title: `Ask ${id}`, at, toldAt: at, project: "", next: "", owner: "", ask: "", because: "", shots: [], links: [], files: [], threads: [], digest: null });
    const panes = () => [...document.querySelectorAll<HTMLElement>("#stream > .msg")].map((node) => node.dataset.job ? `job:${node.dataset.job}` : node.querySelector(".body")!.textContent);
    const stream = open("latest", messages);
    stream.emit("update", { order: messages.map((m) => m.id), messages: [], working: false, show: SHOW, jobsFleetKnown: false, jobs: [] });
    await settle();
    stream.emit("update", { order: messages.map((m) => m.id), messages: [], working: false, show: SHOW, jobsFleetKnown: true, jobs: [job("existing", iso(60))] });
    await settle();
    expect(panes()).toEqual(["m0", "m1", "job:existing", "m2", "m3"]);
  });

  it("loads earlier exchanges as he scrolls to the top, above what he is reading, without moving him", async () => {
    // happy-dom lays nothing out: every child of the pane is 100px tall, stacked in DOM order, under a window scrolled to y.
    let y = 0;
    const stack = () => [...document.getElementById("stream")!.children];
    const rect = (top: number) => ({ x: 0, y: top, top, left: 0, right: 600, bottom: top + 100, width: 600, height: 100, toJSON: () => ({}) }) as DOMRect;
    const box = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const at = stack().indexOf(this);
      return at === -1 ? rect(0) : rect(at * 100 - y);
    });
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, get: () => stack().length * 100 });
    window.scrollBy = ((_x: number, dy: number) => { y += dy; }) as typeof window.scrollBy;
    window.scrollTo = ((_x: number, to: number) => { y = to; }) as typeof window.scrollTo;
    try {
      load("");
      await settle();
      const base = Date.now() - 6 * 60 * 60_000;
      const all = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? "assistant" : "user", html: `<p>m${i}</p>`, timestamp: new Date(base + i * 60_000).toISOString() }));
      const stream = FakeEventSource.instances.at(-1)!;
      stream.emit("session", { id: "latest", title: "latest", updatedAt: "2026-10-05T20:00:00.000Z", assistantLabel: "Flyd", stream: "stream-1" });
      // Core drew the newest exchanges; five more wait above.
      const shown = all.slice(10);
      stream.emit("update", { order: shown.map((m) => m.id), earlier: 5, messages: shown, working: false });
      await settle();
      const asked = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/earlier");
      // Reading down at the bottom asks for nothing.
      expect(asked()).toHaveLength(0);
      // He scrolls up to the top: the page asks once for what came before, by its stream.
      y = 150;
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("scroll"));
      await settle();
      expect(asked()).toHaveLength(1);
      expect(JSON.parse(String(asked()[0]![1]!.body))).toEqual({ stream: "stream-1" });
      const reading = document.querySelectorAll<HTMLElement>("#stream > .msg")[1]!;
      const top = reading.getBoundingClientRect().top;
      stream.emit("update", { order: all.map((m) => m.id), messages: all.slice(0, 10), working: false });
      await settle();
      // The earlier exchanges sit above, in order, and what he was reading has not moved under him.
      expect([...document.querySelectorAll<HTMLElement>("#stream > .msg")].map((node) => node.querySelector(".body")!.textContent)).toEqual(all.map((m) => m.id));
      expect(reading.getBoundingClientRect().top).toBe(top);
      // Nothing more waits above: scrolling to the top again asks for nothing.
      y = 0;
      window.dispatchEvent(new Event("scroll"));
      await settle();
      expect(asked()).toHaveLength(1);
    } finally {
      box.mockRestore();
      delete (window as { scrollY?: number }).scrollY;
      delete (document.documentElement as { scrollHeight?: number }).scrollHeight;
    }
  });

  it("opens the item a link names in place, and what needs him first for a call, once the board has come", async () => {
    load("?job=moving");
    await settle();
    const stream = open("latest", []);
    const job = (over: Record<string, unknown>) => ({ project: "", next: "", owner: "", ask: "", because: "", shots: [], links: [], files: [], threads: [], digest: null, at: new Date().toISOString(), ...over });
    const jobs = [job({ id: "ask", group: "needs", state: "Needs you", title: "Which hero ships" }), job({ id: "moving", group: "moving", state: "Working", title: "CleanX" })];
    stream.emit("update", { order: [], messages: [], working: false, show: SHOW, jobsFleetKnown: true, jobs });
    await settle();
    expect(document.documentElement.getAttribute("data-job")).toBe("moving");
    expect(document.querySelector(".job-view")!.closest(".msg.work")!.getAttribute("data-job")).toBe("moving");
    // The island or a notification asks for what needs him.
    (window as unknown as { flydOpen(id: string): boolean }).flydOpen("needs");
    expect(document.documentElement.getAttribute("data-job")).toBe("ask");
    expect(document.documentElement.getAttribute("data-centre")).toBe("talk");
  });

  it("keeps a link to a job the board has not carried yet, and opens it when a later update brings it", async () => {
    load("");
    await settle();
    const stream = open("latest", []);
    const job = (over: Record<string, unknown>) => ({ project: "", next: "", owner: "", ask: "", because: "", shots: [], links: [], files: [], threads: [], digest: null, at: new Date().toISOString(), ...over });
    const base = { order: [], messages: [], working: false, show: SHOW, jobsFleetKnown: true };
    stream.emit("update", { ...base, jobs: [job({ id: "cx", group: "moving", state: "Working", title: "CleanX" })] });
    await settle();
    (window as unknown as { flydOpen(id: string): boolean }).flydOpen("late");
    expect(document.documentElement.getAttribute("data-job")).not.toBe("late");
    stream.emit("update", { ...base, jobs: [job({ id: "cx", group: "moving", state: "Working", title: "CleanX" }), job({ id: "late", group: "needs", state: "Needs you", title: "Late ask" })] });
    await settle();
    expect(document.documentElement.getAttribute("data-job")).toBe("late");
  });

  it("starts in the conversation, the one home with no Today feed beside it", async () => {
    const stream = await opened();
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, live: { known: true, counts: { running: 0, needs: 0 }, running: [], paused: [], needs: [], older: [], landed: [] } });
    expect(document.documentElement.getAttribute("data-centre")).toBe("talk");
    expect(document.querySelector('.ctab[data-centre="talk"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(document.getElementById("feed")).toBeNull();
    // Writing takes the middle back for the conversation.
    await type("hello again");
    expect(document.documentElement.getAttribute("data-centre")).toBe("talk");
  });

  it("shows the Week as eight day strips coloured by project, and tells the day picked", async () => {
    const hours = (at: number, n = 1) => Array.from({ length: 24 }, (_, h) => (h === at ? n : 0));
    const days = ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11"].map((day) => ({ day, hours: {}, changes: 0, head: "", lines: [] as string[] }));
    days[6] = { day: "2026-11-10", hours: { Flyd: hours(9, 2), Bloom: hours(9) } as never, changes: 3, head: "Add the Week tab", lines: ["Bloom: Track creators."] };
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => (String(url).startsWith("/api/week") ? json({ week: { days, lead: ["Flyd", "Logan", "DIR"], read: "" } }) : json({ assistantLabel: "firstmate", sessions: SESSIONS })));
    const stream = await opened();
    stream.emit("update", { order: [], messages: [], working: false, show: SHOW, live: { known: true, counts: { running: 0, needs: 0 }, running: [], paused: [], needs: [], older: [], landed: [] } });
    document.querySelector<HTMLElement>('.ctab[data-centre="week"]')!.click();
    await settle();
    expect(document.documentElement.getAttribute("data-centre")).toBe("week");
    expect(document.querySelector('.ctab[data-centre="week"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(document.getElementById("wk-key")!.textContent).toBe("FlydLoganDIREverything else");
    const strips = [...document.querySelectorAll<HTMLElement>(".wk-day")];
    expect(strips).toHaveLength(8);
    // The latest day with work is picked first; Flyd takes two thirds of 09:00, Bloom (not one of the three) the rest in the neutral.
    expect(strips[6]!.getAttribute("aria-pressed")).toBe("true");
    const segs = [...strips[6]!.querySelectorAll<HTMLElement>(".wk-lane i")];
    expect(segs.map((seg) => seg.className)).toEqual(["k1", "k0"]);
    expect(parseFloat(segs[0]!.style.top)).toBe(37.5);
    expect(strips[7]!.querySelector(".wk-lane em")).not.toBeNull();
    const tell = document.getElementById("wk-tell")!;
    expect(tell.querySelector("h3")!.textContent).toBe("Add the Week tab");
    expect(tell.querySelector("time")!.textContent).toBe("Tuesday 10 November, 3 changes");
    expect(tell.querySelector("p")!.textContent).toBe("Bloom: Track creators.");
    strips[1]!.click();
    expect(tell.querySelector("h3")!.textContent).toBe("A quiet day");
    expect(tell.querySelector("time")!.textContent).toBe("Thursday 5 November, no changes");
  });

  it("keeps the Week story's headline at the tallest day's height, so what sits under it stays put", async () => {
    const days = ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11"].map((day) => ({ day, hours: {}, changes: 0, head: "", lines: [] as string[] }));
    days[5] = { day: "2026-11-09", hours: {}, changes: 2, head: "A short one", lines: [] };
    days[6] = { day: "2026-11-10", hours: {}, changes: 3, head: "A much longer headline that wraps to three lines here", lines: ["Bloom: Track creators."] };
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => (String(url).startsWith("/api/week") ? json({ week: { days, lead: ["Flyd", "Logan", "DIR"], read: "" } }) : json({ assistantLabel: "firstmate", sessions: SESSIONS })));
    // jsdom lays nothing out: a headline is 33px a line at 20 characters a line (or its reserved height if taller), the story 300px wide and its parts stacked.
    const rect = (width: number, height: number) => ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) }) as DOMRect;
    const headHeight = (h3: HTMLElement) => Math.max(Math.ceil((h3.textContent ?? "").length / 20) * 33, parseFloat(h3.closest<HTMLElement>(".wk-tell")!.style.getPropertyValue("--wk-head-h")) || 0);
    const box = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.tagName === "H3" && this.closest(".wk-tell")) return rect(300, headHeight(this as HTMLElement));
      if (this.classList.contains("wk-tell")) {
        const head = this.querySelector<HTMLElement>("h3");
        return rect(300, (head ? headHeight(head) + 31 : 0) + this.querySelectorAll(":scope > p").length * 25);
      }
      return rect(0, 0);
    });
    try {
      const stream = await opened();
      stream.emit("update", { order: [], messages: [], working: false, show: SHOW, live: { known: true, counts: { running: 0, needs: 0 }, running: [], paused: [], needs: [], older: [], landed: [] } });
      document.querySelector<HTMLElement>('.ctab[data-centre="week"]')!.click();
      await settle();
      const tell = document.getElementById("wk-tell")!;
      // The three-line headline (52 characters) sets the room; "A quiet day" and "A short one" keep it.
      expect(tell.style.getPropertyValue("--wk-head-h")).toBe("99px");
      expect(tell.style.minHeight).toBe(`${99 + 31 + 25}px`);
      // The measuring is done unseen and leaves nothing behind.
      expect(document.querySelectorAll(".wk-tell")).toHaveLength(1);
      const strips = [...document.querySelectorAll<HTMLElement>(".wk-day")];
      for (const strip of [strips[5]!, strips[6]!, strips[1]!]) {
        strip.click();
        expect(tell.style.getPropertyValue("--wk-head-h")).toBe("99px");
        expect(tell.style.minHeight).toBe("155px");
      }
      expect(tell.querySelector("h3")!.textContent).toBe("A quiet day");
    } finally {
      box.mockRestore();
    }
  });

  it("tells a Week block in the story below, with no popup, naming its project, its hours and what changed then", async () => {
    const hours = (from: number, to: number) => Array.from({ length: 24 }, (_, h) => (h >= from && h < to ? 1 : 0));
    const days = ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11"].map((day) => ({ day, hours: {}, changes: 0, head: "", lines: [] as string[], work: [] as unknown[] }));
    const when = (h: number, m = 0) => new Date(2026, 10, 10, h, m).getTime();
    const work = [
      ...Array.from({ length: 6 }, (_, i) => ({ project: "Flyd", at: when(9, i * 5), title: `Change ${i + 1}` })),
      { project: "Flyd", at: when(10, 15), title: "Add the Week tab", ref: "#274" },
      { project: "Logan", at: when(14), title: "Keep the canvas still" },
    ];
    days[6] = { day: "2026-11-10", hours: { Flyd: hours(9, 11), Logan: hours(14, 15) } as never, changes: 8, head: "Add the Week tab", lines: [], work };
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => (String(url).startsWith("/api/week") ? json({ week: { days, lead: ["Flyd", "Logan", "DIR"], read: "" } }) : json({ assistantLabel: "firstmate", sessions: SESSIONS })));
    const stream = await opened();
    stream.emit("update", { order: [], messages: [], working: false, show: SHOW, live: { known: true, counts: { running: 0, needs: 0 }, running: [], paused: [], needs: [], older: [], landed: [] } });
    document.querySelector<HTMLElement>('.ctab[data-centre="week"]')!.click();
    await settle();
    expect(document.getElementById("wk-card")).toBeNull();
    const tell = document.getElementById("wk-tell")!;
    const told = () => [tell.querySelector("h3")!.textContent, tell.querySelector("time")!.textContent, ...[...tell.querySelectorAll("p")].map((p) => p.textContent)];
    expect(told()[0]).toBe("Add the Week tab");
    const strip = document.querySelectorAll<HTMLElement>(".wk-day")[6]!;
    const [flyd, logan] = [...strip.querySelectorAll<HTMLElement>(".wk-lane i")];
    // The two Flyd hours join into one block; the story tells it with the count, the latest five and the rest counted.
    flyd!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(told()).toEqual(["Flyd", "Tuesday 10 November, 09:00 to 11:00, 7 changes", "Change 3", "Change 4", "Change 5", "Change 6", "Add the Week tab #274", "and 2 earlier"]);
    expect([...tell.children].map((child) => child.querySelectorAll("p").length)).toEqual([0, 6]);
    expect(flyd!.classList.contains("lit")).toBe(true);
    document.getElementById("wk-days")!.dispatchEvent(new MouseEvent("mouseleave"));
    expect(told()[0]).toBe("Add the Week tab");
    expect(flyd!.classList.contains("lit")).toBe(false);
    // A tap keeps the block told until a tap elsewhere.
    logan!.click();
    expect(told()).toEqual(["Logan", "Tuesday 10 November, 14:00 to 15:00, 1 change", "Keep the canvas still"]);
    document.getElementById("wk-days")!.dispatchEvent(new MouseEvent("mouseleave"));
    expect(told()[0]).toBe("Logan");
    document.body.click();
    expect(told()[0]).toBe("Add the Week tab");
    // From the keyboard, the arrows on a focused day walk its blocks.
    strip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(told()[0]).toBe("Flyd");
    strip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(told()[0]).toBe("Logan");
    strip.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(told()[0]).toBe("Add the Week tab");
  });

  it("shows News as stories in columns, leaves filler out, and the box asks about the story he picks", async () => {
    const stream = await opened();
    const stories = [
      { title: "Static Radio for the Chumby One", url: "https://hackaday.example/chumby", source: "Hackaday", gist: "A native C client turns a 2009 Chumby One into a radio.", image: "/api/story-image?u=1" },
      { title: "Infinite Mac adds support for BeOS", url: "https://waxy.example/beos", source: "Waxy", gist: "Another dead operating system boots in a tab." },
      { title: "Halloween GIF", url: "https://giphy.com/gifs/1", source: "Giphy", gist: "A pumpkin." },
    ];
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, leftColumn: { now: [], recent: [{ id: "record:scout-edition", kind: "news", title: "Put together today's news", stories, at: "2026-11-03T06:00:00.000Z" }], semantic: [] } });
    showNews(null);
    expect(document.documentElement.getAttribute("data-centre")).toBe("news");
    expect(document.getElementById("news-when")!.textContent).toMatch(/^Last updated (?=.*\b3\b)(?=.*November)/);
    const shown = [...document.querySelectorAll<HTMLElement>("#news-cols .story")];
    expect(shown.map((story) => story.querySelector("h2")!.textContent)).toEqual(["Static Radio for the Chumby One", "Infinite Mac adds support for BeOS"]);
    expect(shown[0]!.classList.contains("lead")).toBe(true);
    // The source is a quiet line after the story, never a label above the headline.
    expect(shown[0]!.querySelector(".src")!.textContent).toBe("Hackaday");
    expect([...shown[0]!.children].map((child) => child.tagName.toLowerCase() + (child.className ? "." + child.className : ""))).toEqual(["img", "h2", "p", "p.src", "button.story-chat"]);
    expect(shown[0]!.querySelector("img")!.getAttribute("src")).toBe(`/api/story-image?u=1&token=${"a".repeat(48)}`);
    expect(shown[0]!.querySelector("h2 a")!.getAttribute("href")).toBe("https://hackaday.example/chumby");
    const input = document.getElementById("input") as HTMLTextAreaElement;
    // No story is talked about until he picks one: the box is the conversation's.
    expect(chip()).toBe("");
    expect(input.placeholder).toBe("Message");
    // "Chat about this" under the source puts that story in the box, by name.
    shown[1]!.querySelector<HTMLElement>(".story-chat")!.click();
    expect(chip()).toBe("Infinite Mac adds support for BeOS");
    expect(input.placeholder).toBe("Ask about this story");
    expect(shown[1]!.querySelector(".story-chat")!.getAttribute("aria-pressed")).toBe("true");
    // Pointing at another story on the way to the box never changes it.
    shown[0]!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    document.getElementById("news-page")!.dispatchEvent(new Event("scroll"));
    expect(chip()).toBe("Infinite Mac adds support for BeOS");
    // Asking goes to that story's own conversation, and the answer is drawn under the story.
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => (
      url === "/api/article-chat" ? json({ session: "window:article-0123456789abcdef" }) : url === "/api/send" ? json({ id: "u9" }) : json({ assistantLabel: "Flyd", sessions: SESSIONS })
    ));
    const streams = FakeEventSource.instances.length;
    await type("Which tab?");
    const sent = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").at(-1)!;
    expect(JSON.parse(String(sent[1]!.body))).toMatchObject({ session: "window:article-0123456789abcdef", text: "Which tab?" });
    expect(document.documentElement.getAttribute("data-centre")).toBe("news");
    expect(FakeEventSource.instances.length).toBe(streams + 1);
    FakeEventSource.instances.at(-1)!.emit("update", { order: ["u9", "a1"], working: false, messages: [{ id: "u9", role: "user", html: "<p>Which tab?</p>" }, { id: "a1", role: "assistant", html: "<p>Any browser tab.</p>" }] });
    const talk = shown[1]!.querySelector(".talk")!;
    expect([...talk.children].map((line) => [line.className, line.textContent])).toEqual([["q", "Which tab?"], ["a", "Any browser tab."]]);
    // Back on Today the box is the conversation's again.
    document.querySelector<HTMLElement>('.ctab[data-centre="talk"]')!.click();
    expect(input.placeholder).toBe("Message");
  });

  it("keeps an in-flight News reply live and closes it after completion", async () => {
    const stream = await opened();
    const stories = [
      { title: "First", url: "https://example.test/first", source: "Press" },
      { title: "Second", url: "https://example.test/second", source: "Press" },
    ];
    const update = (items: typeof stories) => stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, leftColumn: { now: [], recent: [{ kind: "news", stories: items }], semantic: [] } });
    update(stories);
    showNews();
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => (
      url === "/api/article-chat" ? json({ session: "article:first" }) : url === "/api/send" ? json({ id: "q1" }) : json({ assistantLabel: "Flyd", sessions: SESSIONS })
    ));
    await type("Question?");
    const first = FakeEventSource.instances.at(-1)!;
    expect(first.url).toContain("session=article%3Afirst");
    document.querySelectorAll<HTMLElement>("#news-cols .story-chat")[1]!.click();
    expect(first.closed).toBe(false);
    first.emit("update", { order: ["q1"], messages: [{ id: "q1", role: "user", html: "Question?" }], working: true });
    first.emit("update", { order: ["q1", "a1"], messages: [{ id: "a1", role: "assistant", html: "Answer.", answers: "q1" }], working: false });
    expect(document.querySelector("#news-cols .story .talk")!.textContent).toContain("Answer.");
    expect(first.closed).toBe(true);
    document.querySelectorAll<HTMLElement>("#news-cols .story-chat")[0]!.click();
    const reconnected = FakeEventSource.instances.at(-1)!;
    expect(reconnected).not.toBe(first);
    reconnected.emit("update", { order: ["q1", "a1"], messages: [{ id: "q1", role: "user", html: "Question?" }, { id: "a1", role: "assistant", html: "Answer." }], working: false });
    expect(document.querySelector("#news-cols .story .talk")!.textContent).toContain("Answer.");
    document.querySelector<HTMLElement>('.ctab[data-centre="talk"]')!.click();
    expect(reconnected.closed).toBe(true);
    showNews();
    const returned = FakeEventSource.instances.at(-1)!;
    expect(returned).not.toBe(reconnected);
    update([]);
    expect(returned.closed).toBe(true);
  });

  it("opens an in-flight story stream after selection changes", async () => {
    const stream = await opened();
    const stories = [{ title: "First", url: "https://example.test/first" }, { title: "Second", url: "https://example.test/second" }];
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, leftColumn: { now: [], recent: [{ kind: "news", stories }], semantic: [] } });
    showNews();
    let finishOpen!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => (
      url === "/api/article-chat" ? new Promise<Response>((resolve) => { finishOpen = resolve; }) : url === "/api/send" ? json({ id: "q1" }) : json({ assistantLabel: "Flyd", sessions: SESSIONS })
    ));
    const sending = type("Question?");
    await settle();
    document.querySelectorAll<HTMLElement>("#news-cols .story-chat")[1]!.click();
    finishOpen(json({ session: "article:first" }));
    await sending;
    await settle();
    const article = FakeEventSource.instances.at(-1)!;
    expect(article.url).toContain("session=article%3Afirst");
    article.emit("update", { order: ["q1", "a1"], messages: [{ id: "q1", role: "user", html: "Question?" }, { id: "a1", role: "assistant", html: "Answer.", answers: "q1" }], working: false });
    expect(document.querySelector("#news-cols .story .talk")!.textContent).toContain("Answer.");
    expect(article.closed).toBe(true);
  });

  it("keeps News selection across updates, scrolling, and an empty feed", async () => {
    const stream = await opened();
    const stories = [
      { title: "First", url: "https://example.test/first", source: "Press", media: "video" },
      { title: "Second", url: "https://example.test/second", source: "Press", media: "quote" },
    ];
    const update = (items: typeof stories) => stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, leftColumn: { now: [], recent: [{ kind: "news", stories: items, at: "2026-11-03T06:00:00Z" }], semantic: [] } });
    update(stories);
    showNews();
    const input = document.getElementById("input") as HTMLTextAreaElement;
    let cards = [...document.querySelectorAll<HTMLElement>("#news-cols .story")];
    expect(cards).toHaveLength(2);
    cards[1]!.querySelector<HTMLElement>(".story-chat")!.click();
    update([{ ...stories[0]! }, { ...stories[1]!, title: "Second updated" }]);
    expect(chip()).toBe("Second updated");
    cards = [...document.querySelectorAll<HTMLElement>("#news-cols .story")];
    // Clicking another card to read it does not change which story the box is about.
    cards[0]!.click();
    document.getElementById("news-page")!.dispatchEvent(new Event("scroll"));
    expect(chip()).toBe("Second updated");
    update([]);
    expect(input.placeholder).toBe("Message");
  });

  it("shows a quote on News once, with who said it and where it came from", async () => {
    const stream = await opened();
    const words = "Confidence is not a guarantee of success, but a pattern of thinking that will improve your likelihood of success, a tenacious search for ways to make things work.";
    const stories = [
      { title: "John Eliot", url: "https://zenquotes.io/#00df0717c2a9", source: "ZenQuotes", media: "quote", quote: words, attribution: "John Eliot", gist: words },
      { title: "Infinite Mac adds support for BeOS", url: "https://waxy.example/beos", source: "Waxy", gist: "Another dead operating system boots in a tab." },
    ];
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, leftColumn: { now: [], recent: [{ id: "record:scout-edition", kind: "news", title: "Put together today's news", stories, at: "2026-11-14T06:00:00.000Z" }], semantic: [] } });
    showNews();
    const [quote, article] = [...document.querySelectorAll<HTMLElement>("#news-cols .story")];
    expect([...quote!.querySelectorAll("p")].map((line) => line.textContent)).toEqual([`“${words}”`, "— John Eliot", "ZenQuotes"]);
    expect([...article!.querySelectorAll("p")].map((line) => line.textContent)).toEqual(["Another dead operating system boots in a tab.", "Waxy"]);
  });

  it("excludes named filler sources without filtering article URLs", async () => {
    const stream = await opened();
    const stories = [
      { title: "Reporting on Pexels", url: "https://press.example/pexels", source: "Independent Press", media: "video" },
      { title: "A Giphy investigation", url: "https://press.example/giphy", source: "Independent Press" },
      { title: "A stock image", url: "https://cdn.example/image", source: "Pexels" },
      { title: "A gif", url: "https://cdn.example/gif", source: "GIPHY" },
      { title: "Trending", url: "https://cdn.example/trend", source: "Google Trends" },
    ];
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, leftColumn: { now: [], recent: [{ kind: "news", stories: stories.slice(1), newsStories: stories, at: "2026-11-03T06:00:00Z" }], semantic: [] } });
    showNews();
    expect([...document.querySelectorAll("#news-cols .story h2")].map((node) => node.textContent)).toEqual(["Reporting on Pexels", "A Giphy investigation"]);
  });

  it("forgets the picked story when he removes it from the box", async () => {
    const stream = await opened();
    const stories = [{ title: "Left", url: "https://example.test/left" }, { title: "Right", url: "https://example.test/right" }];
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, leftColumn: { now: [], recent: [{ kind: "news", stories, at: "2026-11-03T06:00:00Z" }], semantic: [] } });
    showNews(1);
    expect(chip()).toBe("Right");
    document.getElementById("story-chip-clear")!.click();
    expect(chip()).toBe("");
    expect((document.getElementById("input") as HTMLTextAreaElement).placeholder).toBe("Message");
    expect(document.querySelector('#news-cols .story-chat[aria-pressed="true"]')).toBeNull();
  });

  it("names where an unpicked News message goes inside the box, and drops it off News", async () => {
    const stream = await opened();
    const stories = [{ title: "Left", url: "https://example.test/left" }];
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, leftColumn: { now: [], recent: [{ kind: "news", stories, at: "2026-11-03T06:00:00Z" }], semantic: [] } });
    showNews(null);
    const input = document.getElementById("input") as HTMLTextAreaElement;
    stream.emit("session", { id: "project:dir", title: "DIR", updatedAt: "2026-10-05T20:00:00.000Z", assistantLabel: "firstmate" });
    expect(input.placeholder).toBe("Message about DIR");
    expect(input.getAttribute("aria-label")).toBe("Message about DIR");
    showNews(0);
    expect(input.placeholder).toBe("Ask about this story");
    document.getElementById("story-chip-clear")!.click();
    expect(input.placeholder).toBe("Message about DIR");
    document.querySelector<HTMLElement>('.ctab[data-centre="talk"]')!.click();
    expect(input.placeholder).toBe("Message");
  });

  it("sends a News attachment without text to the article session", async () => {
    const stream = await opened();
    const stories = [{ title: "A story", url: "https://example.test/story" }];
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, leftColumn: { now: [], recent: [{ kind: "news", stories, at: "2026-11-03T06:00:00Z" }], semantic: [] } });
    showNews();
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => json(url === "/api/article-chat" ? { session: "window:article-0123456789abcdef" } : { id: "sent" }));
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [new File(["hello"], "notes.md")] } });
    document.body.dispatchEvent(drop);
    for (let i = 0; i < 20 && !document.querySelector(".attachment.file"); i += 1) await settle();
    await type("");
    const call = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").at(-1)!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ session: "window:article-0123456789abcdef", text: "", images: [], files: [{ name: "notes.md", data: btoa("hello") }] });
    expect(document.querySelector(".attachment.file")).toBeNull();
  });

  it.each(["open", "send"])("restores a failed News %s draft to its original story", async (stage) => {
    const stream = await opened();
    const stories = [{ title: "First", url: "https://example.test/first" }, { title: "Second", url: "https://example.test/second" }];
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, leftColumn: { now: [], recent: [{ kind: "news", stories, at: "2026-11-03T06:00:00Z" }], semantic: [] } });
    showNews();
    let fail!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
      if ((stage === "open" && url === "/api/article-chat") || (stage === "send" && url === "/api/send")) return new Promise<Response>((resolve) => { fail = resolve; });
      if (url === "/api/article-chat") return json({ session: "window:article-0123456789abcdef" });
      return json({});
    });
    await type("Question for first");
    document.querySelectorAll<HTMLElement>("#news-cols .story-chat")[1]!.click();
    fail(json({ error: "failed" }, 500));
    await settle();
    const input = document.getElementById("input") as HTMLTextAreaElement;
    expect(input.value).toBe("Question for first");
    expect(chip()).toBe("First");
  });

  it("keeps a new draft when an earlier News send fails", async () => {
    const stream = await opened();
    const stories = [{ title: "First", url: "https://example.test/first" }, { title: "Second", url: "https://example.test/second" }];
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, leftColumn: { now: [], recent: [{ kind: "news", stories, at: "2026-11-03T06:00:00Z" }], semantic: [] } });
    showNews();
    let fail!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => url === "/api/article-chat" ? new Promise<Response>((resolve) => { fail = resolve; }) : json({}));
    await type("Earlier question");
    document.querySelectorAll<HTMLElement>("#news-cols .story-chat")[1]!.click();
    const input = document.getElementById("input") as HTMLTextAreaElement;
    input.value = "New question";
    fail(json({ error: "failed" }, 500));
    await settle();
    expect(input.value).toBe("New question");
    expect(chip()).toBe("Second");
    input.value = "";
    document.querySelector<HTMLButtonElement>("#news-cols .talk button")!.click();
    expect(input.value).toBe("Earlier question");
    expect(chip()).toBe("First");
  });

  it("treats a lost News send response as uncertain and shows delivery warnings", async () => {
    const stream = await opened();
    const stories = [{ title: "A story", url: "https://example.test/story" }];
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, leftColumn: { now: [], recent: [{ kind: "news", stories, at: "2026-11-03T06:00:00Z" }], semantic: [] } });
    showNews();
    let attempts = 0;
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
      if (url === "/api/article-chat") return json({ session: "window:article-0123456789abcdef" });
      if (url === "/api/send") { if (++attempts === 1) throw new Error("connection lost"); return json({ id: "sent", warning: "not woken" }); }
      return json({ token: "a".repeat(48) });
    });
    await type("Remember this");
    expect(document.querySelector("#news-cols .talk")!.textContent).toContain("May not have sent");
    expect((document.getElementById("input") as HTMLTextAreaElement).value).toBe("");
    expect(attempts).toBe(1);
    document.querySelector<HTMLButtonElement>("#news-cols .talk button")!.click();
    await settle();
    expect(attempts).toBe(2);
    expect(document.querySelector("#news-cols .talk")!.textContent).toContain("Saved, but not passed on yet");
  });

  it("keeps News delivery uncertain without a receipt, even for similar messages", async () => {
    const stream = await opened();
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, leftColumn: { now: [], recent: [{ kind: "news", stories: [{ title: "A story", url: "https://example.test/story" }], at: "2026-11-03T06:00:00Z" }], semantic: [] } });
    showNews();
    let rejectSend!: (error: Error) => void;
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
      if (url === "/api/article-chat") return json({ session: "window:article-0123456789abcdef" });
      if (url === "/api/send") return new Promise<Response>((_, reject) => { rejectSend = reject; });
      return json({ token: "a".repeat(48) });
    });
    await type("再见");
    const article = FakeEventSource.instances.at(-1)!;
    article.emit("update", { order: ["old"], messages: [{ id: "old", role: "user", html: "<p>An older question</p>", timestamp: new Date(Date.now() - 60000).toISOString() }], working: false });
    expect(document.querySelector("#news-cols .talk")!.textContent).toContain("再见");
    article.emit("update", { order: ["old", "saved"], messages: [{ id: "old", role: "user", html: "<p>An older question</p>", timestamp: new Date(Date.now() - 60000).toISOString() }, { id: "saved", role: "user", html: "<p>你好</p>", timestamp: new Date().toISOString() }], working: false });
    rejectSend(new Error("response lost"));
    await settle();
    expect(document.querySelector("#news-cols .talk")!.textContent).toContain("再见");
    expect(document.querySelector("#news-cols .talk")!.textContent).toContain("May not have sent");
    expect(document.querySelector("#news-cols .talk button")).not.toBeNull();
    expect(document.querySelectorAll("#news-cols .talk .q.pending")).toHaveLength(1);
  });

  it("retains a successful News question until its receipt appears", async () => {
    const stream = await opened();
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, leftColumn: { now: [], recent: [{ kind: "news", stories: [{ title: "A story", url: "https://example.test/story" }], at: "2026-11-03T06:00:00Z" }], semantic: [] } });
    showNews();
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => json(url === "/api/article-chat" ? { session: "window:article-0123456789abcdef" } : { id: "new" }));
    await type("A new question");
    const article = FakeEventSource.instances.at(-1)!;
    article.emit("update", { order: ["old"], messages: [{ id: "old", role: "user", html: "<p>Earlier</p>" }], working: false });
    expect(document.querySelector("#news-cols .q.pending")!.textContent).toBe("A new question");
    article.emit("update", { order: ["old", "new"], messages: [{ id: "old", role: "user", html: "<p>Earlier</p>" }, { id: "new", role: "user", html: "<p>A new question</p>" }], working: false });
    expect(document.querySelector("#news-cols .q.pending")).toBeNull();
    expect(document.querySelector("#news-cols .talk")!.textContent).toContain("A new question");
  });

  it("shows News image and document attachments before and after their receipt", async () => {
    const stream = await opened();
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, leftColumn: { now: [], recent: [{ kind: "news", stories: [{ title: "A story", url: "https://example.test/story" }], at: "2026-11-03T06:00:00Z" }], semantic: [] } });
    showNews();
    let reply!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
      if (url === "/api/article-chat") return json({ session: "window:article-0123456789abcdef" });
      if (url === "/api/send") return new Promise<Response>((resolve) => { reply = resolve; });
      return json({});
    });
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [new File(["picture"], "image.png", { type: "image/png" }), new File(["notes"], "notes.md")] } });
    document.body.dispatchEvent(drop);
    for (let i = 0; i < 20 && document.querySelectorAll("#attachments .attachment").length < 2; i += 1) await settle();
    await type("See these");
    expect(document.querySelector("#news-cols .q.pending .shot img")!.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(document.querySelector("#news-cols .q.pending .doc .name")!.textContent).toBe("notes.md");
    const article = FakeEventSource.instances.at(-1)!;
    article.emit("update", { order: ["saved"], messages: [{ id: "saved", role: "user", html: "<p>See these</p>", images: ["t1.0"], files: ["notes.md"] }], working: false });
    expect(document.querySelector("#news-cols .q.pending")).not.toBeNull();
    reply(json({ id: "saved" }));
    await settle();
    expect(document.querySelector("#news-cols .q.pending")).toBeNull();
    expect(document.querySelector("#news-cols .q .shot img")!.getAttribute("src")).toBe("/api/image?session=window%3Aarticle-0123456789abcdef&id=t1.0");
    expect(document.querySelector("#news-cols .q .doc .name")!.textContent).toBe("notes.md");
  });

  it("shows only the selected News session's confirmation", async () => {
    const stream = await opened();
    const stories = [{ title: "First", url: "https://example.test/first" }, { title: "Second", url: "https://example.test/second" }];
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, leftColumn: { now: [], recent: [{ kind: "news", stories, at: "2026-11-03T06:00:00Z" }], semantic: [] } });
    showNews();
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => json(url === "/api/article-chat" ? { session: "window:article-0123456789abcdef" } : { id: "sent" }));
    await type("Remember this");
    const article = FakeEventSource.instances.at(-1)!;
    article.emit("update", { order: [], messages: [], working: true, confirm: { id: "confirm-news", prompt: "Remember this?" } });
    const bar = document.getElementById("article-confirm")!;
    expect(bar.hidden).toBe(false);
    stream.emit("update", { order: ["u1"], messages: [], working: false });
    expect(bar.textContent).toContain("Remember this?");
    const cards = [...document.querySelectorAll<HTMLElement>("#news-cols .story")];
    cards[1]!.querySelector<HTMLElement>(".story-chat")!.click();
    expect(bar.hidden).toBe(true);
    cards[0]!.querySelector<HTMLElement>(".story-chat")!.click();
    expect(bar.hidden).toBe(false);
    document.getElementById("article-confirm-yes")!.click();
    await settle();
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/article-confirm")!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ id: "confirm-news", allow: true });
  });

  it("shows and sends quote and statistic content to article chat", async () => {
    const stream = await opened();
    const stories = [
      { title: "A quote", url: "https://example.test/quote", media: "quote", quote: "Keep going", attribution: "Ada", gist: "A remark" },
      { title: "A statistic", url: "https://example.test/stat", media: "stat", figure: "42%", gist: "A result" },
    ];
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, leftColumn: { now: [], recent: [{ kind: "news", stories, at: "2026-11-03T06:00:00Z" }], semantic: [] } });
    showNews();
    const cards = [...document.querySelectorAll<HTMLElement>("#news-cols .story")];
    expect(cards[0]!.textContent).toContain("Keep going");
    expect(cards[0]!.textContent).toContain("Ada");
    expect(cards[1]!.textContent).toContain("42%");
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => json(url === "/api/article-chat" ? { session: "window:article-0123456789abcdef" } : { id: "u9" }));
    cards[0]!.querySelector<HTMLElement>(".story-chat")!.click();
    await type("What did she mean?");
    cards[1]!.querySelector<HTMLElement>(".story-chat")!.click();
    await type("What does it measure?");
    const openedStories = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/article-chat").map(([, init]) => JSON.parse(String(init!.body)));
    expect(openedStories).toMatchObject([{ text: "Keep going", attribution: "Ada" }, { text: "A result", figure: "42%" }]);
  });

  it("retries weather after an initially empty reading", async () => {
    let reads = 0;
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
      if (!String(url).startsWith("/api/weather?")) return json({ assistantLabel: "Flyd", sessions: SESSIONS });
      reads++;
      return json({ weather: reads === 1 ? null : { place: "Canggu", tempC: 29, code: 0, read: "2026-11-07T05:00:00Z", hours: [] } });
    });
    await opened();
    showNews();
    await settle();
    expect(document.querySelector("#news-side .wxcard")).toBeNull();
    document.querySelector<HTMLElement>('.ctab[data-centre="talk"]')!.click();
    showNews();
    await settle();
    expect(document.querySelector("#news-side .wx-deg")!.textContent).toBe("29°");
  });

  it("draws the weather card for the week, and a day or an hour sets the big reading", async () => {
    const weather = {
      place: "Canggu", tempC: 29.2, code: 0, condition: "clear", read: "2026-11-07T05:00:00.000Z", localTime: "13:00", hours: [],
      days: [
        { date: "2026-11-07", code: 61, hiC: 32, loC: 25, hours: [{ at: "2026-11-07T14:00", tempC: 29, rainChance: 88, code: 61 }, { at: "2026-11-07T16:00", tempC: 28.6, rainChance: 99, code: 3 }] },
        { date: "2026-11-08", code: 95, hiC: 30.4, loC: 24, hours: [{ at: "2026-11-08T06:00", tempC: 25, rainChance: 11, code: 1 }] },
      ],
    };
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => json(String(url).startsWith("/api/weather?") ? { weather } : { assistantLabel: "Flyd", sessions: SESSIONS }));
    await opened();
    showNews();
    await settle();
    const card = () => document.querySelector<HTMLElement>("#news-side .wxcard")!;
    expect(card().querySelector(".wx-place")!.textContent).toBe("Canggu");
    expect(card().querySelector(".wx-top time")!.textContent).toBe("13:00");
    expect(card().querySelector(".wx-deg")!.textContent).toBe("29°");
    expect([...card().querySelectorAll(".wx-days button")].map((day) => day.querySelector("time")!.textContent)).toEqual(["Today", expect.any(String)]);
    expect([...card().querySelectorAll(".wx-hours span")].map((rain) => rain.textContent)).toEqual(["88%", "99%"]);
    card().querySelector<HTMLElement>('[data-hour="1"]')!.click();
    expect(card().querySelector(".wx-deg")!.textContent).toBe("29°");
    expect(card().querySelector(".wx-top time")!.textContent).toBe("Today 16:00");
    card().querySelector<HTMLElement>('[data-day="0"]')!.click();
    expect(card().querySelector(".wx-deg")!.textContent).toBe("32°");
    card().querySelector<HTMLElement>('[data-day="1"]')!.click();
    expect(card().querySelector(".wx-deg")!.textContent).toBe("30°");
    expect(card().querySelector('[data-day="1"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(card().querySelectorAll(".wx-hours li")).toHaveLength(1);
    // The phone's copy sits above the stories.
    expect(document.querySelector("#news-side-phone .wxcard")).not.toBeNull();
  });

  it("selects a displayed fallback hour without daily forecasts", async () => {
    const weather = { place: "Canggu", tempC: 29, code: 0, read: "2026-11-07T05:00:00Z", hours: [
      { at: "2026-11-07T14:00", tempC: 29, rainChance: 0 },
      { at: "2026-11-07T15:00", tempC: 26, rainChance: 30, code: 61 },
    ] };
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => json(String(url).startsWith("/api/weather?") ? { weather } : { assistantLabel: "Flyd", sessions: SESSIONS }));
    await opened();
    showNews();
    await settle();
    document.querySelector<HTMLElement>('#news-side [data-hour="0"]')!.click();
    expect(document.querySelector("#news-side .wx-deg")!.textContent).toBe("26°");
    expect(document.querySelector("#news-side .wx-top time")!.textContent).toBe("Today 15:00");
  });

  it("says a job's next step in real counts or Flyd's own pick, and nothing when it has neither", async () => {
    const stream = await opened();
    const decision = PICK.decision;
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, jobs: [
      { ...PICK, id: "call:dir", decision: { ...decision, decisions: [{ question: "Numbers", options: ["Yes"], done: "Done" }, { question: "Clock", options: ["Yes"] }, { question: "Dial", options: ["Yes"] }] } },
      { ...PICK, id: "call:radio", decision: { ...decision, task: "radio", decisionId: "d9", recommended: "Radio" } },
      { ...PICK, id: "call:plain", decision: { ...decision, task: "plain", decisionId: "d8" } },
    ] });
    const act = (id: string) => document.querySelector(`.job[data-job="${id}"] .act`)?.textContent ?? null;
    expect(act("call:dir")).toBe("1 of 3 decided");
    expect(act("call:radio")).toBe("Go with Radio");
    expect(act("call:plain")).toBeNull();
  });

  it("keeps Moving for work under way, folds what waits under a closed Next, and shows no bare finished card", async () => {
    const stream = await opened();
    const job = (over: Record<string, unknown>) => ({ project: "", next: "", owner: "", ask: "", because: "", shots: [], links: [], files: [], threads: [], digest: null, at: new Date().toISOString(), ...over });
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, jobsFleetKnown: true, jobs: [
      job({ id: "run", group: "moving", state: "Working", title: "Under way" }),
      job({ id: "queued", group: "moving", state: "Queued", title: "Next in line" }),
      job({ id: "held", group: "moving", state: "Blocked", title: "Held up" }),
      job({ id: "bare", group: "done", state: "Done", title: "Finished", next: "This is done.", bare: true }),
    ] });
    expect(groups()).toEqual([["Needs you", "No decision is waiting."], ["Now", 1], ["Made", "Nothing made yet."], ["Next", 2]]);
    const next = document.querySelector<HTMLDetailsElement>("#jobs-list details.fnext")!;
    expect(next.open).toBe(false);
    expect(document.querySelector('#stream > .msg.work[data-job="bare"]')).toBeNull();
  });

  it("tells what is moving as one whole line a job, with a small dot whose rollover says where it stands, and lets a changed line rise in", async () => {
    const stream = await opened();
    const job = (over: Record<string, unknown>) => ({ project: "Logan", next: "", owner: "", ask: "", because: "", shots: [], links: [], files: [], threads: [], digest: null, at: new Date().toISOString(), ...over });
    const said = "The swatch row is back at the top of the colour panel. The smart swatches sit underneath it and the HSB sliders below them, on a branch.";
    const board = (next: string) => stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, jobsFleetKnown: true, jobs: [
      job({ id: "logan", group: "moving", state: "Working", title: "Logan swatches", next }),
    ] });
    board(said);
    const line = document.querySelector<HTMLElement>('#jobs-list .job.line[data-job="logan"]')!;
    expect(line.querySelector(".jproject")!.textContent).toBe("Logan");
    expect(line.querySelector(".next")!.textContent).toBe("The swatch row is back at the top of the colour panel.");
    expect(line.textContent).not.toContain("…");
    // No word for its state: the dot says it when pointed at, and no picture rides on a line.
    expect(line.querySelector(".ldot")!.getAttribute("title")).toMatch(/^Working in Logan, /);
    expect(line.textContent).not.toContain("Working");
    expect(line.querySelector("img")).toBeNull();
    expect(line.querySelector(".next")!.classList.contains("swap-in")).toBe(false);
    board("Sliders now sit under the swatches.");
    expect(document.querySelector('#jobs-list .job.line[data-job="logan"] .next')!.classList.contains("swap-in")).toBe(true);
    // On a phone the same line leads the one live strip, named by its project.
    expect(document.getElementById("now-strip")!.hidden).toBe(false);
    expect(document.getElementById("now-strip-text")!.textContent).toBe("Logan: Sliders now sit under the swatches.");
  });

  it("follows the chat once it settles: says what it looks for over shimmer, then Scout's stories and the Evidence Engine's finds arrive, and Find more looks again", async () => {
    const asked: string[] = [];
    let answer: (response: Response) => void = () => {};
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
      // An earlier test's page may still look up its own talk; only this page's is counted.
      if (String(url).startsWith("/api/inspirations?q=Logan")) { asked.push(String(url)); return new Promise<Response>((resolve) => { answer = resolve; }); }
      return json({ assistantLabel: "firstmate", sessions: SESSIONS });
    });
    load("");
    await settle();
    const stream = open("latest", [{ id: "u1", role: "user", html: "<p>Where are we with the Logan swatches?</p>" }]);
    const story = (title: string, media: string, gist = "Colour in practice.") => ({ title, url: "https://example.com/" + media, source: "Design weekly", gist, image: "/api/story-image?u=" + media, media });
    const board = () => stream.emit("update", {
      order: ["u1"], messages: [], working: false, show: SHOW, jobs: [], jobsFleetKnown: true,
      rail: { conversations: [], artefacts: [{ id: "a1", title: "Logan swatches screenshot", line: "Colour panel", image: "/api/rail-image?f=1", at: "2026-10-24T09:00:00.000Z" }] },
      leftColumn: { now: [], semantic: [], recent: [{ id: "record:scout-edition", kind: "news", title: "Today's news", at: "2026-10-24T06:00:00.000Z",
        stories: [story("Swatches that teach colour", "image"), story("Why Logan swatches beat pickers", "text"), story("Unrelated market news", "image", "Rates held steady.")] }] },
    });
    board();
    await settle();
    const section = () => document.querySelector<HTMLElement>("#jobs-list .fchat")!;
    const titles = () => Array.from(section().querySelectorAll(".ccard .ctitle"), (title) => title.textContent);
    expect(section().querySelector(".fhead span")!.textContent).toBe("For this chat");
    expect(section().querySelector(".fterms")!.textContent).toBe("Looking for Logan, swatches…");
    expect(section().querySelectorAll(".ccard.shimmer")).toHaveLength(1);
    expect(section().querySelector("[data-chat-more]")).toBeNull();
    expect(asked).toHaveLength(1);
    expect(new URL(asked[0]!, "http://view").searchParams.get("q")).toBe("Logan,swatches");
    expect(titles()).not.toContain("Unrelated market news");
    answer(json({ terms: ["Logan", "swatches"], items: [{ kind: "Video", title: "Swatch pickers compared", text: "Ten pickers side by side.", by: "youtube.com", at: "", url: "https://www.youtube.com/watch?v=1" }] }));
    await settle();
    expect(section().querySelector(".fterms")!.textContent).toBe("From Logan, swatches");
    expect(section().querySelectorAll(".ccard.shimmer")).toHaveLength(0);
    const found = Array.from(section().querySelectorAll<HTMLElement>(".ccard")).find((card) => card.querySelector(".ctitle")!.textContent === "Swatch pickers compared")!;
    expect(found.getAttribute("href")).toBe("https://www.youtube.com/watch?v=1");
    expect(found.querySelector(".cby")!.textContent).toBe("Video · youtube.com");
    const titled = (title: string) => Array.from(section().querySelectorAll<HTMLElement>(".ccard")).find((card) => card.querySelector(".ctitle")!.textContent === title)!;
    // A story whose picture is the story shows it; one that only has a picture, and Flyd's own screenshot, are words.
    expect(titled("Swatches that teach colour").querySelector("img")).not.toBeNull();
    expect(titled("Why Logan swatches beat pickers").querySelector("img")).toBeNull();
    expect(titled("Logan swatches screenshot").querySelector("img")).toBeNull();
    // The same talk drawn again looks nothing up; Find more does.
    board();
    await settle();
    expect(asked).toHaveLength(1);
    section().querySelector<HTMLElement>("[data-chat-more]")!.click();
    await settle();
    expect(asked).toHaveLength(2);
    expect(section().querySelector(".fterms")!.textContent).toBe("Looking for Logan, swatches…");
  });

  it("keeps his newest Made artefacts on the home column as the Made tab draws them, whatever order they arrive in", async () => {
    const stream = await opened();
    const art = (n: number, over: Record<string, unknown> = {}) => ({ id: `a${n}`, title: `Take ${n}`, line: `Line ${n}`, image: `/api/rail-image?f=${n}`, url: `https://example.com/${n}`, at: new Date(Date.now() - n * 60_000).toISOString(), ...over });
    const artefacts = [
      art(9, { at: undefined }), art(6), art(3, { image: undefined, url: undefined, steps: ["one"] }), art(4, { down: true }),
      art(1), art(2, { image: undefined, preview: "http://127.0.0.1:8097/", at: new Date(Date.now() - 2 * 60_000).toISOString() }),
      art(7, { id: "landed:pr", image: undefined }),
    ];
    const update = (next: string) => stream.emit("update", {
      order: ["u1"], messages: [], working: false, show: SHOW, jobsFleetKnown: true,
      jobs: [{ id: "run", group: "moving", state: "Working", title: "Under way", project: "Logan", next, owner: "", ask: "", because: "", shots: [], links: [], files: [], threads: [], digest: null, at: new Date().toISOString() }],
      rail: { conversations: [], artefacts },
    });
    update("Wiring it");
    expect(document.documentElement.getAttribute("data-rtab")).toBe("jobs");
    expect(groups().map(([name]) => name)).toEqual(["Needs you", "Now", "Made"]);
    const made = document.querySelector<HTMLElement>("#jobs-list .fmade")!;
    expect(made.querySelector(".fhead span:last-child")!.textContent).toBe("5");
    const cards = Array.from(made.querySelectorAll<HTMLElement>(".art-card"));
    expect(cards.map((card) => card.querySelector(".art-title")!.textContent)).toEqual(["Take 1", "Take 2", "Take 6"]);
    expect(cards[0]!.querySelector("a.art-pic")!.getAttribute("href")).toBe("https://example.com/1");
    expect(cards[0]!.querySelector(".art-pic img")).not.toBeNull();
    const frame = cards[1]!.querySelector<HTMLIFrameElement>("iframe")!;
    expect(frame.getAttribute("src")).toBe("http://127.0.0.1:8097/");
    update("Testing it");
    expect(document.querySelector("#jobs-list .job.line .next")!.textContent).toBe("Testing it");
    expect(document.querySelector("#jobs-list .fmade iframe")).toBe(frame);
    const all = made.querySelector<HTMLElement>("[data-made-all]")!;
    expect(all.textContent).toBe("See all");
    all.click();
    expect(document.documentElement.getAttribute("data-rtab")).toBe("arts");
    expect(document.querySelectorAll("#artefacts .art-card")).toHaveLength(6);
  });

  it("brings the whole Made list into view from the phone sheet's See all, and leaves the desktop's scroll alone", async () => {
    let phone = true;
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: phone && query.includes("760px"), media: query, addEventListener() {}, removeEventListener() {} }));
    const shown: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) { shown.push(this.id); };
    try {
      const stream = await opened();
      stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, jobs: [], jobsFleetKnown: true, rail: { conversations: [], artefacts: [1, 2, 3, 4].map((n) => ({ id: `a${n}`, title: `Take ${n}` })) } });
      const seeAll = () => document.querySelector<HTMLElement>("[data-made-all]")!.click();
      document.getElementById("now-strip")!.click();
      seeAll();
      expect(document.documentElement.hasAttribute("data-sheet")).toBe(false);
      expect(document.documentElement.getAttribute("data-rtab")).toBe("arts");
      expect(shown).toEqual(["artefacts"]);
      phone = false;
      seeAll();
      expect(shown).toEqual(["artefacts"]);
    } finally {
      Element.prototype.scrollIntoView = original;
      vi.unstubAllGlobals();
    }
  });

  it("puts undated artefacts after dated ones in Made, and says nothing was made only when nothing was", async () => {
    const stream = await opened();
    const update = (artefacts: unknown[]) => stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, jobs: [], jobsFleetKnown: true, rail: { conversations: [], artefacts } });
    const madeGroup = () => groups().find(([name]) => name === "Made")!;
    update([]);
    expect(madeGroup()[1]).toBe("Nothing made yet.");
    update([{ id: "board", title: "Board" }, { id: "old", title: "Old", at: "2026-01-01T00:00:00.000Z" }]);
    expect(madeGroup()[1]).not.toBe("Nothing made yet.");
    expect([...document.querySelectorAll("#jobs-list .fmade .art-title")].map((title) => title.textContent)).toEqual(["Old", "Board"]);
  });

  it("shows only finished artefacts in Made, and a worker's status change never redraws it", async () => {
    const stream = await opened();
    const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    const running = (line: string, minutes: number) => [1, 2, 3].map((n) => ({ id: `live:live-job-${n}`, title: `Running ${n}`, line, image: "/api/rail-image?f=9", at: at(minutes) }));
    const unfinished = [
      { id: "waiting:held-a", title: "Held", at: at(0) }, { id: "next:next-gate", title: "Queued", at: at(0) },
      { id: "live:http://127.0.0.1:1/", title: "Down", url: "http://127.0.0.1:1/", down: true, at: at(0) },
      { id: "live:http://127.0.0.1:2/", title: "Checking", url: "http://127.0.0.1:2/", checking: true, at: at(0) },
      { id: "live:http://127.0.0.1:3/", title: "Blocked", url: "http://127.0.0.1:3/", blocked: true, at: at(0) },
    ];
    const made = [
      { id: "reply:words", title: "Words", steps: ["one"], at: at(5) },
      { id: "page", title: "Page", image: "/api/rail-image?f=1", at: at(30) },
      { id: "live:http://127.0.0.1:8097/", title: "Board", preview: "http://127.0.0.1:8097/", at: at(20) },
      { id: "landed:landed-pr", title: "Shot", image: "/api/rail-image?f=2", at: at(10) },
    ];
    const update = (artefacts: unknown[]) => stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, jobs: [], jobsFleetKnown: true, rail: { conversations: [], artefacts } });
    const titles = () => [...document.querySelectorAll("#jobs-list .fmade .art-title")].map((title) => title.textContent);
    update([...running("Wiring", 1), ...unfinished, ...made]);
    expect(titles()).toEqual(["Shot", "Board", "Page"]);
    expect(document.querySelector("#jobs-list .fmade .fhead span:last-child")!.textContent).toBe("4");
    expect(document.querySelector("[data-made-all]")!.textContent).toBe("See all");
    const drawn = [...document.querySelectorAll("#jobs-list .fmade, #jobs-list .fmade .art-card, #jobs-list .fmade iframe")];
    expect(drawn).toHaveLength(5);
    update([...running("Testing", 0), ...unfinished, ...made]);
    expect([...document.querySelectorAll("#jobs-list .fmade, #jobs-list .fmade .art-card, #jobs-list .fmade iframe")].every((node, n) => node === drawn[n])).toBe(true);
    // The Made tab still lists everything.
    expect([...document.querySelectorAll("#artefacts .art-title")].map((title) => title.textContent)).toContain("Running 1");
    // A finished artefact with no picture fills a place the pictures leave.
    update([...made.slice(0, 2), ...unfinished]);
    expect(titles()).toEqual(["Page", "Words"]);
    expect(document.querySelector("#jobs-list .fmade .art-steps")!.textContent).toBe("one");
    update([...running("Wiring", 0), ...unfinished]);
    expect(groups().find(([name]) => name === "Made")![1]).toBe("Nothing made yet.");
  });

  it("keeps the phone's live line, and so the sheet, within reach when nothing is under way", async () => {
    const stream = await opened();
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, jobs: [], jobsFleetKnown: true });
    const strip = document.getElementById("now-strip")!;
    expect(strip.hidden).toBe(false);
    expect(document.getElementById("now-strip-text")!.textContent).toBe("Nothing is under way right now.");
    strip.click();
    expect(document.documentElement.hasAttribute("data-sheet")).toBe(true);
  });

  it("draws the sidebar's lines and headings whole, with no eyebrow and no side accent line", async () => {
    document.head.innerHTML = /<style>([\s\S]*?)<\/style>/.exec(renderPage({ assistantLabel: "firstmate", sendToken: "a".repeat(48) }))![0];
    document.documentElement.setAttribute("data-layout", "front");
    const stream = await opened();
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, jobsFleetKnown: true, jobs: [
      { id: "logan", group: "moving", state: "Working", title: "Logan swatches", project: "Logan", next: "Sliders now sit under the swatches.", owner: "", ask: "", because: "", shots: [], links: [], files: [], threads: [], digest: null, at: new Date().toISOString() },
    ] });
    const line = document.querySelector<HTMLElement>('#jobs-list .job.line[data-job="logan"]')!;
    // The stylesheet is in force: the dot is the small fixed size it is drawn at.
    expect(getComputedStyle(line.querySelector(".ldot")!).width).toBe("6px");
    for (const shown of [line.querySelector(".jproject")!, line.querySelector(".next")!, line, document.querySelector("#jobs-list .fhead")!]) {
      const style = getComputedStyle(shown);
      expect(style.textOverflow).not.toBe("ellipsis");
      expect(style.textTransform).not.toBe("uppercase");
      const accent = parseFloat(style.borderLeftWidth || "0") > 0 && !["", "none", "hidden", "initial"].includes(style.borderLeftStyle);
      expect(accent, shown.className).toBe(false);
    }
    document.head.innerHTML = "";
    document.documentElement.removeAttribute("data-layout");
  });

  it("opens a project's thread from the message box with its shortcut, /flyd, instead of sending it", async () => {
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => (
      url === "/api/projects" ? json({ ready: true, projects: [{ id: "project:flyd", name: "Flyd", count: 2 }, { id: "project:good-neighbours-market", name: "Good Neighbours Market", count: 1 }] })
        : url === "/api/commands" ? json({ commands: COMMANDS }) : url === "/api/send" ? json(sendResponse) : json({ assistantLabel: "firstmate", sessions: SESSIONS })
    ));
    load("");
    await settle();
    open("latest", []);
    const input = document.getElementById("input") as HTMLTextAreaElement;
    input.value = "/fl";
    input.dispatchEvent(new Event("input"));
    await settle();
    const menu = document.getElementById("commands")!;
    expect(menu.hidden).toBe(false);
    expect(menu.querySelector("li.project .name")!.textContent).toBe("/flyd");
    await type("/flyd");
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/send")).toBe(false);
    expect(FakeEventSource.instances.at(-1)!.url).toContain("session=project%3Aflyd");
    expect(input.value).toBe("");
  });

  it("lists Core's board as cards in three places, and an unread board as unknown rather than empty", async () => {
    const stream = await opened();
    // The conversation is the middle of the page, not a card: he starts one by typing in it.
    expect(document.querySelector("#jobs-list")!.textContent).toBe("Checking…");
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, jobs: BOARD });
    // What finished reads as a line in Now, under what is under way.
    expect(groups()).toEqual([["Needs you", 1], ["Now", 1], ["Made", "Nothing made yet."]]);
    const needs = document.querySelector<HTMLElement>('.job[data-job="call:pick"]')!;
    expect(needs.querySelector(".frame img")).not.toBeNull();
    // Under "Needs you" the dot says it; the card names the project.
    expect(needs.querySelector(".s")).toBeNull();
    expect(needs.querySelector(".jproject")!.textContent).toBe("CopyCopy");
    expect(document.getElementById("stage-crumb")!.textContent).not.toContain("With firstmate");
    expect(document.getElementById("stage-sub")!.textContent).toContain("With firstmate");
  });

  it("opens one job on the sheet, with its pictures, its choices and its own box, and Escape brings the conversation back", async () => {
    const stream = await opened();
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, jobs: BOARD });
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
    stream.emit("update", { order: ["u1"], messages: [], working: false, show: SHOW, jobs: BOARD });
    document.querySelector<HTMLElement>('.ctab[data-centre="talk"]')!.click();
    after(() => document.querySelector<HTMLElement>('.job[data-job="call:pick"]')!.click());
    expect(document.documentElement.getAttribute("data-job")).toBe("call:pick");
    expect(sessionStorage.getItem("flyd-front-job")).toBe("call:pick");
    const back = document.querySelector<HTMLButtonElement>("#stage-head button#stage-back")!;
    expect(back.textContent).toBe("Back to the conversation");
    after(() => back.click());
    expect(document.documentElement.getAttribute("data-centre")).toBe("talk");
    expect(document.documentElement.hasAttribute("data-job")).toBe(false);
    expect(sessionStorage.getItem("flyd-front-job")).toBe("talk");
    expect(document.querySelector(".job.on")).toBeNull();
  });

  it("keeps a job card to its project, its time and two or three lines, with all of it in the open job", async () => {
    const stream = await opened();
    const long = "PostTraction's security certificate expired on 15 September and auto-renewal has failed since, so browsers block the site and every visitor sees a warning";
    const title = "Redesign how Flyd surfaces items in the conversation view's Held up modal and the brief feed, starting by inspecting the current rendering";
    const done = "Nothing";
    const needed = "Reply OK to inspect the server. A worker can then log in read-only, verify the expired certificate, investigate renewal, and bring back an exact list of fixes with the evidence needed to choose the next step.";
    stream.emit("update", {
      order: ["u1"], messages: [], working: false, jobsFleetKnown: true,
      show: { title: "", summary: "", items: [], counts: {}, live: false },
      jobs: [{
        id: "cleanx", group: "needs", state: "Needs you", title, project: "Product", at: "2026-10-26T12:00:00.000Z",
        next: "", owner: "you", ask: "", because: "", shots: [], links: [], files: [], threads: [],
        digest: { changed: long, means: long, needed },
      }, {
        id: "landed", group: "done", state: "Landed", title: "Logan", project: "Product", at: "2026-10-26T12:00:00.000Z",
        next: "", owner: "", ask: "", because: "", shots: [], links: [], files: [], threads: [],
        digest: { changed: "Pages are live.", means: long, needed: done },
      }],
    });
    const card = document.querySelector<HTMLElement>('.job[data-job="cleanx"]')!;
    expect(card.querySelectorAll("p")).toHaveLength(1);
    // Two or three lines read well: the whole step he needs to take, not a line cut at 52 characters.
    expect(card.querySelector(".next")!.textContent).toBe(needed);
    expect(card.querySelector(".jproject")!.textContent).toBe("Product");
    expect(card.textContent).not.toContain("PostTraction");
    expect(document.querySelector('.job[data-job="landed"] .next')!.textContent).toBe("Pages are live.");
    after(() => card.click());
    expect(document.querySelector(".job-view")!.textContent).toContain(long);
  });

  it("sends the current full question and run after a job update", async () => {
    const stream = await opened();
    const prefix = "A".repeat(200);
    const job = { id: "research", group: "needs", state: "Needs you", title: "Research", project: "", at: "2026-10-26T12:00:00.000Z", next: prefix, owner: "you", ask: prefix, because: "", shots: [], links: [], files: [], threads: [], digest: null, domainRun: "run-1", questionIdentity: `${prefix} old` };
    const update = (next: typeof job) => stream.emit("update", { order: ["u1"], messages: [], working: false, jobsFleetKnown: true, show: { title: "", summary: "", items: [], counts: {}, live: false }, jobs: [next] });
    update(job);
    after(() => document.querySelector<HTMLElement>('.job[data-job="research"]')!.click());
    update({ ...job, domainRun: "run-2", questionIdentity: `${prefix} new` });
    const form = document.querySelector<HTMLFormElement>(".job-view .art-chat")!;
    const input = form.querySelector<HTMLTextAreaElement>("textarea")!;
    input.value = "Yes";
    input.dispatchEvent(new Event("input"));
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    const request = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").at(-1)!;
    expect(JSON.parse(String(request[1]!.body))).toMatchObject({ domainRun: "run-2", questionText: `${prefix} new`, text: "Yes" });
  });

  it("puts a decision's named answers on its card as buttons, recommended first, sent as if typed", async () => {
    const stream = await opened();
    const job = {
      id: "board", group: "needs", state: "Needs you", title: "Show the existing Liesel board", project: "", at: "2026-10-26T12:00:00.000Z", next: "", owner: "you", ask: "Waiting on your go-ahead.", because: "",
      shots: [], links: [], files: [], threads: [], domainRun: "run-9", questionIdentity: "Waiting on your go-ahead.",
      digest: { changed: "The board is finished.", needed: "Say yes to merge it, which I recommend, or tell me to leave it unmerged." },
      choices: ["Yes", "Leave it unmerged"], recommended: "Yes",
    };
    stream.emit("update", { order: ["u1"], messages: [], working: false, jobsFleetKnown: true, show: { title: "", summary: "", items: [], counts: {}, live: false }, jobs: [job] });
    const picks = () => [...document.querySelectorAll<HTMLButtonElement>('.jobask .jpick[data-pick-job="board"]')];
    expect(picks().map((button) => button.textContent)).toEqual(["Yes", "Leave it unmerged"]);
    expect(picks()[0]!.classList.contains("primary")).toBe(true);
    // The buttons are beside the card, never inside its own button.
    expect(document.querySelector(".job .jpick")).toBeNull();
    picks()[1]!.click();
    await settle();
    const request = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").at(-1)!;
    expect(JSON.parse(String(request[1]!.body))).toMatchObject({ domainRun: "run-9", questionText: "Waiting on your go-ahead.", text: "Leave it unmerged" });
    expect(picks().every((button) => button.disabled)).toBe(true);
    expect(picks()[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".jobask .jsent")!.textContent).toMatch(/^Sent to /);
    // The open job offers the same answers over its box, already answered.
    after(() => document.querySelector<HTMLElement>('.job[data-job="board"]')!.click());
    const open = [...document.querySelectorAll<HTMLButtonElement>(".job-view .choice-pick")];
    expect(open.map((button) => button.textContent)).toEqual(["Yesrecommended", "Leave it unmerged"]);
    expect(open.every((button) => button.disabled)).toBe(true);
    expect(document.querySelector(".job-view textarea")).not.toBeNull();
  });

  it("offers a run's next question its own buttons after he tapped an answer to the last one", async () => {
    const stream = await opened();
    const job = {
      id: "board", group: "needs", state: "Needs you", title: "Show the existing Liesel board", project: "", at: "2026-10-26T12:00:00.000Z", next: "", owner: "you", ask: "Waiting on your go-ahead.", because: "",
      shots: [], links: [], files: [], threads: [], domainRun: "run-9", questionIdentity: "Merge the board?",
      digest: { changed: "The board is finished.", needed: "Say yes to merge it." },
      choices: ["Yes", "No"], recommended: "Yes",
    };
    const update = (next: typeof job) => stream.emit("update", { order: ["u1"], messages: [], working: false, jobsFleetKnown: true, show: { title: "", summary: "", items: [], counts: {}, live: false }, jobs: [next] });
    update(job);
    const picks = () => [...document.querySelectorAll<HTMLButtonElement>('.jobask .jpick[data-pick-job="board"]')];
    picks()[0]!.click();
    await settle();
    expect(picks().every((button) => button.disabled)).toBe(true);
    update({ ...job, questionIdentity: "Restart Flyd now?" });
    await settle();
    expect(picks().map((button) => button.disabled)).toEqual([false, false]);
    expect(document.querySelector(".jobask .jsent")).toBeNull();
    after(() => document.querySelector<HTMLElement>('.job[data-job="board"]')!.click());
    const open = [...document.querySelectorAll<HTMLButtonElement>(".job-view .choice-pick")];
    expect(open.map((button) => button.disabled)).toEqual([false, false]);
    open[1]!.click();
    await settle();
    const request = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").at(-1)!;
    expect(JSON.parse(String(request[1]!.body))).toMatchObject({ domainRun: "run-9", questionText: "Restart Flyd now?", text: "No" });
  });

  it("hears that a card button's answer was not delivered once the job is opened", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const stream = await opened();
      const job = {
        id: "board", group: "needs", state: "Needs you", title: "Show the existing Liesel board", project: "", at: "2026-10-26T12:00:00.000Z", next: "", owner: "you", ask: "Waiting on your go-ahead.", because: "",
        shots: [], links: [], files: [], threads: [], domainRun: "run-9", questionIdentity: "Waiting on your go-ahead.",
        digest: { changed: "The board is finished.", needed: "Say yes to merge it." },
        choices: ["Yes", "Leave it unmerged"], recommended: "Yes",
      };
      stream.emit("update", { order: ["u1"], messages: [], working: false, jobsFleetKnown: true, show: { title: "", summary: "", items: [], counts: {}, live: false }, jobs: [job] });
      let routed = false;
      vi.mocked(fetch).mockImplementation(async (url) => json(url === "/api/send" ? { id: "pending:abc" } : String(url).startsWith("/api/note?") ? (routed ? { notDelivered: "Couldn't reach the run. Try again." } : { receipt: "sent" }) : {}));
      document.querySelector<HTMLButtonElement>('.jobask .jpick[data-pick="Yes"]')!.click();
      await settle();
      vi.advanceTimersByTime(4000);
      await settle();
      routed = true;
      document.querySelector<HTMLElement>('.job[data-job="board"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 300));
      vi.advanceTimersByTime(4000);
      await settle();
      expect(document.querySelector(".job-view .art-chat-receipt")!.textContent).toBe("Couldn't reach the run. Try again.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks several numbered questions as one card each, and sends each answer tagged with its question", async () => {
    const stream = await opened();
    const decisions = [
      { question: "WhatsApp card on Today", options: ["Remove it from the timeline", "Keep it"] },
      { question: "Horoscope source", options: ["AstroVed", "Another"] },
      { question: "News tab: anything beyond news, weather and horoscope?", options: ["No, that's all"] },
    ];
    const job = {
      id: "today-calls", group: "needs", state: "Needs you", title: "Three calls on Today", project: "", at: "2026-10-26T12:00:00.000Z", next: "", owner: "you", ask: "Three calls", because: "",
      shots: [], links: [], files: [], threads: [], digest: null, domainRun: "run-3", questionIdentity: "Three calls", decisions,
    };
    stream.emit("update", { order: ["u1"], messages: [], working: false, jobsFleetKnown: true, show: { title: "", summary: "", items: [], counts: {}, live: false }, jobs: [job] });
    after(() => document.querySelector<HTMLElement>('.job[data-job="today-calls"]')!.click());
    const cards = () => [...document.querySelectorAll<HTMLElement>(".job-view .art-decision")];
    expect(cards().map((card) => card.querySelector(".art-decision-q")!.textContent)).toEqual(decisions.map((one) => one.question));
    expect(cards().map((card) => [...card.querySelectorAll(".choice-pick")].map((button) => button.textContent))).toEqual([["Remove it from the timeline", "Keep it"], ["AstroVed", "Another"], ["No, that's all"]]);
    expect(cards().every((card) => card.querySelector("input.art-decision-input"))).toBe(true);
    cards()[1]!.querySelectorAll<HTMLButtonElement>(".choice-pick")[0]!.click();
    await settle();
    const request = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").at(-1)!;
    expect(JSON.parse(String(request[1]!.body))).toMatchObject({ domainRun: "run-3", text: 'On "Horoscope source": AstroVed' });
    // Only that question is done; the others stay open.
    expect([...cards()[1]!.querySelectorAll<HTMLButtonElement>(".choice-pick")].every((button) => button.disabled)).toBe(true);
    expect([...cards()[0]!.querySelectorAll<HTMLButtonElement>(".choice-pick")].some((button) => button.disabled)).toBe(false);
    const own = cards()[2]!.querySelector<HTMLFormElement>(".art-decision-own")!;
    own.querySelector<HTMLInputElement>("input")!.value = "Add the tide times";
    own.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    const last = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").at(-1)!;
    expect(JSON.parse(String(last[1]!.body))).toMatchObject({ text: 'On "News tab: anything beyond news, weather and horoscope?": Add the tide times' });
  });

  it("keeps the Timeline behind a small link, closed until opened, and says each entry whole", async () => {
    const stream = await opened();
    const long = "Rework the Today page so the WhatsApp card, the horoscope source and the News tab each follow what you decided in the last review round.";
    const job = {
      id: "today", group: "moving", state: "Working", title: "Today page", project: "", at: "2026-10-26T12:00:00.000Z", next: "Under way", owner: "Flyd", ask: "", because: "",
      shots: [], links: [], files: [], digest: null, threads: [{ id: "run-1", title: "Rework the Today page so the WhatsApp card…", full: long, at: "2026-10-26T12:00:00.000Z", kind: "run" }],
    };
    stream.emit("update", { order: ["u1"], messages: [], working: false, jobsFleetKnown: true, show: { title: "", summary: "", items: [], counts: {}, live: false }, jobs: [job] });
    after(() => document.querySelector<HTMLElement>('.job[data-job="today"]')!.click());
    const toggle = document.querySelector<HTMLButtonElement>(".job-view .jv-time-toggle")!;
    const list = document.querySelector<HTMLElement>(".job-view .jv-time-list")!;
    expect(toggle.textContent).toBe("Timeline");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(list.hidden).toBe(true);
    toggle.click();
    expect(list.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(list.querySelector(".jv-thread")!.textContent).toBe(long);
    expect(list.textContent).not.toContain("…");
  });

  it("opens a handled line from the server's jobs, and his reply in the one message box reaches Flyd's answer", async () => {
    const stream = await opened();
    stream.emit("update", {
      order: ["u1"], messages: [], working: false, jobsFleetKnown: true, show: { title: "", summary: "", items: [], counts: {}, live: false },
      jobs: [{ id: "landed:sync", group: "done", state: "Handled for you", title: "Said yes for you: rebase and push.", project: "", at: "2026-10-26T12:00:00.000Z", next: "", owner: "", ask: "", because: "", shots: [], links: [], files: [], threads: [], digest: null, handled: { decisionId: "dec-1", task: "sync" } }],
    });
    after(() => document.querySelector<HTMLElement>('.job[data-job="landed:sync"]')!.click());
    // Reply uses the one message box and keeps the handled decision as its destination.
    document.querySelector<HTMLButtonElement>('.work[data-job="landed:sync"] .work-reply')!.click();
    expect(document.getElementById("replying")!.hidden).toBe(false);
    const input = document.getElementById("input") as HTMLTextAreaElement;
    input.value = "No, hold it";
    document.getElementById("composer")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(document.getElementById("replying")!.hidden).toBe(true);
    const request = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/send").at(-1)!;
    expect(JSON.parse(String(request[1]!.body))).toMatchObject({ decisionFollowUp: "dec-1", decisionTask: "sync", text: "No, hold it" });
  });

  it("drops the Flyd speaker label from the reply chip but keeps a lowercase flyd: the title itself says", async () => {
    const stream = await opened();
    const job = (id: string, title: string) => ({ id, group: "done", state: "Done", title, project: "", at: "2026-10-26T12:00:00.000Z", next: "", owner: "", ask: "", because: "", shots: [], links: [], files: [], threads: [], digest: null });
    stream.emit("update", {
      order: ["u1"], messages: [], working: false, jobsFleetKnown: true, show: { title: "", summary: "", items: [], counts: {}, live: false },
      jobs: [job("a", "Flyd: I'm reviewing recent changes for token use"), job("b", "flyd: lowercase is the user's own word")],
    });
    for (const [id, shown] of [["a", "I'm reviewing recent changes for token use"], ["b", "flyd: lowercase is the user's own word"]] as const) {
      after(() => document.querySelector<HTMLElement>(`.job[data-job="${id}"]`)!.click());
      document.querySelector<HTMLButtonElement>(`.work[data-job="${id}"] .work-reply`)!.click();
      expect(document.getElementById("replying-title")!.textContent).toBe(shown);
    }
  });

  it("keeps every finished job reachable under Now: the newest few at first, all nine behind Show all", async () => {
    const stream = await opened();
    const done = (n: number) => ({ id: `done-${n}`, group: "done", state: "Done", title: `Finished ${n}`, project: "", at: `2026-10-26T1${n}:00:00.000Z`, next: "", owner: "", ask: "", because: "", shots: [], links: [], files: [], threads: [], digest: null });
    stream.emit("update", {
      order: ["u1"], messages: [], working: false, jobsFleetKnown: true, show: { title: "", summary: "", items: [], counts: {}, live: false },
      jobs: [9, 8, 7, 6, 5, 4, 3, 2, 1].map(done),
    });
    const shown = () => [...document.querySelectorAll<HTMLElement>("#jobs-list .fnow .job.line")].map((line) => line.dataset.job);
    expect(shown()).toEqual(["done-9", "done-8", "done-7", "done-6", "done-5"]);
    const more = document.querySelector<HTMLButtonElement>('#jobs-list .fmore[data-more="now"]')!;
    expect(more.textContent).toBe("Show all 9");
    more.click();
    expect(shown()).toEqual(["done-9", "done-8", "done-7", "done-6", "done-5", "done-4", "done-3", "done-2", "done-1"]);
  });

  it("renders stored job digests and says what an empty list actually is", async () => {
    const stream = await opened();
    stream.emit("update", { order: ["u1"], messages: [], working: false, jobs: [], jobsFleetKnown: false, show: { title: "", summary: "", items: [], counts: {}, live: false } });
    expect(document.body.textContent).not.toContain("Not read yet");
    expect(groups()).toEqual([
      ["Needs you", "No decision is waiting."],
      ["Now", "Nothing is under way right now."],
      ["Made", "Nothing made yet."],
    ]);
    stream.emit("update", {
      order: ["u1"], messages: [], working: false, jobsFleetKnown: true,
      show: { title: "", summary: "", items: [], counts: {}, live: false },
      jobs: [{
        id: "cap5", group: "moving", state: "Waiting", title: "Cap5", project: "Client", at: "2026-10-26T12:00:00.000Z",
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
    // At a glance: a title and one line, what he must do. The rest waits in the open job.
    expect(cap.querySelector(".next")!.textContent).toBe("Send it.");
    expect(cap.querySelector(".digest")).toBeNull();
    expect(cap.textContent).not.toContain("The deck dropped the third pricing tier.");
    expect(cap.querySelector("a")).toBeNull();
    // Open, Flyd tells him what changed, then what he needs to do: two sentences, no Changed/Means/Needed labels.
    after(() => cap.click());
    const said = Array.from(document.querySelectorAll(".job-view .jv-digest p")).map((line) => line.textContent);
    expect(said).toEqual(["The deck dropped the third pricing tier.", "Send it."]);
    expect(document.querySelector(".job-view .jv-digest b")).toBeNull();
    expect(document.querySelector(".job-view")!.textContent).not.toContain("Cap5 can review one offer.");
    document.querySelector<HTMLElement>('.ctab[data-centre="talk"]')!.click();
    expect(document.querySelector('.job[data-job="pick"] .next')!.textContent).toContain("Pick a hero");
    after(() => document.querySelector<HTMLElement>('.job[data-job="pick"]')!.click());
    expect(document.querySelector(".jv-ask")!.textContent).toBe("Which hero should ship?");
    expect(document.querySelector(".jv-thread")!.textContent).toBe("Hero thread");
    document.querySelector<HTMLElement>('.ctab[data-centre="talk"]')!.click();
    after(() => document.querySelector<HTMLElement>('.job[data-job="pick"]')!.click());
    document.querySelector<HTMLButtonElement>(".jv-thread")!.click();
    expect(document.documentElement.getAttribute("data-centre")).toBe("talk");
    expect(FakeEventSource.instances.at(-1)!.url).toContain("session=s1");
    // No rename row in the job: its one Close is a quiet action in the heading.
    after(() => document.querySelector<HTMLElement>('.job[data-job="pick"]')!.click());
    const view = document.querySelector(".job-view")!;
    expect(view.querySelector('input[name="name"]')).toBeNull();
    expect(Array.from(view.querySelectorAll("button")).map((button) => button.textContent)).not.toEqual(expect.arrayContaining(["Rename"]));
    expect(Array.from(view.querySelectorAll("button")).map((button) => button.textContent)).not.toEqual(expect.arrayContaining(["Close"]));
    const closes = document.querySelectorAll<HTMLButtonElement>("#stage-crumb button");
    expect(Array.from(closes).map((button) => button.textContent)).toEqual(["Close"]);
    vi.mocked(fetch).mockClear();
    closes[0].click();
    const posted = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/jobs")!;
    expect(JSON.parse(String(posted[1]!.body))).toEqual({ op: "close", id: "pick" });
    after(() => document.querySelector<HTMLElement>('.job[data-job="cap5"]')!.click());
    expect(document.querySelector(".jv-digest")!.textContent).toContain("The deck dropped the third pricing tier.");
    expect(document.querySelector<HTMLAnchorElement>(".jv-digest .fbtn")!.href).toBe("https://example.com/deck");
    expect(document.querySelector(".jv-files")!.textContent).toBe("deck.pdf");
  });
});

describe("his own to-dos, in Needs you", () => {
  const LIST = [
    { id: "job:1", text: "Which hero should George ship?", line: "Cap5 · Needs you", job: "cap5", from: "flyd" },
    { id: "todo-a", text: "Book <flights>", line: "Due 20 Nov", from: "you" },
  ];
  const rows = () => Array.from(document.querySelectorAll(".todo-list .todo")).map((row) => row.querySelector(".todo-text")!.textContent);
  function answering(body: unknown, status = 200): void {
    vi.mocked(fetch).mockImplementation(async (url) => (url === "/api/todos" ? json(body, status) : json({ assistantLabel: "firstmate", sessions: SESSIONS })));
  }
  const posted = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/todos").map(([, init]) => JSON.parse(String(init!.body)));
  async function opened(todos: unknown = LIST): Promise<FakeEventSource> {
    load("");
    await settle();
    const stream = FakeEventSource.instances.at(-1)!;
    stream.emit("session", { id: "latest", title: "latest", updatedAt: "2026-10-05T20:00:00.000Z", assistantLabel: "firstmate" });
    stream.emit("update", { order: [], messages: [], working: false, todos });
    return stream;
  }

  it("sit in Needs you under the calls, with no tab of their own", async () => {
    const stream = await opened();
    stream.emit("update", { order: [], messages: [], working: false, todos: LIST, jobs: [], jobsFleetKnown: true });
    expect(Array.from(document.querySelectorAll(".rtab")).map((tab) => tab.textContent)).toEqual(["Now", "Projects", "Made"]);
    const needs = document.querySelector("#jobs-list .fgroup")!;
    expect(needs.querySelector(".fhead")!.textContent).toContain("Needs you");
    expect(needs.querySelector("#todos")).not.toBeNull();
    expect(document.getElementById("todo-new")).toBeNull();
  });

  it("stay in Needs you when the board changes later", async () => {
    const stream = await opened();
    const job = (id: string, title: string) => ({ id, group: "needs", state: "Needs you", title, project: "", next: "", owner: "", ask: "", because: "", shots: [], links: [], files: [], threads: [], digest: null, at: new Date().toISOString() });
    const base = { order: [], messages: [], working: false, todos: LIST, jobsFleetKnown: true };
    stream.emit("update", { ...base, jobs: [job("a", "First ask")] });
    stream.emit("update", { ...base, jobs: [job("a", "First ask"), job("b", "Second ask")] });
    expect(document.querySelector("#jobs-list .fgroup #todos")).not.toBeNull();
    expect(document.querySelectorAll("#jobs-list .fgroup #todos .todo").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("#todos")).toHaveLength(1);
  });

  it("lists what he must do in his own words, escaped", async () => {
    await opened();
    // The Flyd ask has its own card in Needs you; the list keeps only what is his alone.
    expect(rows()).toEqual(["Book <flights>"]);
    expect(document.querySelector('.todo-tick[data-id="todo-a"]')!.getAttribute("aria-label")).toBe("Done: Book <flights>");
    expect(document.querySelector(".todo-line")!.textContent).toBe("Due 20 Nov");
  });

  it("shows a row with no job to open exactly as written, however long", async () => {
    const long = `Renew the lease. ${"Then read every clause with Sam before signing it. ".repeat(3)}Call back.`.trim();
    const own = ["Call George Smith about the lease", "Read https://example.com/a/b", long];
    await opened([
      ...own.map((text, at) => ({ id: `todo-${at}`, text, from: "you" })),
      { id: "inbox:e1", text: `Try again or drop: ${long}`, line: "It did not finish", from: "flyd" },
    ]);
    expect(rows()).toEqual([...own, `Try again or drop: ${long}`]);
    expect(document.querySelector('.todo-tick[data-id="todo-0"]')!.getAttribute("aria-label")).toBe("Done: Call George Smith about the lease");
    expect(document.querySelector('.todo-tick[data-id="inbox:e1"]')!.getAttribute("aria-label")).toBe(`Done: Try again or drop: ${long}`);
  });

  it("says nothing when there is nothing of his to do", async () => {
    await opened([]);
    expect(document.getElementById("todo-lists")!.innerHTML).toBe("");
  });

  it("ticks an item and draws what the store sends back, without it", async () => {
    await opened();
    answering({ todos: [LIST[0]] });
    document.querySelector<HTMLInputElement>('.todo-tick[data-id="todo-a"]')!.click();
    await settle();
    expect(posted()).toEqual([{ op: "tick", id: "todo-a" }]);
    expect(rows()).toEqual([]);
  });

  it("puts a tick back, and says so, when it did not save", async () => {
    await opened();
    answering({ error: "Could not save that." }, 500);
    const box = document.querySelector<HTMLInputElement>('.todo-tick[data-id="todo-a"]')!;
    box.click();
    await settle();
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(false);
    expect(document.getElementById("todo-said")!.textContent).toBe("That did not save. Try again.");
  });

});

describe("project threads", () => {
  const LIST = {
    ready: true,
    all: { id: "project:all", name: "All", question: "the DIR ident", at: "2026-10-05T21:00:00.000Z", replyAt: "2026-10-05T21:00:00.000Z", count: 3 },
    projects: [
      { id: "project:dir", name: "DIR", question: "the <ident>", answer: "It's smaller now.", at: "2026-10-05T21:00:00.000Z", replyAt: "2026-10-05T21:00:00.000Z", count: 2 },
      { id: "project:logan", name: "Logan", question: "gradients", answer: "In.", at: "2026-10-05T19:00:00.000Z", replyAt: "2026-10-05T19:00:00.000Z", count: 1 },
    ],
  };
  const listed = (list: unknown) => {
    const before = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => (url === "/api/projects" ? json(list) : before(url, init)));
  };
  const seenFrom = (since: string) => localStorage.setItem("flyd-threads-seen", JSON.stringify({ since }));

  it("lists each project's latest exchange, escaped, with every conversation under the list", async () => {
    listed(LIST);
    load("");
    await settle();
    const rows = Array.from(document.querySelectorAll(".thread"));
    expect(rows.map((row) => row.querySelector(".thread-name")?.textContent)).toEqual(["DIR", "Logan"]);
    expect(rows[0]!.querySelector(".thread-q")?.textContent).toBe("the <ident>");
    expect(rows[0]!.querySelector(".thread-a")?.textContent).toBe("It's smaller now.");
    expect(Array.from(document.querySelectorAll(".thread-more button")).map((link) => [link.textContent, (link as HTMLElement).dataset.thread])).toEqual([["All conversations", "project:all"]]);
  });

  it("ends with what nothing could place, beside every conversation", async () => {
    listed({ ...LIST, other: { id: "project:other", name: "Other", question: "smaller", at: "2026-10-05T18:00:00.000Z", count: 1 } });
    load("");
    await settle();
    expect(Array.from(document.querySelectorAll(".thread-name")).map((row) => row.textContent)).toEqual(["DIR", "Logan"]);
    expect(Array.from(document.querySelectorAll(".thread-more button")).map((link) => link.textContent)).toEqual(["All conversations", "Other"]);
  });

  it("boxes the newest project that has a picture above the list, never the one open in the middle, and keeps the rest of the list newest first", async () => {
    const pictured = {
      ...LIST,
      projects: [
        LIST.projects[0]!,
        { ...LIST.projects[1]!, picture: "/api/rail-image?path=%2Fkept%2Flogan.png" },
        { id: "project:hftw", name: "HFTW", question: "the hero", answer: "Swapped.", at: "2026-10-05T18:00:00.000Z", replyAt: "2026-10-05T18:00:00.000Z", count: 1, picture: "/api/image?session=project%3Ahftw&id=1" },
      ],
    };
    listed(pictured);
    load("");
    await settle();
    const lead = document.querySelector(".thread-lead")!;
    expect(lead.querySelector(".thread-name")?.textContent).toBe("Logan");
    expect(lead.querySelector("img")!.getAttribute("src")).toMatch(/^\/api\/rail-image\?path=%2Fkept%2Flogan\.png&token=/);
    expect(lead.closest(".thread-list")).toBeNull();
    const listedNames = () => Array.from(document.querySelectorAll(".thread-list .thread-name")).map((row) => row.textContent);
    expect(listedNames()).toEqual(["DIR", "HFTW"]);
    (lead as HTMLElement).click();
    await settle();
    const next = document.querySelector(".thread-lead")!;
    expect(next.querySelector(".thread-name")?.textContent).toBe("HFTW");
    expect(next.querySelector("img")!.getAttribute("src")).toBe("/api/image?session=project%3Ahftw&id=1");
    expect(document.querySelector('.thread-list .thread.on[data-thread="project:logan"]')).not.toBeNull();
    expect(listedNames()).toEqual(["DIR", "Logan"]);
  });

  it("draws the exchange in the box above the list once, never again as a row under it", async () => {
    seenFrom("2026-10-05T20:00:00.000Z");
    const dir = {
      id: "project:dir", name: "DIR", question: "actually now i just heard cvommentary.", answer: "I've told the DJ commentary worker you heard some talk.",
      at: "2026-10-05T21:00:00.000Z", replyAt: "2026-10-05T21:00:00.000Z", count: 2, picture: "/api/image?session=project%3Adir&id=1",
    };
    listed({ ...LIST, projects: [dir, LIST.projects[1]!] });
    load("");
    await settle();
    expect(document.querySelectorAll('.thread[data-thread="project:dir"]')).toHaveLength(1);
    expect(document.querySelector('.thread[data-thread="project:dir"]')!.classList.contains("thread-lead")).toBe(true);
    expect(Array.from(document.querySelectorAll(".thread-q")).filter((node) => node.textContent === dir.question)).toHaveLength(1);
    expect(Array.from(document.querySelectorAll(".thread-a")).filter((node) => node.textContent === dir.answer)).toHaveLength(1);
    expect(Array.from(document.querySelectorAll(".thread-list .thread-name")).map((row) => row.textContent)).toEqual(["Logan"]);
    // The project tab still says something came that he has not read.
    expect((document.getElementById("rtab-threads-dot") as HTMLElement).hidden).toBe(false);
  });

  it("keeps a commented project under the ones not yet gone through, even when it has the only picture", async () => {
    listed({
      ready: true,
      projects: [
        { id: "project:logan", name: "Logan", question: "gradients", answer: "In.", at: "2026-11-06T10:00:00.000Z", replyAt: "2026-11-06T10:00:00.000Z", count: 1 },
        { id: "project:dir", name: "DIR", question: "the ident", answer: "Smaller.", at: "2026-11-06T09:00:00.000Z", replyAt: "2026-11-06T09:00:00.000Z", count: 1 },
        { id: "project:pierre", name: "Pierre", question: "Keep the radio.", answer: "The board is up.", at: "2026-11-07T12:00:00.000Z", replyAt: "2026-11-06T08:00:00.000Z", count: 2, commented: true, picture: "/api/image?session=project%3Apierre&id=1" },
      ],
    });
    load("");
    await settle();
    expect(Array.from(document.querySelectorAll(".thread-name")).map((row) => row.textContent)).toEqual(["Logan", "DIR", "Pierre"]);
    expect(document.querySelector(".thread-lead")).toBeNull();
    expect(document.querySelector('[data-thread="project:pierre"]')!.classList.contains("on")).toBe(false);
    seenFrom("2026-11-06T07:00:00.000Z");
    load("");
    await settle();
    expect(document.querySelector('[data-thread="project:pierre"]')!.classList.contains("unread")).toBe(true);
    expect(document.querySelector('[data-thread="project:logan"]')!.classList.contains("unread")).toBe(true);
  });

  it("opens every conversation from the line under the list", async () => {
    listed(LIST);
    load("");
    await settle();
    document.querySelector<HTMLElement>('.thread-more [data-thread="project:all"]')!.click();
    await settle();
    expect(FakeEventSource.instances.at(-1)!.url).toContain("session=project%3Aall");
    expect(document.querySelector('.thread-more [data-thread="project:all"]')!.getAttribute("aria-current")).toBe("true");
  });

  it("keeps the message box taking his keys after he switches to Projects and opens a thread", async () => {
    listed(LIST);
    load("");
    await settle();
    FakeEventSource.instances.at(-1)!.emit("session", { id: "latest", title: "latest", updatedAt: "2026-10-05T20:00:00.000Z", assistantLabel: "firstmate" });
    await settle();
    const input = document.getElementById("input") as HTMLTextAreaElement;
    expect((document.getElementById("composer") as HTMLElement).hidden).toBe(false);
    input.blur();
    document.querySelector<HTMLElement>('.rtab[data-rtab="threads"]')!.click();
    expect(document.documentElement.getAttribute("data-rtab")).toBe("threads");
    expect(document.activeElement).toBe(input);
    input.blur();
    document.querySelector<HTMLElement>('.thread[data-thread="project:dir"]')!.click();
    await settle();
    expect(document.activeElement).toBe(input);
    // A click on the box around the words, not on one of its buttons, also puts the caret in it.
    input.blur();
    document.querySelector<HTMLElement>(".composer .typing")!.click();
    expect(document.activeElement).toBe(input);
    document.getElementById("attach")!.click();
    expect(document.activeElement).not.toBe(document.getElementById("attach-input"));
  });

  it("marks what came after his last look, on the project and its tab, never on All", async () => {
    seenFrom("2026-10-05T20:00:00.000Z");
    listed(LIST);
    load("");
    await settle();
    expect(document.querySelector('[data-thread="project:dir"]')!.classList.contains("unread")).toBe(true);
    expect(document.querySelector('[data-thread="project:logan"]')!.classList.contains("unread")).toBe(false);
    expect(document.querySelector('[data-thread="project:all"]')!.classList.contains("unread")).toBe(false);
    expect((document.getElementById("rtab-threads-dot") as HTMLElement).hidden).toBe(false);
  });

  it("treats history as read on his first look", async () => {
    listed(LIST);
    load("");
    await settle();
    expect(document.querySelectorAll(".thread.unread")).toHaveLength(0);
    expect((document.getElementById("rtab-threads-dot") as HTMLElement).hidden).toBe(true);
  });

  it("opens a thread on a click: follows it, marks it read, and keeps that across a reload", async () => {
    seenFrom("2026-10-05T20:00:00.000Z");
    listed(LIST);
    load("");
    await settle();
    document.querySelector<HTMLElement>('.ctab[data-centre="talk"]')!.click();
    (document.querySelector('[data-thread="project:dir"]') as HTMLElement).click();
    expect(document.documentElement.getAttribute("data-centre")).toBe("talk");
    await settle();
    expect(FakeEventSource.instances.at(-1)!.url).toContain("session=project%3Adir");
    expect(location.search).toContain("project%3Adir");
    open("project:dir", []);
    expect(document.documentElement.getAttribute("data-thread")).toBe("project:dir");
    const row = document.querySelector('.thread[data-thread="project:dir"]')!;
    expect(row.classList.contains("on")).toBe(true);
    expect(row.classList.contains("unread")).toBe(false);
    expect(JSON.parse(localStorage.getItem("flyd-threads-seen")!)["project:dir"]).toBe("2026-10-05T21:00:00.000Z");
    expect((document.getElementById("rtab-threads-dot") as HTMLElement).hidden).toBe(true);
  });

  it("goes back to the window's own conversation", async () => {
    listed(LIST);
    load("?session=project%3Adir");
    await settle();
    open("project:dir", []);
    document.getElementById("stage-back")!.click();
    await settle();
    expect(location.search).toBe("");
    expect(FakeEventSource.instances.at(-1)!.url).not.toContain("project");
    FakeEventSource.instances.at(-1)!.emit("session", { id: "latest", title: "Latest", updatedAt: "2026-10-05T20:00:00.000Z", assistantLabel: "firstmate" });
    expect(document.documentElement.hasAttribute("data-thread")).toBe(false);
  });

  it("says what is happening while the history is still being read", async () => {
    listed({ ready: false, projects: [] });
    load("");
    await settle();
    expect(document.getElementById("threads")!.textContent).toBe("Reading your conversations.");
  });
});

describe("the Machines screen", () => {
  const GB = 1073741824;
  const ONLINE = {
    id: "@local", name: "Mac", local: true, state: "online",
    reading: { cores: 10, load: [2.5, 2, 1], memory: { used: 18 * GB, total: 32 * GB }, swap: { used: 0, total: 0 }, disk: { used: 240 * GB, total: 2048 * GB },
      running: [{ name: "node <42>", cpu: 42.4, memory: 3 }, { name: "launchd", cpu: 0, memory: 0.1 }] },
    say: "Chrome <b> is holding 15 GB across 186 processes, and swap is nearly full.",
    action: { label: "Free up memory", ask: "The Mac is short of memory. Find what can safely close." },
  };
  const OFFLINE = { id: "85.155.185.63", name: "Server", alias: "85.155.185.63", local: false, state: "offline", reason: "It did not answer.", say: "The Server is not answering.", seenAt: new Date(Date.now() - 12 * 60_000).toISOString() };
  const CHECKING = { id: "radarboy3k", name: "PC", alias: "radarboy3k", local: false, state: "checking", say: "Checking it now." };

  function serve(respond: (init?: RequestInit) => unknown): ReturnType<typeof vi.fn> {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/machines" || url.startsWith("/api/machines?")) {
        const body = respond(init) as { error?: string };
        return json(body, body.error ? 400 : 200);
      }
      return json({ sessions: SESSIONS });
    });
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  }
  const reads = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls.filter(([url]) => url.startsWith("/api/machines?")).length;
  const tab = () => document.querySelector('.ctab[data-centre="machines"]') as HTMLElement;

  it("waits for the initial view token before reading machines", async () => {
    let provideToken!: (response: Response) => void;
    const fetcher = vi.fn(async (url: string) => {
      if (url === "/api/token") return new Promise<Response>((resolve) => { provideToken = resolve; });
      if (url.startsWith("/api/machines?")) return json({ machines: [ONLINE] });
      return json({ sessions: SESSIONS });
    });
    vi.stubGlobal("fetch", fetcher);
    load("", renderPage({ assistantLabel: "firstmate", sendToken: "a".repeat(48) }).replace('data-send-token="' + "a".repeat(48) + '"', 'data-send-token=""'));
    await settle();
    tab().click();
    await settle();
    expect(reads(fetcher)).toBe(0);
    expect(document.getElementById("machines-list")!.textContent).not.toContain("No machines yet");
    provideToken(json({ token: "b".repeat(48) }));
    await settle();
    expect(fetcher.mock.calls.some(([url]) => url === "/api/machines?token=" + "b".repeat(48))).toBe(true);
    expect(document.querySelector(".machine-name")!.textContent).toBe("Mac");
  });

  it("is a tab beside Conversation, News and Week, off the right column, and reads nothing until it is open", async () => {
    const fetcher = serve(() => ({ machines: [ONLINE] }));
    load("");
    await settle();
    expect(Array.from(document.querySelectorAll(".ctab")).map((one) => one.textContent)).toEqual(["Conversation", "News", "Week", "Machines"]);
    expect(Array.from(document.querySelectorAll(".rtab")).map((one) => one.textContent)).toEqual(["Now", "Projects", "Made"]);
    expect(reads(fetcher)).toBe(0);
    tab().click();
    await settle();
    expect(reads(fetcher)).toBe(1);
    expect(document.documentElement.dataset.centre).toBe("machines");
    expect(tab().getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('.ctab[data-centre="talk"]')!.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows each machine's one sentence and one button, escaped, and no numbers of its own", async () => {
    serve(() => ({ machines: [ONLINE] }));
    load("");
    await settle();
    tab().click();
    await settle();
    const row = document.querySelector(".machine.online")!;
    expect(row.querySelector(".machine-name")?.textContent).toBe("Mac");
    expect(row.querySelector(".machine-say")?.textContent).toBe("Chrome <b> is holding 15 GB across 186 processes, and swap is nearly full.");
    expect(row.querySelector(".machine-say b")).toBeNull();
    expect(row.querySelectorAll(".mach-btn")).toHaveLength(1);
    expect(row.querySelector(".mach-btn")?.textContent).toBe("Free up memory");
    expect(row.querySelector(".machine-stats")).toBeNull();
  });

  it("shows which model does each job, Claude's spend in a sentence and the usage left, a used-up plan in words", async () => {
    const noonTomorrow = new Date();
    noonTomorrow.setDate(noonTomorrow.getDate() + 1);
    noonTomorrow.setHours(12, 0, 0, 0);
    const soon = noonTomorrow.toISOString();
    serve(() => ({ machines: [ONLINE], setup: {
      models: [{ role: "Chat", model: "Claude Sonnet 5.5" }, { role: "Quick jobs", model: "Claude Haiku 5.5" }, { role: "Coding crews", model: "GPT-6 Luna through OpenCode Go" }, { role: "LIVE voice", model: "gpt-realtime-2.1" }],
      spend: { usd: 1.789, cap: 100, calls: 1036, capped: false },
      usageAt: new Date(Date.now() - 12 * 60_000).toISOString(),
      usage: [{ provider: "Claude", left: 69, resetsAt: soon }, { provider: "OpenCode Go", left: 0, resetsAt: soon }, { provider: "Codex", left: 24, resetsAt: soon, runsOutAt: soon }],
    } }));
    load("");
    await settle();
    tab().click();
    await settle();
    const setup = document.querySelector("#machines-side .machine-setup")!;
    expect(document.getElementById("machines-side")!.hidden).toBe(false);
    expect(setup.querySelector(".mach-models")!.textContent)
      .toBe("Chat runs on Claude Sonnet 5.5, quick jobs on Claude Haiku 5.5, coding crews on GPT-6 Luna through OpenCode Go, and LIVE voice on gpt-realtime-2.1.");
    expect(setup.querySelector(".setup-spend")!.textContent).toBe("Claude has cost $1.79 of your $100 this month, across 1,036 calls.");
    const usage = [...setup.querySelectorAll(".setup-usage li")];
    expect(setup.querySelector(".setup-usage-read")!.textContent).toBe("Usage read 12m ago");
    expect(usage.map((one) => one.querySelector(".u-top")!.textContent)).toEqual(["Claude69% left", "OpenCode GoUsed up", "Codex24% left"]);
    expect(usage[0]!.querySelector<HTMLElement>(".u-bar i")!.style.width).toBe("69%");
    expect(usage[1]!.querySelector(".u-when")!.textContent).toMatch(/^Back tomorrow at /);
    expect(usage[2]!.querySelector(".u-when.out")!.textContent).toMatch(/^Runs out tomorrow at /);
    expect(setup.querySelector("h2")).toBeNull();
  });

  it("asks Flyd in the conversation when a button is pressed, after asking him first for one that changes something", async () => {
    const tools = { say: "Codex is behind on the Mac, 0.162 against 0.167.", action: { label: "Update Codex", confirm: "Update Codex on the Mac?", ask: "Update Codex on the Mac from 0.162.0 to 0.167.0." } };
    const fetcher = serve(() => ({ machines: [ONLINE], tools }));
    load("");
    await settle();
    FakeEventSource.instances.at(-1)!.emit("session", { id: "latest", title: "Latest", updatedAt: "2026-10-05T20:00:00.000Z", assistantLabel: "firstmate" });
    tab().click();
    await settle();
    const panel = document.getElementById("machines-tools")!;
    expect(document.getElementById("machines-side")!.hidden).toBe(false);
    expect(panel.querySelector(".mach-tools-say")!.textContent).toBe(tools.say);
    const sends = () => fetcher.mock.calls.filter(([url]) => url === "/api/send").map(([, init]) => JSON.parse(String((init as RequestInit).body)).text);
    (panel.querySelector(".mach-btn") as HTMLElement).click();
    await settle();
    expect(sends()).toEqual([]);
    expect(panel.querySelector(".mach-confirm p")!.textContent).toBe("Update Codex on the Mac?");
    (panel.querySelector("[data-mach-no]") as HTMLElement).click();
    expect(panel.querySelector(".mach-confirm")).toBeNull();
    expect(document.activeElement).toBe(panel.querySelector("[data-mach-act]"));
    (panel.querySelector(".mach-btn") as HTMLElement).click();
    (panel.querySelector("[data-mach-yes]") as HTMLElement).click();
    await settle();
    expect(sends()).toEqual(["Update Codex on the Mac from 0.162.0 to 0.167.0."]);
    expect(document.documentElement.dataset.centre).toBe("machines");
    (document.querySelector(".machine .mach-btn") as HTMLElement).click();
    await settle();
    expect(sends().at(-1)).toBe("The Mac is short of memory. Find what can safely close.");
  });

  it("stays on Machines when Free up memory is pressed, says the ask went, and shows Flyd's answer in place", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.startsWith("/api/machines?")) return json({ machines: [ONLINE] });
      if (url === "/api/send") return json({ id: "ask1" });
      return json({ sessions: SESSIONS });
    });
    vi.stubGlobal("fetch", fetcher);
    load("");
    await settle();
    const stream = open("latest", []);
    tab().click();
    await settle();
    (document.querySelector(".machine .mach-btn") as HTMLElement).click();
    await settle();
    expect(fetcher.mock.calls.filter(([url]) => url === "/api/send")).toHaveLength(1);
    expect(document.documentElement.dataset.centre).toBe("machines");
    const row = () => document.querySelector(".machine.online")!;
    expect(row().querySelector(".mach-wait p")!.textContent).toBe("Sent to Flyd. The answer will show here.");
    expect(row().querySelector(".mach-btn")).toBeNull();
    stream.emit("update", { order: ["ask1", "r1"], messages: [
      { id: "ask1", role: "user", html: "<p>Free up memory</p>" },
      { id: "r1", role: "assistant", html: "<p>Chrome can go: <b>15 GB</b>. Shall I close it?</p>" },
    ], working: false });
    await settle();
    expect(document.documentElement.dataset.centre).toBe("machines");
    expect(row().querySelector(".mach-wait.answered p")!.textContent).toBe("Flyd: Chrome can go: 15 GB. Shall I close it?");
    expect(row().querySelector(".mach-btn")!.textContent).toBe("Free up memory");
    (row().querySelector("[data-mach-talk]") as HTMLElement).click();
    expect(document.documentElement.dataset.centre).toBe("talk");
  });

  it("keeps a half-typed message and its attachment when a button asks Flyd", async () => {
    const fetcher = serve(() => ({ machines: [ONLINE] }));
    load("");
    await settle();
    FakeEventSource.instances.at(-1)!.emit("session", { id: "latest", title: "Latest", updatedAt: "2026-10-05T20:00:00.000Z", assistantLabel: "firstmate" });
    tab().click();
    await settle();
    const input = document.getElementById("input") as HTMLTextAreaElement;
    input.value = "half a thought";
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const paste = new Event("paste", { cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { items: [{ kind: "file", getAsFile: () => new File([png], "shot.png", { type: "image/png" }) }] } });
    input.dispatchEvent(paste);
    for (let i = 0; i < 20 && !document.querySelector(".attachment img"); i += 1) await settle();
    (document.querySelector(".machine .mach-btn") as HTMLElement).click();
    await settle();
    const sent = fetcher.mock.calls.filter(([url]) => url === "/api/send").map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(sent.map((one) => [one.text, one.images.length])).toEqual([["The Mac is short of memory. Find what can safely close.", 0]]);
    expect(input.value).toBe("half a thought");
    expect(document.querySelectorAll(".attachment img")).toHaveLength(1);
  });

  it("says so in place when a button could not ask Flyd, and leaves the message box alone", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const fetcher = serve(() => ({ machines: [ONLINE] }));
      load("");
      await vi.runOnlyPendingTimersAsync();
      tab().click();
      await vi.runOnlyPendingTimersAsync();
      const input = document.getElementById("input") as HTMLTextAreaElement;
      input.value = "half a thought";
      (document.querySelector(".machine .mach-btn") as HTMLElement).click();
      await vi.advanceTimersByTimeAsync(25_000);
      expect(fetcher.mock.calls.some(([url]) => url === "/api/send")).toBe(false);
      expect(input.value).toBe("half a thought");
      expect(document.documentElement.dataset.centre).toBe("machines");
      expect(document.querySelector(".machine .mach-wait.failed p")!.textContent).toMatch(/could not ask that/);
      expect(document.querySelector(".machine .mach-btn")!.textContent).toBe("Free up memory");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says which model does which job in a sentence that agrees with whichever job comes first", async () => {
    serve(() => ({ machines: [ONLINE], setup: {
      models: [{ role: "Coding crews", model: "GPT-6 Luna through OpenCode Go" }, { role: "Typing", model: "GPT-4o Mini Transcribe" }, { role: "LIVE voice", model: "gpt-realtime-2.1" }],
      usage: [],
    } }));
    load("");
    await settle();
    tab().click();
    await settle();
    expect(document.querySelector("#machines-side .mach-models")!.textContent)
      .toBe("Coding crews run on GPT-6 Luna through OpenCode Go, typing on GPT-4o Mini Transcribe, and LIVE voice on gpt-realtime-2.1.");
  });

  it("hides the right column when there are no versions, models or usage to show", async () => {
    serve(() => ({ machines: [ONLINE] }));
    load("");
    await settle();
    tab().click();
    await settle();
    expect(document.getElementById("machines-side")!.hidden).toBe(true);
  });

  it("says plainly when a machine is offline, with no numbers", async () => {
    serve(() => ({ machines: [ONLINE, OFFLINE, CHECKING] }));
    load("");
    await settle();
    tab().click();
    await settle();
    const row = document.querySelector(".machine.offline")!;
    expect(row.querySelector(".machine-say")?.textContent).toBe("The Server is not answering.");
    expect(row.querySelector(".machine-seen")?.textContent).toBe("Last seen 12m ago");
    expect(row.querySelector(".mach-btn")).toBeNull();
    expect(document.querySelector(".machine.checking .machine-say")?.textContent).toBe("Checking it now.");
  });

  it("reads again on the interval only while the screen is up, and soon while one is being checked", async () => {
    let machines = [ONLINE, CHECKING];
    const fetcher = serve(() => ({ machines }));
    load("");
    await settle();
    vi.useFakeTimers();
    try {
      tab().click();
      await vi.advanceTimersByTimeAsync(0);
      expect(reads(fetcher)).toBe(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(reads(fetcher)).toBe(2);
      machines = [ONLINE];
      await vi.advanceTimersByTimeAsync(2000);
      expect(reads(fetcher)).toBe(3);
      await vi.advanceTimersByTimeAsync(29_000);
      expect(reads(fetcher)).toBe(3);
      await vi.advanceTimersByTimeAsync(1000);
      expect(reads(fetcher)).toBe(4);
      (document.querySelector('.ctab[data-centre="talk"]') as HTMLElement).click();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(reads(fetcher)).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("adds a machine by name and alias, and shows what SSH would not take", async () => {
    let machines: object[] = [ONLINE];
    const setup = { models: [{ role: "Chat", model: "example-model" }], spend: { usd: 3, cap: 20, calls: 4, capped: false }, usage: [{ provider: "Codex", left: 42 }] };
    const sent: Array<Record<string, string>> = [];
    serve((init) => {
      if (!init?.method) return { machines, setup };
      const body = JSON.parse(String(init.body)) as Record<string, string>;
      sent.push(body);
      if (body.alias === "-x") return { error: "That is not an SSH host alias." };
      machines = [ONLINE, { id: body.alias, name: body.name, alias: body.alias, local: false, state: "checking" }];
      return { machines };
    });
    load("");
    await settle();
    tab().click();
    await settle();
    const form = document.getElementById("machine-form") as HTMLFormElement;
    const button = document.getElementById("machine-open") as HTMLButtonElement;
    expect(form.hidden).toBe(true);
    button.click();
    expect(form.hidden).toBe(false);
    expect(button.hidden).toBe(true);
    (form.elements.namedItem("name") as HTMLInputElement).value = "Studio";
    (form.elements.namedItem("alias") as HTMLInputElement).value = "-x";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(document.getElementById("machine-error")?.textContent).toBe("That is not an SSH host alias.");
    expect(form.hidden).toBe(false);
    (form.elements.namedItem("alias") as HTMLInputElement).value = "studio";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(sent[1]).toEqual({ name: "Studio", alias: "studio" });
    expect(form.hidden).toBe(true);
    expect(button.hidden).toBe(false);
    expect(Array.from(document.querySelectorAll(".machine-name")).map((one) => one.textContent)).toEqual(["Mac", "Studio"]);
    expect(document.querySelector(".machine-setup")!.textContent).toContain("example-model");
    expect(document.querySelector(".machine-setup")!.textContent).toContain("$3.00");
    expect(document.querySelector(".machine-setup")!.textContent).toContain("42% left");
  });

  it("cancels and resets the machine form, returning focus", async () => {
    serve(() => ({ machines: [ONLINE] }));
    load("");
    await settle();
    tab().click();
    await settle();
    const button = document.getElementById("machine-open") as HTMLButtonElement;
    const form = document.getElementById("machine-form") as HTMLFormElement;
    button.click();
    (form.elements.namedItem("name") as HTMLInputElement).value = "Studio";
    document.getElementById("machine-cancel")!.click();
    expect(form.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    button.click();
    expect((form.elements.namedItem("name") as HTMLInputElement).value).toBe("");
  });

  it("keeps Tab and typing in the add form, away from the screen swap and the message box", async () => {
    serve(() => ({ machines: [ONLINE] }));
    load("");
    await settle();
    tab().click();
    await settle();
    (document.getElementById("machine-open") as HTMLElement).click();
    const field = (document.getElementById("machine-form") as HTMLFormElement).elements.namedItem("name") as HTMLInputElement;
    field.focus();
    for (const key of ["Tab", "a"]) {
      const press = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      field.dispatchEvent(press);
      expect(press.defaultPrevented, key).toBe(false);
      expect(document.activeElement, key).toBe(field);
    }
    expect(document.documentElement.dataset.screen).not.toBe("show");
  });

  it("keeps a half-typed form through a redraw", async () => {
    let machines: object[] = [ONLINE, OFFLINE];
    serve(() => ({ machines }));
    load("");
    await settle();
    tab().click();
    await settle();
    (document.getElementById("machine-open") as HTMLElement).click();
    const field = (document.getElementById("machine-form") as HTMLFormElement).elements.namedItem("name") as HTMLInputElement;
    field.value = "half typed";
    machines = [ONLINE];
    (document.querySelector('.ctab[data-centre="talk"]') as HTMLElement).click();
    tab().click();
    await settle();
    expect(document.querySelectorAll(".machine")).toHaveLength(1);
    expect(field.value).toBe("half typed");
  });
});
