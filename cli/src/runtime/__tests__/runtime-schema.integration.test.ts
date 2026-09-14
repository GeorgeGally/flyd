import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRuntimePool, withTransaction } from "../database.js";
import { OperationalDecisionStore } from "../operational-decision-store.js";

const adminUrl = process.env.FLYD_TEST_DATABASE_URL ?? "postgres:///flyd_v1_test";

// Proves Core owns the runtime schema: a brand-new database with zero tables
// bootstraps itself through the pool and runtime writes succeed — no
// bin/rails db:prepare involved.
describe("runtime schema bootstrap on a fresh database", () => {
  let dbName: string;
  let pool: pg.Pool;
  let admin: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    dbName = `flyd_v1_schema_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await admin.query(`CREATE DATABASE ${dbName}`);
    pool = createRuntimePool(`postgres:///${dbName}`);
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP DATABASE ${dbName}`);
    await admin.end();
  });

  it("bootstraps the full runtime schema on a database with zero tables", async () => {
    const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    expect(tables.rows.map((row) => row.tablename).sort()).toEqual([
      "agent_tasks",
      "projects",
      "release_acceptance_observations",
      "release_markers",
      "runtime_delivery_receipts",
      "runtime_delivery_states",
      "runtime_events",
      "surface_items",
      "task_artifacts",
      "task_assignments",
      "task_corrections",
      "task_grants",
      "task_recommendations",
      "task_sessions",
      "worker_commands",
      "worker_sessions",
    ]);
  });

  it("runtime writes succeed after bootstrap", async () => {
    await withTransaction(pool, async (client) => {
      await client.query(
        "INSERT INTO projects (name, root_path, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())",
        ["schema-probe", "/tmp/schema-probe"],
      );
      await client.query(
        `INSERT INTO agent_tasks (project_id, task_key, status, intended_outcome, created_at, updated_at)
         VALUES ((SELECT id FROM projects WHERE name = $1), $2, 'ready', $3, NOW(), NOW())`,
        ["schema-probe", "schema-probe-task", "probe"],
      );
    });

    const store = new OperationalDecisionStore(pool);
    const decision = await store.openDecision("schema-probe-task", {
      question: "does the bootstrap make runtime writes work?",
      idempotencyKey: `probe-open-${dbName}`,
    });
    expect(decision.status).toBe("open");

    await store.resolveDecision("schema-probe-task", decision.decisionId, "yes", `probe-resolve-${dbName}`);
    const decisions = await store.listDecisions("schema-probe-task");
    expect(decisions).toHaveLength(1);
    expect(decisions[0].status).toBe("resolved");
  });
});