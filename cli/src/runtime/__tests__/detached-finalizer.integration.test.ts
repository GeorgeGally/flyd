import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { promisify } from "util";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { ensureRuntimeSchema } from "../runtime-schema.js";
import { PostgresTaskStore } from "../task-store.js";
import { finalizeDetachedProject } from "../detached-finalizer.js";
import { GitWorktreeManager } from "../worktree-manager.js";

const execFileAsync = promisify(execFile);
const connectionString = process.env.FLYD_TEST_DATABASE_URL ?? "postgres:///flyd_v1_test";
const pool = new Pool({ connectionString, max: 2 });
const store = new PostgresTaskStore(pool);

const cleanedRoots: string[] = [];
const cleanedManaged: string[] = [];

async function repository(): Promise<{ root: string; head: string }> {
  const root = mkdtempSync(join(tmpdir(), "flyd-detached-finalizer-test-"));
  cleanedRoots.push(root);
  await execFileAsync("git", ["init", "-b", "main", root]);
  writeFileSync(join(root, "one.txt"), "one base\n");
  writeFileSync(join(root, "two.txt"), "two base\n");
  await execFileAsync("git", ["-C", root, "add", "."]);
  await execFileAsync("git", ["-C", root, "-c", "user.name=Flyd Test", "-c", "user.email=flyd@example.test", "commit", "-m", "base"]);
  const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"]);
  return { root, head: stdout.trim() };
}

async function git(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args]);
  return stdout.trim();
}

async function cleanProject(rootPath: string): Promise<void> {
  const projects = await pool.query("SELECT id FROM projects WHERE root_path = $1", [rootPath]);
  for (const project of projects.rows) {
    const tasks = await pool.query("SELECT id FROM agent_tasks WHERE project_id = $1", [project.id]);
    const taskIds = tasks.rows.map((row) => row.id);
    if (taskIds.length) {
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

async function seedDetachedSurvivor(repo: { root: string; head: string }) {
  const projectName = `detached-${randomUUID().slice(0, 8)}`;
  const managedRoot = mkdtempSync(join(tmpdir(), "flyd-detached-managed-"));
  cleanedManaged.push(managedRoot);
  const manager = new GitWorktreeManager({ managedRoot });

  const task = await store.createTask({
    projectName,
    projectRoot: repo.root,
    intendedOutcome: "Recover the completed detached worker's output",
    repository: {
      root: repo.root,
      name: projectName,
      remote: null,
      branch: "main",
      head: repo.head,
      dirty: false,
      statusLines: [],
      statusDigest: "clean",
    },
    idempotencyKey: `task:${projectName}`,
  });
  const oriented = await store.recordOrientation(task.taskKey, task.revision, {
    contextSnapshot: { memory_refs: [] },
    repositorySnapshot: { head: repo.head, status_digest: "clean" },
    recommendedNextAction: "Run the worker",
    idempotencyKey: `orient:${projectName}:0`,
  });
  const grant = await store.approveGrant(oriented.taskKey, oriented.revision, {
    repositoryRoots: [repo.root],
    worktreePaths: [managedRoot],
    workerAdapters: ["codex"],
    fileOperations: ["read", "write"],
    commandClasses: ["test", "git_status"],
    verificationCommands: ["git diff --check"],
    renewalRequiredActions: ["deploy", "publish", "secret_disclosure"],
    maxConcurrency: 1,
    budget: { max_worker_runs: 1, max_runtime_minutes: 90 },
    providerIdentity: "codex-configured-provider",
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    idempotencyKey: `grant:${projectName}:1`,
  });

  const worker = await store.createWorker({
    taskKey: task.taskKey,
    grantKey: grant.grantKey,
    adapter: "codex",
    executablePath: "/usr/local/bin/codex",
    executableVersion: "1.0.0",
    workingDirectory: repo.root,
    idempotencyKey: `worker:${projectName}`,
  });

  const assignments = await pool.query("SELECT assignment_key FROM task_assignments WHERE agent_task_id = $1", [task.id]);
  const assignmentKey = assignments.rows[0].assignment_key as string;

  const worktree = await manager.prepare({ repositoryRoot: repo.root, taskKey: task.taskKey, assignmentKey, baseHead: repo.head });
  await pool.query("UPDATE worker_sessions SET working_directory = $1 WHERE worker_key = $2", [worktree.path, worker.workerKey]);
  await store.updateAssignmentWorkspace(assignmentKey, {
    worktreePath: worktree.path,
    branchName: worktree.branchName,
    baseHead: repo.head,
    idempotencyKey: `workspace:${projectName}`,
  });

  appendFileSync(join(worktree.path, "one.txt"), "worker edit\n");

  await store.transitionWorker(worker.workerKey, {
    status: "running",
    processId: process.pid,
    idempotencyKey: `running:${projectName}`,
  });
  await store.transitionWorker(worker.workerKey, {
    status: "completed",
    exitStatus: 0,
    output: "Detached output ready",
    idempotencyKey: `completed:${projectName}`,
  });
  await pool.query(
    "UPDATE worker_sessions SET ended_at = NOW() - INTERVAL '12 seconds' WHERE worker_key = $1",
    [worker.workerKey],
  );

  return { projectRoot: repo.root, taskKey: task.taskKey, manager, worktreePath: worktree.path };
}

describe("detached-finalizer integration (macOS-only: verification sandbox requires darwin, so these tests skip elsewhere)", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    await ensureRuntimeSchema(pool);
  });

  afterEach(async () => {
    for (const root of cleanedRoots) await cleanProject(root);
    for (const root of cleanedRoots) rmSync(root, { recursive: true, force: true });
    cleanedRoots.length = 0;
    for (const root of cleanedManaged) rmSync(root, { recursive: true, force: true });
    cleanedManaged.length = 0;
  });

  afterAll(async () => {
    await pool.end();
  });

  it.skipIf(process.platform !== "darwin")(
    "integrates a completed detached worker after a machine restart (survivors recovered)",
    async () => {
      const repo = await repository();
      const seeded = await seedDetachedSurvivor(repo);

      const results = await finalizeDetachedProject(pool, seeded.projectRoot, seeded.manager);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("integrated");
      const head = await git(repo.root, "rev-parse", "HEAD");
      expect(head).not.toBe(repo.head);
      expect(await git(repo.root, "log", "-1", "--format=%s")).toBe(`flyd: integrate ${seeded.taskKey}`);
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "blocks detached landing when the source repository changed while Core was offline",
    async () => {
      const repo = await repository();
      const seeded = await seedDetachedSurvivor(repo);
      await git(repo.root, "-c", "user.name=Flyd Test", "-c", "user.email=flyd@example.test", "commit", "--allow-empty", "-m", "external merge");

      const results = await finalizeDetachedProject(pool, seeded.projectRoot, seeded.manager);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("blocked");
      expect(results[0].reason).toMatch(/Source repository .* changed since assignment start/);
    },
  );
});