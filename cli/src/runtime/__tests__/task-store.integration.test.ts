import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresTaskStore } from "../task-store.js";

const connectionString = process.env.FLYD_TEST_DATABASE_URL ?? "postgres:///flyd_v1_test";
const pool = new Pool({ connectionString, max: 2 });
const store = new PostgresTaskStore(pool);
const projectRoot = `/tmp/flyd-runtime-${process.pid}`;

async function cleanProject(): Promise<void> {
  const projects = await pool.query("SELECT id FROM projects WHERE root_path = $1", [projectRoot]);
  for (const project of projects.rows) {
    const tasks = await pool.query("SELECT id FROM agent_tasks WHERE project_id = $1", [project.id]);
    const taskIds = tasks.rows.map((row) => row.id);
    if (taskIds.length) {
      await pool.query("DELETE FROM runtime_events WHERE agent_task_id = ANY($1::bigint[])", [taskIds]);
      await pool.query("DELETE FROM task_sessions WHERE agent_task_id = ANY($1::bigint[])", [taskIds]);
      await pool.query("DELETE FROM worker_sessions WHERE agent_task_id = ANY($1::bigint[])", [taskIds]);
      await pool.query("DELETE FROM task_grants WHERE agent_task_id = ANY($1::bigint[])", [taskIds]);
      await pool.query("DELETE FROM agent_tasks WHERE id = ANY($1::bigint[])", [taskIds]);
    }
    await pool.query("DELETE FROM projects WHERE id = $1", [project.id]);
  }
}

describe("PostgresTaskStore", () => {
  beforeEach(async () => {
    await cleanProject();
  });

  afterAll(async () => {
    await cleanProject();
    await pool.end();
  });

  it("creates, orients, grants, resumes, and completes one durable task", async () => {
    const task = await store.createTask({
      projectName: "runtime-test",
      projectRoot,
      intendedOutcome: "Prove restart continuity",
      repository: { root: projectRoot, name: "runtime-test", remote: null, branch: "main", head: "a", dirty: false, statusLines: [], statusDigest: "clean" },
      idempotencyKey: `task:${projectRoot}`,
    });
    expect(task.revision).toBe(0);

    const oriented = await store.recordOrientation(task.taskKey, task.revision, {
      contextSnapshot: { memory_refs: ["memory:1"] },
      repositorySnapshot: { head: "a", status_digest: "clean" },
      recommendedNextAction: "Run OpenCode",
      idempotencyKey: `orient:${task.taskKey}:0`,
    });
    expect(oriented.revision).toBe(1);

    const grant = await store.approveGrant(oriented.taskKey, oriented.revision, {
      repositoryRoots: [projectRoot],
      worktreePaths: [],
      workerAdapters: ["opencode"],
      fileOperations: ["read", "write"],
      commandClasses: ["test", "git_status"],
      verificationCommands: ["git diff --check"],
      renewalRequiredActions: ["deploy", "publish", "secret_disclosure"],
      maxConcurrency: 1,
      budget: { max_worker_runs: 3, max_runtime_minutes: 90 },
      providerIdentity: "opencode-configured-provider",
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
      idempotencyKey: `grant:${oriented.taskKey}:1`,
    });
    expect(grant.status).toBe("approved");
    expect(grant.verificationCommands).toEqual(["git diff --check"]);
    expect(grant.renewalRequiredActions).toContain("secret_disclosure");
    expect(grant.maxConcurrency).toBe(1);
    expect(grant.budget).toMatchObject({ max_worker_runs: 3, max_runtime_minutes: 90 });
    expect(grant.providerIdentity).toBe("opencode-configured-provider");
    expect(new Date(grant.expiresAt!).getTime()).toBeGreaterThan(Date.now());
    const duplicateGrant = await store.approveGrant(oriented.taskKey, oriented.revision, {
      repositoryRoots: [projectRoot],
      worktreePaths: [],
      workerAdapters: ["opencode"],
      fileOperations: ["read", "write"],
      commandClasses: ["test", "git_status"],
      verificationCommands: ["git diff --check"],
      renewalRequiredActions: ["deploy", "publish", "secret_disclosure"],
      maxConcurrency: 1,
      budget: { max_worker_runs: 3, max_runtime_minutes: 90 },
      providerIdentity: "opencode-configured-provider",
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
      idempotencyKey: `grant:${oriented.taskKey}:1`,
    });
    expect(duplicateGrant.grantKey).toBe(grant.grantKey);

    const resumed = await store.findResumableTask(projectRoot);
    expect(resumed?.taskKey).toBe(task.taskKey);
    expect(resumed?.revision).toBe(2);

    const sessionKey = await store.startTaskSession(task.id, true, { head: "a" });
    await store.finishTaskSession(sessionKey, { interpretation: "focused_corrected" });

    await expect(store.recordOrientation(task.taskKey, 0, {
      contextSnapshot: {}, repositorySnapshot: {}, recommendedNextAction: "stale", idempotencyKey: "stale-orientation",
    })).rejects.toThrow(/revision/i);

    const worker = await store.createWorker({
      taskKey: task.taskKey,
      grantKey: grant.grantKey,
      adapter: "opencode",
      executablePath: "/usr/local/bin/opencode",
      executableVersion: "1.17.18",
      workingDirectory: projectRoot,
      idempotencyKey: `worker:${task.taskKey}`,
    });
    const duplicateWorker = await store.createWorker({
      taskKey: task.taskKey,
      grantKey: grant.grantKey,
      adapter: "opencode",
      executablePath: "/usr/local/bin/opencode",
      executableVersion: "1.17.18",
      workingDirectory: projectRoot,
      idempotencyKey: `worker:${task.taskKey}`,
    });
    expect(duplicateWorker.workerKey).toBe(worker.workerKey);
    await expect(store.createWorker({
      taskKey: task.taskKey,
      grantKey: grant.grantKey,
      adapter: "opencode",
      executablePath: "/usr/local/bin/opencode",
      executableVersion: "1.17.18",
      workingDirectory: "/tmp/outside-grant",
      idempotencyKey: `worker-outside:${task.taskKey}`,
    })).rejects.toThrow(/grant/i);
    const runningTask = await store.findTask(task.taskKey);
    await expect(store.completeTask(task.taskKey, runningTask!.revision, {
      summary: "Unverified",
      verification: {},
      repositorySnapshot: {},
      idempotencyKey: `premature-complete:${task.taskKey}`,
    })).rejects.toThrow(/worker/i);
    await store.transitionWorker(worker.workerKey, {
      status: "running",
      processId: process.pid,
      idempotencyKey: `worker-running:${task.taskKey}`,
    });
    await store.transitionWorker(worker.workerKey, {
      status: "completed",
      externalSessionId: "session-1",
      exitStatus: 0,
      output: "Continuity proven",
      idempotencyKey: `worker-completed:${task.taskKey}`,
    });
    const afterWorker = await store.findTask(task.taskKey);
    await expect(store.completeTask(task.taskKey, afterWorker!.revision, {
      summary: "Not actually verified",
      verification: {},
      repositorySnapshot: { head: "b", status_digest: "changed" },
      idempotencyKey: `unverified-complete:${task.taskKey}`,
    })).rejects.toThrow(/verification/i);
    const escaped = await store.recordToolEscape(
      task.taskKey,
      afterWorker!.revision,
      "needed a manual comparison",
      `tool-escape:${task.taskKey}`,
    );

    const completed = await store.completeTask(task.taskKey, escaped.revision, {
      summary: "Continuity proven",
      verification: { confirmed_by: "user" },
      repositorySnapshot: { head: "b", status_digest: "changed" },
      idempotencyKey: `complete:${task.taskKey}`,
    });
    expect(completed.status).toBe("completed");
    expect(completed.verificationResult).toEqual({ confirmed_by: "user" });

    const events = await pool.query("SELECT event_type FROM runtime_events WHERE agent_task_id = $1 ORDER BY task_revision", [task.id]);
    expect(events.rows.map((row) => row.event_type)).toEqual([
      "task.created", "task.oriented", "grant.approved", "task_session.started", "task_session.ended", "worker.queued",
      "worker.running", "worker.completed", "task.tool_escape", "task.completed",
    ]);
    const pendingArchive = await store.pendingArchiveEvents();
    const completionEvent = pendingArchive.find((event) => event.eventType === "task.completed");
    expect(completionEvent).toMatchObject({ taskKey: task.taskKey, payload: { summary: "Continuity proven" } });
    await store.markArchiveDelivered(completionEvent!.id);
    expect((await store.pendingArchiveEvents()).map((event) => event.id)).not.toContain(completionEvent!.id);
    const sessions = await pool.query("SELECT resumed, interpretation_status, status FROM task_sessions WHERE session_key = $1", [sessionKey]);
    expect(sessions.rows[0]).toMatchObject({ resumed: false, interpretation_status: "focused_corrected", status: "ended" });

    const listed = await store.listTasks(projectRoot);
    expect(listed.map((listedTask) => listedTask.taskKey)).toContain(task.taskKey);
    const metrics = await store.metrics(projectRoot);
    expect(metrics).toMatchObject({
      windowStartedAt: expect.any(String),
      tasks: 1,
      completedTasks: 1,
      sessions: 1,
      resumedSessions: 0,
      resumedWithoutRestatement: 0,
      acceptedInterpretations: 0,
      correctedInterpretations: 1,
      replacedInterpretations: 0,
      toolEscapes: 1,
    });
  });

  it("journals and closes an abandoned active task session on restart", async () => {
    const task = await store.createTask({
      projectName: "runtime-test",
      projectRoot,
      intendedOutcome: "Recover an abandoned session",
      repository: { root: projectRoot, name: "runtime-test", remote: null, branch: "main", head: "c", dirty: false, statusLines: [], statusDigest: "clean-c" },
      idempotencyKey: `recovery-task:${projectRoot}`,
    });
    const sessionKey = await store.startTaskSession(task.id, false, { head: "c" });

    expect(await store.recoverTaskSessions(projectRoot)).toBe(1);

    const session = await pool.query("SELECT status, interpretation_status FROM task_sessions WHERE session_key = $1", [sessionKey]);
    expect(session.rows[0]).toEqual({ status: "ended", interpretation_status: "pending" });
    const events = await pool.query("SELECT event_type FROM runtime_events WHERE agent_task_id = $1 ORDER BY task_revision", [task.id]);
    expect(events.rows.map((row) => row.event_type)).toEqual([
      "task.created", "task_session.started", "task_session.ended",
    ]);
  });

  it("counts a task session as resumed only after a thirty-minute break", async () => {
    const task = await store.createTask({
      projectName: "runtime-test",
      projectRoot,
      intendedOutcome: "Measure a real resume",
      repository: { root: projectRoot, name: "runtime-test", remote: null, branch: "main", head: "a", dirty: false, statusLines: [], statusDigest: "clean" },
      idempotencyKey: `resume-task:${projectRoot}`,
    });
    const first = await store.startTaskSession(task.id, false, {});
    await store.finishTaskSession(first, { interpretation: "accepted" });
    await pool.query("UPDATE task_sessions SET ended_at = NOW() - INTERVAL '31 minutes' WHERE session_key = $1", [first]);

    const resumed = await store.startTaskSession(task.id, true, {});
    await store.finishTaskSession(resumed, { interpretation: "accepted" });

    const session = await pool.query("SELECT resumed FROM task_sessions WHERE session_key = $1", [resumed]);
    expect(session.rows[0].resumed).toBe(true);
  });

  it("expires stale authority before approving a replacement grant", async () => {
    const task = await store.createTask({
      projectName: "runtime-test",
      projectRoot,
      intendedOutcome: "Renew bounded authority",
      repository: { root: projectRoot, name: "runtime-test", remote: null, branch: "main", head: "a", dirty: false, statusLines: [], statusDigest: "clean" },
      idempotencyKey: `renew-task:${projectRoot}`,
    });
    const first = await store.approveGrant(task.taskKey, task.revision, {
      repositoryRoots: [projectRoot], worktreePaths: [], workerAdapters: ["opencode"],
      fileOperations: ["read", "write"], commandClasses: ["test"],
      verificationCommands: ["git diff --check"], renewalRequiredActions: ["deploy"],
      maxConcurrency: 1, budget: { max_worker_runs: 3, max_runtime_minutes: 90 },
      providerIdentity: "opencode-configured-provider", expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: `first-grant:${task.taskKey}`,
    });
    await pool.query("UPDATE task_grants SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [first.id]);
    expect(await store.approvedGrant(task.id)).toBeNull();
    const current = await store.findTask(task.taskKey);

    const replacement = await store.approveGrant(task.taskKey, current!.revision, {
      repositoryRoots: [projectRoot], worktreePaths: [], workerAdapters: ["opencode"],
      fileOperations: ["read", "write"], commandClasses: ["test"],
      verificationCommands: ["git diff --check"], renewalRequiredActions: ["deploy"],
      maxConcurrency: 1, budget: { max_worker_runs: 3, max_runtime_minutes: 90 },
      providerIdentity: "opencode-configured-provider", expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: `replacement-grant:${task.taskKey}`,
    });

    expect(replacement.grantKey).not.toBe(first.grantKey);
    expect((await pool.query("SELECT status FROM task_grants WHERE id = $1", [first.id])).rows[0].status).toBe("expired");
  });
});
