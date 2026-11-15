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
    expect(result).toMatchObject({ kind: "reason", reason: "fast judgment found a strategically consequential issue" });
  });

  it("declines high-impact and externally committed decisions before querying a model", async () => {
    const called: string[] = [];
    for (const question of [
      "Can I deploy the site?",
      "Force push over main?",
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

  it("settles a routine push or merge of George's own work itself, with no decision model, never asking him", async () => {
    const called: string[] = [];
    for (const question of [
      "Should we merge PR #46?",
      "Waiting for George's approval to push the Guido fix to GitHub",
      "Need permission to merge and push to main?",
    ]) {
      const result = await judgeOperationalQuestion({ ...routine, domain: "coding", question, options: [], recommendation: undefined }, {
        evaluate: async () => { called.push(question); return fake("use_recommendation"); },
      });
      expect(result.kind, question).toBe("internal");
      expect(result.kind === "internal" && result.message, question).toMatch(/push it to his GitHub/);
    }
    expect(called).toEqual([]);
    // Still his: going live, someone else's repo, and work outside code.
    for (const question of ["Push and deploy to production?", "Push the fix upstream to their fork?"]) {
      expect((await judgeOperationalQuestion({ ...routine, domain: "coding", question, options: [] })).kind, question).toBe("escalate");
    }
    expect(protectedOperationalQuestion({ ...routine, domain: "creative", question: "Merge PR #46?", options: [] })).toBe(true);
    // A choice, a personal call or red work is never settled as a routine go-ahead.
    for (const question of ["Merge option A or B? George's personal preference", "Should I rebase onto main or merge?", "Ready to merge? two tests still fail"]) {
      const result = await judgeOperationalQuestion({ ...routine, domain: "coding", question, options: [] });
      expect(result.reason, question).not.toBe("routine git step under George's standing rule");
    }
    expect(protectedOperationalQuestion({ ...routine, domain: "coding", question: "Merge option A or B? George's personal preference", options: [] })).toBe(true);
    const red = await judgeOperationalQuestion({ ...routine, domain: "coding", question: "Ready to merge?", options: [], recommendation: "merge even though lint is failing" });
    expect(red.reason).not.toBe("routine git step under George's standing rule");
    const bare = await judgeOperationalQuestion({ ...routine, domain: "coding", question: "Ready to merge?", options: [], recommendation: "merge; 2 tests failing" });
    expect(bare.reason).not.toBe("routine git step under George's standing rule");
    for (const question of ["Revert the last commit and push?", "Should I add push notifications?"]) {
      const result = await judgeOperationalQuestion({ ...routine, domain: "coding", question, options: [], recommendation: undefined }, { evaluate: async () => fake("escalate_to_flyd") });
      expect(result.reason, question).not.toBe("routine git step under George's standing rule");
    }
    const cleanup = await judgeOperationalQuestion({ ...routine, domain: "coding", question: "Ready to merge and push?", options: [], recommendation: "Removed dead code and deleted old fixtures; green" });
    expect(cleanup.kind).toBe("internal");
    const productionFix = await judgeOperationalQuestion({ ...routine, domain: "coding", question: "Waiting for George's approval to push the production error fix to GitHub", options: [], recommendation: undefined });
    expect(productionFix.kind).toBe("internal");
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
    expect(result.kind).toBe("reason");
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
