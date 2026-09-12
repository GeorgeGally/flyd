import type { Pool } from "pg";
import { inspectRepository } from "./repository-inspector.js";
import { filesOutsideScope, verifyWorkerResult, type VerifiedWorkerResult } from "./result-verifier.js";
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

/**
 * Find tasks whose workers completed successfully while no orchestrator owns
 * the completion anymore. A short grace period lets the normal orchestrator
 * finish first; this path is recovery, not a competitor to the live runner.
 */
async function detachedTasks(pool: Pool, projectRoot: string): Promise<DetachedTask[]> {
  const tasks = await pool.query(`SELECT t.id, t.task_key, p.root_path AS project_root,
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
      AND EXISTS (
        SELECT 1 FROM worker_sessions done
        WHERE done.agent_task_id = t.id AND done.status = 'completed' AND done.exit_status = 0
          AND done.ended_at <= NOW() - INTERVAL '10 seconds'
      )`, [projectRoot]);

  const out: DetachedTask[] = [];
  for (const task of tasks.rows) {
    const assignments = await pool.query(`SELECT a.assignment_key, a.repository_root, a.base_head,
        a.declared_file_scope, a.status,
        w.worker_key, w.working_directory
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
    if (assignments.rows.some((row) => !row.worker_key || !row.working_directory || !row.base_head)) continue;

    out.push({
      taskId: String(task.id),
      taskKey: task.task_key,
      projectRoot: task.project_root,
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

export async function finalizeDetachedProject(
  pool: Pool,
  projectRoot: string,
  manager = new GitWorktreeManager(),
): Promise<DetachedFinalizationResult[]> {
  const store = new PostgresTaskStore(pool);
  const candidates = await detachedTasks(pool, projectRoot);
  const outcomes: DetachedFinalizationResult[] = [];

  for (const task of candidates) {
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

    if (blockedReason) {
      await store.recordTaskIntegration(task.taskKey, {
        result: { status: "blocked", reason: blockedReason, changedFiles: [], patchDigest: null },
        idempotencyKey: `detached-integration-blocked:${task.taskKey}:${blockedReason}`,
      });
      outcomes.push({ taskKey: task.taskKey, status: "blocked", reason: blockedReason });
      continue;
    }

    if (verified.size !== task.assignments.length) {
      outcomes.push({ taskKey: task.taskKey, status: "skipped", reason: "Not every assignment has a recoverable completed worker" });
      continue;
    }

    const groups = new Map<string, VerifiedWorkerResult[]>();
    for (const assignment of task.assignments) {
      const list = groups.get(assignment.repositoryRoot) ?? [];
      list.push(verified.get(assignment.assignmentKey)!);
      groups.set(assignment.repositoryRoot, list);
    }

    const repositorySnapshots = new Map<string, RepositorySnapshot>();
    for (const [root] of groups) repositorySnapshots.set(root, await inspectRepository(root));

    const integration = await integrateRepositoryGroups({
      groups: [...groups].map(([repositoryRoot, results]) => ({
        repositoryRoot,
        results,
        verificationCommands: task.verificationCommands,
      })),
      taskKey: task.taskKey,
      primaryRepositoryRoot: task.projectRoot,
      repositorySnapshots,
      manager,
    });

    await store.recordTaskIntegration(task.taskKey, {
      result: integration,
      idempotencyKey: `detached-integration:${task.taskKey}:${integration.patchDigest ?? integration.reason ?? integration.status}`,
    });
    outcomes.push({
      taskKey: task.taskKey,
      status: integration.status,
      reason: integration.reason ?? undefined,
    });
  }

  return outcomes;
}
