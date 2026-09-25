import { createHash, randomUUID } from "node:crypto";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { validateEnvelope, type ContextEnvelope, type EpistemicKind } from "../../intelligence/context-envelope.js";
import type { TimeShape, WorldRelationType } from "../../intelligence/world/types.js";
import { evaluatePredicates } from "../system-one/jev.js";
import type { JevOptions, PredicateEgress, PredicateEvaluation, PredicateQuestion } from "../system-one/types.js";
import { rebuildKnowledgeProjections } from "../projections/store.js";

function stable(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function appendValidated(store: IntelligenceEventStore, envelope: ContextEnvelope): number {
  const validation = validateEnvelope(envelope, { consentLookup: store });
  if (!validation.ok) throw new Error(`curator envelope rejected: ${validation.detail}`);
  const event = store.append(envelope);
  if (!event) throw new Error("curator append failed");
  return event.sequence;
}

export interface ClaimMutation {
  entityId: string;
  attribute: string;
  value: string;
  authority?: "observed" | "inferred" | "user_confirmed";
  validFrom?: string;
  validUntil?: string;
  effectiveAt?: string;
  timeShape?: TimeShape;
  parentEntityId?: string;
  evidenceRefs?: string[];
}

export interface RelationMutation {
  fromId: string;
  type: WorldRelationType;
  toId: string;
  confidence?: number;
  validFrom?: string;
  validUntil?: string;
  evidenceRefs?: string[];
}

export class CognitiveCurator {
  constructor(private readonly store = new IntelligenceEventStore()) {}

  close(): void { this.store.close(); }

  recordObservation(
    payload: Record<string, unknown>,
    sourceId = "cognition.observation",
    options: { correlationId?: string; evidenceRefs?: string[]; retentionClass?: "ephemeral" | "local_default" | "extended" } = {},
  ): number {
    return appendValidated(this.store, {
      pathKind: "interface",
      kind: "observation",
      sourceId,
      consent: { grantedAt: new Date().toISOString(), scopes: [sourceId] },
      retentionClass: options.retentionClass ?? "local_default",
      payloadClassification: "personal",
      provenance: "cognitive-curator:observation",
      idempotencyKey: stable(["observation", sourceId, payload, options.correlationId ?? ""]),
      correlationId: options.correlationId,
      evidenceRefs: options.evidenceRefs,
      payload,
    });
  }

  recordConversationTurn(input: {
    sessionId: string;
    user: string;
    assistant: string;
    turnNumber?: number;
    projectIds?: string[];
    intentKind?: string;
    temporalFrame?: string;
    referents?: Record<string, string>;
  }): number {
    return this.recordObservation({
      conversation: {
        sessionId: input.sessionId,
        turnNumber: input.turnNumber,
        user: input.user,
        assistant: input.assistant,
        projectIds: input.projectIds ?? [],
        intentKind: input.intentKind,
        temporalFrame: input.temporalFrame,
        referents: input.referents ?? {},
      },
    }, "chat.cognition", { correlationId: input.sessionId });
  }

  addClaim(input: ClaimMutation, sourceId = "cognition.curator"): number {
    const kind: EpistemicKind = input.authority === "user_confirmed"
      ? "user_confirmed_intention"
      : input.authority === "inferred" ? "inferred_belief" : "observation";
    return appendValidated(this.store, {
      pathKind: "executive",
      kind,
      sourceId,
      consent: { grantedAt: new Date().toISOString(), scopes: [sourceId] },
      retentionClass: "local_default",
      payloadClassification: "personal",
      provenance: "cognitive-curator",
      idempotencyKey: stable(["claim", input]),
      evidenceRefs: input.evidenceRefs,
      payload: {
        entity: { id: input.entityId }, attribute: input.attribute, value: input.value,
        ...(input.validFrom ? { validFrom: input.validFrom } : {}),
        ...(input.validUntil ? { validUntil: input.validUntil } : {}),
        ...(input.effectiveAt ? { effectiveAt: input.effectiveAt } : {}),
        ...(input.timeShape ? { timeShape: input.timeShape } : {}),
        ...(input.parentEntityId ? { parentEntityId: input.parentEntityId } : {}),
      },
    });
  }

  addRelation(input: RelationMutation, sourceId = "cognition.curator"): number {
    return appendValidated(this.store, {
      pathKind: "executive",
      kind: "observation",
      sourceId,
      consent: { grantedAt: new Date().toISOString(), scopes: [sourceId] },
      retentionClass: "local_default",
      payloadClassification: "personal",
      provenance: "cognitive-curator:relation",
      idempotencyKey: stable(["relation", input]),
      evidenceRefs: input.evidenceRefs,
      payload: { relation: {
        id: `relation:${randomUUID()}`, from: input.fromId, type: input.type, to: input.toId,
        confidence: input.confidence ?? 1,
        ...(input.validFrom ? { validFrom: input.validFrom } : {}),
        ...(input.validUntil ? { validUntil: input.validUntil } : {}),
      }},
    });
  }

  markStatus(entityId: string, status: "completed" | "cancelled" | "active", evidenceRefs: string[] = []): number {
    const sequence = this.addClaim({ entityId, attribute: "status", value: status, authority: "user_confirmed", evidenceRefs }, "cognition.lifecycle");
    this.rebuild();
    return sequence;
  }

  supersede(newClaimId: string, oldClaimId: string, confidence = 1): number {
    const sequence = this.addRelation({ fromId: newClaimId, type: "supersedes", toId: oldClaimId, confidence }, "cognition.supersession");
    this.rebuild();
    return sequence;
  }

  rebuild(): void { rebuildKnowledgeProjections(this.store); }

  async evaluate(
    state: Record<string, unknown>,
    questions: PredicateQuestion[],
    jev?: JevOptions,
    egress?: PredicateEgress,
  ): Promise<PredicateEvaluation> {
    return evaluatePredicates(state, questions, jev, egress);
  }
}
