import { randomUUID } from "crypto";
import type { Pool } from "pg";
import type { QueryResultRow } from "pg";

// Generic durable-run lifecycle, extracted from the repository-action
// task-store machinery (revision-guarded transactional updates). Deliberately
// free of repository concepts: grants, worker sessions and artifacts are
// consumers of this contract, not part of it.
//
//   running ⇄ checkpoint ⇄ waiting_for_user | waiting_for_tool | waiting_for_agent
//        → completed | failed | cancelled

export class RevisionConflictError extends Error {
  constructor(runKey: string) {
    super(`Run ${runKey} was modified concurrently — refresh and retry`);
    this.name = "RevisionConflictError";
  }
}

export class InvalidTransitionError extends Error {
  constructor(runKey: string, from: string, to: string) {
    super(`Run ${runKey}: cannot transition ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export const RUN_STATUSES = [
  "running",
  "waiting_for_user",
  "waiting_for_tool",
  "waiting_for_agent",
  "completed",
  "failed",
  "cancelled",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export type WaitOn = "user" | "tool" | "agent";

export interface RunPrincipal {
  kind: "user" | "system" | "agent";
  id: string;
}

/** What a parked run is waiting for. Shape is consumer-defined. */
export interface PendingRequest {
  prompt?: string;
  [key: string]: unknown;
}

export interface AgentRun {
  runKey: string;
  principal: RunPrincipal;
  /** Consumer-defined work kind, e.g. "repository_action", "research". */
  kind: string;
  status: RunStatus;
  waitOn: WaitOn | null;
  waitReason: string | null;
  pendingRequest: PendingRequest | null;
  checkpoint: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  endedAt: Date | null;
}

export interface CreateRunInput {
  principal: RunPrincipal;
  kind: string;
  checkpoint?: Record<string, unknown>;
  /**
   * Optional externally-chosen identity so consumers can look runs up by
   * their own keys (e.g. grant IDs). Must be globally unique.
   */
  runKey?: string;
}

export interface ParkInput {
  waitOn: WaitOn;
  reason?: string;
  pendingRequest?: PendingRequest;
  checkpoint?: Record<string, unknown>;
}

const TERMINAL: ReadonlySet<RunStatus> = new Set(["completed", "failed", "cancelled"]);
const WAITING: ReadonlySet<RunStatus> = new Set(["waiting_for_user", "waiting_for_tool", "waiting_for_agent"]);

function mapRun(row: QueryResultRow): AgentRun {
  return {
    runKey: String(row.run_key),
    principal: { kind: row.principal_kind as RunPrincipal["kind"], id: String(row.principal_id) },
    kind: String(row.kind),
    status: row.status as RunStatus,
    waitOn: (row.wait_on as WaitOn) ?? null,
    waitReason: (row.wait_reason as string) ?? null,
    pendingRequest: (row.pending_request as PendingRequest) ?? null,
    checkpoint: (row.checkpoint as Record<string, unknown>) ?? {},
    result: (row.result as Record<string, unknown>) ?? null,
    error: (row.error as string) ?? null,
    revision: Number(row.revision),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    endedAt: row.ended_at ? new Date(row.ended_at) : null,
  };
}

const RUN_COLUMNS = `run_key, principal_kind, principal_id, kind, status, wait_on, wait_reason,
  pending_request, checkpoint, result, error, revision, created_at, updated_at, ended_at`;

export class PostgresRunStore {
  private pool: Pool;
  private schemaReady: Promise<void> | null = null;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /** Idempotent. The run store owns its schema; no external migrations needed. */
  ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.pool.query(`
        CREATE TABLE IF NOT EXISTS agent_runs (
          id BIGSERIAL PRIMARY KEY,
          run_key TEXT NOT NULL UNIQUE,
          principal_kind TEXT NOT NULL,
          principal_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          wait_on TEXT,
          wait_reason TEXT,
          pending_request JSONB,
          checkpoint JSONB NOT NULL DEFAULT '{}'::jsonb,
          result JSONB,
          error TEXT,
          revision INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ended_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS index_agent_runs_on_status ON agent_runs (status);
        CREATE INDEX IF NOT EXISTS index_agent_runs_on_principal ON agent_runs (principal_kind, principal_id);
      `).then(() => undefined);
    }
    return this.schemaReady;
  }

  async createRun(input: CreateRunInput): Promise<AgentRun> {
    await this.ensureSchema();
    const runKey = input.runKey ?? randomUUID();
    const result = await this.pool.query(
      `INSERT INTO agent_runs (run_key, principal_kind, principal_id, kind, checkpoint)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING ${RUN_COLUMNS}`,
      [runKey, input.principal.kind, input.principal.id, input.kind, JSON.stringify(input.checkpoint ?? {})]
    ).catch((err: { code?: string }) => {
      if (err.code === "23505") throw new Error(`Run key already exists: ${runKey}`);
      throw err;
    });
    return mapRun(result.rows[0]);
  }

  async getRun(runKey: string): Promise<AgentRun | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE run_key = $1`,
      [runKey]
    );
    return result.rows.length ? mapRun(result.rows[0]) : null;
  }

  /**
   * Persist progress while running. Revision-guarded: pass the revision you
   * read; concurrent writers make you retry with fresh state.
   */
  async saveCheckpoint(runKey: string, expectedRevision: number, checkpoint: Record<string, unknown>): Promise<AgentRun> {
    return this.mutate(runKey, expectedRevision, ["running"], "running", (revision) => ({
      text: `UPDATE agent_runs SET checkpoint = $1::jsonb, revision = $2, updated_at = NOW()
             WHERE run_key = $3 AND revision = $4 AND status = 'running'`,
      values: [JSON.stringify(checkpoint), revision, runKey, expectedRevision],
    }));
  }

  /** RUNNING → WAITING_*. Optionally advances the checkpoint in one transaction. */
  async park(runKey: string, expectedRevision: number, input: ParkInput): Promise<AgentRun> {
    return this.mutate(runKey, expectedRevision, ["running"], `waiting_for_${input.waitOn}` as RunStatus, (revision) => ({
      text: `UPDATE agent_runs SET status = $1, wait_on = $2, wait_reason = $3,
               pending_request = $4::jsonb,
               checkpoint = COALESCE($5::jsonb, checkpoint),
               revision = $6, updated_at = NOW()
             WHERE run_key = $7 AND revision = $8 AND status = 'running'`,
      values: [
        `waiting_for_${input.waitOn}`,
        input.waitOn,
        input.reason ?? null,
        input.pendingRequest ? JSON.stringify(input.pendingRequest) : null,
        input.checkpoint ? JSON.stringify(input.checkpoint) : null,
        revision,
        runKey,
        expectedRevision,
      ],
    }));
  }

  /** WAITING_* → RUNNING. Returns the run with its pendingRequest intact for the resuming turn. */
  async resume(runKey: string): Promise<AgentRun> {
    await this.ensureSchema();
    const current = await this.getRun(runKey);
    if (!current) throw new Error(`Run ${runKey} not found`);
    if (!WAITING.has(current.status)) throw new InvalidTransitionError(runKey, current.status, "running");
    if (TERMINAL.has(current.status)) throw new InvalidTransitionError(runKey, current.status, "running");

    const result = await this.pool.query(
      `UPDATE agent_runs SET status = 'running', wait_on = NULL, wait_reason = NULL,
         revision = revision + 1, updated_at = NOW()
       WHERE run_key = $1 AND status LIKE 'waiting_for_%'
       RETURNING ${RUN_COLUMNS}`,
      [runKey]
    );
    if (!result.rows.length) throw new RevisionConflictError(runKey);
    return mapRun(result.rows[0]);
  }

  async complete(runKey: string, expectedRevision: number, result: Record<string, unknown> = {}): Promise<AgentRun> {
    return this.finish(runKey, expectedRevision, ["running", ...WAITING], "completed", result, null);
  }

  async fail(runKey: string, expectedRevision: number, error: string): Promise<AgentRun> {
    return this.finish(runKey, expectedRevision, ["running", ...WAITING], "failed", null, error);
  }

  async cancel(runKey: string, expectedRevision: number): Promise<AgentRun> {
    return this.finish(runKey, expectedRevision, ["running", ...WAITING], "cancelled", null, null);
  }

  async listActive(filter: { principal?: RunPrincipal; kind?: string } = {}): Promise<AgentRun[]> {
    await this.ensureSchema();
    const conditions = [`status IN ('running', 'waiting_for_user', 'waiting_for_tool', 'waiting_for_agent')`];
    const values: unknown[] = [];
    if (filter.principal) {
      values.push(filter.principal.kind, filter.principal.id);
      conditions.push(`principal_kind = $${values.length - 1}`, `principal_id = $${values.length}`);
    }
    if (filter.kind) {
      values.push(filter.kind);
      conditions.push(`kind = $${values.length}`);
    }
    const result = await this.pool.query(
      `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC LIMIT 100`,
      values
    );
    return result.rows.map(mapRun);
  }

  /**
   * Fail every still-'running' run of a kind left behind by a previous
   * process. Called at boot: in-process execution cannot survive a restart,
   * so those runs are interrupted, not active. Parked runs are deliberately
   * untouched — waiting is exactly what survives a restart.
   */
  async failRunningByKind(kind: string, error: string): Promise<number> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `UPDATE agent_runs SET status = 'failed', error = $1, ended_at = NOW(),
         revision = revision + 1, updated_at = NOW()
       WHERE kind = $2 AND status = 'running'`,
      [error, kind]
    );
    return result.rowCount ?? 0;
  }

  private async finish(
    runKey: string,
    expectedRevision: number,
    allowedFrom: readonly RunStatus[],
    to: RunStatus,
    result: Record<string, unknown> | null,
    error: string | null
  ): Promise<AgentRun> {
    return this.mutate(runKey, expectedRevision, allowedFrom, to, (revision) => ({
      text: `UPDATE agent_runs SET status = $1, result = $2::jsonb, error = $3,
               wait_on = NULL, wait_reason = NULL, pending_request = NULL,
               ended_at = NOW(), revision = $4, updated_at = NOW()
             WHERE run_key = $5 AND revision = $6 AND status = ANY($7::text[])`,
      values: [to, JSON.stringify(result), error, revision, runKey, expectedRevision, [...allowedFrom]],
    }));
  }

  /**
   * Revision- and transition-guarded mutation. The WHERE clause enforces both:
   * zero rows updated means either a lost race or an invalid transition —
   * distinguish them so callers can react correctly.
   */
  private async mutate(
    runKey: string,
    expectedRevision: number,
    allowedFrom: readonly RunStatus[],
    to: RunStatus,
    build: (nextRevision: number) => { text: string; values: unknown[] }
  ): Promise<AgentRun> {
    await this.ensureSchema();
    const nextRevision = expectedRevision + 1;

    // Pre-check gives precise errors; the UPDATE's own guard still protects
    // against races between check and write.
    const current = await this.pool.query(`SELECT status FROM agent_runs WHERE run_key = $1`, [runKey]);
    if (!current.rows.length) throw new Error(`Run ${runKey} not found`);
    const status = current.rows[0].status as RunStatus;
    if (!allowedFrom.includes(status)) throw new InvalidTransitionError(runKey, status, to);

    const statement = build(nextRevision);
    const updated = await this.pool.query(statement.text, statement.values);
    if (!updated.rowCount) throw new RevisionConflictError(runKey);

    const fresh = await this.pool.query(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE run_key = $1`, [runKey]);
    return mapRun(fresh.rows[0]);
  }
}
