import { describe, expect, it } from "vitest";
import { evaluatePredicates } from "../system-one/jev.js";
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
