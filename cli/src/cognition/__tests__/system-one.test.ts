import { describe, expect, it } from "vitest";
import { evaluatePredicates, JEV_PINNED_MODEL } from "../system-one/jev.js";
import { predicatePasses } from "../system-one/policy.js";

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return (async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("Jev System-1 predicate layer", () => {
  it("batches predicates and preserves probabilities/confidence", async () => {
    const result = await evaluatePredicates(
      { statement: "GNM3 is done" },
      [
        { id: "is_correction", instructions: "correction?" },
        { id: "changes_current_state", instructions: "state change?" },
      ],
      {
        apiKey: "test",
        fetchFn: fakeFetch({
          model: "jev-test",
          answers: {
            is_correction: { noul: 0.96, confidence: 0.91 },
            changes_current_state: { probability: 0.98, confidence: 0.89 },
          },
        }),
      },
    );
    expect(result.ok).toBe(true);
    expect(result.model).toBe("jev-test");
    expect(result.answers.is_correction.probability).toBe(0.96);
    expect(predicatePasses(result, "is_correction")).toBe(true);
  });

  it("fails safe when Jev is not configured", async () => {
    const previous = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.FLYD_JEV_API_KEY;
    delete process.env.BEACON_JEV_API_KEY;
    const result = await evaluatePredicates({ statement: "x" }, [{ id: "is_correction", instructions: "?" }], { apiKey: "" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("jev_not_configured");
    if (previous) process.env.TYPESAFE_API_KEY = previous;
  });

  it("does not pass low-confidence probability gates", async () => {
    const result = await evaluatePredicates(
      { statement: "maybe" },
      [{ id: "supersedes_existing_claim", instructions: "supersedes?" }],
      { apiKey: "test", fetchFn: fakeFetch({ answers: { supersedes_existing_claim: { noul: 0.55, confidence: 0.9 } } }) },
    );
    expect(predicatePasses(result, "supersedes_existing_claim")).toBe(false);
  });
});

interface CapturedRequest {
  url: string;
  body: { model: string; state: Record<string, unknown>; questions: Record<string, { type: string; instructions: string; criteria: unknown }> };
}

/** Fake TypeSafe endpoint that validates request shapes the way the live API does. */
function typesafeFake(answers: Record<string, unknown>, captured: CapturedRequest[] = [], extra: Record<string, unknown> = {}): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as CapturedRequest["body"];
    captured.push({ url, body });
    const invalid = Object.values(body.questions).some((q) =>
      (q.type === "score" && !Array.isArray(q.criteria)) ||
      (q.type === "choice" && (Array.isArray(q.criteria) || typeof q.criteria !== "object")));
    if (invalid) return { ok: false, status: 422, json: async () => ({ detail: "criteria" }) };
    return { ok: true, status: 200, json: async () => ({ model: "jev-1.13.0", answers, usage: { input_tokens: 1000, output_tokens: 19 }, ...extra }) };
  }) as unknown as typeof fetch;
}

describe("Jev client wire contract (docs.typesafe.ai/api)", () => {
  it("sends Score criteria as an ordered array, even when declared as a map", async () => {
    const captured: CapturedRequest[] = [];
    const result = await evaluatePredicates(
      { note: "Release shipped Tuesday" },
      [
        { id: "usefulness", type: "score", instructions: "How useful?", criteria: ["Irrelevant", "Somewhat useful", "Directly answers it"] },
        { id: "legacy", type: "score", instructions: "How useful?", criteria: { low: "Irrelevant", mid: "Somewhat", high: "Directly" } },
      ],
      {
        apiKey: "test",
        fetchFn: typesafeFake({
          usefulness: { type: "score", score: 1.5, confidence: 0.52, legend: { 0: "Irrelevant", 1: "Somewhat useful", 2: "Directly answers it" }, probabilities: { 0: 0.1, 1: 0.3, 2: 0.6 } },
          legacy: { type: "score", score: 1, confidence: 0.4, probabilities: { 0: 0.2, 1: 0.6, 2: 0.2 } },
        }, captured),
      },
    );
    expect(result.ok).toBe(true);
    expect(captured[0].body.questions.usefulness.criteria).toEqual(["Irrelevant", "Somewhat useful", "Directly answers it"]);
    expect(captured[0].body.questions.legacy.criteria).toEqual(["Irrelevant", "Somewhat", "Directly"]);
    expect(result.answers.usefulness).toMatchObject({ type: "score", score: 1.5, levels: 3, probability: 0.75, confidence: 0.52 });
  });

  it("fails locally, without a network call, on a malformed Score or Choice", async () => {
    const captured: CapturedRequest[] = [];
    const result = await evaluatePredicates({ x: 1 }, [{ id: "bad", type: "score", instructions: "?", criteria: ["only one"] }], { apiKey: "test", fetchFn: typesafeFake({}, captured) });
    expect(result).toMatchObject({ ok: false, error: "invalid_question:bad:score_needs_levels" });
    expect(captured).toHaveLength(0);
  });

  it("surfaces a 422 as a failed evaluation", async () => {
    const fetchFn = (async () => ({ ok: false, status: 422, json: async () => ({}) })) as unknown as typeof fetch;
    const result = await evaluatePredicates({ x: 1 }, [{ id: "q", instructions: "?" }], { apiKey: "test", fetchFn });
    expect(result).toMatchObject({ ok: false, evaluator: "jev", error: "jev_http_422" });
  });

  it("records a Choice's probability as the chosen option's probability", async () => {
    const result = await evaluatePredicates(
      { intent: "rewrite this" },
      [{ id: "mode", type: "choice", instructions: "Which?", criteria: { answer: "Answer.", insert: "Insert." } }],
      { apiKey: "test", fetchFn: typesafeFake({ mode: { type: "choice", choice: "insert", confidence: 0.6, probabilities: { answer: 0.2, insert: 0.8 } } }) },
    );
    expect(result.answers.mode).toMatchObject({ type: "choice", choice: "insert", probability: 0.8, confidence: 0.6, probabilities: { answer: 0.2, insert: 0.8 } });
    expect(predicatePasses(result, "mode", 0.75)).toBe(true);
  });

  it("derives cost from input tokens and keeps usage", async () => {
    const result = await evaluatePredicates({ x: 1 }, [{ id: "q", instructions: "?" }], { apiKey: "test", fetchFn: typesafeFake({ q: { type: "noul", noul: 0.9 } }) });
    expect(result.usage).toEqual({ inputTokens: 1000, outputTokens: 19 });
    expect(result.costUSD).toBeCloseTo(0.000042, 12);
  });

  it("sends only the caller's state, without the rubric version", async () => {
    const captured: CapturedRequest[] = [];
    await evaluatePredicates({ utterance: "hi" }, [{ id: "q", instructions: "?" }], { apiKey: "test", fetchFn: typesafeFake({ q: { noul: 0.5 } }, captured) });
    expect(captured[0].body.state).toEqual({ utterance: "hi" });
    expect(captured[0].body.questions.q).toEqual({ type: "noul", instructions: "?", criteria: { true: "The state satisfies this criterion.", false: "The state does not satisfy this criterion." } });
  });

  it("keeps jev-latest by default and lets config or FLYD_JEV_MODEL pin an exact version", async () => {
    const previous = process.env.FLYD_JEV_MODEL;
    const captured: CapturedRequest[] = [];
    const fetchFn = typesafeFake({ q: { noul: 0.5 } }, captured);
    try {
      delete process.env.FLYD_JEV_MODEL;
      await evaluatePredicates({ x: 1 }, [{ id: "q", instructions: "?" }], { apiKey: "test", fetchFn });
      process.env.FLYD_JEV_MODEL = JEV_PINNED_MODEL;
      const pinned = await evaluatePredicates({ x: 1 }, [{ id: "q", instructions: "?" }], { apiKey: "test", fetchFn });
      await evaluatePredicates({ x: 1 }, [{ id: "q", instructions: "?" }], { apiKey: "test", fetchFn, model: "jev-1.12.0" });
      expect(captured.map((c) => c.body.model)).toEqual(["jev-latest", JEV_PINNED_MODEL, "jev-1.12.0"]);
      expect(pinned.model).toBe("jev-1.13.0");
    } finally {
      if (previous === undefined) delete process.env.FLYD_JEV_MODEL;
      else process.env.FLYD_JEV_MODEL = previous;
    }
  });

  it("routes egress through the policy gateway and denies undeclared fields before any network call", async () => {
    const captured: CapturedRequest[] = [];
    const fetchFn = typesafeFake({ q: { noul: 0.9 } }, captured);
    const denied = await evaluatePredicates({ utterance: "hi", selection_text: "private" }, [{ id: "q", instructions: "?" }], { apiKey: "test", fetchFn }, { purpose: "interpret", allowedFields: ["utterance"] });
    expect(denied.ok).toBe(false);
    expect(denied.error).toMatch(/^egress_denied: .*selection_text/);
    expect(denied.egressReceiptId).toBeTruthy();
    const revoked = await evaluatePredicates({ utterance: "hi" }, [{ id: "q", instructions: "?" }], { apiKey: "test", fetchFn, consentLookup: { isRevoked: () => true } }, { purpose: "interpret", allowedFields: ["utterance"] });
    expect(revoked.error).toMatch(/^egress_denied: .*revoked/);
    expect(captured).toHaveLength(0);
    const allowed = await evaluatePredicates({ utterance: "hi" }, [{ id: "q", instructions: "?" }], { apiKey: "test", fetchFn }, { purpose: "interpret", allowedFields: ["utterance"] });
    expect(allowed.ok).toBe(true);
    expect(allowed.egressReceiptId).toBeTruthy();
  });

  it("makes no network call and no egress decision when Jev is not enabled", async () => {
    const previous = process.env.FLYD_JEV_ENABLED;
    delete process.env.FLYD_JEV_ENABLED;
    const captured: CapturedRequest[] = [];
    try {
      const result = await evaluatePredicates({ x: 1 }, [{ id: "q", instructions: "?" }], { fetchFn: typesafeFake({}, captured) });
      expect(result).toMatchObject({ ok: false, evaluator: "none", model: "jev-latest", error: "jev_not_enabled" });
      expect(result.egressReceiptId).toBeUndefined();
      expect(captured).toHaveLength(0);
    } finally {
      if (previous !== undefined) process.env.FLYD_JEV_ENABLED = previous;
    }
  });
});
