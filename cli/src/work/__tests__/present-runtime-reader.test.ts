import { describe, expect, it, vi } from "vitest";
import { readRuntimeAwarePresent } from "../present-runtime-reader.js";
import type { WorkHypothesis } from "../work-hypothesis/types.js";

const present: WorkHypothesis = {
  epistemicClass: "inference",
  id: "wh-1",
  hypothesisText: "Working on Bloom",
  primaryThreads: [],
  secondaryThreads: [],
  confidence: "medium",
  uncertainty: [],
  evidenceRefs: [],
  demotions: [],
  revisedAt: "2026-09-11T06:00:00.000Z",
  generatedAt: "2026-09-11T06:00:00.000Z",
  fromCache: false,
};

describe("readRuntimeAwarePresent", () => {
  it("attaches decision facts and worker observations without mutating runtime state", async () => {
    const readBasePresent = vi.fn(() => present);
    const listOpenDecisionFacts = vi.fn(async () => [{
      decision: {
        decisionId: "d1",
        taskId: "1",
        question: "Which architecture?",
        context: "Worker blocked.",
        status: "open" as const,
        requestedAt: "2026-09-11T06:01:00.000Z",
      },
      taskKey: "task-1",
      projectName: "Bloom",
      projectRoot: "/work/bloom",
    }]);
    const listWorkerObservations = vi.fn(async () => [{
      workerKey: "worker-1",
      taskId: "1",
      projectRoot: "/work/bloom",
      observedAt: "2026-09-11T06:02:00.000Z",
      reconciliation: {
        state: "waiting_decision" as const,
        action: "ask_user" as const,
        reason: "An explicit operational decision is open for this work.",
        consequential: true,
      },
    }]);

    const result = await readRuntimeAwarePresent({
      readBasePresent,
      listOpenDecisionFacts,
      listWorkerObservations,
    });

    expect(result?.openDecisions).toEqual([
      expect.objectContaining({
        epistemicClass: "fact",
        decisionId: "d1",
        taskKey: "task-1",
        projectName: "Bloom",
      }),
    ]);
    expect(result?.workerObservations).toEqual([
      expect.objectContaining({
        epistemicClass: "observation",
        workerKey: "worker-1",
        state: "waiting_decision",
        action: "ask_user",
      }),
    ]);
    expect(readBasePresent).toHaveBeenCalledTimes(1);
    expect(listOpenDecisionFacts).toHaveBeenCalledTimes(1);
    expect(listWorkerObservations).toHaveBeenCalledTimes(1);
  });

  it("does not query runtime state when no base Present model exists", async () => {
    const listOpenDecisionFacts = vi.fn(async () => []);
    const listWorkerObservations = vi.fn(async () => []);

    const result = await readRuntimeAwarePresent({
      readBasePresent: () => null,
      listOpenDecisionFacts,
      listWorkerObservations,
    });

    expect(result).toBeNull();
    expect(listOpenDecisionFacts).not.toHaveBeenCalled();
    expect(listWorkerObservations).not.toHaveBeenCalled();
  });
});
