// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOBILE_PAGE, MOBILE_SCRIPT } from "../surface.js";

const state = { csrf: "session-csrf", voice: true, accountsEnabled: true, requests: [] as unknown[] };
let calls: Array<{ url: string; body?: Record<string, unknown> }>;
let sendResult: Promise<Response>, resumeAudio: Promise<void>, stopped: ReturnType<typeof vi.fn>;
const closed = vi.fn(async () => {});
let refreshTick: (() => void) | undefined;
function json(data: unknown): Response { return new Response(JSON.stringify(data)); }
async function flush(): Promise<void> { for (let i=0;i<15;i++) await Promise.resolve(); }
beforeEach(() => {
  calls = []; state.requests = []; refreshTick = undefined;
  sendResult = Promise.resolve(json({ status: "accepted" })); resumeAudio = Promise.resolve(); stopped = vi.fn(); closed.mockClear();
  document.body.innerHTML = MOBILE_PAGE.match(/<body>([\s\S]*)<\/body>/)![1];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: { body?: string }) => {
    calls.push({ url, ...(options?.body ? { body: JSON.parse(options.body) } : {}) });
    if (url === "/api/send") return sendResult;
    return json(state);
  }));
  vi.stubGlobal("setInterval", vi.fn((fn: () => void) => { refreshTick = fn; return 1; }));
  vi.stubGlobal("clearInterval", vi.fn());
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: stopped }] }) } });
  vi.stubGlobal("AudioContext", class {
    resume() { return resumeAudio; }
    close() { return closed(); }
    createMediaStreamSource() { throw new Error("Capture must not be installed after backgrounding"); }
  });
});
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe("phone reconnect and microphone lifecycle", () => {
  it("polling can acknowledge a request before POST returns without corrupting the composer", async () => {
    let complete!: (value: Response) => void;
    sendResult = new Promise(resolve => { complete = resolve; });
    // A function scope isolates this test's script bindings; actual browser uses one page scope.
    new Function(MOBILE_SCRIPT)(); await flush();
    const message = document.getElementById("message") as HTMLTextAreaElement;
    message.value = "Check the inbox";
    document.getElementById("composer")!.dispatchEvent(new Event("submit", { cancelable: true })); await flush();
    const sent = calls.find(call => call.url === "/api/send")!.body!;
    state.requests = [{ id: sent.id, text: sent.text, status: "running" }];
    refreshTick?.(); await flush();
    message.value = "A new thought while that runs";
    complete(json({ id: sent.id })); await flush();
    expect(message.value).toBe("A new thought while that runs");
    expect(document.getElementById("notice")!.textContent).not.toContain("null");
    expect(calls.filter(call => call.url === "/api/send")).toHaveLength(1);
    expect((document.getElementById("send") as HTMLButtonElement).disabled).toBe(false);
  });
  it("removes results no longer present in canonical state after source erasure", async () => {
    state.requests = [{ id: "erased-result", text: "A private request", status: "succeeded", html: "<p>Private result</p>" }];
    new Function(MOBILE_SCRIPT)(); await flush();
    expect(document.getElementById("request-erased-result")).not.toBeNull();
    state.requests = []; refreshTick?.(); await flush();
    expect(document.getElementById("request-erased-result")).toBeNull();
  });
  it("cancels microphone acquisition if the phone backgrounds while audio resume is suspended", async () => {
    let resume!: () => void; resumeAudio = new Promise(resolve => { resume = resolve; });
    new Function(MOBILE_SCRIPT)(); await flush();
    document.getElementById("voice")!.click(); await flush();
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange")); resume(); await flush();
    expect(stopped).toHaveBeenCalled(); expect(closed).toHaveBeenCalled();
    expect(document.getElementById("voice")!.getAttribute("aria-pressed")).toBe("false");
    expect(calls.some(call => call.url === "/api/transcribe")).toBe(false);
  });
});

it("shows newest results first, collapses older answers and prepares follow-up without sending", async () => {
  state.requests = [1,2,3].map(n=>({id:String(n),text:'Question '+n,status:'succeeded',html:'<p>Answer '+n+'</p>'}));
  new Function(MOBILE_SCRIPT)(); await flush();
  expect([...document.getElementById('results')!.children].map(n=>n.id)).toEqual(['request-3','request-2','request-1']);
  const oldest=document.getElementById('request-1')!;
  expect((oldest.querySelector('.answer') as HTMLElement).hidden).toBe(true);
  (oldest.querySelector('.result-actions button') as HTMLButtonElement).click();
  expect((oldest.querySelector('.answer') as HTMLElement).hidden).toBe(false);
  (oldest.querySelector('.result-actions button:last-child') as HTMLButtonElement).click();
  expect((document.getElementById('message') as HTMLTextAreaElement).value).toContain('Question 1');
  expect(calls.some(call=>call.url==='/api/send')).toBe(false);
});

it("lists today's news with more/less buttons that rate the story", async () => {
  (state as Record<string, unknown>).news = { date: "2026-10-24", items: [{ n: 2, title: "<b>DOOM</b> on a clamp meter", url: "https://hackaday.test/doom", source: "Hackaday", why: "any screen becomes a console", kind: "relevant" }] };
  new Function(MOBILE_SCRIPT)(); await flush();
  const section = document.getElementById("news")!;
  expect(section.hidden).toBe(false);
  const link = section.querySelector("a")!;
  expect(link.textContent).toBe("<b>DOOM</b> on a clamp meter");
  expect(link.getAttribute("href")).toBe("https://hackaday.test/doom");
  (section.querySelector('button[data-verdict="less"]') as HTMLButtonElement).click(); await flush();
  expect(calls.find(call => call.url === "/api/news/feedback")?.body).toEqual({ n: 2, url: "https://hackaday.test/doom", verdict: "less" });
  expect(section.querySelector('button[data-verdict="less"]')!.getAttribute("aria-pressed")).toBe("true");
  delete (state as Record<string, unknown>).news;
});
