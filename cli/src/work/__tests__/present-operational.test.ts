import { describe, expect, it } from "vitest";
import { attachOperationalDecisions } from "../present-operational.js";
import type { OperationalDecision } from "../../runtime/operational-decision.js";
import type { WorkHypothesis } from "../work-hypothesis/types.js";

const present: WorkHypothesis = {
  id: "wh-1",
  hypothesisText: "Working on Bloom",
  primaryThreads: [],
  secondaryThreads: [],
  confidence: "medium",
  uncertainty: [],
  evidenceRefs: ["repo:bloom"],
  demotions: [],
  revisedAt: "2026-09-11T06:00:00.000Z",
  generatedAt: "2026-09-11T06:00:00.000Z",
  fromCache: false,
};

const decisions: OperationalDecision[] = [
  {
    decisionId: "d-open",
    taskId: "task-1",
    question: "Use the existing runtime model?",
    context: "Worker is blocked on architecture.",
    status: "open",
    requestedAt: "2026-09-11T06:01:00.000Z",
  },
  {
    decisionId: "d-resolved",
    taskId: "task-2",
    question: "Old question",
    context: "",
    status: "resolved",
    requestedAt: "2026-09-11T05:00:00.000Z",
    resolution: "Done",
    resolvedAt: "2026-09-11T05:30:00.000Z",
  },
];

describe("attachOperationalDecisions", () => {
  it("adds only open decisions and preserves them as explicit evidence", () => {
    const result = attachOperationalDecisions(present, decisions, [
      { taskId: "task-1", taskKey: "task-key-1", projectName: "Bloom" },
    ]);

    expect(result.openDecisions).toEqual([
      expect.objectContaining({
        decisionId: "d-open",
        taskKey: "task-key-1",
        projectName: "Bloom",
        question: "Use the existing runtime model?",
      }),
    ]);
    expect(result.evidenceRefs).toEqual(["repo:bloom", "decision:d-open"]);
  });

  it("does not mutate the underlying work hypothesis", () => {
    const result = attachOperationalDecisions(present, decisions);

    expect(result).not.toBe(present);
    expect(present.openDecisions).toBeUndefined();
    expect(present.evidenceRefs).toEqual(["repo:bloom"]);
  });
});
