import type { IntelligenceEventStore, StoredEvent } from "../event-store.js";
import type { SourceContractRegistry } from "./source-contracts.js";

/**
 * Source governance controls (PRD §3.2): inspect, export, delete, and
 * retention enforcement for LEARN sources. Every control is local-only.
 */

export interface GovernanceSummary {
  sourceId: string;
  status: string;
  sensitivity: string;
  purpose: string;
  eventCount: number;
  firstCapturedAt?: string;
  lastCapturedAt?: string;
}

/** Inspect: what does Flyd hold for each LEARN source? */
export function governanceSummary(store: IntelligenceEventStore, registry: SourceContractRegistry): GovernanceSummary[] {
  const counts = new Map<string, { n: number; first?: string; last?: string }>();
  for (let seq = 0; ; ) {
    const batch = store.readFrom(seq);
    if (batch.length === 0) break;
    for (const event of batch) {
      const entry = counts.get(event.sourceId) ?? { n: 0 };
      entry.n += 1;
      entry.first = entry.first ?? event.capturedAt;
      entry.last = event.capturedAt;
      counts.set(event.sourceId, entry);
      seq = Math.max(seq, event.sequence);
    }
    if (batch.length < 1000) break;
  }

  return registry.list().map(({ contract, state }) => ({
    sourceId: contract.sourceId,
    status: state.status,
    sensitivity: contract.sensitivity,
    purpose: contract.purpose,
    eventCount: counts.get(contract.sourceId)?.n ?? 0,
    ...(counts.get(contract.sourceId)?.first ? { firstCapturedAt: counts.get(contract.sourceId)!.first } : {}),
    ...(counts.get(contract.sourceId)?.last ? { lastCapturedAt: counts.get(contract.sourceId)!.last } : {}),
  }));
}

export interface SourceExport {
  sourceId: string;
  exportedAt: string;
  events: Array<Pick<StoredEvent, "sequence" | "kind" | "capturedAt" | "payload"> & { payloadReadable: boolean }>;
}

/** Export: every stored event for one source, with readable-payload labels. */
export function exportSourceData(store: IntelligenceEventStore, sourceId: string): SourceExport {
  const events: SourceExport["events"] = [];
  for (const event of store.readFrom(0)) {
    if (event.sourceId !== sourceId) continue;
    events.push({
      sequence: event.sequence,
      kind: event.kind,
      capturedAt: event.capturedAt,
      payload: event.payload,
      payloadReadable: event.payload !== undefined && !event.erased,
    });
  }
  return { sourceId, exportedAt: new Date().toISOString(), events };
}

/**
 * Delete: revoke immediately, erase payloads from the canonical spine, and
 * return the erasure record so callers can sweep projections, indexes,
 * replay snapshots, and legacy-derived copies. After this returns, the raw
 * material is unrecoverable from any surface the store owns.
 */
export function deleteSource(
  store: IntelligenceEventStore,
  registry: SourceContractRegistry,
  sourceId: string,
): { revokedAt: string; tombstone: ReturnType<IntelligenceEventStore["latestTombstone"]>; pendingSweeps: number } {
  registry.setStatus(sourceId, "revoked");
  const { tombstone, sweeps } = store.eraseSource(sourceId);
  return {
    revokedAt: new Date().toISOString(),
    tombstone,
    pendingSweeps: sweeps.length,
  };
}

/**
 * Retention enforcement: sequences older than the contract's retention
 * window. Callers pass the results to eraseSource-style sweeps; nothing is
 * deleted implicitly by reads.
 */
export function retentionDueSequences(store: IntelligenceEventStore, registry: SourceContractRegistry, now = new Date()): Array<{ sourceId: string; sequences: number[] }> {
  const out: Array<{ sourceId: string; sequences: number[] }> = [];
  for (const { contract } of registry.list()) {
    if (!contract.retentionDays) continue;
    const cutoff = now.getTime() - contract.retentionDays * 86_400_000;
    const stale = store
      .readFrom(0)
      .filter((e) => e.sourceId === contract.sourceId && !e.erased && Date.parse(e.capturedAt) < cutoff)
      .map((e) => e.sequence);
    if (stale.length > 0) out.push({ sourceId: contract.sourceId, sequences: stale });
  }
  return out;
}
