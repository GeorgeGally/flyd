import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateExecutivePredicates, evaluateGeminiPredicates, geminiQuestion } from "../system-one/decision-provider.js";

afterEach(() => vi.unstubAllEnvs());

describe("Gemini Decision 1 System-1 adapter", () => {
  it("uses the Gemini REST contract and normalizes a batch of bounded answers", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
    const result = await evaluateGeminiPredicates(
      { source_kind: "domain", summary: "tests broken", question: "which suite", options: ["vitest", "jest"] },
      [
        { id: "routine", type: "noul", instructions: "Routine?", criteria: { true: "Routine internal work", false: "Requires user approval" } },
        { id: "action", type: "choice", instructions: "Choose safe tactic", criteria: { investigate: "Investigate", rebrief: "Rebrief" } },
      ],
      {
        apiKey: "fake-key",
        fetchFn: (async (url: string, init: RequestInit) => {
          calls.push({
            url, headers: init.headers as Record<string, string>,
            body: JSON.parse(String(init.body)) as Record<string, unknown>,
          });
          return {
            ok: true, status: 200,
            json: async () => ({
              model: "gemini-decision-1",
              answers: {
                routine: { type: "noul", noul: 0.91, confidence: 0.91 },
                action: { type: "choice", choice: "investigate", probabilities: { investigate: 0.86, rebrief: 0.14 }, confidence: 0.86 },
              },
              usage: { total_input_tokens: 2000, total_output_tokens: 0 },
            }),
          };
        }) as unknown as typeof fetch,
      },
      { purpose: "executive", allowedFields: ["source_kind", "summary", "question", "options"] },
    );

    expect(result).toMatchObject({
      ok: true, evaluator: "gemini", model: "gemini-decision-1",
      answers: { routine: { probability: 0.91 }, action: { choice: "investigate", probability: 0.86 } },
      usage: { inputTokens: 2000, outputTokens: 0 },
    });
    expect(result.costUSD).toBeCloseTo(0.0002, 10);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/decisions");
    expect(calls[0].headers["x-goog-api-key"]).toBe("fake-key");
    expect(calls[0].headers).not.toHaveProperty("authorization");
    expect(JSON.parse(String(calls[0].body.input))).toEqual({
      source_kind: "domain", summary: "tests broken", question: "which suite", options: ["vitest", "jest"],
    });
    expect(calls[0].body.questions).toMatchObject({
      routine: { type: "noul", criteria: { true_description: "Routine internal work", false_description: "Requires user approval" } },
      action: { type: "choice", criteria: { investigate: "Investigate", rebrief: "Rebrief" } },
    });
  });

  it("omits Jev-only default criteria when Gemini Noul has none", () => {
    expect(geminiQuestion({ id: "x", instructions: "?", type: "noul" })).toEqual({
      type: "noul", instructions: "?",
    });
  });

  it("fails closed on invalid questions before network", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const result = await evaluateGeminiPredicates(
      { summary: "x" },
      [{ id: "invalid key", instructions: "?" }],
      { apiKey: "fake", fetchFn },
    );
    expect(result).toMatchObject({ ok: false, error: "invalid_question_id" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("blocks undeclared or revoked context before network", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const undeclared = await evaluateGeminiPredicates(
      { summary: "routine", secret_note: "private" },
      [{ id: "routine", instructions: "?" }],
      { apiKey: "fake", fetchFn },
      { purpose: "executive", allowedFields: ["summary"] },
    );
    expect(undeclared.error).toMatch(/^egress_denied/);
    const revoked = await evaluateGeminiPredicates(
      { summary: "routine" },
      [{ id: "routine", instructions: "?" }],
      { apiKey: "fake", fetchFn, consentLookup: { isRevoked: () => true } },
      { purpose: "executive", allowedFields: ["summary"] },
    );
    expect(revoked.error).toMatch(/^egress_denied/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("uses Jev by default and Gemini only when explicitly selected", async () => {
    vi.stubEnv("FLYD_EXECUTIVE_DECISION_PROVIDER", "gemini");
    const called: string[] = [];
    const fetchFn = (async (url: string) => {
      called.push(url);
      return { ok: true, status: 200, json: async () => ({ answers: { q: { noul: 0.88 } } }) };
    }) as unknown as typeof fetch;
    const result = await evaluateExecutivePredicates({ summary: "hello" }, [{ id: "q", instructions: "?" }], { apiKey: "test", fetchFn });
    expect(result.evaluator).toBe("gemini");
    expect(called[0]).toMatch(/generativelanguage\.googleapis\.com/);

    const jev = await evaluateExecutivePredicates({ summary: "hello" }, [{ id: "q", instructions: "?" }], { provider: "jev", apiKey: "test", fetchFn });
    expect(jev.evaluator).toBe("jev");
    expect(called[1]).toMatch(/typesafe\.ai/);
  });

  it("does not make a request without credentials", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const result = await evaluateGeminiPredicates({ summary: "hello" }, [{ id: "q", instructions: "?" }], { fetchFn });
    expect(result).toMatchObject({ ok: false, error: "gemini_not_configured" });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
