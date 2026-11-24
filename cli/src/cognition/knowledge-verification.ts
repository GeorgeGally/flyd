import { createHash } from "node:crypto";
import { IntelligenceEventStore } from "../intelligence/event-store.js";
import { deriveWorldState } from "../intelligence/world/world-model.js";
import { replayWorldModel } from "../intelligence/world/replay-cache.js";
import type { KnowledgeReceipt } from "./curator/knowledge-repair.js";
import { knowledgeVersion } from "./curator/knowledge-repair.js";
import type { UnifiedMemoryResult } from "./types.js";
import { validateEnvelope, type ContextEnvelope } from "../intelligence/context-envelope.js";
import { knowledgeSourceAllowed } from "./curator/knowledge-source-policy.js";

export interface KnowledgeSnapshot { version: string; memory: UnifiedMemoryResult; storeIdentity: string }
const storeIdentity = (store: IntelligenceEventStore) => createHash("sha256").update(JSON.stringify([store.replayFingerprint().file,store.getBySequence(1)?.id])).digest("hex");
/** Frozen input for paired replay. No calls to current retrieval, clocks or materializers during replay. */
export function captureKnowledgeSnapshot(store: IntelligenceEventStore, now = new Date()): KnowledgeSnapshot {
  const state = deriveWorldState(replayWorldModel(store), now);
  const version = knowledgeVersion(store);
  return structuredClone({ version, storeIdentity: storeIdentity(store), memory: {
    current: state.current, historical: state.historical, relevant: [],
    conflicts: state.conflicts.map((c) => ({ entityId: c.entityId, attribute: c.attribute, scopeId: c.scopeId, status: c.status ?? "unresolved", claims: [c.active.value, ...c.conflicting.map((v)=>v.claim.value)], claimIds: [c.active.claimId,...c.conflicting.map((v)=>v.claim.claimId)] })),
    gaps: state.unresolvedEntityIds, relations: state.relations, knowledgeVersion: version,
  } });
}

/** Erasure is the only live input allowed into frozen replay; no future knowledge is retrieved. */
export function readableKnowledgeSnapshot(snapshot: KnowledgeSnapshot, suppliedStore?: IntelligenceEventStore): UnifiedMemoryResult {
  const store = suppliedStore ?? new IntelligenceEventStore();
  try {
    const sameStore = snapshot.storeIdentity === storeIdentity(store);
    const live = (sequence: number) => sameStore && !!store.getBySequence(sequence)?.payload;
    const current = snapshot.memory.current.filter((claim) => live(Number(claim.claimId)) && claim.evidenceRefs.every(live));
    const historical = snapshot.memory.historical.filter((claim) => live(Number(claim.claimId)) && claim.evidenceRefs.every(live));
    const ids = new Set([...current,...historical].map((claim) => claim.claimId));
    return { ...snapshot.memory, current, historical, relevant: [],
      conflicts: snapshot.memory.conflicts.filter((conflict) => conflict.claimIds?.every((id) => ids.has(id))),
      relations: snapshot.memory.relations.filter((relation) => relation.evidenceRefs.every(live)),
    };
  } finally { if (!suppliedStore) store.close(); }
}

export function verifyKnowledgeRead(store: IntelligenceEventStore, receipt: KnowledgeReceipt, consumer: { name: string; version: string; claimIds: string[]; prompt: string }): "pass" | "fail" | "unknown" {
  return store.transaction(() => {
  const source = store.getBySequence(Number(receipt.claimId));
  if (!source?.payload || !knowledgeSourceAllowed(store,source)) return "unknown";
  const state = deriveWorldState(replayWorldModel(store));
  const claim = state.current.find((c) => c.claimId === receipt.claimId);
  const stale = consumer.version !== knowledgeVersion(store);
  const previous = receipt.replacedIds.map((id) => store.getBySequence(Number(id))?.payload?.value).filter((v): v is string => typeof v === "string" && v !== claim?.value);
  const scopedLines = consumer.prompt.split("\n").filter((line) => line.includes(receipt.key.entityId) && line.includes(receipt.key.property));
  const status = stale || !claim ? "unknown" : consumer.claimIds.includes(claim.claimId) && scopedLines.some((line) => line.includes(claim.value)) && !previous.some((value) => scopedLines.some((line) => line.includes(value))) && (!claim.disputed || scopedLines.some((line) => /disputed|disagree/i.test(line))) ? "pass" : "fail";
  const fingerprint = createHash("sha256").update(consumer.prompt).digest("hex");
  const envelope: ContextEnvelope = { pathKind: "executive", kind: "observation", sourceId: source.sourceId,
    consent: JSON.parse(source.consentJson), retentionClass: source.retentionClass as "local_default", payloadClassification: "personal",
    provenance: "knowledge-verification:v1", idempotencyKey: `verify:${receipt.repairId}:${consumer.name}:${consumer.version}:${fingerprint}`,
    evidenceRefs: [`event:${source.sequence}`], payload: { recordType: "knowledge.verification", verification: { repairId: receipt.repairId, consumer: consumer.name, version: consumer.version, promptHash: fingerprint, status } },
  };
  const validation = validateEnvelope(envelope, { consentLookup: store });
  if (!validation.ok) return "unknown";
  store.append(envelope);
  return status;
  });
}

/** Called with the actual formatted prompt, so omitted claims cannot earn verification credit. */
export function recordKnowledgeConsumption(memory: UnifiedMemoryResult, prompt: string, consumer: string): void {
  if (!memory.knowledgeVersion || !memory.current.some((c) => c.repairId)) return;
  const store = new IntelligenceEventStore();
  try {
    const visible = memory.current.filter((c) => prompt.includes(c.value) && prompt.includes(c.entityId));
    for (const claim of visible) {
      const source = store.getBySequence(Number(claim.claimId));
      const event = source && store.findByIdempotencyKey(source.sourceId,`receipt:${claim.repairId}`);
      const receipt = event?.payload?.knowledgeReceipt as unknown as KnowledgeReceipt | undefined;
      if (receipt) verifyKnowledgeRead(store, receipt, { name: consumer, version: memory.knowledgeVersion, claimIds: visible.map((c) => c.claimId), prompt });
    }
  } finally { store.close(); }
}
