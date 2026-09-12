import { describe, expect, it } from "vitest";
import { buildPresentModelSection } from "../ground-pack.js";
import type { WorkHypothesis } from "../../work/work-hypothesis/types.js";

const present: WorkHypothesis = {
  id: "wh-1",
  hypothesisText: "You're primarily working on Bloom.",
  primaryThreads: [{
    root: "/work/bloom",
    name: "Bloom",
    isDirty: false,
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
    projectName: "Bloom",
    question: "Use provider A or provider B?",
    context: "Collection is blocked.",
    requestedAt: "2026-09-12T03:00:00.000Z",
  }],
  workerObservations: [{
    epistemicClass: "observation",
    workerKey: "w1",
    taskId: "1",
    projectRoot: "/work/bloom",
    state: "waiting_decision",
    action: "ask_user",
    reason: "An explicit operational decision is open for this work.",
    observedAt: "2026-09-12T03:01:00.000Z",
    consequential: true,
  }],
  demotions: [],
  revisedAt: "2026-09-12T03:00:00.000Z",
  generatedAt: "2026-09-12T03:00:00.000Z",
  fromCache: false,
};

describe("buildPresentModelSection runtime truth", () => {
  it("labels canonical decision facts separately from worker observations", () => {
    const section = buildPresentModelSection(present, {
      primaryProject: "Bloom",
      primarySource: "foreground",
      conflict: false,
    });

    expect(section?.provenance).toBe("work-hypothesis+runtime");
    expect(section?.content).toContain("[FACT] Bloom: Use provider A or provider B?");
    expect(section?.content).toContain("[OBSERVATION] waiting_decision / ask_user");
  });
});
