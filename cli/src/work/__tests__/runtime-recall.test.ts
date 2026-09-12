import { describe, expect, it } from "vitest";
import { answerFromCanonicalPresent } from "../runtime-recall.js";
import type { WorkHypothesis } from "../work-hypothesis/types.js";

function present(): WorkHypothesis {
  return {
    id: "wh-1",
    hypothesisText: "You're primarily working on Bloom.",
    primaryThreads: [{
      root: "/work/bloom",
      name: "Bloom",
      isDirty: true,
      hasTasks: true,
      isForeground: true,
      signals: [],
      demoted: false,
    }],
    secondaryThreads: [],
    confidence: "high",
    uncertainty: [],
    evidenceRefs: [],
    openDecisions: [{
      epistemicClass: "fact",
      decisionId: "d1",
      taskId: "1",
      taskKey: "task-1",
      projectName: "Bloom",
      question: "Use provider A or B?",
      context: "Collection is blocked.",
      requestedAt: "2026-09-12T03:00:00.000Z",
    }],
    workerObservations: [{
      epistemicClass: "observation",
      workerKey: "w1",
      taskId: "2",
      projectRoot: "/work/flyd",
      state: "interrupted",
      action: "ask_flyd",
      reason: "Worker process and worktree are both missing; recovery requires judgment.",
      observedAt: "2026-09-12T03:01:00.000Z",
      consequential: true,
    }],
    demotions: [],
    revisedAt: "2026-09-12T03:00:00.000Z",
    generatedAt: "2026-09-12T03:00:00.000Z",
    fromCache: false,
  };
}

describe("answerFromCanonicalPresent", () => {
  it("includes durable decisions and consequential worker observations in active status", () => {
    const answer = answerFromCanonicalPresent("what am I working on", present());
    expect(answer).toContain("Bloom [dirty]");
    expect(answer).toContain("Needs you:");
    expect(answer).toContain("Use provider A or B?");
    expect(answer).toContain("Operational attention:");
    expect(answer).toContain("interrupted");
  });

  it("answers what needs me from explicit facts before inference", () => {
    const answer = answerFromCanonicalPresent("what needs me?", present());
    expect(answer).toContain("Bloom: Use provider A or B?");
    expect(answer).toContain("interrupted:");
  });

  it("declines unrelated query shapes so callers can use the legacy fallback", () => {
    expect(answerFromCanonicalPresent("show recent commits", present())).toBeNull();
  });
});
