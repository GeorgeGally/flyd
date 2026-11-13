import { describe, expect, it } from "vitest";
import { judgeOperationalQuestion, operationalQuestionKey, protectedOperationalQuestion } from "../cos/operational-judgment.js";
import type { PredicateEvaluation } from "../../cognition/system-one/types.js";

const routine = {
  domain: "coding" as const,
  goal: "Make the notification screen work",
  question: "Should we use Vitest or Jest for this component test?",
  options: ["Vitest", "Jest"],
  recommendation: "Vitest",
  evidenceRefs: ["domain-run:example"],
};

function fake(choice: string, confidence = 0.96, probability = 0.94): PredicateEvaluation {
  return {
    ok: true, evaluator: "jev", model: "mock", rubricVersion: "test",
    projectionHash: "case", evaluatedAt: "2026-11-13T00:00:00Z", latencyMs: 1,
    answers: { cos_operational_disposition: { id: "cos_operational_disposition", type: "choice", choice, confidence, probability } },
  };
}

describe("CoS operational decisions", () => {
  it("answers grounded internal choices without George", async () => {
    const result = await judgeOperationalQuestion(routine, {
      evaluate: async () => fake("use_recommendation"),
    });
    expect(result.kind).toBe("internal");
    if (result.kind === "internal") {
      expect(result.message).toContain("Vitest");
      expect(result.message).toContain("grants no permission");
    }
  });

  it("asks the domain to investigate on low confidence, without guessing", async () => {
    const result = await judgeOperationalQuestion(routine, {
      evaluate: async () => fake("use_recommendation", 0.5, 0.55),
    });
    expect(result.kind).toBe("internal");
    if (result.kind === "internal") expect(result.message).toContain("Investigate");
    expect(result.reason).toBe("internal investigation required");
  });

  it("escalates to Flyd, not George, when strategic reasoning is required", async () => {
    const result = await judgeOperationalQuestion(routine, {
      evaluate: async () => fake("escalate_to_flyd"),
    });
    expect(result).toMatchObject({ kind: "escalate", reason: "fast judgment found a strategically consequential issue" });
  });

  it("declines high-impact and externally committed decisions before querying a model", async () => {
    const called: string[] = [];
    for (const question of [
      "Should we merge PR #46?",
      "Can I deploy the site?",
      "Send the client's message?",
      "Do we pay the supplier?",
      "Delete the production database?",
      "Which password should I rotate?",
    ]) {
      const result = await judgeOperationalQuestion({ ...routine, question, options: [], recommendation: undefined }, {
        evaluate: async () => { called.push(question); return fake("use_recommendation"); },
      });
      expect(result.kind, question).toBe("escalate");
    }
    expect(called).toEqual([]);
  });

  it("does not interpret a personal booking as routine implementation", async () => {
    expect(protectedOperationalQuestion({ ...routine, domain: "life" })).toBe(true);
    const response = await judgeOperationalQuestion({ ...routine, domain: "life" }, {
      evaluate: async () => fake("use_recommendation"),
    });
    expect(response.kind).toBe("escalate");
  });

  it("does not automatically repeat the same decision instruction", async () => {
    const result = await judgeOperationalQuestion({ ...routine, previousResolution: true }, {
      evaluate: async () => fake("use_recommendation"),
    });
    expect(result.kind).toBe("escalate");
    expect(operationalQuestionKey(routine)).toBe(operationalQuestionKey({ ...routine }));
  });

  it("does not invent a recommendation absent from the source options", async () => {
    const result = await judgeOperationalQuestion({ ...routine, recommendation: "A different framework" }, {
      evaluate: async () => fake("use_recommendation"),
    });
    expect(result.kind).toBe("internal");
    if (result.kind === "internal") expect(result.message).not.toContain("A different framework");
  });
});
