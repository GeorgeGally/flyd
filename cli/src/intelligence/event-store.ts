import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import type { ContextEnvelope } from "./context-envelope.js";

/**
 * Canonical event spine (flyd-personal-intelligence-prd.md §2.1).
 *
 * Append-only, schema-versioned, idempotent events in a local SQLite WAL
 * database. This is the sole durable write path for personal-runtime state.
 * Erasure nulls payloads per source and leaves only a non-identifying
 * tombstone; erased events stay in the spine as audit records but their
 * content is unrecoverable and excluded from replay.
 *
 * ponytail: payloads are stored as referenced plaintext locally — the
 * "or-referenced" half of encrypted-or-referenced. Per-source key domains
 * land when U5 wires real LEARN sources; erasure semantics already hold.
 */

export const EVENT_SCHEMA_VERSION = 1;

export interface StoredEvent {
  sequence: number;
  id: string;
  schemaVersion: number;
  kind: string;
  sourceId: string;
  capturedAt: string;
  consentJson: string;
  retentionClass: string;
  provenance: string;
  idempotencyKey: string;
  correlationId?: string;
  causationIds: string[];
  evidenceRefs: string[];
  policyVersion?: string;
  authorityGrantId?: string;
  budgetKey?: string;
  payloadDomain: string;
  payload: Record<string, unknown> | undefined;
  redacted: boolean;
  erased: boolean;
}

export interface ErasureTombstone {
  sourceId: string;
  erasedAt: string;
  eventCount: number;
}

export interface PendingErasureSweep {
  sweepId: string;
  sourceId: string;
  surface: "projections" | "indexes" | "replay_snapshots" | "legacy_copies";
  status: "pending" | "done";
}

export function defaultIntelligenceDbPath(): string {
  const flydDir = process.env.FLYD_DIR?.trim() || join(homedir(), ".flyd");
  return join(flydDir, "intelligence.sqlite");
}

export class IntelligenceEventStore {
  private readonly db: Database.Database;

  constructor(options: { path?: string } = {}) {
    const path = options.path ?? defaultIntelligenceDbPath();
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS personal_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        schema_version INTEGER NOT NULL,
        kind TEXT NOT NULL,
        source_id TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        consent_json TEXT NOT NULL,
        retention_class TEXT NOT NULL,
        provenance TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        correlation_id TEXT,
        causation_ids TEXT NOT NULL DEFAULT '[]',
        evidence_refs TEXT NOT NULL DEFAULT '[]',
        policy_version TEXT,
        authority_grant_id TEXT,
        budget_key TEXT,
        payload_domain TEXT NOT NULL,
        payload_json TEXT,
        redacted INTEGER NOT NULL DEFAULT 0,
        erased INTEGER NOT NULL DEFAULT 0,
        UNIQUE(source_id, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_personal_events_source ON personal_events(source_id);

      CREATE TABLE IF NOT EXISTS erasure_tombstones (
        source_id TEXT NOT NULL,
        erased_at TEXT NOT NULL,
        event_count INTEGER NOT NULL,
        PRIMARY KEY (source_id, erased_at)
      );

      CREATE TABLE IF NOT EXISTS erasure_sweeps (
        sweep_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        surface TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
      );

      CREATE TABLE IF NOT EXISTS projector_checkpoints (
        projector_name TEXT PRIMARY KEY,
        last_sequence INTEGER NOT NULL,
        state_hash TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Idempotent append. A duplicate (sourceId, idempotencyKey) returns the
   * existing event without writing. Rejected envelopes never reach this
   * method — validate at the boundary with validateEnvelope().
   */
  append(envelope: ContextEnvelope): StoredEvent | null {
    if (!envelope) return null;
    const existing = this.findByIdempotencyKey(envelope.sourceId, envelope.idempotencyKey);
    if (existing) return existing;

    const result = this.db
      .prepare(
        `INSERT INTO personal_events (
           id, schema_version, kind, source_id, captured_at, consent_json,
           retention_class, provenance, idempotency_key, correlation_id,
           causation_ids, evidence_refs, policy_version, authority_grant_id,
           budget_key, payload_domain, payload_json, redacted
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        EVENT_SCHEMA_VERSION,
        envelope.kind,
        envelope.sourceId,
        new Date().toISOString(),
        JSON.stringify(envelope.consent),
        envelope.retentionClass,
        envelope.provenance,
        envelope.idempotencyKey,
        envelope.correlationId ?? null,
        JSON.stringify(envelope.causationIds ?? []),
        JSON.stringify(envelope.evidenceRefs ?? []),
        envelope.policyVersion ?? null,
        envelope.authorityGrantId ?? null,
        envelope.budgetKey ?? null,
        `domain:${envelope.sourceId}`,
        envelope.payload === undefined ? null : JSON.stringify(envelope.payload),
        envelope.payloadClassification === "sensitive" ? 1 : 0,
      );

    return this.getBySequence(Number(result.lastInsertRowid));
  }

  findByIdempotencyKey(sourceId: string, idempotencyKey: string): StoredEvent | null {
    const row = this.db
      .prepare(`SELECT sequence FROM personal_events WHERE source_id = ? AND idempotency_key = ?`)
      .get(sourceId, idempotencyKey) as { sequence: number } | undefined;
    return row ? this.getBySequence(row.sequence) : null;
  }

  getBySequence(sequence: number): StoredEvent | null {
    const row = this.db.prepare(`SELECT * FROM personal_events WHERE sequence = ?`).get(sequence) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapRow(row) : null;
  }

  /** Replay feed: canonical sequence order, payloads of erased events withheld. */
  readFrom(afterSequence: number, limit = 1000): StoredEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM personal_events WHERE sequence > ? ORDER BY sequence ASC LIMIT ?`,
      )
      .all(afterSequence, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapRow(row));
  }

  headSequence(): number {
    const row = this.db.prepare(`SELECT MAX(sequence) AS head FROM personal_events`).get() as {
      head: number | null;
    };
    return row.head ?? 0;
  }

  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM personal_events`).get() as { n: number };
    return row.n;
  }

  /**
   * Source erasure (PRD §3.2): destroy every readable payload for the
   * source, write a non-identifying tombstone (count + time only), queue
   * sweeps for every derived surface, and exclude content from replay.
   * Returns the sequences whose projections must retract.
   */
  eraseSource(sourceId: string): { tombstone: ErasureTombstone; affectedSequences: number[]; sweeps: PendingErasureSweep[] } {
    const affected = (
      this.db
        .prepare(`SELECT sequence FROM personal_events WHERE source_id = ? AND erased = 0`)
        .all(sourceId) as Array<{ sequence: number }>
    ).map((r) => r.sequence);

    const erase = this.db.transaction((ids: number[]) => {
      const now = new Date().toISOString();
      const mark = this.db.prepare(
        `UPDATE personal_events SET erased = 1, payload_json = NULL WHERE source_id = ? AND erased = 0`,
      );
      mark.run(sourceId);
      this.db
        .prepare(`INSERT INTO erasure_tombstones (source_id, erased_at, event_count) VALUES (?, ?, ?)`)
        .run(sourceId, now, ids.length);
      for (const surface of ["projections", "indexes", "replay_snapshots", "legacy_copies"] as const) {
        this.db
          .prepare(`INSERT INTO erasure_sweeps (sweep_id, source_id, surface) VALUES (?, ?, ?)`)
          .run(crypto.randomUUID(), sourceId, surface);
      }
    });
    erase(affected);

    return {
      tombstone: this.latestTombstone(sourceId) as ErasureTombstone,
      affectedSequences: affected,
      sweeps: this.pendingSweeps(sourceId),
    };
  }

  latestTombstone(sourceId: string): ErasureTombstone | null {
    const row = this.db
      .prepare(
        `SELECT source_id, erased_at, event_count FROM erasure_tombstones
         WHERE source_id = ? ORDER BY erased_at DESC LIMIT 1`,
      )
      .get(sourceId) as { source_id: string; erased_at: string; event_count: number } | undefined;
    return row ? { sourceId: row.source_id, erasedAt: row.erased_at, eventCount: row.event_count } : null;
  }

  pendingSweeps(sourceId?: string): PendingErasureSweep[] {
    const rows = sourceId
      ? (this.db
          .prepare(`SELECT * FROM erasure_sweeps WHERE source_id = ? AND status = 'pending'`)
          .all(sourceId) as Array<Record<string, unknown>>)
      : (this.db
          .prepare(`SELECT * FROM erasure_sweeps WHERE status = 'pending'`)
          .all() as Array<Record<string, unknown>>);
    return rows.map((r) => ({
      sweepId: r.sweep_id as string,
      sourceId: r.source_id as string,
      surface: r.surface as PendingErasureSweep["surface"],
      status: r.status as PendingErasureSweep["status"],
    }));
  }

  completeSweep(sweepId: string): void {
    this.db.prepare(`UPDATE erasure_sweeps SET status = 'done' WHERE sweep_id = ?`).run(sweepId);
  }

  isRevoked(sourceId: string): boolean {
    return !!this.latestTombstone(sourceId);
  }

  getCheckpoint(projectorName: string): number {
    const row = this.db
      .prepare(`SELECT last_sequence FROM projector_checkpoints WHERE projector_name = ?`)
      .get(projectorName) as { last_sequence: number } | undefined;
    return row?.last_sequence ?? 0;
  }

  saveCheckpoint(projectorName: string, lastSequence: number, stateHash: string): void {
    this.db
      .prepare(
        `INSERT INTO projector_checkpoints (projector_name, last_sequence, state_hash)
         VALUES (?, ?, ?)
         ON CONFLICT(projector_name) DO UPDATE SET last_sequence = excluded.last_sequence,
                                                   state_hash = excluded.state_hash`,
      )
      .run(projectorName, lastSequence, stateHash);
  }

  private mapRow(row: Record<string, unknown>): StoredEvent {
    const erased = Number(row.erased) === 1;
    return {
      sequence: Number(row.sequence),
      id: String(row.id),
      schemaVersion: Number(row.schema_version),
      kind: String(row.kind),
      sourceId: String(row.source_id),
      capturedAt: String(row.captured_at),
      consentJson: String(row.consent_json),
      retentionClass: String(row.retention_class),
      provenance: String(row.provenance),
      idempotencyKey: String(row.idempotency_key),
      correlationId: (row.correlation_id as string) ?? undefined,
      causationIds: JSON.parse(String(row.causation_ids)) as string[],
      evidenceRefs: JSON.parse(String(row.evidence_refs)) as string[],
      policyVersion: (row.policy_version as string) ?? undefined,
      authorityGrantId: (row.authority_grant_id as string) ?? undefined,
      budgetKey: (row.budget_key as string) ?? undefined,
      payloadDomain: String(row.payload_domain),
      payload: erased || row.payload_json === null ? undefined : (JSON.parse(String(row.payload_json)) as Record<string, unknown>),
      redacted: Number(row.redacted) === 1,
      erased,
    };
  }
}
