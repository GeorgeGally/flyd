import type { ArchiveRuntimeEvent } from "./types.js";

export interface PromotedRuntimeKnowledge {
  kind: "repository_fact" | "user_correction" | "user_decision" | "workflow_hypothesis";
  statement: string;
  epistemicStatus: "observation" | "user_confirmed" | "hypothesis";
  provenance: Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function promoteRuntimeOutcome(event: ArchiveRuntimeEvent): PromotedRuntimeKnowledge[] {
  if (event.eventType === "task.corrected") {
    if (event.payload.authority !== "user" || typeof event.payload.corrected_value !== "string") return [];
    return [ {
      kind: "user_correction",
      statement: event.payload.corrected_value,
      epistemicStatus: "user_confirmed",
      provenance: {
        event_key: event.eventKey,
        task_key: event.taskKey,
        task_revision: event.taskRevision,
        supersedes: event.payload.original_claim ?? null,
        correction_key: event.payload.correction_key ?? null,
      },
    } ];
  }

  if (event.eventType !== "task.completed") return [];
  const verification = record(event.payload.verification);
  const repository = record(event.payload.repository);
  const confirmed = verification.user_confirmed === true || verification.confirmed_by === "user";
  if (!confirmed || typeof repository.head !== "string" || typeof event.payload.summary !== "string") return [];

  const knowledge: PromotedRuntimeKnowledge[] = [ {
    kind: "repository_fact",
    statement: event.payload.summary,
    epistemicStatus: "observation",
    provenance: {
      event_key: event.eventKey,
      task_key: event.taskKey,
      task_revision: event.taskRevision,
      repository_head: repository.head,
      status_digest: repository.status_digest,
      user_confirmed: true,
    },
  } ];
  if (typeof event.payload.decision === "string" && event.payload.decision.trim()) {
    knowledge.push({
      kind: "user_decision",
      statement: event.payload.decision.trim(),
      epistemicStatus: "user_confirmed",
      provenance: { event_key: event.eventKey, task_key: event.taskKey },
    });
  }
  if (typeof event.payload.workflow_preference === "string" && event.payload.workflow_preference.trim()) {
    knowledge.push({
      kind: "workflow_hypothesis",
      statement: event.payload.workflow_preference.trim(),
      epistemicStatus: "hypothesis",
      provenance: { event_key: event.eventKey, task_key: event.taskKey },
    });
  }
  return knowledge;
}
