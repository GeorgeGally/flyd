export type OperationalDecisionStatus = "open" | "resolved" | "superseded" | "cancelled";

export interface OperationalDecision {
  decisionId: string;
  taskId: string;
  question: string;
  context: string;
  status: OperationalDecisionStatus;
  requestedAt: string;
  resolution?: string;
  resolvedAt?: string;
  supersededBy?: string;
}

export interface RuntimeProjectionEvent {
  eventType: string;
  taskId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

/**
 * Decision state is folded independently from general runtime status. Unrelated
 * worker/task events can never overwrite or implicitly resolve an open decision.
 */
export function projectOperationalDecisions(
  events: RuntimeProjectionEvent[],
): OperationalDecision[] {
  const decisions = new Map<string, OperationalDecision>();

  for (const event of events) {
    if (!event.eventType.startsWith("decision.")) continue;

    const id = typeof event.payload.decision_id === "string"
      ? event.payload.decision_id
      : "";
    if (!id) continue;

    if (event.eventType === "decision.opened") {
      const question = typeof event.payload.question === "string"
        ? event.payload.question.trim()
        : "";
      if (!question || decisions.has(id)) continue;
      decisions.set(id, {
        decisionId: id,
        taskId: event.taskId,
        question,
        context: typeof event.payload.context === "string" ? event.payload.context.trim() : "",
        status: "open",
        requestedAt: event.occurredAt,
      });
      continue;
    }

    const existing = decisions.get(id);
    if (!existing || existing.status !== "open") continue;

    if (event.eventType === "decision.resolved") {
      const resolution = typeof event.payload.resolution === "string"
        ? event.payload.resolution.trim()
        : "";
      if (!resolution) continue;
      decisions.set(id, {
        ...existing,
        status: "resolved",
        resolution,
        resolvedAt: event.occurredAt,
      });
    } else if (event.eventType === "decision.superseded") {
      const supersededBy = typeof event.payload.superseded_by === "string"
        ? event.payload.superseded_by
        : "";
      if (!supersededBy) continue;
      decisions.set(id, {
        ...existing,
        status: "superseded",
        supersededBy,
        resolvedAt: event.occurredAt,
      });
    } else if (event.eventType === "decision.cancelled") {
      decisions.set(id, {
        ...existing,
        status: "cancelled",
        resolution: typeof event.payload.reason === "string" ? event.payload.reason : undefined,
        resolvedAt: event.occurredAt,
      });
    }
  }

  return [...decisions.values()].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

export function openOperationalDecisions(
  events: RuntimeProjectionEvent[],
): OperationalDecision[] {
  return projectOperationalDecisions(events).filter((decision) => decision.status === "open");
}
