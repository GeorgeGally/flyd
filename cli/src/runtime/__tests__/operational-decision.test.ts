import { describe, expect, it } from "vitest";
import {
  openOperationalDecisions,
  projectOperationalDecisions,
  type RuntimeProjectionEvent,
} from "../operational-decision.js";

function event(
  eventType: string,
  occurredAt: string,
  payload: Record<string, unknown>,
): RuntimeProjectionEvent {
  return { eventType, taskId: "task-1", occurredAt, payload };
}

describe("operational decision projection", () => {
  it("keeps a decision open through unrelated later activity", () => {
    const events = [
      event("decision.opened", "2026-09-11T10:00:00Z", {
        decision_id: "d1",
        question: "Merge the schema change now?",
        context: "Migration is backwards compatible but touches production data.",
      }),
      event("worker.progress", "2026-09-11T10:01:00Z", { message: "tests running" }),
      event("task.updated", "2026-09-11T10:02:00Z", { status: "running" }),
      event("worker.completed", "2026-09-11T10:03:00Z", { worker_key: "w1" }),
    ];

    expect(openOperationalDecisions(events)).toEqual([
      expect.objectContaining({ decisionId: "d1", status: "open" }),
    ]);
  });

  it("closes a decision only on an explicit resolution event", () => {
    const events = [
      event("decision.opened", "2026-09-11T10:00:00Z", {
        decision_id: "d1",
        question: "Merge now?",
      }),
      event("decision.resolved", "2026-09-11T10:04:00Z", {
        decision_id: "d1",
        resolution: "Wait for the backup, then merge.",
      }),
      event("worker.progress", "2026-09-11T10:05:00Z", { message: "continuing" }),
    ];

    expect(openOperationalDecisions(events)).toEqual([]);
    expect(projectOperationalDecisions(events)[0]).toMatchObject({
      decisionId: "d1",
      status: "resolved",
      resolution: "Wait for the backup, then merge.",
      resolvedAt: "2026-09-11T10:04:00Z",
    });
  });

  it("supports explicit supersession without losing the original decision record", () => {
    const events = [
      event("decision.opened", "2026-09-11T10:00:00Z", {
        decision_id: "d1",
        question: "Use approach A?",
      }),
      event("decision.opened", "2026-09-11T10:01:00Z", {
        decision_id: "d2",
        question: "Use approach B instead?",
      }),
      event("decision.superseded", "2026-09-11T10:02:00Z", {
        decision_id: "d1",
        superseded_by: "d2",
      }),
    ];

    const projected = projectOperationalDecisions(events);
    expect(projected.find((decision) => decision.decisionId === "d1")).toMatchObject({
      status: "superseded",
      supersededBy: "d2",
    });
    expect(openOperationalDecisions(events).map((decision) => decision.decisionId)).toEqual(["d2"]);
  });
});
