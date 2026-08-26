import { randomUUID } from "crypto";
import type { Pool } from "pg";
import {
  type RunStore,
  type AgentRun,
  type RunPrincipal,
  type WaitOn,
} from "./run-store.js";

// Transport-facing session/event contract. CLI, overlay, voice and HTTP are
// all adapters over this kernel; none of them own session bookkeeping.
//
//   principal → session → input event → [turn] → output events + continuation
//
// A turn runs until the handler completes, fails, or parks. Parking is the
// only way work survives process death: run state lives in the RunStore.

export interface SessionEvent {
  direction: "input" | "output";
  type: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export type InputEvent =
  | { type: "user_message"; text: string }
  | { type: "tool_result"; toolCallId: string; payload?: Record<string, unknown> }
  | { type: "agent_result"; agentRunKey: string; payload?: Record<string, unknown> };

export type OutputEvent =
  | { type: "message"; text: string }
  | { type: "waiting"; waitOn: WaitOn; reason?: string }
  | { type: "completed"; result: Record<string, unknown> }
  | { type: "failed"; error: string };

/** The wait state an input event can satisfy. */
function satisfiedBy(event: InputEvent): WaitOn | null {
  switch (event.type) {
    case "user_message": return "user";
    case "tool_result": return "tool";
    case "agent_result": return "agent";
  }
}

export interface TurnContext {
  run: AgentRun;
  input: InputEvent;
  /** Emit output events to the caller as they happen. */
  emit(output: OutputEvent): void;
  /** Persist progress so a crash mid-turn resumes from here. */
  checkpoint(data: Record<string, unknown>): Promise<void>;
}

export type TurnOutcome =
  | { status: "completed"; result?: Record<string, unknown> }
  | { status: "parked"; waitOn: WaitOn; reason?: string; pendingRequest?: Record<string, unknown>; checkpoint?: Record<string, unknown> }
  | { status: "failed"; error: string };

export interface SessionKernelOptions {
  /** Runs a single turn to completion, park, or failure. */
  handleTurn: (ctx: TurnContext) => Promise<TurnOutcome>;
  /** Observe persisted events (optional). Not awaited. */
  onEvent?: (sessionKey: string, event: SessionEvent) => void;
}

export interface SessionInfo {
  sessionKey: string;
  principal: RunPrincipal;
  runKey: string | null;
}

interface SessionRow {
  sessionKey: string;
  principal: RunPrincipal;
  runKey: string | null;
}

/**
 * Session/event persistence behind the kernel. Postgres keeps the durable
 * trail across restarts; memory covers tests and surfaces running without a
 * database. The kernel's logic is identical on both.
 */
interface SessionStorage {
  ensureSchema(): Promise<void>;
  insertSession(row: SessionRow): Promise<void>; // throws on duplicate key
  getSession(sessionKey: string): Promise<SessionRow | null>;
  bindRun(sessionKey: string, runKey: string): Promise<void>;
  appendEvent(sessionKey: string, direction: "input" | "output", type: string, payload: Record<string, unknown>): Promise<void>;
  listEvents(sessionKey: string): Promise<Array<{ direction: "input" | "output"; type: string; payload: Record<string, unknown> }>>;
}

class PgSessionStorage implements SessionStorage {
  constructor(private pool: Pool) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS agent_run_sessions (
        id BIGSERIAL PRIMARY KEY,
        session_key TEXT NOT NULL UNIQUE,
        principal_kind TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        run_key TEXT REFERENCES agent_runs(run_key),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS agent_run_events (
        id BIGSERIAL PRIMARY KEY,
        session_key TEXT NOT NULL,
        direction TEXT NOT NULL,
        type TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS index_agent_run_events_on_session ON agent_run_events (session_key, id);
    `);
  }

  async insertSession(row: SessionRow): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO agent_run_sessions (session_key, principal_kind, principal_id)
         VALUES ($1, $2, $3)`,
        [row.sessionKey, row.principal.kind, row.principal.id]
      );
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new Error(`Session ${row.sessionKey} already exists`);
      }
      throw err;
    }
  }

  async getSession(sessionKey: string): Promise<SessionRow | null> {
    const result = await this.pool.query(
      `SELECT session_key, principal_kind, principal_id, run_key FROM agent_run_sessions WHERE session_key = $1`,
      [sessionKey]
    );
    if (!result.rows.length) return null;
    const row = result.rows[0];
    return {
      sessionKey: String(row.session_key),
      principal: { kind: row.principal_kind as RunPrincipal["kind"], id: String(row.principal_id) },
      runKey: row.run_key ? String(row.run_key) : null,
    };
  }

  async bindRun(sessionKey: string, runKey: string): Promise<void> {
    await this.pool.query(
      `UPDATE agent_run_sessions SET run_key = $1, updated_at = NOW() WHERE session_key = $2`,
      [runKey, sessionKey]
    );
  }

  async appendEvent(sessionKey: string, direction: "input" | "output", type: string, payload: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `INSERT INTO agent_run_events (session_key, direction, type, payload) VALUES ($1, $2, $3, $4::jsonb)`,
      [sessionKey, direction, type, JSON.stringify(payload)]
    );
  }

  async listEvents(sessionKey: string): Promise<Array<{ direction: "input" | "output"; type: string; payload: Record<string, unknown> }>> {
    const result = await this.pool.query(
      `SELECT direction, type, payload FROM agent_run_events WHERE session_key = $1 ORDER BY id`,
      [sessionKey]
    );
    return result.rows.map((r) => ({
      direction: r.direction as "input" | "output",
      type: String(r.type),
      payload: (r.payload ?? {}) as Record<string, unknown>,
    }));
  }
}

class MemorySessionStorage implements SessionStorage {
  private sessions = new Map<string, SessionRow>();
  private events = new Map<string, Array<{ direction: "input" | "output"; type: string; payload: Record<string, unknown> }>>();

  async ensureSchema(): Promise<void> {}

  async insertSession(row: SessionRow): Promise<void> {
    if (this.sessions.has(row.sessionKey)) {
      throw new Error(`Session ${row.sessionKey} already exists`);
    }
    this.sessions.set(row.sessionKey, { ...row });
  }

  async getSession(sessionKey: string): Promise<SessionRow | null> {
    const row = this.sessions.get(sessionKey);
    return row ? { ...row } : null;
  }

  async bindRun(sessionKey: string, runKey: string): Promise<void> {
    const row = this.sessions.get(sessionKey);
    if (row) row.runKey = runKey;
  }

  async appendEvent(sessionKey: string, direction: "input" | "output", type: string, payload: Record<string, unknown>): Promise<void> {
    const list = this.events.get(sessionKey) ?? [];
    list.push({ direction, type, payload: { ...payload } });
    this.events.set(sessionKey, list);
  }

  async listEvents(sessionKey: string) {
    return [...(this.events.get(sessionKey) ?? [])];
  }
}

export class SessionKernel {
  private store: RunStore;
  private storage: SessionStorage;
  private schemaReady: Promise<void> | null = null;
  /** Per-session submission gate: one in-flight turn, later submits queue. */
  private inflight = new Map<string, Promise<unknown>>();

  /**
   * pool === null selects in-memory session/event storage — for tests and
   * surfaces running without Postgres. Run state still comes from `store`.
   */
  constructor(
    pool: Pool | null,
    store: RunStore,
    private options: SessionKernelOptions
  ) {
    this.storage = pool ? new PgSessionStorage(pool) : new MemorySessionStorage();
    this.store = store;
  }

  ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.store.ensureSchema().then(() => this.storage.ensureSchema());
    }
    return this.schemaReady;
  }

  /** Persisted input/output trail for a session — crash forensics, history rebuild. */
  async events(sessionKey: string): Promise<Array<{ direction: "input" | "output"; type: string; payload: Record<string, unknown> }>> {
    await this.ensureSchema();
    return this.storage.listEvents(sessionKey);
  }

  async openSession(principal: RunPrincipal, sessionKey: string = randomUUID()): Promise<SessionInfo> {
    await this.ensureSchema();
    await this.storage.insertSession({ sessionKey, principal, runKey: null });
    return { sessionKey, principal, runKey: null };
  }

  async getSession(sessionKey: string): Promise<SessionInfo | null> {
    await this.ensureSchema();
    const row = await this.storage.getSession(sessionKey);
    return row ? { ...row } : null;
  }

  /**
   * Deliver one input event and drive the run until it yields.
   * Submissions per session are serialized; concurrent calls queue in order.
   */
  async submit(sessionKey: string, input: InputEvent): Promise<OutputEvent[]> {
    const tail = this.inflight.get(sessionKey) ?? Promise.resolve();
    const turn = tail.catch(() => undefined).then(() => this.driveTurn(sessionKey, input));
    this.inflight.set(sessionKey, turn.catch(() => undefined));
    return turn;
  }

  private async record(sessionKey: string, direction: "input" | "output", type: string, payload: Record<string, unknown>): Promise<void> {
    await this.storage.appendEvent(sessionKey, direction, type, payload);
    this.options.onEvent?.(sessionKey, { direction, type, payload, createdAt: new Date() });
  }

  private async driveTurn(sessionKey: string, input: InputEvent): Promise<OutputEvent[]> {
    await this.ensureSchema();
    let stored = await this.loadSession(sessionKey);
    if (!stored) throw new Error(`Unknown session ${sessionKey}`);

    await this.record(sessionKey, "input", input.type, input as unknown as Record<string, unknown>);
    const outputs: OutputEvent[] = [];
    // Persist each output as it is emitted — if the terminal transition or the
    // process dies later, the caller still has the assistant's trail.
    let persistChain: Promise<void> = Promise.resolve();
    const emit = (output: OutputEvent) => {
      outputs.push(output);
      persistChain = persistChain.then(() =>
        this.record(sessionKey, "output", output.type, output as unknown as Record<string, unknown>)
      );
    };

    // Bind or rebind the session's run lazily: a user_message with no active
    // run starts one. Everything else requires an existing run.
    let run: AgentRun | null = stored.runKey ? await this.store.getRun(stored.runKey) : null;

    if (!run || ["completed", "failed", "cancelled"].includes(run.status)) {
      if (input.type !== "user_message") {
        const failed: OutputEvent = { type: "failed", error: `No active run accepts ${input.type}` };
        emit(failed); // emit persists via persistChain — do not also record()
        await persistChain;
        return [failed];
      }
      run = await this.store.createRun({
        principal: stored.principal,
        kind: "conversation",
        checkpoint: {},
      });
      await this.bindSession(sessionKey, run.runKey);
    } else if (run.waitOn !== satisfiedBy(input)) {
      // Parked (or mid-turn) for a different input kind — do not wake the run
      // with something it did not ask for. Duplicate tool_results and early
      // agent_results are rejected here rather than double-executing a turn.
      emit({
        type: "waiting",
        waitOn: run.waitOn ?? "user",
        reason: run.waitReason ?? `Run is ${run.status}; received unsolicited ${input.type}`,
      });
      await persistChain;
      return outputs;
    }

    if (run.status !== "running") {
      run = await this.store.resume(run.runKey);
    }

    let outcome: TurnOutcome;
    try {
      outcome = await this.options.handleTurn({
        run,
        input,
        emit,
        checkpoint: async (data) => {
          const fresh = await this.store.getRun(run!.runKey);
          if (fresh && fresh.status === "running") {
            await this.store.saveCheckpoint(run!.runKey, fresh.revision, data);
          }
        },
      });
    } catch (err) {
      // A throwing handler must never strand the run in 'running' forever.
      const message = err instanceof Error ? err.message : String(err);
      const fresh = await this.store.getRun(run.runKey).catch(() => null);
      if (fresh && fresh.status === "running") {
        await this.store.fail(run.runKey, fresh.revision, message).catch(() => undefined);
      }
      emit({ type: "failed", error: message });
      await persistChain;
      return outputs;
    }

    // Outputs emitted so far must be durable before attempting the terminal
    // transition — a failed transition must not erase the turn's trail.
    await persistChain;

    // Re-read revision after the turn; the handler may have checkpointed.
    const fresh = await this.store.getRun(run.runKey);
    const revision = fresh?.revision ?? run.revision;

    let terminal: OutputEvent;
    if (outcome.status === "completed") {
      await this.store.complete(run.runKey, revision, outcome.result ?? {});
      terminal = { type: "completed", result: outcome.result ?? {} };
    } else if (outcome.status === "failed") {
      await this.store.fail(run.runKey, revision, outcome.error);
      terminal = { type: "failed", error: outcome.error };
    } else {
      await this.store.park(run.runKey, revision, {
        waitOn: outcome.waitOn,
        reason: outcome.reason,
        pendingRequest: outcome.pendingRequest,
        checkpoint: outcome.checkpoint,
      });
      terminal = { type: "waiting", waitOn: outcome.waitOn, reason: outcome.reason };
    }

    emit(terminal);
    await persistChain;
    return outputs;
  }

  private async loadSession(sessionKey: string): Promise<SessionInfo | null> {
    return this.storage.getSession(sessionKey);
  }

  private async bindSession(sessionKey: string, runKey: string): Promise<void> {
    await this.storage.bindRun(sessionKey, runKey);
  }
}
