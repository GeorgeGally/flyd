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
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/api/send" ? json(sendResponse) : json({ assistantLabel: "firstmate", sessions: SESSIONS }))));
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
});
