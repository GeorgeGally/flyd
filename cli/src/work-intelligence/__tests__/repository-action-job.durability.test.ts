import { randomUUID } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresRunStore } from "../../runtime/run-store.js";
import { RepositoryActionJobStore } from "../repository-action-job.js";

// Durability contract for repository-action jobs: statuses and results
// survive process restarts; interrupted runs are failed at boot.

const connectionString = process.env.FLYD_TEST_DATABASE_URL ?? "postgres:///flyd_v1_test";
const pool = new Pool({ connectionString, max: 2 });
const runStore = new PostgresRunStore(pool);

function durableStore(): RepositoryActionJobStore<unknown> {
  return new RepositoryActionJobStore<unknown>({ durable: true, databaseUrl: connectionString });
}

async function cleanRuns(): Promise<void> {
  await runStore.ensureSchema();
  await pool.query("DELETE FROM agent_run_sessions WHERE session_key LIKE 'ra-test-%'");
  await pool.query("DELETE FROM agent_runs WHERE principal_id = 'core' AND kind = 'repository_action'");
}

describe("RepositoryActionJobStore durability", { timeout: 15_000 }, () => {
  afterAll(async () => {
    await cleanRuns();
    await pool.end();
  });

  it("terminal job status is readable by a fresh store instance after restart", async () => {
    await cleanRuns();
    const first = durableStore();
    const job = await first.start(`ra-test-${randomUUID()}`, async () => ({ verified: true, diffPresent: true }));
    await job.completion;

    // brand-new instance, as if Core restarted
    const second = durableStore();
    const snapshot = await second.get(job.jobId);
    expect(snapshot).toMatchObject({
      jobId: job.jobId,
      status: "completed",
      result: { verified: true, diffPresent: true },
    });
  });

  it("recoverInterrupted fails runs stranded in running by a dead process", async () => {
    await cleanRuns();
    const jobId = `ra-test-${randomUUID()}`;
    await runStore.createRun({
      principal: { kind: "system", id: "core" },
      kind: "repository_action",
      checkpoint: { jobId },
      runKey: jobId,
    });

    const restarted = durableStore();
    const failed = await restarted.recoverInterrupted();
    expect(failed).toBeGreaterThanOrEqual(1);

    const snapshot = await restarted.get(jobId);
    expect(snapshot).toMatchObject({ status: "failed", error: expect.stringContaining("restart") });
  });
});
