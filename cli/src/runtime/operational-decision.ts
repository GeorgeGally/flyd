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

export type OperationalDecisionEvent =
  | {
      eventType: "decision.opened";
      taskId: string;
      occurredAt: string;
      payload: {
        decision_id: string;
        question: string;
        context?: string;
      };
    }
  | {
      eventType: "decision.resolved";
      taskId: string;
      occurredAt: string;
      payload: {
        decision_id: string;
        resolution: string;
      };
    }
  | {
      eventType: "decision.superseded";
      taskId: string;
      occurredAt: string;
      payload: {
        decision_id: string;
        superseded_by: string;
      };
    }
  | {
      eventType: "decision.cancelled";
      taskId: string;
      occurredAt: string;
      payload: {
        decision_id: string;
        reason?: string;
      };
    };

/**
 * Fold only decision events. Unrelated runtime activity is intentionally unable
 * to close or hide an open decision.
 */
export function projectOperationalDecisions(
  events: OperationalDecisionEvent[],
): OperationalDecision[] {
  const decisions = new Map<string, OperationalDecision>();

  for (const event of events) {
    const id = event.payload.decision_id;
    if (event.eventType === "decision.opened") {
      if (decisions.has(id)) continue;
      decisions.set(id, {
        decisionId: id,
        taskId: event.taskId,
        question: event.payload.question.trim(),
        context: event.payload.context?.trim() ?? "",
        status: "open",
        requestedAt: event.occurredAt,
      });
      continue;
    }

    const existing = decisions.get(id);
    if (!existing || existing.status !== "open") continue;

    if (event.eventType === "decision.resolved") {
      decisions.set(id, {
        ...existing,
        status: "resolved",
        resolution: event.payload.resolution,
        resolvedAt: event.occurredAt,
      });
    } else if (event.eventType === "decision.superseded") {
      decisions.set(id, {
        ...existing,
        status: "superseded",
        supersededBy: event.payload.superseded_by,
        resolvedAt: event.occurredAt,
      });
    } else if (event.eventType === "decision.cancelled") {
      decisions.set(id, {
        ...existing,
        status: "cancelled",
        resolution: event.payload.reason,
        resolvedAt: event.occurredAt,
      });
    }
  }

  return [...decisions.values()].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

export function openOperationalDecisions(
  events: OperationalDecisionEvent[],
): OperationalDecision[] {
  return projectOperationalDecisions(events).filter((decision) => decision.status === "open");
}
