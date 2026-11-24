import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { deriveWorldState } from "../../intelligence/world/world-model.js";
import { replayWorldModel } from "../../intelligence/world/replay-cache.js";
import { groundedProperty, projectFactEntity, knowledgeScopeHash, GOVERNED_PROPERTIES } from "../knowledge-facts.js";
import { acceptKnowledgeProposal, repairMode, targetRevision } from "./knowledge-repair.js";
import { knowledgeSourceAllowed } from "./knowledge-source-policy.js";

export interface MigrationResult { applied: string[]; deferred: Array<{ sequence: number; reason: string }>; shadow: number }

/** Migrate attributable original spans, never whole maintained documents as confirmed truth. */
export function migrateKnowledgeSources(store: IntelligenceEventStore, sequences: number[]): MigrationResult {
  if (sequences.length > 50 || sequences.some((s) => !Number.isSafeInteger(s) || s < 1)) throw new Error("Provide at most 50 original event sequences");
  const result: MigrationResult = { applied: [], deferred: [], shadow: 0 };
  for (const sequence of [...new Set(sequences)]) {
    const source = store.getBySequence(sequence);
    if (!source?.payload || !knowledgeSourceAllowed(store,source)) { result.deferred.push({sequence,reason:"Source unavailable or learning disabled"}); continue; }
    const conversation = source.payload.conversation as { user?: string; occurredAt?: string } | undefined;
    const text = conversation?.user ?? (source.payload.sourceEvidence as { text?: string } | undefined)?.text;
    if (!text) { result.deferred.push({sequence,reason:"Original attributable prose required"}); continue; }
    const effectiveAt = conversation?.occurredAt ?? source.capturedAt;
    let recognized = false;
    for (const quote of text.split(/\n|(?<=[.!])\s+(?=[A-Z])/).map((line)=>line.trim().replace(/^-\s+/,""))) {
      const fact = groundedProperty(quote);
      if (!fact) continue;
      recognized = true;
      const entityId = projectFactEntity(fact.subject);
      const key = { entityId, property: fact.property, scopeId: entityId };
      const state = deriveWorldState(replayWorldModel(store));
      const current = state.current.find((c)=>c.entityId===entityId&&c.attribute===fact.property&&c.scopeId===entityId);
      if (!current && state.governedScopeHashes?.includes(knowledgeScopeHash(entityId,fact.property))) {
        result.deferred.push({sequence,reason:"Retired scope has no current value; a legacy re-import cannot restore erased or retracted knowledge"});
        continue;
      }
      if (current && Date.parse(current.effectiveAt??current.capturedAt) > Date.parse(effectiveAt)) { result.deferred.push({sequence,reason:"Older evidence retained as history; current fact unchanged"}); continue; }
      if (repairMode() !== "active") { result.shadow++; continue; }
      try {
        // Keep the operation stable across retries; same-value evidence is
        // coalesced by the projector without turning a replay into a new repair.
        const receipt = acceptKnowledgeProposal(store,{originId:`migration:${sequence}:${fact.property}`,key,value:fact.value,operation:"dispute",expectedRevision:targetRevision(store,key),effectiveAt,evidence:[{sequence,quote}],authority:source.sourceId==="chat.cognition"?"user_confirmed":"observed"});
        result.applied.push(receipt.repairId);
      } catch (error) { result.deferred.push({sequence,reason:error instanceof Error?error.message:"Validation failed"}); }
    }
    if (!recognized) result.deferred.push({sequence,reason:"Property or scope is not grounded in a registered scalar schema"});
  }
  return result;
}

export function knowledgeMigrationStatus(store: IntelligenceEventStore): { properties: readonly string[]; scopes: string[]; mode: string } {
  return { properties:GOVERNED_PROPERTIES,scopes:[...new Set(deriveWorldState(replayWorldModel(store)).current.filter((c)=>c.repairId).map((c)=>`${c.entityId}.${c.attribute}`))],mode:repairMode() };
}

/** Incremental migration of eligible original events; own exports/receipts never count as fresh evidence. */
export function runKnownFactMigration(store: IntelligenceEventStore): number {
  if (repairMode() !== "active") return 0;
  const checkpoint="knowledge-source-migration-v1";
  let cursor=store.getCheckpoint(checkpoint), count=0;
  for (const event of store.readFrom(cursor,500)) {
    const conversation=event.payload?.conversation as {user?:string;knowledgeInput?:boolean}|undefined;
    if (!event.erased && ["chat.cognition","conversation.import"].includes(event.sourceId) && conversation?.user && !conversation.knowledgeInput && groundedProperty(conversation.user)) count+=migrateKnowledgeSources(store,[event.sequence]).applied.length;
    cursor=event.sequence;
    store.saveCheckpoint(checkpoint,cursor,String(cursor));
  }
  return count;
}
