import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { assertNotRealFlydHome } from "../lib/test-home-guard.js";
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
    assertNotRealFlydHome(path);
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

      CREATE TABLE IF NOT EXISTS source_renewals (
        source_id TEXT PRIMARY KEY,
        tombstone_rowid INTEGER NOT NULL
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

  /** Serialize read/derive/append workflows against other Core/CLI writers. */
  transaction<T>(work: () => T): T {
    return this.db.transaction(work).immediate();
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

  /** Changes whenever a source is erased; with headSequence it identifies one replayable log state. */
  erasureMark(): number {
    const row = this.db.prepare(`SELECT MAX(rowid) AS mark FROM erasure_tombstones`).get() as { mark: number | null };
    return row.mark ?? 0;
  }

  headSequence(): number {
    const row = this.db.prepare(`SELECT MAX(sequence) AS head FROM personal_events`).get() as {
      head: number | null;
    };
    return row.head ?? 0;
  }

  /** One source's events in sequence order, via the source index; dictation reads this per utterance. */
  readSource(sourceId: string): StoredEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM personal_events WHERE source_id = ? ORDER BY sequence ASC`)
      .all(sourceId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapRow(row));
  }

  /** One page of a source's live events after a time, oldest first, or before a time, newest first: readers walk pages instead of loading the whole source. */
  readSourcePage(sourceId: string, options: { after?: string; before?: string; limit: number }): StoredEvent[] {
    const newest = options.after === undefined;
    const rows = this.db
      .prepare(`SELECT * FROM personal_events WHERE source_id = ? AND erased = 0 AND captured_at > ? AND captured_at < ? ORDER BY captured_at ${newest ? "DESC" : "ASC"}, sequence ${newest ? "DESC" : "ASC"} LIMIT ?`)
      .all(sourceId, options.after ?? "", options.before ?? "\uffff", Math.max(1, Math.floor(options.limit))) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapRow(row));
  }

  /** A source's live events whose idempotency key starts with a prefix, oldest first, by the (source, key) index. */
  readByIdempotencyPrefix(sourceId: string, prefix: string): StoredEvent[] {
    if (!prefix) throw new Error("Invalid idempotency prefix");
    const rows = this.db
      .prepare(`SELECT * FROM personal_events WHERE source_id = ? AND erased = 0 AND idempotency_key >= ? AND idempotency_key < ? ORDER BY sequence ASC`)
      .all(sourceId, prefix, prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapRow(row));
  }

  /** A source family, using an indexed lexical range instead of replaying unrelated memory. */
  readSourcePrefix(prefix: string): StoredEvent[] {
    if (!prefix || !/^[a-zA-Z0-9_.:-]+$/.test(prefix)) throw new Error("Invalid source prefix");
    const rows = this.db.prepare(`SELECT * FROM personal_events WHERE source_id >= ? AND source_id < ? ORDER BY sequence ASC`)
      .all(prefix, prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)) as Array<Record<string, unknown>>;
    return rows.map(row => this.mapRow(row));
  }

  /** Newest first: subjects that conversation learning labelled, for dictation's spelling hints. */
  learnedTopicLabels(limit = 50): string[] {
    const rows = this.db.prepare(
      "SELECT json_extract(payload_json, '$.value') AS label FROM personal_events WHERE erased = 0" +
      " AND source_id IN ('chat.cognition','conversation.import')" +
      " AND json_extract(payload_json, '$.attribute') = 'label'" +
      " AND json_extract(payload_json, '$.entity.id') LIKE 'topic:%' ORDER BY sequence DESC LIMIT ?",
    ).all(Math.max(1, Math.min(limit, 200))) as Array<{ label: unknown }>;
    return rows.flatMap(row => typeof row.label === "string" ? [row.label] : []);
  }

  /** The newest attributed conversation turns, newest first, whatever was said in them. */
  recentConversations(limit = 200): StoredEvent[] {
    const rows = this.db.prepare(
      "SELECT * FROM personal_events WHERE erased = 0 AND source_id IN ('chat.cognition','conversation.import')" +
      " AND json_type(payload_json, '$.conversation') = 'object' ORDER BY sequence DESC LIMIT ?",
    ).all(Math.max(1, Math.min(limit, 1_000))) as Array<Record<string, unknown>>;
    return rows.map(row => this.mapRow(row));
  }

  /** Search original attributed conversation evidence without a second archive/index. */
  searchConversations(terms: string[], projectIds: string[] = [], limit = 8): StoredEvent[] {
    const words = [...new Set(terms.map(t => t.toLowerCase().trim()).filter(t => t.length >= 3))].slice(0, 8);
    if (!words.length) return [];
    const clauses = words.map(() => "LOWER(json_extract(payload_json, '$.conversation.user')) LIKE ? ESCAPE '\\'");
    const patterns = words.map(t => "%" + t.replace(/[\\%_]/g, c => "\\" + c) + "%");
    const projectClause = projectIds.length
      ? " AND EXISTS (SELECT 1 FROM json_each(json_extract(payload_json, '$.conversation.projectIds')) WHERE value IN (" +
        projectIds.map(() => "?").join(",") + "))" : "";
    const rows = this.db.prepare(
      "SELECT * FROM personal_events WHERE erased = 0 AND source_id IN ('chat.cognition','conversation.import')" +
      " AND json_type(payload_json, '$.conversation') = 'object' AND (" + clauses.join(" OR ") + ")" +
      projectClause + " ORDER BY sequence DESC LIMIT ?",
    ).all(...patterns, ...projectIds, Math.max(1, Math.min(limit, 50))) as Array<Record<string, unknown>>;
    return rows.map(row => this.mapRow(row));
  }

  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM personal_events`).get() as { n: number };
    return row.n;
  }

  /**
   * What a replay depends on, in one cheap query: the head, how many events
   * exist and how many are erased. Appends move only the head and count;
   * an erasure or a purge changes the rest, so a cached replay can tell
   * whether extending it is still the same as replaying from zero.
   */
  replayFingerprint(): { file: string; head: number; count: number; erased: number } {
    const row = this.db.prepare(
      `SELECT COALESCE(MAX(sequence), 0) AS head, COUNT(*) AS n, COALESCE(SUM(erased), 0) AS erased FROM personal_events`,
    ).get() as { head: number; n: number; erased: number };
    return { file: this.db.name, head: row.head, count: row.n, erased: row.erased };
  }

  /** Invalidate cached/derived views whenever initiative content is retracted. */
  private scheduleInitiativeErasureSweeps(): void {
    const episodeTable = this.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'episode_nodes'",
    ).get();
    if (episodeTable) this.db.prepare("DELETE FROM episode_nodes").run();
    for (const surface of ["projections", "indexes", "replay_snapshots", "legacy_copies"] as const) {
      this.db.prepare(
        "INSERT INTO erasure_sweeps (sweep_id, source_id, surface, status) VALUES (?, ?, ?, 'pending')",
      ).run(crypto.randomUUID(), "initiative.curated", surface);
    }
  }

  /**
   * Remove event content without revoking the whole source. An expired event
   * keeps an opaque idempotency tombstone, so a restart cannot resurrect it.
   */
  purgeSourceBefore(sourceId: string, before: Date): number {
    if (!Number.isFinite(before.getTime())) throw new Error("Invalid retention cutoff");
    return this.transaction(() => {
      const oldRows = this.db.prepare(
        "SELECT sequence FROM personal_events WHERE source_id = ?" +
        " AND captured_at < ? AND erased = 0",
      ).all(sourceId, before.toISOString()) as Array<{ sequence: number }>;
      const refs = new Set(this.eventReferences(oldRows.map(row => row.sequence)));
      // An expired research finding or user mandate also invalidates derived
      // CoS reports that still reference it. Retention cannot leave children.
      const linked = sourceId.startsWith("initiative.")
        ? this.linkedCosReportSequences(refs) : [];
      const res = this.db.prepare(
        "UPDATE personal_events SET erased = 1, payload_json = NULL, evidence_refs = '[]'," +
        " causation_ids = '[]', correlation_id = NULL WHERE source_id = ?" +
        " AND captured_at < ? AND erased = 0",
      ).run(sourceId, before.toISOString());
      this.retractSequences(linked);
      if (res.changes > 0 || linked.length) this.scheduleInitiativeErasureSweeps();
      return res.changes;
    });
  }

  /** Find derived initiative events that depend on the precise upstream keys. */
  private derivedInitiativeSequences(keys: ReadonlySet<string>, prefixes: string[] = []): number[] {
    const rows = this.db.prepare(
      "SELECT sequence, payload_json FROM personal_events" +
      " WHERE source_id = 'initiative.curated' AND erased = 0 AND payload_json IS NOT NULL",
    ).all() as Array<{ sequence: number; payload_json: string }>;
    const hit = (key: string): boolean => keys.has(key) || prefixes.some(prefix => key.startsWith(prefix));
    return rows.flatMap(row => {
      let payload: { source_keys?: unknown; sources?: unknown };
      try { payload = JSON.parse(row.payload_json) as typeof payload; } catch { return []; }
      const direct = Array.isArray(payload.source_keys) ? payload.source_keys : [];
      const nested = Array.isArray(payload.sources)
        ? payload.sources.map(item => (item as { id?: unknown } | null)?.id) : [];
      return [...direct, ...nested].some(key => typeof key === "string" && hit(key)) ? [row.sequence] : [];
    });
  }

  /** CoS research reports inherit the research/mandate source's privacy. */
  private linkedCosReportSequences(keys: ReadonlySet<string>): number[] {
    if (!keys.size) return [];
    const rows = this.db.prepare(
      "SELECT sequence, payload_json FROM personal_events WHERE source_id = 'cos.report'" +
      " AND erased = 0 AND payload_json IS NOT NULL",
    ).all() as Array<{ sequence: number; payload_json: string }>;
    return rows.flatMap(row => {
      try {
        const p = JSON.parse(row.payload_json) as { report?: { evidenceRefs?: unknown } };
        const refs = p.report?.evidenceRefs;
        return Array.isArray(refs) && refs.some(ref => typeof ref === "string" && keys.has(ref))
          ? [row.sequence] : [];
      } catch { return []; }
    });
  }

  private eventReferences(sequences: number[]): string[] {
    if (!sequences.length) return [];
    const lookup = this.db.prepare("SELECT id FROM personal_events WHERE sequence = ?");
    return sequences.flatMap(sequence => {
      const row = lookup.get(sequence) as { id: string } | undefined;
      return row ? ["event:" + row.id] : [];
    });
  }

  private retractSequences(sequences: number[]): void {
    const update = this.db.prepare(
      "UPDATE personal_events SET erased = 1, payload_json = NULL, evidence_refs = '[]'," +
      " causation_ids = '[]', correlation_id = NULL WHERE sequence = ? AND erased = 0",
    );
    for (const sequence of sequences) update.run(sequence);
  }

  /**
   * Erase derived initiative text when one source key becomes stale or is
   * explicitly withdrawn. This doesn't disable unrelated initiative consent.
   */
  retractInitiativeBySourceKeys(sourceKeys: string[]): number {
    const keys = new Set(sourceKeys.filter(key =>
      /^(?:project|council|scout|cos):[^\s]{1,400}$/.test(key)));
    if (!keys.size) return 0;
    return this.transaction(() => {
      const sequences = this.derivedInitiativeSequences(keys);
      const cos = this.linkedCosReportSequences(new Set(this.eventReferences(sequences)));
      this.retractSequences([...sequences, ...cos]);
      if (sequences.length || cos.length) this.scheduleInitiativeErasureSweeps();
      return sequences.length + cos.length;
    });
  }

  /** Retract an obsolete question/revision without removing a newly revised case. */
  retractInitiativeCases(cases: Array<{ candidateId: string; revision: string }>): number {
    const match = new Set(cases.map(c => c.candidateId + "@" + c.revision));
    if (!match.size) return 0;
    return this.transaction(() => {
      const rows = this.db.prepare(
        "SELECT sequence, payload_json FROM personal_events WHERE source_id = 'initiative.curated'" +
        " AND erased = 0 AND payload_json IS NOT NULL",
      ).all() as Array<{ sequence: number; payload_json: string }>;
      const erase = rows.flatMap(row => {
        try {
          const p = JSON.parse(row.payload_json) as Record<string, unknown>;
          const id = p.candidate_id;
          const rev = p.revision ?? p.source_revision;
          return typeof id === "string" && typeof rev === "string" && match.has(id + "@" + rev)
            ? [row.sequence] : [];
        } catch { return []; }
      });
      const cos = this.linkedCosReportSequences(new Set(this.eventReferences(erase)));
      this.retractSequences([...erase, ...cos]);
      if (erase.length || cos.length) this.scheduleInitiativeErasureSweeps();
      return erase.length + cos.length;
    });
  }

  /** Public research consent is separate from local candidate consent. */
  retractInitiativeResearch(): number {
    return this.transaction(() => {
      const rows = this.db.prepare(
        "SELECT sequence, payload_json FROM personal_events WHERE source_id = 'initiative.curated'" +
        " AND erased = 0 AND payload_json IS NOT NULL",
      ).all() as Array<{ sequence: number; payload_json: string }>;
      const found = rows.flatMap(row => {
        try {
          const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
          return payload.type === "research_claim" || payload.type === "investigation"
            || payload.type === "initiative_review" ? [row.sequence] : [];
        } catch { return []; }
      });
      const cos = this.linkedCosReportSequences(new Set(this.eventReferences(found)));
      this.retractSequences([...found, ...cos]);
      if (found.length || cos.length) this.scheduleInitiativeErasureSweeps();
      return found.length + cos.length;
    });
  }

  /**
   * Source erasure (PRD §3.2): destroy every readable payload for the
   * source, write a non-identifying tombstone (count + time only), queue
   * sweeps for every derived surface, and exclude content from replay.
   * Returns the sequences whose projections must retract.
   */
  eraseSource(sourceId: string): { tombstone: ErasureTombstone; affectedSequences: number[]; sweeps: PendingErasureSweep[] } {
    const original = this.db.prepare(
      "SELECT id, sequence FROM personal_events WHERE source_id = ? AND erased = 0",
    ).all(sourceId) as Array<{ id: string; sequence: number }>;
    const own = original.map(row => row.sequence);

    // Prior to removing the original records, find any private synthesis that
    // cites their event identities or the registered source family. This must
    // happen in the SAME transaction as the parent erasure.
    const family = sourceId === "cos.report" ? ["cos:"]
      : sourceId === "council.advisory" ? ["council:"]
      : sourceId === "scout.edition" ? ["scout:"]
      : sourceId === "project.curated" ? ["project:"] : [];
    const keys = new Set<string>([
      sourceId,
      ...original.flatMap(row => ["event:" + row.id, "cos:" + row.id]),
    ]);
    const impacted = this.transaction(() => {
      const dependent = this.derivedInitiativeSequences(keys, family);
      const cos = this.linkedCosReportSequences(new Set([
        ...this.eventReferences(own), ...this.eventReferences(dependent),
      ]));
      this.retractSequences([...own, ...dependent, ...cos]);
      const now = new Date().toISOString();
      this.db.prepare(
        "INSERT INTO erasure_tombstones (source_id, erased_at, event_count) VALUES (?, ?, ?)",
      ).run(sourceId, now, own.length);
      const episodeTable = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'episode_nodes'").get();
      if (episodeTable) this.db.prepare("DELETE FROM episode_nodes").run();
      for (const surface of ["projections", "indexes", "replay_snapshots", "legacy_copies"] as const) {
        this.db.prepare(
          "INSERT INTO erasure_sweeps (sweep_id, source_id, surface, status) VALUES (?, ?, ?, 'pending')",
        ).run(crypto.randomUUID(), sourceId, surface);
      }
      return [...new Set([...own, ...dependent, ...cos])];
    });
    return {
      tombstone: this.latestTombstone(sourceId) as ErasureTombstone,
      affectedSequences: impacted,
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
    const latest = this.db
      .prepare(`SELECT MAX(rowid) AS id FROM erasure_tombstones WHERE source_id = ?`)
      .get(sourceId) as { id: number | null };
    if (latest.id === null) return false;
    const renewal = this.db
      .prepare(`SELECT tombstone_rowid FROM source_renewals WHERE source_id = ?`)
      .get(sourceId) as { tombstone_rowid: number } | undefined;
    return latest.id > (renewal?.tombstone_rowid ?? 0);
  }

  /** Accepts new events for an erased source after an explicit re-enable; erased events stay erased. */
  renewSource(sourceId: string): void {
    this.db
      .prepare(
        `INSERT INTO source_renewals (source_id, tombstone_rowid)
         SELECT ?, MAX(rowid) FROM erasure_tombstones WHERE source_id = ? GROUP BY source_id
         ON CONFLICT(source_id) DO UPDATE SET tombstone_rowid = excluded.tombstone_rowid`,
      )
      .run(sourceId, sourceId);
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
