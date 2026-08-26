import { randomUUID } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { InMemoryRunStore, PostgresRunStore, type RunStore } from "../run-store.js";
import {
  SessionKernel,
  type InputEvent,
  type OutputEvent,
  type TurnContext,
  type TurnOutcome,
} from "../session-kernel.js";

// Kernel behavior must be identical on both backends. Postgres proves the
// durable contract (cross-instance resume); memory proves the abstraction.

const connectionString = process.env.FLYD_TEST_DATABASE_URL ?? "postgres:///flyd_v1_test";
const pool = new Pool({ connectionString, max: 2 });
const pgStore = new PostgresRunStore(pool);
const principal = { kind: "user" as const, id: "kernel-eval" };

type BackendName = "postgres" | "memory";

const BACKENDS: Record<BackendName, () => { store: RunStore; pool: Pool | null }> = {
  postgres: () => ({ store: pgStore, pool }),
  // One shared memory store per test-file run — kernels and assertions in
  // this file must observe the same runs.
  memory: (() => { let s: InMemoryRunStore | null = null; return () => ({ store: (s ??= new InMemoryRunStore()), pool: null }); })(),
};

async function cleanRuns(): Promise<void> {
  await pgStore.ensureSchema();
  await pool.query("DELETE FROM agent_run_events WHERE session_key LIKE 'k-test-%'");
  await pool.query("DELETE FROM agent_run_sessions WHERE session_key LIKE 'k-test-%'");
  await pool.query("DELETE FROM agent_runs WHERE principal_id = 'kernel-eval'");
}

function kernelWith(
  backend: BackendName,
  handleTurn: (ctx: TurnContext) => Promise<TurnOutcome>,
): SessionKernel {
  const { store, pool: p } = BACKENDS[backend]();
  return new SessionKernel(p, store, { handleTurn });
}

function lastOutput(outputs: OutputEvent[]): OutputEvent {
  return outputs[outputs.length - 1];
}

describe.each(Object.keys(BACKENDS) as BackendName[])("SessionKernel[%s]", (backend) => {
  it("starts a run from a user message, parks for approval, resumes on the next message", async () => {
    let turns = 0;
    const kernel = kernelWith(backend, async (ctx) => {
      turns += 1;
      if (turns === 1) {
        ctx.emit({ type: "message", text: "I found two options." });
        return {
          status: "parked",
          waitOn: "user",
          reason: "pick one",
          pendingRequest: { prompt: "Option A or B?" },
          checkpoint: { options: ["A", "B"] },
        };
      }
      return {
        status: "completed",
        result: { chose: (ctx.input as Extract<InputEvent, { type: "user_message" }>).text },
      };
    });

    const session = await kernel.openSession(principal, `k-test-${randomUUID()}`);
    expect(session.runKey).toBeNull();

    const first = await kernel.submit(session.sessionKey, { type: "user_message", text: "plan my trip" });
    expect(first.map((o) => o.type)).toEqual(["message", "waiting"]);
    expect(lastOutput(first)).toMatchObject({ type: "waiting", waitOn: "user", reason: "pick one" });
    const bound = await kernel.getSession(session.sessionKey);
    expect(bound?.runKey).toBeTruthy();

    const second = await kernel.submit(session.sessionKey, { type: "user_message", text: "A" });
    expect(second.map((o) => o.type)).toEqual(["completed"]);
    expect(lastOutput(second)).toEqual({ type: "completed", result: { chose: "A" } });

    const events = await kernel.events(session.sessionKey);
    expect(events.map((e) => `${e.direction}:${e.type}`)).toEqual([
      "input:user_message",
      "output:message",
      "output:waiting",
      "input:user_message",
      "output:completed",
    ]);
  });

  it("refuses input that does not satisfy what the run is waiting for", async () => {
    let turns = 0;
    const kernel = kernelWith(backend, async () => {
      turns += 1;
      if (turns === 1) return { status: "parked", waitOn: "tool", reason: "awaiting scrape" };
      throw new Error("handler must not be re-entered");
    });

    const session = await kernel.openSession(principal, `k-test-${randomUUID()}`);
    await kernel.submit(session.sessionKey, { type: "user_message", text: "go" });

    const wrong = await kernel.submit(session.sessionKey, { type: "user_message", text: "still here" });
    expect(lastOutput(wrong)).toMatchObject({
      type: "waiting",
      waitOn: "tool",
      reason: "awaiting scrape",
    });
    expect(turns).toBe(1);

    // the rejected input left the parked request untouched
    const bound = await kernel.getSession(session.sessionKey);
    const run = bound?.runKey ? await BACKENDS[backend]().store.getRun(bound.runKey) : null;
    expect(run?.status).toBe("waiting_for_tool");
  });

  it("delivers a tool_result to a parked run and completes", async () => {
    let sawToolResult = false;
    const kernel = kernelWith(backend, async (ctx) => {
      if (!sawToolResult) {
        sawToolResult = true;
        return { status: "parked", waitOn: "tool", reason: "running tests" };
      }
      expect(ctx.input.type).toBe("tool_result");
      return { status: "completed", result: { tests: "green" } };
    });

    const session = await kernel.openSession(principal, `k-test-${randomUUID()}`);
    await kernel.submit(session.sessionKey, { type: "user_message", text: "verify" });
    const outputs = await kernel.submit(session.sessionKey, {
      type: "tool_result",
      toolCallId: "t-1",
      payload: { exitCode: 0 },
    });
    expect(lastOutput(outputs)).toEqual({ type: "completed", result: { tests: "green" } });
  });

  it("fails the durable run when the handler throws instead of stranding it in running", async () => {
    const kernel = kernelWith(backend, async () => {
      throw new Error("handler blew up");
    });
    const session = await kernel.openSession(principal, `k-test-${randomUUID()}`);

    const outputs = await kernel.submit(session.sessionKey, { type: "user_message", text: "go" });
    expect(lastOutput(outputs)).toEqual({ type: "failed", error: "handler blew up" });

    const bound = await kernel.getSession(session.sessionKey);
    const run = bound?.runKey ? await BACKENDS[backend]().store.getRun(bound.runKey) : null;
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("handler blew up");
  });

  it("serializes concurrent submissions on the same session", async () => {
    let inFlight = 0;
    let overlapViolations = 0;
    const kernel = kernelWith(backend, async (ctx) => {
      inFlight += 1;
      if (inFlight > 1) overlapViolations += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return { status: "completed", result: { handled: (ctx.input as { text?: string }).text ?? "" } };
    });

    const session = await kernel.openSession(principal, `k-test-${randomUUID()}`);
    const results = await Promise.all([
      kernel.submit(session.sessionKey, { type: "user_message", text: "one" }),
      kernel.submit(session.sessionKey, { type: "user_message", text: "two" }),
      kernel.submit(session.sessionKey, { type: "user_message", text: "three" }),
    ]);

    expect(overlapViolations).toBe(0);
    for (const outputs of results) {
      expect(lastOutput(outputs).type).toBe("completed");
    }
  });
});

describe("SessionKernel[postgres] durability", { timeout: 15_000 }, () => {
  afterAll(async () => {
    await cleanRuns();
    await pool.end();
  });

  it("parked work survives process death — a fresh kernel resumes the same run", async () => {
    await cleanRuns();
    const key = `k-test-${randomUUID()}`;

    const firstKernel = new SessionKernel(pool, pgStore, {
      handleTurn: async () => ({
        status: "parked",
        waitOn: "user",
        reason: "confirm direction",
        pendingRequest: { prompt: "North or south?" },
        checkpoint: { plan: "halfway" },
      }),
    });
    const session = await firstKernel.openSession(principal, key);
    const before = await firstKernel.submit(key, { type: "user_message", text: "start" });
    expect(lastOutput(before).type).toBe("waiting");

    // Simulate process death: brand-new store + kernel over the same database.
    const revivedStore = new PostgresRunStore(new Pool({ connectionString, max: 2 }));
    try {
      const secondKernel = new SessionKernel(pool, revivedStore, {
        handleTurn: async (ctx) => {
          expect(ctx.run.checkpoint).toEqual({ plan: "halfway" });
          return { status: "completed", result: { resumed: true } };
        },
      });

      const after = await secondKernel.submit(key, { type: "user_message", text: "south" });
      expect(lastOutput(after)).toEqual({ type: "completed", result: { resumed: true } });
    } finally {
      await revivedStore["pool"].end();
    }
  });
});
