import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jevHealthMessage, jevHealthNotice, jevHealthPath, jevRuntimeStatus, readJevHealth } from "../system-one/health.js";
import { evaluatePredicates } from "../system-one/jev.js";

const question = [{ id: "form", instructions: "Which form?" }];
const success = () => new Response(JSON.stringify({ answers: { form: { noul: 0.95 } } }), { status: 200 });

describe("Jev provider failures reach the operator even when a caller falls back", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-jev-health-"));
    vi.stubEnv("FLYD_DIR", dir);
    vi.stubEnv("FLYD_JEV_ENABLED", "false");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  async function response(status: number, error: unknown, reportHealth = true) {
    return evaluatePredicates({ utterance: "private question" }, question, {
      apiKey: "private-api-key", reportHealth,
      fetchFn: async () => new Response(JSON.stringify(error), { status }),
    });
  }

  it.each([
    [402, { error: { code: "insufficient_credits" } }, "credits_exhausted"],
    [429, { error: { code: "insufficient_quota" } }, "credits_exhausted"],
    [402, { error: "Payment required" }, "billing"],
    [429, { error: { code: "rate_limit_exceeded" } }, "rate_limited"],
    [401, { error: "Invalid API key" }, "authentication"],
    [503, { error: "Service unavailable" }, "provider_unavailable"],
  ] as const)("distinguishes HTTP %s (%j) as %s without losing the fallback", async (status, body, failureKind) => {
    const result = await response(status, body);
    expect(result).toMatchObject({ ok: false, answers: {}, error: `jev_http_${status}`, httpStatus: status, failureKind });
    expect(readJevHealth()).toMatchObject({ state: "degraded", failureKind, httpStatus: status });
    expect(jevRuntimeStatus().message).toContain("fallbacks");
    expect(console.warn).toHaveBeenCalled();
  });

  it("keeps one persistent credit warning through repeats, disabled calls and timeouts until Jev succeeds", async () => {
    await response(402, { error: "out of credits" });
    const first = jevHealthNotice();
    expect(first).toMatchObject({ kind: "attention", text: expect.stringContaining("credit is exhausted") });
    await response(402, { error: "out of credits" });
    expect(jevHealthNotice()).toEqual(first);
    expect(console.warn).toHaveBeenCalledTimes(1);
    await evaluatePredicates({}, question);
    await evaluatePredicates({}, question, { apiKey: "test", fetchFn: async () => { throw new Error("network down"); } });
    expect(jevHealthNotice()).toEqual(first);
    await evaluatePredicates({}, question, { apiKey: "test", fetchFn: async () => success() });
    expect(readJevHealth()).toMatchObject({ state: "ready" });
    expect(jevHealthNotice()).toBeUndefined();
    await response(402, { error: "out of credits" });
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(jevHealthNotice()?.id).not.toBe(first?.id);
  });

  it("also recognizes a non-JSON credit error on a 429 response", async () => {
    const result = await evaluatePredicates({}, question, {
      apiKey: "test", fetchFn: async () => new Response("insufficient credits", { status: 429 }),
    });
    expect(result.failureKind).toBe("credits_exhausted");
    expect(jevHealthNotice()?.text).toContain("credit is exhausted");
  });

  it("persists only safe health metadata, never the key, question, predicate or provider error body", async () => {
    await response(402, { error: { code: "insufficient_credits", message: "echo private-api-key and private question" } });
    const saved = readFileSync(jevHealthPath(), "utf8");
    expect(saved).toContain("credits_exhausted");
    expect(saved).not.toMatch(/private|utterance|instructions|echo|form|projection/);
    expect(JSON.stringify(jevRuntimeStatus())).not.toMatch(/private-api-key|private question/);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/private-api-key|private question/);
  });

  it("never lets an offline replay hide a live credit failure", async () => {
    await response(402, { error: "out of credits" });
    const first = readJevHealth();
    await evaluatePredicates({}, question, { apiKey: "replay", reportHealth: false, fetchFn: async () => success() });
    expect(readJevHealth()).toEqual(first);
  });

  it("reports a requested but missing key, but does not call a disabled provider broken", async () => {
    await evaluatePredicates({}, question);
    expect(readJevHealth()).toBeNull();
    await evaluatePredicates({}, question, { apiKey: "" });
    expect(jevHealthNotice()?.text).toContain("without an API key");
  });

  it("reports unusable successful responses instead of marking the provider ready", async () => {
    const result = await response(200, { answers: {} });
    expect(result).toMatchObject({ ok: false, failureKind: "invalid_response", error: "jev_missing_answers" });
    expect(readJevHealth()?.state).toBe("degraded");
  });

  it("keeps the fallback working and logs the problem if health cannot be saved", async () => {
    writeFileSync(join(dir, "cognition"), "not a directory");
    expect(await response(402, { error: "out of credits" })).toMatchObject({ ok: false, failureKind: "credits_exhausted" });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Could not save provider health"));
  });

  it("does not invent account credit or health when there is no valid observation", () => {
    expect(jevHealthMessage(null)).toContain("credit is unknown");
    mkdirSync(dirname(jevHealthPath()), { recursive: true });
    writeFileSync(jevHealthPath(), JSON.stringify({ version: 1, state: "degraded", checkedAt: "invalid", since: "invalid", failureKind: "invented" }));
    expect(readJevHealth()).toBeNull();
  });
});
