import { describe, expect, it } from "vitest";
import { promoteRuntimeOutcome } from "../outcome-promoter.js";

describe("promoteRuntimeOutcome", () => {
  it("promotes only a verified repository outcome tied to its integrated head", () => {
    const promoted = promoteRuntimeOutcome({
      id: "1",
      eventKey: "event-1",
      eventType: "task.completed",
      taskKey: "task-1",
      taskRevision: 12,
      occurredAt: "2026-07-19T00:00:00.000Z",
      payload: {
        summary: "Rails and CLI now share task controls",
        verification: { user_confirmed: true },
        repository: { head: "abc123", status_digest: "clean" },
      },
    });

    expect(promoted).toEqual([ expect.objectContaining({
      kind: "repository_fact",
      epistemicStatus: "observation",
      provenance: expect.objectContaining({ repository_head: "abc123", user_confirmed: true }),
    }) ]);
  });

  it("rejects unverified model or worker claims", () => {
    const promoted = promoteRuntimeOutcome({
      id: "2",
      eventKey: "event-2",
      eventType: "task.completed",
      taskKey: "task-1",
      taskRevision: 12,
      occurredAt: "2026-07-19T00:00:00.000Z",
      payload: {
        summary: "Worker says it is done",
        verification: { worker_claimed: true },
        repository: { head: "abc123", status_digest: "clean" },
      },
    });

    expect(promoted).toEqual([]);
  });

  it("promotes user corrections and labels workflow preferences as hypotheses", () => {
    const correction = promoteRuntimeOutcome({
      id: "3",
      eventKey: "event-3",
      eventType: "task.corrected",
      taskKey: "task-1",
      taskRevision: 13,
      occurredAt: "2026-07-19T00:00:00.000Z",
      payload: {
        authority: "user",
        original_claim: "Rails is secondary",
        corrected_value: "Rails is a first-class surface",
      },
    });
    const completion = promoteRuntimeOutcome({
      id: "4",
      eventKey: "event-4",
      eventType: "task.completed",
      taskKey: "task-1",
      taskRevision: 14,
      occurredAt: "2026-07-19T00:00:00.000Z",
      payload: {
        summary: "Done",
        verification: { confirmed_by: "user" },
        repository: { head: "def456", status_digest: "clean" },
        workflow_preference: "Prefer narrow verified slices",
      },
    });

    expect(correction[0]).toMatchObject({
      kind: "user_correction",
      statement: "Rails is a first-class surface",
      epistemicStatus: "user_confirmed",
      provenance: { supersedes: "Rails is secondary" },
    });
    expect(completion.at(-1)).toMatchObject({
      kind: "workflow_hypothesis",
      epistemicStatus: "hypothesis",
    });
  });
});
