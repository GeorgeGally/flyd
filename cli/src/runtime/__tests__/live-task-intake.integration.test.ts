import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresTaskStore } from "../task-store.js";
import { intakeLiveTask, resolveLiveTaskIntent } from "../live-task-intake.js";
import type { RepositorySnapshot } from "../types.js";

const connectionString = process.env.FLYD_TEST_DATABASE_URL ?? "postgres:///flyd_v1_test";
const pool = new Pool({ connectionString, max: 2 });
const store = new PostgresTaskStore(pool);
const projectRoot = "/work/live-intake-test";

const repository: RepositorySnapshot = {
  root: projectRoot,
  name: "live-intake-test",
  remote: null,
  branch: "main",
  head: "abc123",
  dirty: false,
  statusLines: [],
  statusDigest: "clean",
};

async function cleanProject(): Promise<void> {
  const projects = await pool.query("SELECT id FROM projects WHERE root_path = $1", [projectRoot]);
  for (const project of projects.rows) {
    const tasks = await pool.query("SELECT id FROM agent_tasks WHERE project_id = $1", [project.id]);
    const taskIds = tasks.rows.map((row) => row.id);
    if (taskIds.length) {
      await pool.query(`DELETE FROM runtime_delivery_receipts
        WHERE runtime_event_id IN (SELECT id FROM runtime_events WHERE agent_task_id = ANY($1::bigint[]))`, [taskIds]);
      await pool.query("DELETE FROM runtime_events WHERE agent_task_id = ANY($1::bigint[])", [taskIds]);
      await pool.query("DELETE FROM task_recommendations WHERE agent_task_id = ANY($1::bigint[])", [taskIds]);
      await pool.query("DELETE FROM task_sessions WHERE agent_task_id = ANY($1::bigint[])", [taskIds]);
      await pool.query("DELETE FROM worker_commands WHERE agent_task_id = ANY($1::bigint[])", [taskIds]);
      await pool.query("DELETE FROM task_artifacts WHERE agent_task_id = ANY($1::bigint[])", [taskIds]);
      await pool.query("DELETE FROM task_corrections WHERE agent_task_id = ANY($1::bigint[])", [taskIds]);
      await pool.query("DELETE FROM worker_sessions WHERE agent_task_id = ANY($1::bigint[])", [taskIds]);
      await pool.query("DELETE FROM task_assignments WHERE agent_task_id = ANY($1::bigint[])", [taskIds]);
      await pool.query("DELETE FROM task_grants WHERE agent_task_id = ANY($1::bigint[])", [taskIds]);
      await pool.query("DELETE FROM agent_tasks WHERE id = ANY($1::bigint[])", [taskIds]);
    }
    await pool.query("DELETE FROM projects WHERE id = $1", [project.id]);
  }
}

describe("live task intake", { timeout: 15_000 }, () => {
  beforeEach(async () => {
    await cleanProject();
  });

  afterAll(async () => {
    await cleanProject();
    await pool.end();
  });

  it("turns a task utterance into a canonical AgentTask row", async () => {
    const decision = resolveLiveTaskIntent({ kind: "task_plan", taskIntent: "Fix the Instagram pull issue" });
    expect(decision).not.toBeNull();

    const result = await intakeLiveTask(decision!, projectRoot, { source: "voice" }, { store, inspectRepository: async () => repository });

    expect(result.created).toBe(true);
    const persisted = await store.findTask(result.task.taskKey);
    expect(persisted).not.toBeNull();
    expect(persisted!.intendedOutcome).toBe("Fix the Instagram pull issue");
    expect(persisted!.projectRoot).toBe(projectRoot);
    expect(["awaiting_grant", "ready", "running", "blocked"]).toContain(persisted!.status);

    const resumable = await store.findResumableTask(projectRoot);
    expect(resumable?.taskKey).toBe(result.task.taskKey);
  });

  it("does not create a second task for a repeated utterance", async () => {
    const decision = resolveLiveTaskIntent({ kind: "task_plan", taskIntent: "Fix the Instagram pull issue" })!;
    const first = await intakeLiveTask(decision, projectRoot, {}, { store, inspectRepository: async () => repository });
    const second = await intakeLiveTask(decision, projectRoot, {}, { store, inspectRepository: async () => repository });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.task.taskKey).toBe(first.task.taskKey);

    const tasks = await pool.query("SELECT id FROM agent_tasks WHERE project_id = (SELECT id FROM projects WHERE root_path = $1)", [projectRoot]);
    expect(tasks.rows).toHaveLength(1);
  });

  it("does not resume an unrelated task for a distinct utterance", async () => {
    const first = await intakeLiveTask(
      resolveLiveTaskIntent({ kind: "task_plan", taskIntent: "Deploy the landing page" })!,
      projectRoot,
      {},
      { store, inspectRepository: async () => repository },
    );
    expect(first.created).toBe(true);

    const distinct = resolveLiveTaskIntent({ kind: "task_plan", taskIntent: "Fix the Instagram pull issue" })!;
    await expect(
      intakeLiveTask(distinct, projectRoot, {}, { store, inspectRepository: async () => repository }),
    ).rejects.toThrow(/unfinished/i);

    const resumable = await store.findResumableTask(projectRoot);
    expect(resumable?.taskKey).toBe(first.task.taskKey);
    expect(resumable?.intendedOutcome).toBe("Deploy the landing page");
  });

  it("creates no task for an ambiguous utterance", async () => {
    const decision = resolveLiveTaskIntent({ kind: "explanation", taskIntent: "What is the capital of France?" });
    expect(decision).toBeNull();

    const tasks = await pool.query("SELECT id FROM agent_tasks WHERE project_id = (SELECT id FROM projects WHERE root_path = $1)", [projectRoot]);
    expect(tasks.rows).toHaveLength(0);
  });
});