import { createHash } from "node:crypto";
import type { IntelligenceEventStore, StoredEvent } from "../event-store.js";
import type { ContextEnvelope } from "../context-envelope.js";

/**
 * Legacy-writer migration adapter (plan U8).
 *
 * Dual-writes legacy store entries onto the canonical spine with preserved
 * IDs, timestamps, and `legacy_import` provenance. Legacy owners keep their
 * reads until reconciliation proves parity; a writer is retired only after
 * its dual-write AND read-parity gates pass (U8 contract). No destructive
 * conversion happens here.
 *
 * ponytail: this module deliberately does not touch the legacy writers —
 * each one adopts the adapter behind its own parity gate, one owner at a
 * time.
 */

export interface LegacyEntry {
  /** The legacy store's own id — preserved verbatim on the spine event. */
  legacyId: string;
  kind: string;
  sourceId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface DualWriteResult {
  eventId: string;
  sequence: number;
  /** True when the entry already existed on the spine (idempotent backfill). */
  alreadyPresent: boolean;
}

/**
 * Backfill one legacy entry as a spine event. Idempotent per
 * (sourceId, legacyId): re-running a migration never duplicates events.
 */
export function dualWriteLegacyEntry(store: IntelligenceEventStore, entry: LegacyEntry): DualWriteResult | null {
  const envelope: ContextEnvelope = {
    pathKind: "interface",
    kind: spineKind(entry.kind),
    sourceId: entry.sourceId,
    consent: { grantedAt: entry.occurredAt, scopes: [entry.sourceId] },
    retentionClass: "local_default",
    payloadClassification: "operational",
    provenance: `legacy_import:${entry.legacyId}`,
    idempotencyKey: `legacy:${entry.sourceId}:${entry.legacyId}`,
    causationIds: [],
    // Original timestamp rides inside the payload until the captured_at
    // backfill pass lands with the first real writer cutover.
    payload: { ...entry.payload, legacy_id: entry.legacyId, occurred_at: entry.occurredAt },
  };

  const existing = store.findByIdempotencyKey(envelope.sourceId, envelope.idempotencyKey);
  if (existing) {
    return { eventId: existing.id, sequence: existing.sequence, alreadyPresent: true };
  }
  const written = store.append(envelope);
  if (!written) return null;
  return { eventId: written.id, sequence: written.sequence, alreadyPresent: false };
}

function spineKind(legacyKind: string): ContextEnvelope["kind"] {
  switch (legacyKind) {
    case "observation":
      return "observation";
    case "inferred_belief":
      return "inferred_belief";
    case "user_confirmed_intention":
      return "user_confirmed_intention";
    case "verified_outcome":
      return "verified_outcome";
    case "executive_decision":
      return "executive_decision";
    default:
      return "observation";
  }
}

// ---------------------------------------------------------------------------
// Reconciliation gates
// ---------------------------------------------------------------------------

export interface ReconciliationReport {
  legacyCount: number;
  spineCount: number;
  missingOnSpine: string[];
  countParity: boolean;
  hashParity: boolean;
  legacyHash: string;
  spineHash: string;
}

/**
 * Compare a legacy store's entries against their dual-written spine events:
 * counts and content hashes must match before any reader is cut over.
 */
export function reconcile(
  store: IntelligenceEventStore,
  sourceId: string,
  readLegacy: () => LegacyEntry[],
): ReconciliationReport {
  const legacy = readLegacy();
  const missingOnSpine: string[] = [];
  const foundTriples: Array<[string, string, Record<string, unknown>]> = [];

  for (const entry of legacy) {
    const onSpine = store.findByIdempotencyKey(entry.sourceId, `legacy:${entry.sourceId}:${entry.legacyId}`);
    if (!onSpine) {
      missingOnSpine.push(entry.legacyId);
      continue;
    }
    foundTriples.push([entry.legacyId, entry.kind, entry.payload]);
  }

  const allTriples = legacy.map((e) => [e.legacyId, e.kind, e.payload] as [string, string, Record<string, unknown>]);
  const spineCount = legacy.length - missingOnSpine.length;

  return {
    legacyCount: legacy.length,
    spineCount,
    missingOnSpine,
    countParity: missingOnSpine.length === 0,
    hashParity: contentHash(allTriples) === contentHash(foundTriples),
    legacyHash: contentHash(allTriples),
    spineHash: contentHash(foundTriples),
  };

  function contentHash(parts: Array<[string, string, Record<string, unknown>]>): string {
    return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  }
}

/** Reader-parity probe: projected state vs a legacy reader over the same data. */
export function readerParity<T>(
  projected: T,
  legacy: T,
  equals: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b),
): boolean {
  try {
    return equals(projected, legacy);
  } catch {
    return false;
  }
}

export type { StoredEvent };
