import { SourceContractRegistry } from "../../intelligence/sensors/source-contracts.js";
import type { IntelligenceEventStore, StoredEvent } from "../../intelligence/event-store.js";

/** Re-read source controls; copying evidence into a curator event never grants new egress. */
export function knowledgeSourceAllowed(store: IntelligenceEventStore, event: StoredEvent, egress = false, seen = new Set<number>()): boolean {
  if (!event.payload || event.erased || store.isRevoked(event.sourceId) || seen.has(event.sequence) || seen.size >= 64) return false;
  seen.add(event.sequence);
  const registry = new SourceContractRegistry();
  const status = registry.status(event.sourceId);
  if (status && status !== "enabled" || event.sourceId === "conversation.import" && status !== "enabled") return false;
  const contract = registry.contract(event.sourceId);
  if (contract?.retentionDays && Date.now()-Date.parse(event.capturedAt) > contract.retentionDays*86400000) return false;
  if (egress && (contract ? !contract.egressDestinations.includes("configured-learning-model") : event.sourceId !== "chat.cognition")) return false;
  if (event.provenance.startsWith("knowledge-")) {
    for (const ref of event.evidenceRefs) {
      if (!ref.startsWith("event:")) continue;
      const source=store.getByEventReference(ref);
      if (!source || !knowledgeSourceAllowed(store,source,egress,new Set(seen))) return false;
    }
  }
  return true;
}
