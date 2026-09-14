import type { Pool } from "pg";
import { OperationalDecisionStore } from "./operational-decision-store.js";
import { inspectRepository } from "./repository-inspector.js";
import { filesOutsideScope, verifyWorkerResult, type VerifiedWorkerResult } from "./result-verifier.js";
import { authorizesRuntimeIntegration, parseDeliveryContract } from "./delivery-contract.js";
import { integrateRepositoryGroups } from "./orchestrator.js";
import { PostgresTaskStore } from "./task-store.js";
import { GitWorktreeManager } from "./worktree-manager.js";
import type { RepositorySnapshot } from "./types.js";

interface DetachedAssignment {
  assignmentKey: string;
  repositoryRoot: string;
  baseHead: string;
  declaredFileScope: string[];
  worktreePath: string;
  workerKey: string;
  status: string;
}

interface DetachedTask {
  taskId: string;
  taskKey: string;
  projectRoot: string;
  contextSnapshot: Record<string, unknown> | null;
  recordedRepository: { head?: string; status_digest?: string };
  assignments: DetachedAssignment[];
  verificationCommands: string[];
}

function verificationPayload(result: VerifiedWorkerResult): Record<string, unknown> {
  return {
    passed: result.passed,
    base_head: result.baseHead,
    head: result.head,
    changed_files: result.changedFiles,
    patch_digest: result.patchDigest,
    commands: result.commands.map((command) => ({
      command: command.command,
      exit_status: command.exitStatus,
      output_digest: command.outputDigest,
    })),
  };
}

async function detachedTasks(pool: Pool, projectRoot: string): Promise<DetachedTask[]> {
  const tasks = await pool.query(`SELECT t.id, t.task_key, t.repository_snapshot, t.context_snapshot, p.root_path AS project_root,
      COALESCE(g.verification_commands, '[]'::jsonb) AS verification_commands
    FROM agent_tasks t
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN LATERAL (
      SELECT verification_commands FROM task_grants
      WHERE agent_task_id = t.id AND status IN ('approved','completed')
      ORDER BY approved_at DESC NULLS LAST, created_at DESC LIMIT 1
    ) g ON TRUE
    WHERE p.root_path = $1
      AND t.status IN ('ready','running','blocked')
      AND NOT EXISTS (
        SELECT 1 FROM worker_sessions live
        WHERE live.agent_task_id = t.id
          AND live.status IN ('queued','starting','running','stopping')
      )
      AND NOT EXISTS (
        SELECT 1 FROM runtime_events recovered
        WHERE recovered.agent_task_id = t.id
          AND (
            recovered.idempotency_key LIKE 'detached-integration:%'
            OR recovered.idempotency_key LIKE 'detached-integration-blocked:%'
          )
      )
      AND EXISTS (
        SELECT 1 FROM worker_sessions done
        WHERE done.agent_task_id = t.id AND done.status = 'completed' AND done.exit_status = 0
          AND done.ended_at <= NOW() - INTERVAL '10 seconds'
      )`, [projectRoot]);

  const out: DetachedTask[] = [];
  for (const task of tasks.rows) {
    const assignments = await pool.query(`SELECT a.assignment_key, a.repository_root, a.base_head,
        a.declared_file_scope, a.status,
        w.worker_key, w.working_directory, w.status AS worker_status, w.exit_status, w.ended_at
      FROM task_assignments a
      LEFT JOIN LATERAL (
        SELECT worker_key, working_directory, status, exit_status, ended_at
        FROM worker_sessions
        WHERE task_assignment_id = a.id
        ORDER BY created_at DESC, id DESC LIMIT 1
      ) w ON TRUE
      WHERE a.agent_task_id = $1 AND a.status IN ('running','verified')
      ORDER BY a.created_at, a.id`, [task.id]);

    if (assignments.rows.length === 0) continue;
    if (assignments.rows.some((row) =>
      !row.worker_key || !row.working_directory || !row.base_head ||
      row.worker_status !== "completed" || Number(row.exit_status) !== 0 ||
      !row.ended_at || Date.now() - new Date(row.ended_at).getTime() < 10_000
    )) continue;

    out.push({
      taskId: String(task.id),
      taskKey: task.task_key,
      projectRoot: task.project_root,
      contextSnapshot: (task.context_snapshot as Record<string, unknown> | null) ?? {},
      recordedRepository: task.repository_snapshot ?? {},
      verificationCommands: Array.isArray(task.verification_commands) ? task.verification_commands : [],
      assignments: assignments.rows.map((row) => ({
        assignmentKey: row.assignment_key,
        repositoryRoot: row.repository_root ?? task.project_root,
        baseHead: row.base_head,
        declaredFileScope: Array.isArray(row.declared_file_scope) ? row.declared_file_scope : [],
        worktreePath: row.working_directory,
        workerKey: row.worker_key,
        status: row.status,
      })),
    });
  }
  return out;
}

export interface DetachedFinalizationResult {
  taskKey: string;
  status: "integrated" | "blocked" | "skipped";
  reason?: string;
}

/**
 * Recover worker completions that outlived their original orchestrator.
 * Every assignment is independently re-verified. Before integration, each
 * source repository must still be clean on main at the assignment's recorded
 * base HEAD. This is conservative but gives multi-repository recovery the same
 * safety property as live orchestration without inventing historical state.
 */
export async function finalizeDetachedProject(
  pool: Pool,
  projectRoot: string,
  manager = new GitWorktreeManager(),
): Promise<DetachedFinalizationResult[]> {
  const store = new PostgresTaskStore(pool);
  const decisionStore = new OperationalDecisionStore(pool);
  const [candidates, openDecisionFacts] = await Promise.all([
    detachedTasks(pool, projectRoot),
    decisionStore.listOpenDecisionFacts(),
  ]);
  const openDecisionTaskIds = new Set(openDecisionFacts.map((fact) => fact.decision.taskId));
  const outcomes: DetachedFinalizationResult[] = [];

  for (const task of candidates) {
    if (openDecisionTaskIds.has(task.taskId)) {
      outcomes.push({ taskKey: task.taskKey, status: "skipped", reason: "An operational decision is open for this task" });
      continue;
    }

    if (task.verificationCommands.length === 0) {
      const reason = "Detached completion has no persisted verification commands";
      await store.recordTaskIntegration(task.taskKey, {
        result: { status: "blocked", reason, changedFiles: [], patchDigest: null },
        idempotencyKey: `detached-integration-blocked:${task.taskKey}:${reason}`,
      });
      outcomes.push({ taskKey: task.taskKey, status: "blocked", reason });
      continue;
    }

    const delivery = parseDeliveryContract(task.contextSnapshot?.delivery);
    if (!authorizesRuntimeIntegration(delivery)) {
      const reason = delivery
        ? `Task delivery contract does not authorize runtime integration (mode=${delivery.mode}, mergeAuthority=${delivery.mergeAuthority}); refusing to integrate`
        : "Task has no delivery contract; refusing to guess how its work ships or who may merge it";
      await store.recordTaskIntegration(task.taskKey, {
        result: { status: "blocked", reason, changedFiles: [], patchDigest: null },
        idempotencyKey: `detached-integration-blocked:${task.taskKey}:${reason}`,
      });
      outcomes.push({ taskKey: task.taskKey, status: "blocked", reason });
      continue;
    }

    const verified = new Map<string, VerifiedWorkerResult>();
    let blockedReason: string | null = null;

    for (const assignment of task.assignments) {
      let result: VerifiedWorkerResult;
      try {
        result = await verifyWorkerResult({
          worktreePath: assignment.worktreePath,
          baseHead: assignment.baseHead,
          commands: task.verificationCommands,
          invocationId: `detached:${task.taskKey}:${assignment.assignmentKey}`,
        });
      } catch (error) {
        blockedReason = error instanceof Error ? error.message : String(error);
        break;
      }

      const escaped = filesOutsideScope(result.changedFiles, assignment.declaredFileScope);
      const passed = result.passed && escaped.length === 0;
      await store.recordAssignmentVerification(assignment.assignmentKey, {
        status: passed ? "verified" : "failed",
        result: {
          ...verificationPayload(result),
          ...(escaped.length > 0 ? { files_outside_scope: escaped } : {}),
          recovered_detached_completion: true,
        },
        idempotencyKey: `detached-verify:${assignment.workerKey}:${result.patchDigest}`,
      });

      if (!passed) {
        blockedReason = escaped.length > 0
          ? `Assignment changed files outside its declared scope: ${escaped.join(", ")}`
          : "Detached worker result failed independent verification";
        break;
      }
      verified.set(assignment.assignmentKey, result);
    }

    if (verified.size !== task.assignments.length && !blockedReason) {
      outcomes.push({ taskKey: task.taskKey, status: "skipped", reason: "Not every assignment has a recoverable completed worker" });
      continue;
    }

    const baseSnapshots = new Map<string, RepositorySnapshot>();
    if (!blockedReason) {
      for (const assignment of task.assignments) {
        if (baseSnapshots.has(assignment.repositoryRoot)) continue;
        const sameRepoAssignments = task.assignments.filter((item) => item.repositoryRoot === assignment.repositoryRoot);
        const heads = new Set(sameRepoAssignments.map((item) => item.baseHead));
        if (heads.size !== 1) {
          blockedReason = `Assignments for ${assignment.repositoryRoot} do not share one recorded base HEAD`;
          break;
        }
        const current = await inspectRepository(assignment.repositoryRoot);
        const expectedHead = assignment.baseHead;
        if (current.head !== expectedHead || current.dirty || current.branch !== "main") {
          blockedReason = `Source repository ${assignment.repositoryRoot} changed since assignment start; detached landing cannot be proven safe`;
          break;
        }
        baseSnapshots.set(assignment.repositoryRoot, current);
      }
    }

    if (blockedReason) {
      await store.recordTaskIntegration(task.taskKey, {
        result: { status: "blocked", reason: blockedReason, changedFiles: [], patchDigest: null },
        idempotencyKey: `detached-integration-blocked:${task.taskKey}:${blockedReason}`,
      });
      outcomes.push({ taskKey: task.taskKey, status: "blocked", reason: blockedReason });
      continue;
    }

    const groups = new Map<string, VerifiedWorkerResult[]>();
    for (const assignment of task.assignments) {
      const list = groups.get(assignment.repositoryRoot) ?? [];
      list.push(verified.get(assignment.assignmentKey)!);
      groups.set(assignment.repositoryRoot, list);
    }

    const integration = await integrateRepositoryGroups({
      groups: [...groups].map(([repositoryRoot, results]) => ({
        repositoryRoot,
        results,
        verificationCommands: task.verificationCommands,
      })),
      taskKey: task.taskKey,
      primaryRepositoryRoot: task.projectRoot,
      repositorySnapshots: baseSnapshots,
      manager,
    });

    await store.recordTaskIntegration(task.taskKey, {
      result: integration,
      idempotencyKey: `detached-integration:${task.taskKey}:${integration.patchDigest ?? integration.reason ?? integration.status}`,
    });
    outcomes.push({ taskKey: task.taskKey, status: integration.status, reason: integration.reason ?? undefined });
  }

  return outcomes;
}
