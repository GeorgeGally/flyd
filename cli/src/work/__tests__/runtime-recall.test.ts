import { describe, expect, it } from "vitest";
import { canonicalStatusAnswer } from "../canonical-status.js";
import type { RuntimeAwarePresent } from "../runtime-present-types.js";

function present(): RuntimeAwarePresent {
  return {
    epistemicClass: "inference",
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
    activeRuntimeTasks: [{
      epistemicClass: "fact",
      taskId: "1",
      taskKey: "task-1",
      projectName: "Bloom",
      projectRoot: "/work/bloom",
      status: "blocked",
      intendedOutcome: "Repair collection freshness",
      recommendedNextAction: "Choose a provider",
      updatedAt: "2026-09-12T03:00:30.000Z",
    }],
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

describe("canonicalStatusAnswer", () => {
  it("includes runtime task facts, decisions, and consequential worker observations", () => {
    const answer = canonicalStatusAnswer("what am I working on", present());
    expect(answer).toContain("Bloom [dirty]");
    expect(answer).toContain("Active runtime work:");
    expect(answer).toContain("Repair collection freshness");
    expect(answer).toContain("Needs you:");
    expect(answer).toContain("Use provider A or B?");
    expect(answer).toContain("interrupted");
  });

  it("answers what needs me from explicit runtime truth", () => {
    const answer = canonicalStatusAnswer("what needs me?", present());
    expect(answer).toContain("Bloom: Use provider A or B?");
    expect(answer).toContain("Bloom [blocked]: Choose a provider");
    expect(answer).toContain("interrupted:");
  });

  it("declines unrelated query shapes so callers can use the legacy fallback", () => {
    expect(canonicalStatusAnswer("show recent commits", present())).toBeNull();
  });
});
