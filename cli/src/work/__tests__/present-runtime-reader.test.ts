import { describe, expect, it, vi } from "vitest";
import { readRuntimeAwarePresent } from "../present-runtime-reader.js";
import type { WorkHypothesis } from "../work-hypothesis/types.js";

const present: WorkHypothesis = {
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
  it("attaches open decision facts without mutating runtime state", async () => {
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

    const result = await readRuntimeAwarePresent({ readBasePresent, listOpenDecisionFacts });

    expect(result?.openDecisions).toEqual([
      expect.objectContaining({ decisionId: "d1", taskKey: "task-1", projectName: "Bloom" }),
    ]);
    expect(readBasePresent).toHaveBeenCalledTimes(1);
    expect(listOpenDecisionFacts).toHaveBeenCalledTimes(1);
  });

  it("does not query runtime facts when no base Present model exists", async () => {
    const listOpenDecisionFacts = vi.fn(async () => []);

    const result = await readRuntimeAwarePresent({
      readBasePresent: () => null,
      listOpenDecisionFacts,
    });

    expect(result).toBeNull();
    expect(listOpenDecisionFacts).not.toHaveBeenCalled();
  });
});
