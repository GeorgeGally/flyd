import { randomUUID } from "crypto";
import type { Pool } from "pg";
import {
  PostgresRunStore,
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
// only way work survives process death: run state lives in PostgresRunStore.

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

export class SessionKernel {
  private store: PostgresRunStore;
  private pool: Pool;
  private schemaReady: Promise<void> | null = null;
  /** Per-session submission gate: one in-flight turn, later submits queue. */
  private inflight = new Map<string, Promise<unknown>>();

  constructor(
    pool: Pool,
    store: PostgresRunStore,
    private options: SessionKernelOptions
  ) {
    this.pool = pool;
    this.store = store;
  }

  ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.store.ensureSchema().then(() =>
        this.pool.query(`
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
        `)
      ).then(() => undefined);
    }
    return this.schemaReady;
  }

  async openSession(principal: RunPrincipal, sessionKey: string = randomUUID()): Promise<SessionInfo> {
    await this.ensureSchema();
    try {
      await this.pool.query(
        `INSERT INTO agent_run_sessions (session_key, principal_kind, principal_id)
         VALUES ($1, $2, $3)`,
        [sessionKey, principal.kind, principal.id]
      );
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new Error(`Session ${sessionKey} already exists`);
      }
      throw err;
    }
    return { sessionKey, principal, runKey: null };
  }

  async getSession(sessionKey: string): Promise<SessionInfo | null> {
    await this.ensureSchema();
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
    await this.pool.query(
      `INSERT INTO agent_run_events (session_key, direction, type, payload) VALUES ($1, $2, $3, $4::jsonb)`,
      [sessionKey, direction, type, JSON.stringify(payload)]
    );
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
        emit(failed);
        await this.record(sessionKey, "output", failed.type, failed);
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
      const waiting: OutputEvent = {
        type: "waiting",
        waitOn: run.waitOn ?? "user",
        reason: run.waitReason ?? `Run is ${run.status}; received unsolicited ${input.type}`,
      };
      emit(waiting);
      await this.record(sessionKey, "output", waiting.type, waiting);
      return [waiting];
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

  private async loadSession(sessionKey: string): Promise<(SessionInfo & { id: number }) | null> {
    const result = await this.pool.query(
      `SELECT id, session_key, principal_kind, principal_id, run_key FROM agent_run_sessions WHERE session_key = $1`,
      [sessionKey]
    );
    if (!result.rows.length) return null;
    const row = result.rows[0];
    return {
      id: Number(row.id),
      sessionKey: String(row.session_key),
      principal: { kind: row.principal_kind as RunPrincipal["kind"], id: String(row.principal_id) },
      runKey: row.run_key ? String(row.run_key) : null,
    };
  }

  private async bindSession(sessionKey: string, runKey: string): Promise<void> {
    await this.pool.query(
      `UPDATE agent_run_sessions SET run_key = $1, updated_at = NOW() WHERE session_key = $2`,
      [runKey, sessionKey]
    );
  }
}
