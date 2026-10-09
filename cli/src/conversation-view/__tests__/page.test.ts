// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderPage } from "../page.js";

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

function load(search: string): void {
  window.history.replaceState(null, "", `/${search}`);
  const html = renderPage({ assistantLabel: "firstmate", sendToken: "a".repeat(48) });
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
  FakeEventSource.instances = [];
  sendResponse = { id: "note:1", timestamp: "2026-10-05T20:01:00.000Z" };
  blips = 0;
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/api/send" ? json(sendResponse) : url === "/api/plan" ? json({ plan: planResponse }) : json({ assistantLabel: "firstmate", sessions: SESSIONS }))));
  window.scrollTo = () => {};
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("conversation page", () => {
  it("swaps the optimistic copy for the delivered note when it arrives", async () => {
    load("");
    await settle();
    const stream = open("latest", [{ id: "u1", role: "user", html: "<p>hello</p>" }]);
    await type("run the flyd viewer");
    expect(pending()).toEqual([expect.stringContaining("run the flyd viewer")]);
    expect(pending()[0]).toContain("delivered");

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
    expect(document.querySelector(".msg.user .state")?.textContent).toBe("saved, but firstmate was not woken: fm-inbox: firstmate was NOT woken");
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
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ session: "latest", text: "", images: [{ mediaType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" }] });
    expect(document.querySelectorAll(".attachment")).toHaveLength(0);
    expect(document.querySelectorAll(".msg.pending .shot img")).toHaveLength(1);
    void stream;
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
    expect(pending()[0]).toContain("delivered");

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

    (document.getElementById("mode") as HTMLButtonElement).click();
    expect(document.documentElement.getAttribute("data-view")).toBe("full");
    expect(localStorage.getItem("flyd-view-mode")).toBe("full");
    (document.getElementById("mode") as HTMLButtonElement).click();
    expect(document.documentElement.getAttribute("data-view")).toBe("summary");
  });

  it("swaps a pending first-sentence summary for the model's when it arrives", async () => {
    load("");
    await settle();
    const stream = open("latest", [
      { id: "r1", role: "assistant", html: "<p>Long.</p>", summary: { html: "<p>First sentence.</p>", source: "first-sentence", pending: true } } as never,
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
});
