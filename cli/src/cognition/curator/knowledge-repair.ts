import { createHash } from "node:crypto";
import { IntelligenceEventStore, type StoredEvent } from "../../intelligence/event-store.js";
import { validateEnvelope, type ContextEnvelope } from "../../intelligence/context-envelope.js";
import { deriveWorldState, factKey } from "../../intelligence/world/world-model.js";
import { replayWorldModel } from "../../intelligence/world/replay-cache.js";
import type { ClaimAuthority } from "../../intelligence/world/types.js";
import { redactSensitiveText } from "../../runtime/context-redactor.js";
import { groundedProperty, projectFactEntity, knowledgeScopeHash } from "../knowledge-facts.js";
import { knowledgeSourceAllowed } from "./knowledge-source-policy.js";
export { groundedProperty } from "../knowledge-facts.js";

export interface FactKey { entityId: string; property: string; scopeId: string }
export interface KnowledgeProposal {
  originId: string;
  key: FactKey;
  value: string;
  operation: "correct" | "support" | "dispute";
  expectedRevision: string;
  evidence: Array<{ sequence: number; quote: string }>;
  authority?: ClaimAuthority;
  effectiveAt?: string;
  legacyRefs?: string[];
  displaySection?: string;
}
export interface KnowledgeReceipt {
  repairId: string;
  claimId: string;
  key: FactKey;
  replacedIds: string[];
  revision: string;
  status: "applied";
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const repairMode = (): "off" | "shadow" | "active" => {
  const mode = process.env.FLYD_KNOWLEDGE_REPAIR;
  return mode === "off" || mode === "shadow" ? mode : "active";
};
const worldKey = (key: FactKey) => ({ entityId: key.entityId, attribute: key.property, scopeId: key.scopeId });
export function targetRevision(store: IntelligenceEventStore, key: FactKey): string {
  const state = deriveWorldState(replayWorldModel(store));
  const claims = [...state.current, ...state.conflicts.flatMap((c) => c.conflicting.map((entry) => entry.claim))];
  return hash([...new Map(claims.filter((c) => factKey(c) === factKey(worldKey(key))).map((c) => [c.claimId, c])).values()].map((c) => [c.claimId, c.value]).sort());
}

export function knowledgeVersion(store: IntelligenceEventStore, now = new Date()): string {
  const state = deriveWorldState(replayWorldModel(store), now);
  return hash([state.current.map((c) => [c.claimId, c.value, c.disputed, c.evidenceRefs, Math.floor(c.freshness*4)]), state.conflicts.map((c) => c.active.claimId), state.staleEntityIds, state.unresolvedEntityIds, store.replayFingerprint().erased]);
}

function append(store: IntelligenceEventStore, source: StoredEvent, key: string, payload: Record<string, unknown>, evidenceRefs: string[], kind: ContextEnvelope["kind"] = "observation") {
  const envelope: ContextEnvelope = {
    pathKind: "executive", kind, sourceId: source.sourceId,
    consent: JSON.parse(source.consentJson), retentionClass: source.retentionClass as ContextEnvelope["retentionClass"],
    payloadClassification: "personal", provenance: "knowledge-repair:v1", idempotencyKey: key,
    correlationId: source.correlationId, evidenceRefs, payload,
  };
  const validation = validateEnvelope(envelope, { consentLookup: store });
  if (!validation.ok) throw new Error(validation.detail);
  return store.append(envelope)!;
}

function sourceText(event: StoredEvent): string {
  const conversation = event.payload?.conversation as { user?: string } | undefined;
  const source = event.payload?.sourceEvidence as { text?: string } | undefined;
  return conversation?.user ?? source?.text ?? "";
}

/** A proposal cannot invent confirmation, evidence or replacement targets. No network inside the transaction. */
export function acceptKnowledgeProposal(store: IntelligenceEventStore, proposal: KnowledgeProposal): KnowledgeReceipt {
  if (repairMode() !== "active") throw new Error("Knowledge repair is not active");
  if (!proposal.originId || !/^[a-z][a-z0-9_.-]*:[\w:.-]+$/i.test(proposal.key.entityId) ||
      !/^[a-z][a-z0-9_.-]{0,100}$/i.test(proposal.key.property) || !proposal.key.scopeId || proposal.key.scopeId.length > 200 ||
      !proposal.value.trim() || proposal.value.length > 2000 || !proposal.evidence.length || proposal.evidence.length > 12 ||
      !["correct", "support", "dispute"].includes(proposal.operation) || proposal.authority !== undefined && !["observed", "inferred", "user_confirmed"].includes(proposal.authority))
    throw new Error("Invalid grounded fact proposal");
  if (proposal.effectiveAt && !Number.isFinite(Date.parse(proposal.effectiveAt))) throw new Error("Invalid effective time");
  const repairId = hash(["repair-v1", proposal.originId, proposal.key, proposal.operation, proposal.value]);
  return store.transaction(() => {
    const evidence = proposal.evidence.map(({ sequence, quote }) => {
      const event = store.getBySequence(sequence);
      if (!event || !knowledgeSourceAllowed(store,event) || !quote.trim() || !sourceText(event).includes(quote) || !quote.includes(proposal.value))
        throw new Error("Evidence is missing, revoked or does not support the quoted value");
      const fact = groundedProperty(quote);
      if (!fact || projectFactEntity(fact.subject) !== proposal.key.entityId || fact.property !== proposal.key.property || proposal.key.scopeId !== proposal.key.entityId || fact.value !== proposal.value)
        throw new Error("Quoted evidence does not ground this entity, property and scope");
      return event;
    });
    const source = evidence[0];
    const existing = store.findByIdempotencyKey(source.sourceId, `receipt:${repairId}`);
    if (existing && !existing.erased) return existing.payload!.knowledgeReceipt as unknown as KnowledgeReceipt;
    if (targetRevision(store, proposal.key) !== proposal.expectedRevision) throw new Error("Target revision changed");
    const authority = proposal.authority ?? "observed";
    if (authority === "user_confirmed" && evidence.some((event) => event.sourceId !== "chat.cognition" || !(event.payload?.conversation as { user?: string })?.user))
      throw new Error("Only an explicit current user statement can confirm a fact");
    const state = deriveWorldState(replayWorldModel(store));
    const prior = state.current.filter((c) => factKey(c) === factKey(worldKey(proposal.key)));
    if (proposal.operation === "support" && prior.some((c) => c.value.trim() !== proposal.value.trim())) throw new Error("Support must match the current value");
    const effectiveAt = proposal.effectiveAt ?? source.capturedAt;
    if (proposal.operation === "correct" && prior.some((c) => Date.parse(c.effectiveAt ?? c.capturedAt) > Date.parse(effectiveAt)))
      throw new Error("Historical evidence cannot replace a newer fact");
    const refs = evidence.map((event) => `event:${event.sequence}`);
    const claim = append(store, source, `claim:${repairId}`, {
      entity: { id: proposal.key.entityId }, attribute: proposal.key.property, value: proposal.value,
      scopeId: proposal.key.scopeId, repairId, effectiveAt, timeShape: "state",
      legacyRefs: proposal.legacyRefs ?? [], displaySection: proposal.displaySection,
    }, refs, authority === "user_confirmed" ? "user_confirmed_intention" : authority === "inferred" ? "inferred_belief" : "observation");
    store.guardKnowledgeScope(claim.sequence, knowledgeScopeHash(proposal.key.entityId, proposal.key.property, proposal.key.scopeId));
    const replacedIds: string[] = [];
    const targets = [...prior, ...state.conflicts.filter((c) => factKey(c) === factKey(worldKey(proposal.key))).flatMap((c) => c.conflicting.map((v) => v.claim))];
    for (const old of [...new Map(targets.map((c) => [c.claimId, c])).values()]) {
      if (proposal.operation === "support" || old.value.trim() === proposal.value.trim()) continue;
      append(store, source, `relation:${repairId}:${old.claimId}`, { relation: {
        id: `knowledge:${repairId}:${old.claimId}`, from: String(claim.sequence), to: old.claimId,
        type: proposal.operation === "correct" ? "supersedes" : "contradicts", repairId,
      } }, refs);
      if (proposal.operation === "correct") replacedIds.push(old.claimId);
    }
    const receipt: KnowledgeReceipt = { repairId, claimId: String(claim.sequence), key: proposal.key, replacedIds, revision: targetRevision(store, proposal.key), status: "applied" };
    append(store, source, `receipt:${repairId}`, { recordType: "knowledge.receipt", knowledgeReceipt: receipt }, refs);
    return receipt;
  });
}

export function retractKnowledgeRepair(store: IntelligenceEventStore, receipt: KnowledgeReceipt, originSequence: number): void {
  store.transaction(() => {
    const origin = store.getBySequence(originSequence);
    const claim = store.getBySequence(Number(receipt.claimId));
    if (!origin || origin.erased || origin.sourceId !== "chat.cognition" || !/\b(?:undo|revert|retract|take back)\b/i.test(sourceText(origin)) || !claim || claim.erased || claim.payload?.repairId !== receipt.repairId)
      throw new Error("Retraction requires a current explicit user origin and an existing repair");
    append(store, origin, `retract:${receipt.repairId}:${originSequence}`, { knowledgeRetraction: { repairId: receipt.repairId } }, [`event:${originSequence}`]);
  });
}

/** Called before answering, so failed generation cannot lose an eligible explicit correction. */
export function ingestKnowledgeCorrection(text: string, sessionId: string, suppliedStore?: IntelligenceEventStore, originId?: string): KnowledgeReceipt | null {
  const fact = groundedProperty(text);
  const undo = /^(?:undo|revert|retract|take back) (?:my |the )?last (?:knowledge )?correction[.!]?$/i.test(text.trim());
  if ((!fact && !undo) || repairMode() !== "active" || redactSensitiveText(text) !== text) return null;
  const store = suppliedStore ?? new IntelligenceEventStore();
  try {
    return store.transaction(() => {
    if (repairMode() !== "active" || store.isRevoked("chat.cognition")) return null;
    // Resolve this explicit reference only within its original session. A new
    // session's vague "undo" cannot retract an unrelated user's/source's fact.
    if (undo) {
      const undoKey = `undo:${hash([sessionId,originId??"",text])}`;
      if (store.findByIdempotencyKey("chat.cognition",undoKey)) return null;
      const retracted = new Set(replayWorldModel(store).retractedRepairs ?? []);
      const event = store.readRecords("knowledge.receipt").reverse().find((event) => event.correlationId === sessionId && !retracted.has((event.payload?.knowledgeReceipt as unknown as KnowledgeReceipt)?.repairId));
      const receipt = event?.payload?.knowledgeReceipt as unknown as KnowledgeReceipt | undefined;
      if (!receipt) return null;
      const origin = store.append({ pathKind:"interface", kind:"observation", sourceId:"chat.cognition",
        consent:{grantedAt:new Date().toISOString(),scopes:["chat.cognition"]}, retentionClass:"local_default",payloadClassification:"personal",
        provenance:"explicit-knowledge-input",idempotencyKey:undoKey,correlationId:sessionId,
        payload:{conversation:{sessionId,user:text,assistant:"",knowledgeInput:true}},
      });
      if (origin) retractKnowledgeRepair(store,receipt,origin.sequence);
      return null;
    }
    if (!fact) return null;
    const entityId = `project:${fact.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const key = { entityId, property: fact.property, scopeId: entityId };
    const idempotencyKey = hash([sessionId, originId ?? "", text]);
    const source = store.append({ pathKind: "interface", kind: "observation", sourceId: "chat.cognition",
      consent: { grantedAt: new Date().toISOString(), scopes: ["chat.cognition"] }, retentionClass: "local_default",
      payloadClassification: "personal", provenance: "explicit-knowledge-input", idempotencyKey: `input:${idempotencyKey}`,
      correlationId: sessionId, payload: { conversation: { sessionId, user: text, assistant: "", projectIds: [entityId], knowledgeInput: true } },
    });
    if (!source || store.isRevoked(source.sourceId)) return null;
    return acceptKnowledgeProposal(store, { originId: `event:${source.sequence}`, key, value: fact.value,
      operation: "correct", expectedRevision: targetRevision(store, key), authority: "user_confirmed",
      evidence: [{ sequence: source.sequence, quote: text }], legacyRefs: [] });
    });
  } finally { if (!suppliedStore) store.close(); }
}
