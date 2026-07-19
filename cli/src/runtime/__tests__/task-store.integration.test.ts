import { randomUUID } from "crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresTaskStore } from "../task-store.js";
import type { WorkerSession } from "../types.js";

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
      await pool.query(`DELETE FROM runtime_delivery_receipts
        WHERE runtime_event_id IN (SELECT id FROM runtime_events WHERE agent_task_id = ANY($1::bigint[]))`, [taskIds]);
      await pool.query("DELETE FROM runtime_events WHERE agent_task_id = ANY($1::bigint[])", [taskIds]);
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

describe("PostgresTaskStore", { timeout: 15_000 }, () => {
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
    expect(afterWorker?.status).toBe("ready");
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
    expect(completed.recommendedNextAction).toBe(
      "No unresolved work. Reopen only if this verified outcome regresses: Continuity proven",
    );

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

  it("publishes a compact notification only after the runtime event commits", async () => {
    const listener = await pool.connect();
    try {
      await listener.query("LISTEN flyd_runtime_events");
      const received = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("runtime notification timed out")), 2_000);
        listener.once("notification", (message) => {
          clearTimeout(timeout);
          resolve(JSON.parse(message.payload ?? "{}"));
        });
      });

      const task = await store.createTask({
        projectName: "runtime-test",
        projectRoot,
        intendedOutcome: "Notify Rails after commit",
        repository: {
          root: projectRoot, name: "runtime-test", remote: null, branch: "main",
          head: "notify-head", dirty: false, statusLines: [], statusDigest: "clean",
        },
        idempotencyKey: `notify-task:${projectRoot}`,
      });
      const payload = await received;

      expect(payload).toEqual(expect.objectContaining({
        task_key: task.taskKey,
        task_revision: 0,
        event_type: "task.created",
      }));
      expect(payload.event_key).toEqual(expect.any(String));
    } finally {
      await listener.query("UNLISTEN flyd_runtime_events");
      listener.release();
    }
  });

  it("derives global acceptance from session-bounded artifacts and browser receipts", async () => {
    await pool.query(`INSERT INTO release_markers
      (release_key, available_at, metadata, created_at, updated_at)
      VALUES ('release_1c', NOW() - INTERVAL '1 day', '{}'::jsonb, NOW(), NOW())
      ON CONFLICT (release_key) DO UPDATE
      SET available_at = EXCLUDED.available_at, updated_at = NOW()`);
    const baseline = await store.releaseAcceptanceEvidence();
    const project = await pool.query(`INSERT INTO projects
      (name, root_path, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW()) RETURNING id`, [
      `acceptance-${process.pid}`,
      projectRoot,
    ]);
    const task = await pool.query(`INSERT INTO agent_tasks
      (project_id, task_key, status, intended_outcome, success_criteria, verification_criteria,
       plan, context_snapshot, repository_snapshot, verification_result, revision, started_at,
       created_at, updated_at)
      VALUES ($1, $2, 'ready', 'Prove session evidence', '[]'::jsonb, '[]'::jsonb,
       '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 1, NOW() - INTERVAL '2 hours',
       NOW(), NOW()) RETURNING id`, [project.rows[0].id, randomUUID()]);
    const taskId = task.rows[0].id;
    const assignment = await pool.query(`INSERT INTO task_assignments
      (agent_task_id, assignment_key, status, title, instructions, success_criteria,
       capability_requirements, dependency_keys, declared_file_scope, excluded_adapters,
       verification_result, integration_result, revision, created_at, updated_at)
      VALUES ($1, $2, 'integrated', 'Implement', 'Implement and verify', '[]'::jsonb,
       '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
       1, NOW(), NOW()) RETURNING id`, [taskId, randomUUID()]);
    const grant = await pool.query(`INSERT INTO task_grants
      (agent_task_id, grant_key, status, scope_digest, repository_roots, worktree_paths,
       worker_adapters, file_operations, command_classes, verification_commands,
       renewal_required_actions, max_concurrency, budget, expires_at, provider_identity,
       created_at, updated_at)
      VALUES ($1, $2, 'completed', $3, '[]'::jsonb, '[]'::jsonb, '["codex"]'::jsonb,
       '[]'::jsonb, '[]'::jsonb, '["npm test"]'::jsonb, '[]'::jsonb, 1, '{}'::jsonb,
       NOW() + INTERVAL '1 hour', 'codex:test', NOW(), NOW()) RETURNING id`, [
      taskId,
      randomUUID(),
      "a".repeat(64),
    ]);
    const realSession = await pool.query(`INSERT INTO task_sessions
      (agent_task_id, session_key, status, resumed, interpretation_status,
       manual_context_restatement, tool_escape, startup_snapshot, started_at, ended_at,
       created_at, updated_at)
      VALUES ($1, $2, 'ended', TRUE, 'focused_corrected', FALSE, FALSE, '{}'::jsonb,
       NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '2 minutes', NOW(), NOW())
      RETURNING id`, [taskId, randomUUID()]);
    const worker = await pool.query(`INSERT INTO worker_sessions
      (agent_task_id, task_grant_id, task_assignment_id, worker_key, status, adapter,
       working_directory, assignment_revision, capabilities, started_at, ended_at,
       exit_status, usage, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'completed', 'codex', $5, 1, '[]'::jsonb,
       NOW() - INTERVAL '9 minutes', NOW() - INTERVAL '5 minutes', 0, '{}'::jsonb,
       NOW() - INTERVAL '9 minutes', NOW()) RETURNING id`, [
      taskId,
      grant.rows[0].id,
      assignment.rows[0].id,
      randomUUID(),
      projectRoot,
    ]);
    await pool.query(`INSERT INTO task_artifacts
      (agent_task_id, task_assignment_id, worker_session_id, artifact_key, kind, title,
       media_type, byte_size, sha256_digest, verification_status, source_revision,
       provenance, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'test', 'Verified test', 'text/plain', 6, $5,
       'verified', 1, '{}'::jsonb, NOW() - INTERVAL '4 minutes', NOW())`, [
      taskId,
      assignment.rows[0].id,
      worker.rows[0].id,
      randomUUID(),
      "b".repeat(64),
    ]);
    const event = await pool.query(`INSERT INTO runtime_events
      (agent_task_id, event_key, event_type, task_revision, payload, occurred_at,
       broadcast_delivered_at, delivery_attempts, created_at, updated_at)
      VALUES ($1, $2, 'worker.completed', 1, '{}'::jsonb, NOW() - INTERVAL '3 minutes',
       NOW() - INTERVAL '2 minutes', 0, NOW(), NOW()) RETURNING id`, [taskId, randomUUID()]);
    await pool.query(`INSERT INTO runtime_delivery_receipts
      (runtime_event_id, client_id, acknowledged_at, delivery_latency_ms, created_at, updated_at)
      VALUES ($1, 'acceptance-browser', NOW() - INTERVAL '2 minutes', 777, NOW(), NOW())`, [
      event.rows[0].id,
    ]);
    await pool.query(`INSERT INTO task_sessions
      (agent_task_id, session_key, status, resumed, interpretation_status,
       manual_context_restatement, tool_escape, startup_snapshot, started_at, ended_at,
       created_at, updated_at)
      VALUES ($1, $2, 'ended', TRUE, 'accepted', FALSE, FALSE, '{}'::jsonb,
       NOW() - INTERVAL '90 seconds', NOW() - INTERVAL '60 seconds', NOW(), NOW())`, [
      taskId,
      randomUUID(),
    ]);
    const reviewKey = `acceptance-review:${process.pid}`;
    await store.recordReleaseAcceptanceObservation({
      kind: "memory_safety",
      passed: true,
      evidence: { note: "Sampled evidence stayed current" },
      idempotencyKey: reviewKey,
    });
    await store.recordReleaseAcceptanceObservation({
      kind: "memory_safety",
      passed: true,
      evidence: { note: "Idempotent replay" },
      idempotencyKey: reviewKey,
    });

    const evidence = await store.releaseAcceptanceEvidence();

    expect(evidence.realSessions).toBe(baseline.realSessions + 1);
    expect(evidence.resumedSessions).toBe(baseline.resumedSessions + 1);
    expect(evidence.recommendedActions).toBe(baseline.recommendedActions + 1);
    expect(evidence.acceptedOrAdaptedActions).toBe(baseline.acceptedOrAdaptedActions + 1);
    expect(evidence.parityEvidenceCount).toBe(baseline.parityEvidenceCount + 1);
    expect(evidence.propagationLatenciesMs).toContain(777);
    expect(evidence.memorySafetyReviews.length).toBe(baseline.memorySafetyReviews.length + 1);
    expect(realSession.rows[0].id).toBeDefined();
    await pool.query("DELETE FROM release_acceptance_observations WHERE idempotency_key = $1", [reviewKey]);
  });

  it("persists structured user corrections idempotently with provenance", async () => {
    const task = await store.createTask({
      projectName: "runtime-test",
      projectRoot,
      intendedOutcome: "Assume the old claim",
      repository: {
        root: projectRoot, name: "runtime-test", remote: null, branch: "main",
        head: "correction-head", dirty: false, statusLines: [], statusDigest: "clean",
      },
      idempotencyKey: `correction-task:${projectRoot}`,
    });
    const input = {
      repositorySnapshot: { head: "correction-head", status_digest: "clean" },
      originalClaim: "The old claim",
      surfaceRevision: 42,
      actorSurface: "rails" as const,
      idempotencyKey: `correction:${task.taskKey}`,
    };

    const [ corrected, replay ] = await Promise.all([
      store.recordCorrection(task.taskKey, task.revision, "The corrected value", input),
      store.recordCorrection(task.taskKey, task.revision, "The corrected value", input),
    ]);
    const corrections = await store.listCorrections(task.id);

    expect(replay.revision).toBe(corrected.revision);
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({
      originalClaim: "The old claim",
      correctedValue: "The corrected value",
      surfaceRevision: 42,
      authority: "user",
      provenance: { actor_surface: "rails" },
    });
    const archive = await store.pendingArchiveEvents();
    expect(archive.find((event) => event.eventType === "task.corrected")?.payload).toMatchObject({
      original_claim: "The old claim",
      corrected_value: "The corrected value",
      authority: "user",
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

  it("persists a grant proposal before approving or rejecting the exact scope", async () => {
    const task = await store.createTask({
      projectName: "runtime-test",
      projectRoot,
      intendedOutcome: "Share one permission decision across surfaces",
      repository: { root: projectRoot, name: "runtime-test", remote: null, branch: "main", head: "base", dirty: false, statusLines: [], statusDigest: "clean" },
      idempotencyKey: `proposal-task:${projectRoot}`,
    });
    const proposal = await store.proposeGrant(task.taskKey, task.revision, {
      repositoryRoots: [projectRoot], worktreePaths: [], workerAdapters: ["codex"],
      fileOperations: ["read", "write"], commandClasses: ["test"],
      verificationCommands: ["git diff --check"], renewalRequiredActions: ["deploy"],
      maxConcurrency: 1,
      budget: { max_worker_runs: 2, max_runtime_minutes: 90, max_inactivity_minutes: 10 },
      providerIdentity: "codex:local", expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: `proposal:${task.taskKey}`,
    });

    expect(proposal).toMatchObject({
      status: "proposed",
      approvedAt: null,
      decisionReason: null,
      workerAdapters: ["codex"],
    });
    expect((await store.findTask(task.taskKey))!.status).toBe("awaiting_grant");
    expect((await store.proposedGrant(task.id))?.grantKey).toBe(proposal.grantKey);

    const current = await store.findTask(task.taskKey);
    const [approved, replay] = await Promise.all([
      store.approveGrantProposal(
        task.taskKey,
        current!.revision,
        proposal.grantKey,
        `proposal-approve:${proposal.grantKey}`,
      ),
      store.approveGrantProposal(
        task.taskKey,
        current!.revision,
        proposal.grantKey,
        `proposal-approve:${proposal.grantKey}`,
      ),
    ]);
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).toEqual(expect.any(String));
    expect((await store.findTask(task.taskKey))!.status).toBe("ready");

    expect(replay.grantKey).toBe(approved.grantKey);
    expect((await store.listGrants(task.id))).toHaveLength(1);
  });

  it("persists one validated plan idempotently and enforces assignment concurrency", async () => {
    const task = await store.createTask({
      projectName: "runtime-test",
      projectRoot,
      intendedOutcome: "Run two bounded assignments",
      repository: { root: projectRoot, name: "runtime-test", remote: null, branch: "main", head: "base", dirty: false, statusLines: [], statusDigest: "clean" },
      idempotencyKey: `plan-task:${projectRoot}`,
    });
    const planned = await store.persistAssignmentPlan(task.taskKey, task.revision, {
      successCriteria: ["Both assignments verify"],
      verificationCriteria: ["git diff --check"],
      source: "model",
      assignments: [
        {
          key: "implementation",
          title: "Implement",
          instructions: "Implement the change",
          capabilityRequirements: ["implementation", "testing"],
          dependencyKeys: [],
          declaredFileScope: ["app"],
        },
        {
          key: "review",
          title: "Review",
          instructions: "Review the implementation",
          capabilityRequirements: ["review"],
          dependencyKeys: ["implementation"],
          declaredFileScope: ["test"],
        },
      ],
      baseHead: "base",
      idempotencyKey: `plan:${task.taskKey}`,
    });
    const duplicate = await store.persistAssignmentPlan(task.taskKey, task.revision, {
      successCriteria: ["Both assignments verify"],
      verificationCriteria: ["git diff --check"],
      source: "model",
      assignments: [],
      baseHead: "base",
      idempotencyKey: `plan:${task.taskKey}`,
    });

    expect(planned.task.revision).toBe(1);
    expect(duplicate.assignments.map((assignment) => assignment.assignmentKey))
      .toEqual(planned.assignments.map((assignment) => assignment.assignmentKey));
    expect(planned.assignments).toHaveLength(2);
    expect(planned.task.successCriteria).toEqual(["Both assignments verify"]);

    const grant = await store.approveGrant(task.taskKey, planned.task.revision, {
      repositoryRoots: [projectRoot],
      worktreePaths: [`${projectRoot}/managed-worktrees`],
      workerAdapters: ["codex", "opencode"],
      fileOperations: ["read", "write"],
      commandClasses: ["test", "git_status"],
      verificationCommands: ["git diff --check"],
      renewalRequiredActions: ["deploy"],
      maxConcurrency: 1,
      budget: { max_worker_runs: 3, max_runtime_minutes: 90 },
      providerIdentity: "codex:local,opencode:local",
      expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: `plan-grant:${task.taskKey}`,
    });
    const first = await store.createWorker({
      taskKey: task.taskKey,
      grantKey: grant.grantKey,
      assignmentKey: planned.assignments[0].assignmentKey,
      adapter: "codex",
      capabilities: ["implementation", "testing"],
      executablePath: "/bin/codex",
      executableVersion: "codex-cli 0.144.2",
      workingDirectory: `${projectRoot}/managed-worktrees/implementation`,
      idempotencyKey: `plan-worker-1:${task.taskKey}`,
    });
    expect(first.taskAssignmentId).toBe(planned.assignments[0].id);
    await expect(store.createWorker({
      taskKey: task.taskKey,
      grantKey: grant.grantKey,
      assignmentKey: planned.assignments[1].assignmentKey,
      adapter: "opencode",
      capabilities: ["review"],
      executablePath: "/bin/opencode",
      executableVersion: "1.17.18",
      workingDirectory: projectRoot,
      idempotencyKey: `plan-worker-2:${task.taskKey}`,
    })).rejects.toThrow("maximum concurrency");
  });

  it("requires every planned assignment to be integrated before task completion", async () => {
    const task = await store.createTask({
      projectName: "runtime-test",
      projectRoot,
      intendedOutcome: "Integrate the complete plan",
      repository: { root: projectRoot, name: "runtime-test", remote: null, branch: "main", head: "base", dirty: false, statusLines: [], statusDigest: "clean" },
      idempotencyKey: `integrated-task:${projectRoot}`,
    });
    const planned = await store.persistAssignmentPlan(task.taskKey, task.revision, {
      successCriteria: ["Both assignments integrated"],
      verificationCriteria: ["git diff --check"],
      source: "model",
      assignments: [
        { key: "one", title: "One", instructions: "One", capabilityRequirements: ["implementation"], dependencyKeys: [], declaredFileScope: ["one.txt"] },
        { key: "two", title: "Two", instructions: "Two", capabilityRequirements: ["testing"], dependencyKeys: [], declaredFileScope: ["two.txt"] },
      ],
      baseHead: "base",
      idempotencyKey: `integrated-plan:${task.taskKey}`,
    });
    const grant = await store.approveGrant(task.taskKey, planned.task.revision, {
      repositoryRoots: [projectRoot], worktreePaths: [projectRoot], workerAdapters: ["codex"],
      fileOperations: ["read", "write"], commandClasses: ["test"],
      verificationCommands: ["git diff --check"], renewalRequiredActions: ["deploy"],
      maxConcurrency: 2, budget: { max_worker_runs: 2, max_runtime_minutes: 90 },
      providerIdentity: "codex:local", expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: `integrated-grant:${task.taskKey}`,
    });
    for (const [index, item] of planned.assignments.entries()) {
      const created = await store.createWorker({
        taskKey: task.taskKey, grantKey: grant.grantKey, assignmentKey: item.assignmentKey,
        adapter: "codex", capabilities: item.capabilityRequirements, executablePath: "/bin/codex",
        executableVersion: "codex-cli 0.144.2", workingDirectory: projectRoot,
        idempotencyKey: `integrated-worker:${item.assignmentKey}`,
      });
      await store.transitionWorker(created.workerKey, {
        status: "running", processId: process.pid,
        idempotencyKey: `integrated-worker-running:${item.assignmentKey}`,
      });
      await store.transitionWorker(created.workerKey, {
        status: "completed", exitStatus: 0, output: "done",
        idempotencyKey: `integrated-worker-done:${item.assignmentKey}`,
      });
      await store.recordAssignmentVerification(item.assignmentKey, {
        status: "verified", result: { passed: true },
        artifacts: index === 0 ? [{
          kind: "diff",
          title: "Verified patch",
          mediaType: "text/x-diff",
          byteSize: 7,
          sha256Digest: "a".repeat(64),
          verificationStatus: "verified",
          content: "patch\\n",
          repositoryHead: "base",
          provenance: { assignment_key: item.assignmentKey },
        }] : [],
        idempotencyKey: `integrated-verified:${item.assignmentKey}`,
      });
    }
    const beforeIntegration = await store.findTask(task.taskKey);
    await expect(store.completeTask(task.taskKey, beforeIntegration!.revision, {
      summary: "Too early", verification: { confirmed_by: "user" },
      repositorySnapshot: { head: "result", status_digest: "changed" },
      idempotencyKey: `integrated-premature:${task.taskKey}`,
    })).rejects.toThrow(/assignments.*integrated/i);

    await store.recordTaskIntegration(task.taskKey, {
      result: { status: "integrated", reason: null, changedFiles: ["one.txt", "two.txt"], patchDigest: "digest" },
      idempotencyKey: `integrated-result:${task.taskKey}`,
    });
    const assignments = await store.listAssignments(task.id);
    expect(assignments.map((item) => item.status)).toEqual(["integrated", "integrated"]);
    expect(await store.listArtifacts(task.id)).toEqual([
      expect.objectContaining({
        kind: "diff",
        content: "patch\\n",
        verificationStatus: "verified",
        taskAssignmentId: planned.assignments[0].id,
      }),
    ]);
    const ready = await store.findTask(task.taskKey);
    const completed = await store.completeTask(task.taskKey, ready!.revision, {
      summary: "Integrated", verification: { confirmed_by: "user" },
      repositorySnapshot: { head: "result", status_digest: "changed" },
      idempotencyKey: `integrated-complete:${task.taskKey}`,
    });
    expect(completed.status).toBe("completed");
    expect(await store.metrics(projectRoot)).toMatchObject({
      routedAssignments: 2,
      codexAssignments: 2,
      openCodeAssignments: 0,
      acceptedInterventions: 0,
      stopControls: 0,
      retryControls: 0,
      redirectControls: 0,
      replaceControls: 0,
      integrationConflicts: 0,
      permissionRenewals: 0,
      verifiedIntegrations: 1,
      manualContextTransfers: 0,
    });
  });

  it("journals worker controls idempotently and revises the assignment", async () => {
    const task = await store.createTask({
      projectName: "runtime-test",
      projectRoot,
      intendedOutcome: "Redirect a worker",
      repository: { root: projectRoot, name: "runtime-test", remote: null, branch: "main", head: "base", dirty: false, statusLines: [], statusDigest: "clean" },
      idempotencyKey: `control-task:${projectRoot}`,
    });
    const planned = await store.persistAssignmentPlan(task.taskKey, task.revision, {
      successCriteria: ["Redirect is durable"],
      verificationCriteria: ["git diff --check"],
      source: "fallback",
      assignments: [{
        key: "primary",
        title: "Primary",
        instructions: "Initial instruction",
        capabilityRequirements: ["implementation"],
        dependencyKeys: [],
        declaredFileScope: ["."],
      }],
      baseHead: "base",
      idempotencyKey: `control-plan:${task.taskKey}`,
    });
    const grant = await store.approveGrant(task.taskKey, planned.task.revision, {
      repositoryRoots: [projectRoot], worktreePaths: [], workerAdapters: ["codex", "opencode"],
      fileOperations: ["read", "write"], commandClasses: ["test"],
      verificationCommands: ["git diff --check"], renewalRequiredActions: ["deploy"],
      maxConcurrency: 1, budget: { max_worker_runs: 3, max_runtime_minutes: 90 },
      providerIdentity: "codex:local,opencode:local", expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: `control-grant:${task.taskKey}`,
    });
    const worker = await store.createWorker({
      taskKey: task.taskKey,
      grantKey: grant.grantKey,
      assignmentKey: planned.assignments[0].assignmentKey,
      adapter: "codex",
      capabilities: ["implementation"],
      executablePath: "/bin/codex",
      executableVersion: "codex-cli 0.144.2",
      workingDirectory: projectRoot,
      idempotencyKey: `control-worker:${task.taskKey}`,
    });
    await store.transitionWorker(worker.workerKey, {
      status: "running",
      processId: process.pid,
      idempotencyKey: `control-running:${task.taskKey}`,
    });
    const currentBeforeControl = await store.findTask(task.taskKey);
    await expect(store.queueWorkerCommand(
      worker.workerKey,
      "redirect",
      { instruction: "Stale request" },
      `stale-redirect:${worker.workerKey}`,
      currentBeforeControl!.revision - 1,
    )).rejects.toThrow(/revision/i);

    const [first, duplicate] = await Promise.all([
      store.queueWorkerCommand(
        worker.workerKey,
        "redirect",
        { instruction: "Focus on the failing store test" },
        `redirect:${worker.workerKey}`,
      ),
      store.queueWorkerCommand(
        worker.workerKey,
        "redirect",
        { instruction: "Focus on the failing store test" },
        `redirect:${worker.workerKey}`,
      ),
    ]);
    expect(duplicate.command.commandKey).toBe(first.command.commandKey);
    expect(first.worker.status).toBe("stopping");
    expect((await store.liveWorkers(projectRoot)).map((item) => item.workerKey)).toContain(worker.workerKey);
    expect((await store.listWorkers(task.id))[0]).toMatchObject({
      workerKey: worker.workerKey,
      assignmentRevision: 2,
      pendingControl: "redirect",
      lastObservedAt: expect.any(String),
    });

    await store.completeWorkerCommand(first.command.commandKey, {
      workerStatus: "interrupted",
    });
    const afterLateExit = await store.transitionWorker(worker.workerKey, {
      status: "failed",
      exitStatus: 1,
      error: "Process exited after redirect",
      idempotencyKey: `late-exit:${worker.workerKey}`,
    });
    expect(afterLateExit).toMatchObject({
      workerKey: worker.workerKey,
      status: "interrupted",
      stopReason: "redirect",
    });
    const completedEvent = await pool.query(
      "SELECT payload FROM runtime_events WHERE agent_task_id = $1 AND event_type = 'worker.command_completed' ORDER BY task_revision DESC LIMIT 1",
      [task.id],
    );
    expect(completedEvent.rows[0].payload.worker_key).toBe(worker.workerKey);
    const assignments = await store.listAssignments(task.id);
    expect(assignments[0]).toMatchObject({
      status: "pending",
      instructions: "Focus on the failing store test",
      revision: 2,
    });

    const replacement = await store.queueWorkerCommand(
      worker.workerKey,
      "replace",
      {},
      `replace:${worker.workerKey}`,
    );
    await store.completeWorkerCommand(replacement.command.commandKey, { workerStatus: null });
    expect((await store.listAssignments(task.id))[0].excludedAdapters).toContain("codex");

    const retry = await store.queueWorkerCommand(
      worker.workerKey,
      "retry",
      {},
      `retry:${worker.workerKey}`,
    );
    const failed = await store.completeWorkerCommand(retry.command.commandKey, {
      workerStatus: null,
      error: "replacement unavailable",
    });
    const revisionAfterFailure = (await store.findTask(task.taskKey))!.revision;
    const failedEventsBeforeReplay = await pool.query(
      "SELECT COUNT(*)::int AS count FROM runtime_events WHERE agent_task_id = $1 AND event_type = 'worker.command_failed'",
      [task.id],
    );

    const replay = await store.completeWorkerCommand(retry.command.commandKey, {
      workerStatus: null,
      error: "replacement unavailable",
    });

    expect(failed.status).toBe("failed");
    expect(replay.status).toBe("failed");
    expect((await store.findTask(task.taskKey))!.revision).toBe(revisionAfterFailure);
    const failedEventsAfterReplay = await pool.query(
      "SELECT COUNT(*)::int AS count FROM runtime_events WHERE agent_task_id = $1 AND event_type = 'worker.command_failed'",
      [task.id],
    );
    expect(failedEventsAfterReplay.rows[0].count).toBe(failedEventsBeforeReplay.rows[0].count);
  });

  it("keeps a task running while another assignment worker remains live", async () => {
    const task = await store.createTask({
      projectName: "runtime-test",
      projectRoot,
      intendedOutcome: "Keep concurrent task state truthful",
      repository: { root: projectRoot, name: "runtime-test", remote: null, branch: "main", head: "base", dirty: false, statusLines: [], statusDigest: "clean" },
      idempotencyKey: `parallel-control-task:${projectRoot}`,
    });
    const planned = await store.persistAssignmentPlan(task.taskKey, task.revision, {
      successCriteria: ["Both workers settle"],
      verificationCriteria: ["git diff --check"],
      source: "fallback",
      assignments: [
        {
          key: "one", title: "One", instructions: "One", capabilityRequirements: ["implementation"],
          dependencyKeys: [], declaredFileScope: ["one.txt"],
        },
        {
          key: "two", title: "Two", instructions: "Two", capabilityRequirements: ["testing"],
          dependencyKeys: [], declaredFileScope: ["two.txt"],
        },
      ],
      baseHead: "base",
      idempotencyKey: `parallel-control-plan:${task.taskKey}`,
    });
    const grant = await store.approveGrant(task.taskKey, planned.task.revision, {
      repositoryRoots: [projectRoot], worktreePaths: [], workerAdapters: ["codex"],
      fileOperations: ["read", "write"], commandClasses: ["test"],
      verificationCommands: ["git diff --check"], renewalRequiredActions: ["deploy"],
      maxConcurrency: 2, budget: { max_worker_runs: 3, max_runtime_minutes: 90 },
      providerIdentity: "codex:local", expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: `parallel-control-grant:${task.taskKey}`,
    });
    const workers: WorkerSession[] = [];
    for (const assignment of planned.assignments) {
      const created = await store.createWorker({
        taskKey: task.taskKey, grantKey: grant.grantKey, assignmentKey: assignment.assignmentKey,
        adapter: "codex", capabilities: assignment.capabilityRequirements, executablePath: "/bin/codex",
        executableVersion: "codex-cli 0.144.2", workingDirectory: projectRoot,
        idempotencyKey: `parallel-control-worker:${assignment.assignmentKey}`,
      });
      workers.push(await store.transitionWorker(created.workerKey, {
        status: "running", processId: process.pid,
        idempotencyKey: `parallel-control-running:${assignment.assignmentKey}`,
      }));
    }
    const revisionBeforeObservation = (await store.findTask(task.taskKey))!.revision;
    const listener = await pool.connect();
    await listener.query("LISTEN flyd_runtime_events");
    const notification = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("worker observation notification timed out")), 2_000);
      listener.once("notification", (message) => {
        clearTimeout(timer);
        resolve(JSON.parse(message.payload ?? "{}"));
      });
    });
    try {
      await store.observeWorker(workers[1].workerKey);
      await expect(notification).resolves.toMatchObject({
        event_type: "worker.observed",
        task_key: task.taskKey,
        task_revision: revisionBeforeObservation,
      });
    } finally {
      await listener.query("UNLISTEN flyd_runtime_events");
      listener.release();
    }
    expect((await store.findTask(task.taskKey))!.revision).toBe(revisionBeforeObservation);
    expect((await store.listWorkers(task.id)).find((item) => item.workerKey === workers[1].workerKey)?.lastObservedAt)
      .toEqual(expect.any(String));

    const control = await store.queueWorkerCommand(
      workers[0].workerKey,
      "stop",
      {},
      `parallel-control-stop:${workers[0].workerKey}`,
    );
    await store.completeWorkerCommand(control.command.commandKey, { workerStatus: "stopped" });

    expect((await store.findTask(task.taskKey))!.status).toBe("running");
    expect((await store.listWorkers(task.id)).find((item) => item.workerKey === workers[1].workerKey)?.status)
      .toBe("running");
  });
});
