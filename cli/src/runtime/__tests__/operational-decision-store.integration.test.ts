import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { OperationalDecisionStore } from "../operational-decision-store.js";
import { PostgresTaskStore } from "../task-store.js";

const connectionString = process.env.FLYD_TEST_DATABASE_URL ?? "postgres:///flyd_v1_test";
const pool = new Pool({ connectionString, max: 2 });
const taskStore = new PostgresTaskStore(pool);
const decisionStore = new OperationalDecisionStore(pool);
const projectRoot = `/tmp/flyd-decision-${process.pid}`;
const projectName = `decision-test-${process.pid}`;

async function cleanProject(): Promise<void> {
  const projects = await pool.query("SELECT id FROM projects WHERE root_path = $1 OR name = $2", [projectRoot, projectName]);
  for (const project of projects.rows) {
    const tasks = await pool.query("SELECT id FROM agent_tasks WHERE project_id = $1", [project.id]);
    const ids = tasks.rows.map((row) => row.id);
    if (ids.length) {
      await pool.query("DELETE FROM runtime_events WHERE agent_task_id = ANY($1::bigint[])", [ids]);
      await pool.query("DELETE FROM agent_tasks WHERE id = ANY($1::bigint[])", [ids]);
    }
    await pool.query("DELETE FROM projects WHERE id = $1", [project.id]);
  }
}

async function createTask() {
  return taskStore.createTask({
    projectName,
    projectRoot,
    intendedOutcome: "Resolve an architectural question",
    repository: {
      root: projectRoot,
      name: projectName,
      remote: null,
      branch: "main",
      head: "abc123",
      dirty: false,
      statusLines: [],
      statusDigest: "clean",
    },
    idempotencyKey: `decision-task:${randomUUID()}`,
  });
}

describe("OperationalDecisionStore", { timeout: 15_000 }, () => {
  beforeEach(cleanProject);
  afterAll(async () => {
    await cleanProject();
    await pool.end();
  });

  it("keeps a decision open through unrelated runtime activity until explicitly resolved", async () => {
    const task = await createTask();
    const decision = await decisionStore.openDecision(task.taskKey, {
      question: "Should this become a new runtime primitive?",
      context: "The worker is blocked on architecture.",
      idempotencyKey: `decision-open:${task.taskKey}`,
    });

    await pool.query(`INSERT INTO runtime_events
      (agent_task_id, event_key, event_type, idempotency_key, task_revision, payload, occurred_at, created_at, updated_at)
      VALUES ($1, $2, 'worker.running', $3, 99, '{}'::jsonb, NOW(), NOW(), NOW())`, [
      task.id,
      randomUUID(),
      `unrelated:${task.taskKey}`,
    ]).catch(() => undefined);

    expect((await decisionStore.listOpenDecisions(task.taskKey)).map((item) => item.decisionId)).toContain(decision.decisionId);

    const resolved = await decisionStore.resolveDecision(
      task.taskKey,
      decision.decisionId,
      "Reuse the existing runtime task model.",
      `decision-resolve:${task.taskKey}`,
    );

    expect(resolved.status).toBe("resolved");
    expect(resolved.resolution).toContain("existing runtime task model");
    expect(await decisionStore.listOpenDecisions(task.taskKey)).toEqual([]);
  });

  it("is idempotent for repeated open requests", async () => {
    const task = await createTask();
    const key = `decision-open:${task.taskKey}`;
    const id = "decision-1";

    const first = await decisionStore.openDecision(task.taskKey, {
      decisionId: id,
      question: "Which verification path?",
      idempotencyKey: key,
    });
    const second = await decisionStore.openDecision(task.taskKey, {
      decisionId: id,
      question: "Which verification path?",
      idempotencyKey: key,
    });

    expect(first.decisionId).toBe(id);
    expect(second.decisionId).toBe(id);
    expect((await decisionStore.listDecisions(task.taskKey)).filter((item) => item.decisionId === id)).toHaveLength(1);
  });

  it("refuses to resolve a decision twice", async () => {
    const task = await createTask();
    const decision = await decisionStore.openDecision(task.taskKey, {
      question: "Proceed?",
      idempotencyKey: `decision-open:${task.taskKey}`,
    });

    await decisionStore.resolveDecision(task.taskKey, decision.decisionId, "Yes", `decision-resolve:${task.taskKey}`);

    await expect(decisionStore.resolveDecision(
      task.taskKey,
      decision.decisionId,
      "No",
      `decision-resolve-again:${task.taskKey}`,
    )).rejects.toThrow(/already resolved/i);
  });
});
