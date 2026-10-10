// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installComposerPredictions } from "../composer-predictions-client.js";

let input: HTMLTextAreaElement;
let form: HTMLFormElement;
let session: string;
let attached: boolean;
let control: ReturnType<typeof installComposerPredictions>;
const json = (prediction: unknown) => new Response(JSON.stringify({ prediction }), { headers: { "content-type": "application/json" } });
const offered = { id: "offer", suffix: " and check the tests" };
const flush = async () => { await vi.advanceTimersByTimeAsync(230); };
const type = (text: string) => { input.value = text; input.setSelectionRange(text.length, text.length); input.dispatchEvent(new Event("input")); };
const key = (value: string, init: KeyboardEventInit = {}) => { const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...init }); input.dispatchEvent(event); return event; };
const predictions = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/predict");

beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); session = "one"; attached = false;
  document.body.innerHTML = '<form id="form"><div id="layer" hidden><span id="prefix"></span><span id="suffix"></span></div><textarea></textarea><button type="button" id="toggle"></button></form>';
  input = document.querySelector("textarea")!; form = document.querySelector("form")!; input.focus();
  vi.stubGlobal("fetch", vi.fn(async () => json(offered)));
  control = installComposerPredictions({ input, composer: form, layer: document.getElementById("layer")!, prefix: document.getElementById("prefix")!, suffix: document.getElementById("suffix")!, toggle: document.getElementById("toggle")! as HTMLButtonElement, session: () => session, token: () => "token", grow: () => {}, attached: () => attached });
});
afterEach(() => { control.reset(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("typing suggestions", () => {
  it("shows ghost text without changing the draft; Tab accepts but never submits", async () => {
    const submit = vi.fn(); form.addEventListener("submit", submit);
    type("implement it"); await flush();
    expect(input.value).toBe("implement it"); expect(document.getElementById("suffix")!.textContent).toBe(offered.suffix);
    expect(key("Tab").defaultPrevented).toBe(true); expect(input.value).toBe("implement it and check the tests"); expect(submit).not.toHaveBeenCalled();
  });
  it("cancels stale requests and ignores a late answer even if fetch ignores abort", async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    type("implement it"); await flush();
    const signal = (predictions()[0]![1] as RequestInit).signal!;
    type("actually wait"); expect(signal.aborted).toBe(true);
    finish(json(offered)); await Promise.resolve(); await Promise.resolve();
    expect(document.getElementById("layer")!.hidden).toBe(true);
  });
  it("discards predictions when sessions change", async () => {
    type("implement it"); await flush(); session = "two"; control.reset();
    expect(key("Tab").defaultPrevented).toBe(false); expect(input.value).toBe("implement it");
  });
  it("Escape dismisses; Tab remains normal navigation without a suggestion", async () => {
    type("implement it"); await flush(); expect(key("Escape").defaultPrevented).toBe(true);
    expect(key("Tab").defaultPrevented).toBe(false); expect(document.getElementById("layer")!.hidden).toBe(true);
  });
  it("suppresses slash commands, selected text, attachments and IME composition", async () => {
    type("/review"); await flush();
    type("implement it"); input.setSelectionRange(0, 4); await flush();
    attached = true; type("implement it"); await flush(); attached = false;
    input.dispatchEvent(new CompositionEvent("compositionstart")); type("implement it"); await flush();
    expect(predictions()).toHaveLength(0); expect(key("Tab", { isComposing: true }).defaultPrevented).toBe(false);
  });
  it("reuses the remaining suffix when the user types matching characters", async () => {
    type("implement it"); await flush(); type("implement it and"); await flush();
    expect(predictions()).toHaveLength(1); expect(document.getElementById("suffix")!.textContent).toBe(" check the tests");
  });
  it("turns suggestions off and remembers the choice", async () => {
    document.getElementById("toggle")!.click(); type("implement it"); await flush();
    expect(predictions()).toHaveLength(0); expect(localStorage.getItem("flyd.predictions")).toBe("off");
  });
  it("renders provider content as text and tracks edits after acceptance", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ id: "offer", suffix: " <img src=x>" }));
    type("implement it"); await flush(); expect(document.querySelector("img")).toBeNull();
    key("Tab"); type("implement it differently");
    expect(vi.mocked(fetch).mock.calls.some(([url, init]) => url === "/api/prediction-feedback" && JSON.parse(String(init!.body)).event === "edited")).toBe(true);
  });
});
