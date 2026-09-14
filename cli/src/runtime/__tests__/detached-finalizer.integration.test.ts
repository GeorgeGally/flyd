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

async function seedLegacyDetachedSurvivor(repo: { root: string; head: string }) {
  const projectName = `detached-legacy-${randomUUID().slice(0, 8)}`;
  const managedRoot = mkdtempSync(join(tmpdir(), "flyd-detached-managed-"));
  cleanedManaged.push(managedRoot);
  const manager = new GitWorktreeManager({ managedRoot });
  const project = await pool.query(`INSERT INTO projects (name, root_path, created_at, updated_at)
    VALUES ($1, $2, NOW(), NOW()) RETURNING id`, [projectName, repo.root]);
  const taskKey = randomUUID();
  const task = await pool.query(`INSERT INTO agent_tasks
    (project_id, task_key, status, intended_outcome, success_criteria, verification_criteria,
     plan, context_snapshot, repository_snapshot, verification_result, revision, started_at,
     created_at, updated_at)
    VALUES ($1, $2, 'ready', 'Legacy detached work', '["Changed"]'::jsonb, '["git diff --check"]'::jsonb,
     '{}'::jsonb, '{}'::jsonb, $3::jsonb, '{}'::jsonb, 1, NOW(), NOW(), NOW()) RETURNING id`,
    [project.rows[0].id, taskKey, JSON.stringify({ head: repo.head, status_digest: "clean" })]);
  const taskId = task.rows[0].id;
  const assignmentKey = randomUUID();
  await pool.query(`INSERT INTO task_assignments
    (agent_task_id, assignment_key, status, title, instructions, success_criteria, capability_requirements,
     dependency_keys, declared_file_scope, repository_root, base_head, revision, created_at, updated_at)
    VALUES ($1, $2, 'running', 'Legacy assignment', 'Change one.txt', '["Changed"]'::jsonb, '["implementation"]'::jsonb,
     '[]'::jsonb, '["one.txt"]'::jsonb, $3, $4, 1, NOW(), NOW())`,
    [taskId, assignmentKey, repo.root, repo.head]);
  await pool.query(`INSERT INTO task_grants
    (agent_task_id, grant_key, status, scope_digest, repository_roots, worktree_paths, worker_adapters,
     file_operations, command_classes, verification_commands, renewal_required_actions, max_concurrency,
     budget, expires_at, created_at, updated_at)
    VALUES ($1, $2, 'approved', 'digest', $3::jsonb, $4::jsonb, '["codex"]'::jsonb, '["read","write"]'::jsonb,
     '["test","git_status"]'::jsonb, '["git diff --check"]'::jsonb, '["deploy"]'::jsonb, 1,
     '{"max_worker_runs":1,"max_runtime_minutes":90}'::jsonb, NOW() + INTERVAL '8 hours', NOW(), NOW())`,
    [taskId, randomUUID(), JSON.stringify([repo.root]), JSON.stringify([managedRoot])]);
  const worktree = await manager.prepare({ repositoryRoot: repo.root, taskKey, assignmentKey, baseHead: repo.head });
  appendFileSync(join(worktree.path, "one.txt"), "worker edit\n");
  await pool.query(`INSERT INTO worker_sessions
    (agent_task_id, task_grant_id, task_assignment_id, worker_key, status, adapter, executable_path,
     executable_version, working_directory, exit_status, output, started_at, ended_at, created_at, updated_at)
    VALUES ($1, (SELECT id FROM task_grants WHERE agent_task_id = $1 LIMIT 1), (SELECT id FROM task_assignments WHERE assignment_key = $2),
     $3, 'completed', 'codex', '/usr/local/bin/codex', '1.0.0', $4, 0, 'detached output', NOW() - INTERVAL '5 minutes',
     NOW() - INTERVAL '12 seconds', NOW(), NOW())`,
    [taskId, assignmentKey, randomUUID(), worktree.path]);
  return { projectRoot: repo.root, taskKey, manager };
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
    "blocks detached landing for a legacy task with no delivery contract before any repository mutation",
    async () => {
      const repo = await repository();
      const seeded = await seedLegacyDetachedSurvivor(repo);

      const results = await finalizeDetachedProject(pool, seeded.projectRoot, seeded.manager);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("blocked");
      expect(results[0].reason).toMatch(/no delivery contract/i);
      const head = await git(repo.root, "rev-parse", "HEAD");
      expect(head).toBe(repo.head);
      expect(await git(repo.root, "log", "-1", "--format=%s")).toBe("base");
      const blockedEvent = await pool.query(
        `SELECT payload FROM runtime_events WHERE event_type = 'task.integration_blocked'
          AND agent_task_id = (SELECT id FROM agent_tasks WHERE task_key = $1)`,
        [seeded.taskKey],
      );
      expect(blockedEvent.rows[0]?.payload.reason).toMatch(/no delivery contract/i);
    },
  );

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
