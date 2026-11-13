import { describe, expect, it } from "vitest";
import { canRecoverInternally, judgeRecovery, maxAutonomousAttempts } from "../cos/recovery.js";
import type { RecoveryInput } from "../cos/recovery.js";
import type { PredicateEvaluation } from "../../cognition/system-one/types.js";

const input: RecoveryInput = {
  objective: { words: "Fix the catalog filter", brief: undefined, adaptations: [] },
  run: { key: "r1", team: "coding", outcome: "Fix catalog filter", attempt: 1, ref: "domain-run-coding" },
  failure: "the component test failed",
  retryable: true,
  effectKnownInternal: true,
};

function result(choice: string): PredicateEvaluation {
  return {
    ok: true, evaluator: "jev", rubricVersion: "test", projectionHash: "test",
    evaluatedAt: "2026-11-13T00:00:00Z", latencyMs: 1,
    answers: { cos_recovery_tactic: { id: "cos_recovery_tactic", type: "choice", choice, confidence: 0.95, probability: 0.95 } },
  };
}

describe("bounded CoS recovery", () => {
  it("allows a genuinely different internal tactic after the second failure", async () => {
    const second = { ...input, run: { ...input.run, attempt: 2, failure: input.failure } };
    const response = await judgeRecovery(second, { evaluate: async () => result("rebrief_with_different_tactic") });
    expect(response.action).toBe("rebrief");
    expect(response.reason).toMatch(/fundamentally different/);
    expect(canRecoverInternally(second)).toBe(true);
  });

  it("stops at a bounded cumulative attempt cap without another model call", async () => {
    const calls: string[] = [];
    const r = await judgeRecovery({ ...input, run: { ...input.run, attempt: 3 } }, {
      evaluate: async () => { calls.push("called"); return result("rebrief_with_different_tactic"); },
    });
    expect(r.action).toBe("hold");
    expect(calls).toEqual([]);
    expect(maxAutonomousAttempts("100")).toBe(5);
    expect(maxAutonomousAttempts("1")).toBe(2);
  });

  it("never repeats outward or unknown effects on its own", async () => {
    for (const altered of [
      { ...input, objective: { words: "Book a table" } },
      { ...input, run: { ...input.run, outcome: "Push a branch" } },
      { ...input, effectKnownInternal: false },
      { ...input, run: { ...input.run, ref: "job:booking" } },
      { ...input, run: { ...input.run, team: "life" as const } },
    ]) {
      expect(canRecoverInternally(altered)).toBe(false);
      expect((await judgeRecovery(altered)).action).toBe("hold");
    }
  });

  it("honors a high-confidence hold without silently retrying", async () => {
    const r = await judgeRecovery(input, { evaluate: async () => result("hold_for_evidence") });
    expect(r.action).toBe("hold");
  });

  it("uses a bounded, safe internal fallback when no provider is configured", async () => {
    const r = await judgeRecovery(input, { evaluate: async () => ({ ok: false, evaluator: "none", rubricVersion: "test", projectionHash: "t", evaluatedAt: "", latencyMs: 1, answers: {} }) });
    expect(r.action).toBe("rebrief");
  });
});
