import { describe, expect, it, afterAll } from "vitest";
import { Pool } from "pg";
import {
  InvalidTransitionError,
  PostgresRunStore,
  RevisionConflictError,
} from "../run-store.js";

const connectionString = process.env.FLYD_TEST_DATABASE_URL ?? "postgres:///flyd_v1_test";
const pool = new Pool({ connectionString, max: 2 });
const store = new PostgresRunStore(pool);

const principal = { kind: "user" as const, id: "run-store-eval" };

async function cleanRuns(): Promise<void> {
  await store.ensureSchema();
  await pool.query("DELETE FROM agent_runs WHERE principal_id = 'run-store-eval'");
}

describe("PostgresRunStore", { timeout: 15_000 }, () => {
  afterAll(async () => {
    await cleanRuns();
    await pool.end();
  });

  it("walks the full lifecycle: run → checkpoint → park → resume → complete", async () => {
    await cleanRuns();
    let run = await store.createRun({ principal, kind: "test_work", checkpoint: { step: 0 } });

    run = await store.saveCheckpoint(run.runKey, run.revision, { step: 1, notes: "scanned" });
    expect(run.checkpoint).toEqual({ step: 1, notes: "scanned" });

    run = await store.park(run.runKey, run.revision, {
      waitOn: "user",
      reason: "needs approval",
      pendingRequest: { prompt: "Proceed?" },
    });
    expect(run.status).toBe("waiting_for_user");
    expect(run.pendingRequest).toEqual({ prompt: "Proceed?" });

    // checkpointing while parked is a transition violation
    await expect(store.saveCheckpoint(run.runKey, run.revision, { step: 2 }))
      .rejects.toBeInstanceOf(InvalidTransitionError);

    const resumed = await store.resume(run.runKey);
    expect(resumed.status).toBe("running");
    expect(resumed.waitOn).toBeNull();
    expect(resumed.pendingRequest).toEqual({ prompt: "Proceed?" });

    const done = await store.complete(resumed.runKey, resumed.revision, { answer: 42 });
    expect(done.status).toBe("completed");
    expect(done.result).toEqual({ answer: 42 });
    expect(done.endedAt).toBeTruthy();

    await expect(store.resume(done.runKey)).rejects.toBeInstanceOf(InvalidTransitionError);
    const active = await store.listActive({ principal });
    expect(active.find((r) => r.runKey === done.runKey)).toBeUndefined();
  });

  it("rejects stale revisions instead of silently overwriting", async () => {
    await cleanRuns();
    const run = await store.createRun({ principal, kind: "test_work" });

    const winner = await store.saveCheckpoint(run.runKey, run.revision, { writer: "a" });
    await expect(store.saveCheckpoint(run.runKey, run.revision, { writer: "b" }))
      .rejects.toBeInstanceOf(RevisionConflictError);
    expect(winner.revision).toBe(run.revision + 1);
  });

  it("fails and cancels from running or waiting states", async () => {
    await cleanRuns();
    const a = await store.createRun({ principal, kind: "test_work" });
    const failed = await store.fail(a.runKey, a.revision, "boom");
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("boom");

    const b = await store.createRun({ principal, kind: "test_work" });
    const parked = await store.park(b.runKey, b.revision, { waitOn: "tool", reason: "long call" });
    const cancelled = await store.cancel(parked.runKey, parked.revision);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.waitOn).toBeNull();
  });

  it("parks atomically with an advanced checkpoint", async () => {
    await cleanRuns();
    const run = await store.createRun({ principal, kind: "test_work", checkpoint: { progress: 10 } });
    const parked = await store.park(run.runKey, run.revision, {
      waitOn: "agent",
      reason: "delegated research",
      checkpoint: { progress: 40 },
    });
    expect(parked.status).toBe("waiting_for_agent");
    expect(parked.checkpoint).toEqual({ progress: 40 });
  });
});
