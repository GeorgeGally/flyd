import { randomUUID } from "crypto";
import { describe, expect, it, afterAll } from "vitest";
import { Pool } from "pg";
import { PostgresRunStore } from "../run-store.js";
import {
  SessionKernel,
  type InputEvent,
  type OutputEvent,
  type TurnContext,
  type TurnOutcome,
} from "../session-kernel.js";

const connectionString = process.env.FLYD_TEST_DATABASE_URL ?? "postgres:///flyd_v1_test";
const pool = new Pool({ connectionString, max: 2 });
const store = new PostgresRunStore(pool);
const principal = { kind: "user" as const, id: "kernel-eval" };

// Schema bootstrap only — each test builds its own kernel with real handlers.
const schemaKernel = new SessionKernel(pool, store, {
  handleTurn: async () => ({ status: "failed", error: "unused" }),
});

async function cleanRuns(): Promise<void> {
  await schemaKernel.ensureSchema();
  await pool.query("DELETE FROM agent_run_events WHERE session_key LIKE 'k-test-%'");
  await pool.query("DELETE FROM agent_run_sessions WHERE session_key LIKE 'k-test-%'");
  await pool.query("DELETE FROM agent_runs WHERE principal_id = 'kernel-eval'");
}

function kernelWith(handler: (ctx: TurnContext) => Promise<TurnOutcome>): SessionKernel {
  return new SessionKernel(pool, store, { handleTurn: handler });
}

function lastOutput(outputs: OutputEvent[]): OutputEvent {
  return outputs[outputs.length - 1];
}

describe("SessionKernel", { timeout: 15_000 }, () => {
  afterAll(async () => {
    await cleanRuns();
    await pool.end();
  });

  it("starts a run from a user message, parks for approval, resumes on the next message", async () => {
    await cleanRuns();
    let turns = 0;
    const kernel = kernelWith(async (ctx) => {
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
  });

  it("refuses input that does not satisfy what the run is waiting for", async () => {
    await cleanRuns();
    let turns = 0;
    const kernel = kernelWith(async () => {
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
  });

  it("delivers a tool_result to a parked run and completes", async () => {
    await cleanRuns();
    let sawToolResult = false;
    const kernel = kernelWith(async (ctx) => {
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

  it("persists events so a crashed turn leaves an inspectable trail", async () => {
    await cleanRuns();
    const kernel = kernelWith(async () => ({ status: "parked", waitOn: "user" }));
    const key = `k-test-${randomUUID()}`;
    const session = await kernel.openSession(principal, key);
    await kernel.submit(key, { type: "user_message", text: "hello" });

    const events = await pool.query(
      "SELECT direction, type FROM agent_run_events WHERE session_key = $1 ORDER BY id",
      [key]
    );
    const sequence = events.rows.map((r) => `${r.direction}:${r.type}`);
    expect(sequence).toEqual(["input:user_message", "output:waiting"]);
  });

  it("serializes concurrent submissions on the same session", async () => {
    await cleanRuns();
    let inFlight = 0;
    let overlapViolations = 0;
    const kernel = kernelWith(async (ctx) => {
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

  it("records failures and keeps the terminal state durable", async () => {
    await cleanRuns();
    const kernel = kernelWith(async () => ({ status: "failed", error: "model exploded" }));
    const session = await kernel.openSession(principal, `k-test-${randomUUID()}`);

    const outputs = await kernel.submit(session.sessionKey, { type: "user_message", text: "do it" });
    expect(lastOutput(outputs)).toEqual({ type: "failed", error: "model exploded" });

    const again = await kernel.submit(session.sessionKey, { type: "user_message", text: "try once more" });
    // terminal run → fresh conversation run starts
    expect(again.some((o) => o.type === "failed")).toBe(true);
  });

  it("fails the durable run when the handler throws instead of stranding it in running", async () => {
    await cleanRuns();
    const kernel = kernelWith(async () => {
      throw new Error("handler blew up");
    });
    const session = await kernel.openSession(principal, `k-test-${randomUUID()}`);

    const outputs = await kernel.submit(session.sessionKey, { type: "user_message", text: "go" });
    expect(lastOutput(outputs)).toEqual({ type: "failed", error: "handler blew up" });

    const bound = await kernel.getSession(session.sessionKey);
    const run = bound?.runKey ? await store.getRun(bound.runKey) : null;
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("handler blew up");
  });

  it("parked work survives process death — a fresh kernel resumes the same run", async () => {
    await cleanRuns();
    const key = `k-test-${randomUUID()}`;
    let turns = 0;

    const firstKernel = kernelWith(async (ctx) => {
      turns += 1;
      if (turns === 1) {
        return {
          status: "parked",
          waitOn: "user",
          reason: "confirm direction",
          pendingRequest: { prompt: "North or south?" },
          checkpoint: { plan: "halfway" },
        };
      }
      expect(ctx.run.checkpoint).toEqual({ plan: "halfway" });
      return { status: "completed", result: { resumed: true } };
    });

    const session = await firstKernel.openSession(principal, key);
    const before = await firstKernel.submit(key, { type: "user_message", text: "start" });
    expect(lastOutput(before).type).toBe("waiting");

    // Simulate process death: brand-new store instance over the same DB.
    const revivedStore = new PostgresRunStore(new Pool({ connectionString, max: 2 }));
    try {
      const secondKernel = kernelWith(async (ctx) => {
        expect(ctx.run.checkpoint).toEqual({ plan: "halfway" });
        return { status: "completed", result: { resumed: true } };
      });

      const after = await secondKernel.submit(key, { type: "user_message", text: "south" });
      expect(lastOutput(after)).toEqual({ type: "completed", result: { resumed: true } });
    } finally {
      await revivedStore["pool"].end();
    }
  });

  it("a rejected wrong-waitOn input leaves pendingRequest untouched", async () => {
    await cleanRuns();
    let turns = 0;
    const kernel = kernelWith(async () => {
      turns += 1;
      if (turns === 1) {
        return {
          status: "parked",
          waitOn: "user",
          reason: "awaiting choice",
          pendingRequest: { prompt: "A or B?" },
        };
      }
      throw new Error("must not run");
    });

    const session = await kernel.openSession(principal, `k-test-${randomUUID()}`);
    await kernel.submit(session.sessionKey, { type: "user_message", text: "begin" });

    await kernel.submit(session.sessionKey, { type: "tool_result", toolCallId: "t-9" });
    const bound = await kernel.getSession(session.sessionKey);
    const run = bound?.runKey ? await store.getRun(bound.runKey) : null;
    expect(run?.status).toBe("waiting_for_user");
    expect(run?.pendingRequest).toEqual({ prompt: "A or B?" });
    expect(turns).toBe(1);
  });
});
