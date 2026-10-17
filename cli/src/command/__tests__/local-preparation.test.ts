import { describe, it, expect, vi } from "vitest";
import { runLocalPreparation, type LocalPreparationInput } from "../local-preparation.js";
import { resolveModelConnection } from "../../lib/config.js";

vi.mock("../../lib/config.js", () => ({ resolveModelConnection: vi.fn(() => ({ providerIdentity: "local/model" })) }));
const input: LocalPreparationInput = {
  attemptId: "attempt", goal: "Draft a sponsor follow-up", outcome: "A sponsor follow-up draft",
  source: { turnId: "turn", sessionId: "session", text: "Need sponsors", revision: 1, consentRef: "remit" },
  context: [{ ref: "source-1", text: "Acme has not replied" }], model: "model", providerIdentity: "local/model",
};
function setup(replies: string[]) {
  const store = { read: vi.fn(), isActive: vi.fn(() => true), complete: vi.fn(() => true), fail: vi.fn() };
  const complete = vi.fn(async () => replies.shift() ?? "");
  return { store, complete };
}
const accepted = 'MET 1: `Dear Acme` is a follow-up draft\nMET 2: `Acme has not replied` is supplied';
describe("bounded local preparation", () => {
  it("publishes only after an independent acceptance check", async () => {
    const deps = setup(["Dear Acme", accepted]);
    expect(await runLocalPreparation(input, deps)).toBe(true);
    expect(deps.store.complete).toHaveBeenCalledWith("attempt", { content: "Dear Acme", evidenceRefs: ["source-1"] });
    expect(deps.complete).toHaveBeenCalledTimes(2);
  });
  it("permits only one repair, then fails closed", async () => {
    const deps = setup(["draft", "UNMET 1: wrong\nUNMET 2: unsupported", "repair", "UNMET 1: wrong\nUNMET 2: unsupported"]);
    expect(await runLocalPreparation(input, deps)).toBe(false);
    expect(deps.complete).toHaveBeenCalledTimes(4);
    expect(deps.store.complete).not.toHaveBeenCalled();
  });
  it("does not repair a broken checker", async () => {
    const deps = setup(["draft", "looks fine"]);
    expect(await runLocalPreparation(input, deps)).toBe(false);
    expect(deps.complete).toHaveBeenCalledTimes(2);
  });
  it("reserves all input and output before any provider call", async () => {
    const deps = setup([]);
    expect(await runLocalPreparation({ ...input, context: [{ ref: "big", text: "x".repeat(12000) }] }, deps)).toBe(false);
    expect(deps.complete).not.toHaveBeenCalled();
  });
  it("rejects a changed actual provider", async () => {
    const deps = setup([]);
    vi.mocked(resolveModelConnection).mockReturnValueOnce({ model: "model", apiKey: "test", providerIdentity: "other/model" });
    expect(await runLocalPreparation(input, deps)).toBe(false);
    expect(deps.complete).not.toHaveBeenCalled();
  });
  it("counts verifier input against the same aggregate envelope", async () => {
    const deps = setup(["draft"]);
    expect(await runLocalPreparation({ ...input, context: [{ ref: "large", text: "x".repeat(5500) }] }, deps)).toBe(false);
    expect(deps.complete).toHaveBeenCalledTimes(1);
    expect(deps.store.complete).not.toHaveBeenCalled();
  });
  it("hard-aborts a stalled provider after 120 seconds", async () => {
    vi.useFakeTimers();
    try {
      const deps = setup([]);
      const running = runLocalPreparation(input, { ...deps, complete: () => new Promise<string>(() => {}) });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(await running).toBe(false);
      expect(deps.store.fail).toHaveBeenCalledWith("attempt", "Preparation timed out");
      expect(deps.store.complete).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("cancellation aborts in-flight completion and prevents publication", async () => {
    vi.useFakeTimers();
    try {
      const deps = setup([]);
      const complete = vi.fn(() => new Promise<string>(() => {}));
      const running = runLocalPreparation(input, { ...deps, complete });
      deps.store.isActive.mockReturnValue(false);
      await vi.advanceTimersByTimeAsync(500);
      expect(await running).toBe(false);
      expect(deps.store.complete).not.toHaveBeenCalled();
      expect(complete.mock.calls[0]).toBeDefined();
    } finally { vi.useRealTimers(); }
  });
});
