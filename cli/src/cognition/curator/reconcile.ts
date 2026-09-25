import { createHash } from "node:crypto";
import { IntelligenceEventStore, type StoredEvent } from "../../intelligence/event-store.js";
import { ProjectionEngine } from "../../intelligence/projections.js";
import { deriveWorldState, worldModelProjector } from "../../intelligence/world/world-model.js";
import { predicatePasses, SYSTEM_ONE_POLICY_VERSION } from "../system-one/policy.js";
import type { JevOptions } from "../system-one/types.js";
import { CognitiveCurator } from "./curator.js";

const CHECKPOINT = "cognitive-curator-v1";
// A lifecycle mutation needs an affirmative statement, not merely a terminal
// word. "What's left to be done?" and "go over the plan" must remain
// questions about active work rather than silently close it.
const COMPLETED = [
  /\b(?:i|we)\s+(?:have\s+)?(?:finished|completed)\s+(?:the\s+)?(?:project\s+)?[\w.-]+\b/i,
  /\b(?:we(?:'re|\s+are)|i(?:'m|\s+am))\s+done\s+with\s+(?:the\s+)?(?:project\s+)?[\w.-]+\b/i,
  /\b(?:the\s+)?(?:project\s+)?[\w.-]+\s+(?:is|was|has\s+been|is\s+now)\s+(?:done|finished|completed|over|ended)\b/i,
];
const CANCELLED = /\b(?:cancelled|canceled|scrapped|not happening|called off)\b/i;

function explicitlyStatesCompletion(text: string): boolean {
  return COMPLETED.some((pattern) => pattern.test(text));
}

interface ConversationPayload {
  sessionId?: string;
  user?: string;
  assistant?: string;
  projectIds?: string[];
  intentKind?: string;
  temporalFrame?: string;
  referents?: Record<string, string>;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function conversationOf(event: StoredEvent): ConversationPayload | null {
  if (event.sourceId !== "chat.cognition" || !event.payload) return null;
  const raw = event.payload.conversation;
  if (!raw || typeof raw !== "object") return null;
  return raw as ConversationPayload;
}

function existingEntityFor(projectIds: string[], store: IntelligenceEventStore): string | null {
  if (projectIds.length === 0) return null;
  const state = deriveWorldState(new ProjectionEngine(store, worldModelProjector).rebuild(0).state);
  const all = new Set([
    ...state.current.map((claim) => claim.entityId),
    ...state.historical.map((claim) => claim.entityId),
    ...state.relations.flatMap((relation) => [relation.fromId, relation.toId]).filter((id) => !/^\d+$/.test(id)),
  ]);
  for (const requested of projectIds) {
    if (all.has(requested)) return requested;
    const suffix = requested.split(":").slice(1).join(":");
    const matches = [...all].filter((id) => id.split(":").slice(1).join(":") === suffix);
    if (matches.length === 1) return matches[0];
  }
  return projectIds.length === 1 ? projectIds[0] : null;
}

async function reconcileConversation(
  event: StoredEvent,
  conversation: ConversationPayload,
  store: IntelligenceEventStore,
  jev?: JevOptions,
): Promise<void> {
  const text = conversation.user?.trim();
  if (!text) return;
  const curator = new CognitiveCurator(store);
  const target = existingEntityFor(conversation.projectIds ?? [], store);
  const evaluation = await curator.evaluate(
    {
      statement: text,
      project_ids: conversation.projectIds ?? [],
      intent_kind: conversation.intentKind,
      temporal_frame: conversation.temporalFrame,
      referents: conversation.referents ?? {},
      source_event: event.sequence,
    },
    [
      { id: "is_correction", instructions: "Is the user correcting a prior fact, assumption, task, or current state?" },
      { id: "changes_current_state", instructions: "Does the statement materially change what is currently true or actionable?" },
      { id: "marks_completed", instructions: "Does the user explicitly state that the referenced project/event/task is completed, over, finished, or already happened?" },
      { id: "marks_cancelled", instructions: "Does the user explicitly state that the referenced project/event/task is cancelled or no longer happening?" },
      { id: "evidence_supported", instructions: "Is the proposed state change directly supported by the user's statement itself?" },
    ],
    jev,
  );

  curator.recordObservation({
    evaluator: evaluation.evaluator,
    evaluatorModel: evaluation.model,
    policyVersion: SYSTEM_ONE_POLICY_VERSION,
    projectionHash: evaluation.projectionHash,
    sourceEvent: event.sequence,
    answers: Object.fromEntries(Object.entries(evaluation.answers).map(([id, answer]) => [id, {
      probability: answer.probability,
      confidence: answer.confidence,
    }])),
    ok: evaluation.ok,
    error: evaluation.error,
  }, "cognition.system-one", { correlationId: conversation.sessionId, evidenceRefs: [`event:${event.sequence}`] });

  if (!target) return;

  // Explicit terminal language is hard evidence. Jev can corroborate ambiguous
  // semantics, but it is never required to make deterministic date/lifecycle facts true.
  const explicitCompleted = explicitlyStatesCompletion(text);
  const explicitCancelled = CANCELLED.test(text);
  const supported = !evaluation.ok || predicatePasses(evaluation, "evidence_supported", 0.80);
  const changesState = !evaluation.ok || predicatePasses(evaluation, "changes_current_state", 0.80);

  if (explicitCompleted && supported && changesState) {
    curator.addClaim({
      entityId: target,
      attribute: "status",
      value: "completed",
      authority: "user_confirmed",
      effectiveAt: event.capturedAt,
      timeShape: "state",
      evidenceRefs: [`event:${event.sequence}`],
    }, "cognition.lifecycle");
  } else if (explicitCancelled && supported && changesState) {
    curator.addClaim({
      entityId: target,
      attribute: "status",
      value: "cancelled",
      authority: "user_confirmed",
      effectiveAt: event.capturedAt,
      timeShape: "state",
      evidenceRefs: [`event:${event.sequence}`],
    }, "cognition.lifecycle");
  } else if (evaluation.ok && predicatePasses(evaluation, "is_correction") && predicatePasses(evaluation, "changes_current_state")) {
    // Preserve the correction as canonical evidence. A later extraction pass may
    // turn it into a typed claim only when subject/predicate/object are grounded.
    curator.recordObservation({
      correction: text,
      targetEntityId: target,
      sourceEvent: event.sequence,
      status: "candidate",
    }, "cognition.correction-candidate", { correlationId: conversation.sessionId, evidenceRefs: [`event:${event.sequence}`] });
  }
}

export interface CuratorSweepResult {
  processed: number;
  reconciled: number;
  fromSequence: number;
  toSequence: number;
}

export async function runCuratorSweep(options: { store?: IntelligenceEventStore; jev?: JevOptions; limit?: number } = {}): Promise<CuratorSweepResult> {
  const owned = !options.store;
  const store = options.store ?? new IntelligenceEventStore();
  const fromSequence = store.getCheckpoint(CHECKPOINT);
  let cursor = fromSequence;
  let processed = 0;
  let reconciled = 0;
  try {
    const events = store.readFrom(cursor, options.limit ?? 500);
    for (const event of events) {
      const conversation = conversationOf(event);
      if (conversation) {
        await reconcileConversation(event, conversation, store, options.jev);
        reconciled += 1;
      }
      cursor = event.sequence;
      processed += 1;
      store.saveCheckpoint(CHECKPOINT, cursor, hash([cursor, CHECKPOINT]));
    }
    if (reconciled > 0) {
      const curator = new CognitiveCurator(store);
      curator.rebuild();
    }
    return { processed, reconciled, fromSequence, toSequence: cursor };
  } finally {
    if (owned) store.close();
  }
}
