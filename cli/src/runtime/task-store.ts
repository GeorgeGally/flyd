import { createHash, randomUUID } from "crypto";
import { isAbsolute, relative, resolve } from "path";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { withTransaction } from "./database.js";
import { fiveWorkingDayWindowStart } from "./metrics.js";
import type {
  AgentTask,
  ArchiveRuntimeEvent,
  RepositorySnapshot,
  RuntimeMetrics,
  TaskAssignment,
  TaskGrant,
  WorkerCommand,
  WorkerCommandKind,
  WorkerSession,
} from "./types.js";

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function mapTask(row: QueryResultRow): AgentTask {
  return {
    id: String(row.id), taskKey: row.task_key, projectId: String(row.project_id), projectName: row.project_name,
    projectRoot: row.project_root, status: row.status, intendedOutcome: row.intended_outcome,
    successCriteria: row.success_criteria ?? [], verificationCriteria: row.verification_criteria ?? [],
    plan: row.plan ?? {},
    contextSnapshot: row.context_snapshot ?? {}, repositorySnapshot: row.repository_snapshot ?? {},
    recommendedNextAction: row.recommended_next_action, outcomeSummary: row.outcome_summary,
    verificationResult: row.verification_result ?? {}, revision: Number(row.revision),
    startedAt: iso(row.started_at)!, completedAt: iso(row.completed_at), updatedAt: iso(row.updated_at)!,
  };
}

function mapAssignment(row: QueryResultRow): TaskAssignment {
  return {
    id: String(row.id), assignmentKey: row.assignment_key, agentTaskId: String(row.agent_task_id),
    status: row.status, title: row.title, instructions: row.instructions,
    successCriteria: row.success_criteria ?? [], capabilityRequirements: row.capability_requirements ?? [],
    dependencyKeys: row.dependency_keys ?? [], declaredFileScope: row.declared_file_scope ?? [],
    excludedAdapters: row.excluded_adapters ?? [], worktreePath: row.worktree_path, branchName: row.branch_name,
    baseHead: row.base_head, verificationResult: row.verification_result ?? {},
    integrationResult: row.integration_result ?? {}, revision: Number(row.revision),
  };
}

function mapGrant(row: QueryResultRow): TaskGrant {
  return {
    id: String(row.id), grantKey: row.grant_key, agentTaskId: String(row.agent_task_id), status: row.status,
    scopeDigest: row.scope_digest, repositoryRoots: row.repository_roots ?? [], worktreePaths: row.worktree_paths ?? [],
    workerAdapters: row.worker_adapters ?? [], fileOperations: row.file_operations ?? [], commandClasses: row.command_classes ?? [],
    verificationCommands: row.verification_commands ?? [], renewalRequiredActions: row.renewal_required_actions ?? [],
    maxConcurrency: Number(row.max_concurrency), budget: row.budget ?? {}, providerIdentity: row.provider_identity,
    approvedAt: iso(row.approved_at), expiresAt: iso(row.expires_at),
  };
}

function mapWorker(row: QueryResultRow): WorkerSession {
  return {
    id: String(row.id), workerKey: row.worker_key, agentTaskId: String(row.agent_task_id), taskGrantId: String(row.task_grant_id),
    taskAssignmentId: String(row.task_assignment_id), status: row.status, adapter: row.adapter,
    capabilities: row.capabilities ?? [], executablePath: row.executable_path, executableVersion: row.executable_version,
    workingDirectory: row.working_directory, externalSessionId: row.external_session_id,
    processId: row.process_id == null ? null : Number(row.process_id), processIdentity: row.process_identity,
    errorSummary: row.error_summary, output: row.output,
    exitStatus: row.exit_status == null ? null : Number(row.exit_status), startedAt: iso(row.started_at), endedAt: iso(row.ended_at),
    lastObservedAt: iso(row.last_observed_at ?? row.last_heartbeat_at), stopReason: row.stop_reason,
    assignmentRevision: row.assignment_revision_current == null
      ? Number(row.assignment_revision)
      : Number(row.assignment_revision_current),
    pendingControl: row.pending_control ?? null,
  };
}

function mapWorkerCommand(row: QueryResultRow): WorkerCommand {
  return {
    id: String(row.id), commandKey: row.command_key, agentTaskId: String(row.agent_task_id),
    workerSessionId: String(row.worker_session_id), kind: row.kind, status: row.status,
    idempotencyKey: row.idempotency_key, payload: row.payload ?? {},
    dispatchedAt: iso(row.dispatched_at), completedAt: iso(row.completed_at),
    errorSummary: row.error_summary,
  };
}

const TASK_SELECT = `SELECT t.*, p.name AS project_name, p.root_path AS project_root
  FROM agent_tasks t JOIN projects p ON p.id = t.project_id`;

export class RevisionConflictError extends Error {}

export class PostgresTaskStore {
  constructor(private readonly pool: Pool) {}

  async findResumableTask(projectRoot: string): Promise<AgentTask | null> {
    const result = await this.pool.query(`${TASK_SELECT} WHERE p.root_path = $1 AND t.status IN ('awaiting_grant','ready','running','blocked') ORDER BY t.updated_at DESC LIMIT 1`, [projectRoot]);
    return result.rows[0] ? mapTask(result.rows[0]) : null;
  }

  async findTask(taskKey: string): Promise<AgentTask | null> {
    const result = await this.pool.query(`${TASK_SELECT} WHERE t.task_key = $1 LIMIT 1`, [taskKey]);
    return result.rows[0] ? mapTask(result.rows[0]) : null;
  }

  async listTasks(projectRoot?: string, limit = 20): Promise<AgentTask[]> {
    const where = projectRoot ? "WHERE p.root_path = $1" : "";
    const values = projectRoot ? [projectRoot, limit] : [limit];
    const limitParameter = projectRoot ? "$2" : "$1";
    const result = await this.pool.query(
      `${TASK_SELECT} ${where} ORDER BY t.updated_at DESC LIMIT ${limitParameter}`,
      values,
    );
    return result.rows.map(mapTask);
  }

  async metrics(projectRoot: string, since = fiveWorkingDayWindowStart(new Date())): Promise<RuntimeMetrics> {
    const values = [projectRoot, since.toISOString()];
    const [tasks, sessions, assignments, controls, events] = await Promise.all([
      this.pool.query(`SELECT COUNT(*)::int AS tasks,
        COUNT(*) FILTER (WHERE t.status = 'completed' AND t.verification_result <> '{}'::jsonb)::int AS completed_tasks
        FROM agent_tasks t JOIN projects p ON p.id = t.project_id
        WHERE p.root_path = $1 AND t.started_at >= $2
          AND EXISTS (SELECT 1 FROM worker_sessions w WHERE w.agent_task_id = t.id)`, values),
      this.pool.query(`SELECT COUNT(*)::int AS sessions,
        COUNT(*) FILTER (WHERE s.resumed)::int AS resumed_sessions,
        COUNT(*) FILTER (WHERE s.resumed AND NOT s.manual_context_restatement)::int AS resumed_without_restatement,
        COUNT(*) FILTER (WHERE s.interpretation_status = 'accepted')::int AS accepted_interpretations,
        COUNT(*) FILTER (WHERE s.interpretation_status = 'focused_corrected')::int AS corrected_interpretations,
        COUNT(*) FILTER (WHERE s.interpretation_status = 'replaced')::int AS replaced_interpretations,
        COUNT(*) FILTER (WHERE s.manual_context_restatement)::int AS manual_context_restatements,
        COUNT(*) FILTER (WHERE s.tool_escape)::int AS tool_escapes
        FROM task_sessions s
        JOIN agent_tasks t ON t.id = s.agent_task_id
        JOIN projects p ON p.id = t.project_id
        WHERE p.root_path = $1 AND s.started_at >= $2
          AND EXISTS (SELECT 1 FROM worker_sessions w WHERE w.agent_task_id = t.id)`, values),
      this.pool.query(`SELECT COUNT(*)::int AS routed_assignments,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM worker_sessions w WHERE w.task_assignment_id = a.id AND w.adapter = 'codex'
        ))::int AS codex_assignments,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM worker_sessions w WHERE w.task_assignment_id = a.id AND w.adapter = 'opencode'
        ))::int AS opencode_assignments
        FROM task_assignments a
        JOIN agent_tasks t ON t.id = a.agent_task_id
        JOIN projects p ON p.id = t.project_id
        WHERE p.root_path = $1 AND a.created_at >= $2
          AND EXISTS (SELECT 1 FROM worker_sessions w WHERE w.task_assignment_id = a.id)`, values),
      this.pool.query(`SELECT
        COUNT(*) FILTER (WHERE c.status = 'completed' AND c.payload ? 'evidence_digest'
          AND a.status = 'integrated')::int AS accepted_interventions,
        COUNT(*) FILTER (WHERE c.kind = 'stop')::int AS stop_controls,
        COUNT(*) FILTER (WHERE c.kind = 'retry')::int AS retry_controls,
        COUNT(*) FILTER (WHERE c.kind = 'redirect')::int AS redirect_controls,
        COUNT(*) FILTER (WHERE c.kind = 'replace')::int AS replace_controls
        FROM worker_commands c
        JOIN worker_sessions w ON w.id = c.worker_session_id
        JOIN task_assignments a ON a.id = w.task_assignment_id
        JOIN agent_tasks t ON t.id = c.agent_task_id
        JOIN projects p ON p.id = t.project_id
        WHERE p.root_path = $1 AND c.created_at >= $2`, values),
      this.pool.query(`SELECT
        COUNT(*) FILTER (WHERE e.event_type = 'task.integration_blocked')::int AS integration_conflicts,
        COUNT(*) FILTER (WHERE e.event_type = 'grant.revoked')::int AS permission_renewals,
        COUNT(*) FILTER (WHERE e.event_type = 'task.integration_integrated')::int AS verified_integrations
        FROM runtime_events e
        JOIN agent_tasks t ON t.id = e.agent_task_id
        JOIN projects p ON p.id = t.project_id
        WHERE p.root_path = $1 AND e.occurred_at >= $2`, values),
    ]);
    return {
      windowStartedAt: since.toISOString(),
      tasks: Number(tasks.rows[0].tasks),
      completedTasks: Number(tasks.rows[0].completed_tasks),
      sessions: Number(sessions.rows[0].sessions),
      resumedSessions: Number(sessions.rows[0].resumed_sessions),
      resumedWithoutRestatement: Number(sessions.rows[0].resumed_without_restatement),
      acceptedInterpretations: Number(sessions.rows[0].accepted_interpretations),
      correctedInterpretations: Number(sessions.rows[0].corrected_interpretations),
      replacedInterpretations: Number(sessions.rows[0].replaced_interpretations),
      manualContextRestatements: Number(sessions.rows[0].manual_context_restatements),
      toolEscapes: Number(sessions.rows[0].tool_escapes),
      routedAssignments: Number(assignments.rows[0].routed_assignments),
      codexAssignments: Number(assignments.rows[0].codex_assignments),
      openCodeAssignments: Number(assignments.rows[0].opencode_assignments),
      acceptedInterventions: Number(controls.rows[0].accepted_interventions),
      stopControls: Number(controls.rows[0].stop_controls),
      retryControls: Number(controls.rows[0].retry_controls),
      redirectControls: Number(controls.rows[0].redirect_controls),
      replaceControls: Number(controls.rows[0].replace_controls),
      integrationConflicts: Number(events.rows[0].integration_conflicts),
      permissionRenewals: Number(events.rows[0].permission_renewals),
      verifiedIntegrations: Number(events.rows[0].verified_integrations),
      manualContextTransfers: Number(sessions.rows[0].manual_context_restatements),
    };
  }

  async latestWorker(taskId: string): Promise<WorkerSession | null> {
    const result = await this.pool.query("SELECT * FROM worker_sessions WHERE agent_task_id = $1 ORDER BY created_at DESC LIMIT 1", [taskId]);
    return result.rows[0] ? mapWorker(result.rows[0]) : null;
  }

  async findWorker(workerKey: string): Promise<WorkerSession | null> {
    const result = await this.pool.query("SELECT * FROM worker_sessions WHERE worker_key = $1", [workerKey]);
    return result.rows[0] ? mapWorker(result.rows[0]) : null;
  }

  async listWorkers(taskId: string): Promise<WorkerSession[]> {
    const result = await this.pool.query(
      `SELECT w.*, a.revision AS assignment_revision_current,
        (SELECT c.kind FROM worker_commands c
          WHERE c.worker_session_id = w.id AND c.status IN ('queued','dispatched')
          ORDER BY c.created_at DESC LIMIT 1) AS pending_control
        FROM worker_sessions w
        JOIN task_assignments a ON a.id = w.task_assignment_id
        WHERE w.agent_task_id = $1 ORDER BY w.created_at, w.id`,
      [taskId],
    );
    return result.rows.map(mapWorker);
  }

  async liveWorkers(projectRoot: string): Promise<WorkerSession[]> {
    const result = await this.pool.query(`SELECT w.* FROM worker_sessions w
      JOIN agent_tasks t ON t.id = w.agent_task_id
      JOIN projects p ON p.id = t.project_id
      WHERE p.root_path = $1 AND w.status IN ('queued','starting','running','stopping')
      ORDER BY w.created_at`, [projectRoot]);
    return result.rows.map(mapWorker);
  }

  async approvedGrant(taskId: string): Promise<TaskGrant | null> {
    const result = await this.pool.query(
      `SELECT * FROM task_grants WHERE agent_task_id = $1 AND status = 'approved'
       AND expires_at > NOW() ORDER BY approved_at DESC LIMIT 1`,
      [taskId],
    );
    return result.rows[0] ? mapGrant(result.rows[0]) : null;
  }

  async revokeGrant(taskKey: string, expectedRevision: number, grantKey: string, input: {
    reason: string;
    idempotencyKey: string;
  }): Promise<AgentTask> {
    return this.mutateTask(taskKey, expectedRevision, input.idempotencyKey, "grant.revoked", async (client, row, revision) => {
      const grant = await client.query(
        "SELECT * FROM task_grants WHERE agent_task_id = $1 AND grant_key = $2 AND status = 'approved' FOR UPDATE",
        [row.id, grantKey],
      );
      if (!grant.rows[0]) throw new Error(`Approved grant ${grantKey} is not available for renewal`);
      await client.query(
        "UPDATE task_grants SET status = 'revoked', ended_at = NOW(), updated_at = NOW() WHERE id = $1",
        [grant.rows[0].id],
      );
      await client.query(
        "UPDATE agent_tasks SET status = 'awaiting_grant', recommended_next_action = $1, revision = $2, updated_at = NOW() WHERE id = $3",
        [input.reason, revision, row.id],
      );
      return { grant_key: grantKey, reason: input.reason };
    });
  }

  async listAssignments(taskId: string): Promise<TaskAssignment[]> {
    const result = await this.pool.query(
      "SELECT * FROM task_assignments WHERE agent_task_id = $1 ORDER BY created_at, id",
      [taskId],
    );
    return result.rows.map(mapAssignment);
  }

  async updateAssignmentWorkspace(assignmentKey: string, input: {
    worktreePath: string;
    branchName: string;
    baseHead: string;
    idempotencyKey: string;
  }): Promise<TaskAssignment> {
    return withTransaction(this.pool, async (client) => {
      const duplicate = await client.query(
        "SELECT a.* FROM task_assignments a JOIN runtime_events e ON e.agent_task_id = a.agent_task_id WHERE a.assignment_key = $1 AND e.idempotency_key = $2 LIMIT 1",
        [assignmentKey, input.idempotencyKey],
      );
      if (duplicate.rows[0]) return mapAssignment(duplicate.rows[0]);
      const result = await client.query(`SELECT a.*, t.revision AS task_revision
        FROM task_assignments a JOIN agent_tasks t ON t.id = a.agent_task_id
        WHERE a.assignment_key = $1 FOR UPDATE OF a, t`, [assignmentKey]);
      const assignment = result.rows[0];
      if (!assignment) throw new Error(`Unknown assignment ${assignmentKey}`);
      const updated = await client.query(`UPDATE task_assignments SET worktree_path = $2,
        branch_name = $3, base_head = $4, updated_at = NOW() WHERE id = $1 RETURNING *`, [
        assignment.id, input.worktreePath, input.branchName, input.baseHead,
      ]);
      const revision = Number(assignment.task_revision) + 1;
      await client.query("UPDATE agent_tasks SET revision = $1, updated_at = NOW() WHERE id = $2", [revision, assignment.agent_task_id]);
      await this.insertEvent(client, assignment.agent_task_id, revision, "assignment.workspace_prepared", input.idempotencyKey, {
        assignment_key: assignmentKey,
        worktree_path: input.worktreePath,
        branch_name: input.branchName,
        base_head: input.baseHead,
      });
      return mapAssignment(updated.rows[0]);
    });
  }

  async recordAssignmentVerification(assignmentKey: string, input: {
    status: "verified" | "failed" | "blocked";
    result: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<TaskAssignment> {
    return withTransaction(this.pool, async (client) => {
      const duplicate = await client.query(
        "SELECT a.* FROM task_assignments a JOIN runtime_events e ON e.agent_task_id = a.agent_task_id WHERE a.assignment_key = $1 AND e.idempotency_key = $2 LIMIT 1",
        [assignmentKey, input.idempotencyKey],
      );
      if (duplicate.rows[0]) return mapAssignment(duplicate.rows[0]);
      const result = await client.query(`SELECT a.*, t.revision AS task_revision
        FROM task_assignments a JOIN agent_tasks t ON t.id = a.agent_task_id
        WHERE a.assignment_key = $1 FOR UPDATE OF a, t`, [assignmentKey]);
      const assignment = result.rows[0];
      if (!assignment) throw new Error(`Unknown assignment ${assignmentKey}`);
      const updated = await client.query(`UPDATE task_assignments SET status = $2::varchar,
        verification_result = $3::jsonb, ended_at = CASE WHEN $2::varchar IN ('verified','failed') THEN NOW() ELSE ended_at END,
        updated_at = NOW() WHERE id = $1 RETURNING *`, [
        assignment.id, input.status, JSON.stringify(input.result),
      ]);
      const revision = Number(assignment.task_revision) + 1;
      await client.query("UPDATE agent_tasks SET revision = $1, updated_at = NOW() WHERE id = $2", [revision, assignment.agent_task_id]);
      await this.insertEvent(client, assignment.agent_task_id, revision, `assignment.${input.status}`, input.idempotencyKey, {
        assignment_key: assignmentKey,
        verification: input.result,
      });
      return mapAssignment(updated.rows[0]);
    });
  }

  async recordTaskIntegration(taskKey: string, input: {
    result: { status: "integrated" | "blocked"; reason: string | null; changedFiles: string[]; patchDigest: string | null; repositorySnapshot?: RepositorySnapshot };
    idempotencyKey: string;
  }): Promise<AgentTask> {
    return withTransaction(this.pool, async (client) => {
      const existing = await this.taskForIdempotency(client, input.idempotencyKey);
      if (existing) return existing;
      const task = await this.lockTask(client, taskKey);
      if (input.result.status === "integrated") {
        const unverified = await client.query(
          "SELECT 1 FROM task_assignments WHERE agent_task_id = $1 AND status <> 'verified' LIMIT 1",
          [task.id],
        );
        if (unverified.rows[0]) throw new Error("Task integration requires every assignment to be independently verified");
      }
      const revision = Number(task.revision) + 1;
      const verification = {
        integrated: input.result.status === "integrated",
        changed_files: input.result.changedFiles,
        patch_digest: input.result.patchDigest,
        reason: input.result.reason,
      };
      await client.query(`UPDATE agent_tasks SET status = $2, verification_result = $3::jsonb,
        repository_snapshot = COALESCE($4::jsonb, repository_snapshot), recommended_next_action = $5,
        revision = $6, updated_at = NOW() WHERE id = $1`, [
        task.id,
        input.result.status === "integrated" ? "ready" : "blocked",
        JSON.stringify(verification),
        input.result.repositorySnapshot ? JSON.stringify(input.result.repositorySnapshot) : null,
        input.result.status === "integrated" ? "Review the verified integrated result" : input.result.reason,
        revision,
      ]);
      if (input.result.status === "integrated") {
        await client.query(`UPDATE task_assignments SET status = 'integrated',
          integration_result = $2::jsonb, ended_at = COALESCE(ended_at, NOW()), updated_at = NOW()
          WHERE agent_task_id = $1 AND status = 'verified'`, [task.id, JSON.stringify(verification)]);
      }
      await this.insertEvent(client, task.id, revision, `task.integration_${input.result.status}`, input.idempotencyKey, verification);
      return this.loadTask(client, taskKey);
    });
  }

  async persistAssignmentPlan(taskKey: string, expectedRevision: number, input: {
    successCriteria: string[];
    verificationCriteria: string[];
    source: "model" | "fallback";
    assignments: Array<{
      key: string;
      title: string;
      instructions: string;
      capabilityRequirements: string[];
      dependencyKeys: string[];
      declaredFileScope: string[];
    }>;
    baseHead: string;
    idempotencyKey: string;
  }): Promise<{ task: AgentTask; assignments: TaskAssignment[] }> {
    return withTransaction(this.pool, async (client) => {
      const existing = await this.taskForIdempotency(client, input.idempotencyKey);
      if (existing) {
        const assignments = await client.query(
          "SELECT * FROM task_assignments WHERE agent_task_id = $1 ORDER BY created_at, id",
          [existing.id],
        );
        return { task: existing, assignments: assignments.rows.map(mapAssignment) };
      }
      const task = await this.lockTask(client, taskKey);
      if (Number(task.revision) !== expectedRevision) {
        throw new RevisionConflictError(`Task revision ${task.revision} does not match expected revision ${expectedRevision}`);
      }
      if (input.assignments.length < 1 || input.assignments.length > 2) {
        throw new Error("Assignment plan must contain one or two assignments");
      }
      const revision = expectedRevision + 1;
      const keyMap = new Map(input.assignments.map((assignment) => [assignment.key, randomUUID()]));
      const stored: TaskAssignment[] = [];
      for (const assignment of input.assignments) {
        const result = await client.query(`INSERT INTO task_assignments
          (agent_task_id, assignment_key, title, instructions, success_criteria, capability_requirements,
           dependency_keys, declared_file_scope, base_head, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, NOW(), NOW())
          RETURNING *`, [
          task.id,
          keyMap.get(assignment.key),
          assignment.title,
          assignment.instructions,
          JSON.stringify(input.successCriteria),
          JSON.stringify(assignment.capabilityRequirements),
          JSON.stringify(assignment.dependencyKeys.map((key) => keyMap.get(key))),
          JSON.stringify(assignment.declaredFileScope),
          input.baseHead,
        ]);
        stored.push(mapAssignment(result.rows[0]));
      }
      const plan = {
        source: input.source,
        assignment_keys: stored.map((assignment) => assignment.assignmentKey),
      };
      await client.query(`UPDATE agent_tasks SET success_criteria = $1::jsonb, verification_criteria = $2::jsonb,
        plan = $3::jsonb, recommended_next_action = $4, revision = $5, updated_at = NOW() WHERE id = $6`, [
        JSON.stringify(input.successCriteria),
        JSON.stringify(input.verificationCriteria),
        JSON.stringify(plan),
        stored[0].instructions,
        revision,
        task.id,
      ]);
      await this.insertEvent(client, task.id, revision, "task.planned", input.idempotencyKey, plan);
      return { task: await this.loadTask(client, taskKey), assignments: stored };
    });
  }

  async createTask(input: { projectName: string; projectRoot: string; intendedOutcome: string; repository: RepositorySnapshot; idempotencyKey: string }): Promise<AgentTask> {
    return withTransaction(this.pool, async (client) => {
      const existing = await this.taskForIdempotency(client, input.idempotencyKey);
      if (existing) return existing;
      const existingProject = await client.query("SELECT * FROM projects WHERE name = $1 FOR UPDATE", [input.projectName]);
      if (existingProject.rows[0]?.root_path && existingProject.rows[0].root_path !== input.projectRoot) {
        throw new Error(`Project ${input.projectName} is already bound to ${existingProject.rows[0].root_path}`);
      }
      const project = existingProject.rows[0]
        ? await client.query("UPDATE projects SET root_path = $1, updated_at = NOW() WHERE id = $2 RETURNING id", [input.projectRoot, existingProject.rows[0].id])
        : await client.query(`INSERT INTO projects (name, root_path, created_at, updated_at)
          VALUES ($1, $2, NOW(), NOW()) RETURNING id`, [input.projectName, input.projectRoot]);
      const taskKey = randomUUID();
      const taskResult = await client.query(`INSERT INTO agent_tasks
        (project_id, task_key, intended_outcome, repository_snapshot, started_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW(), NOW()) RETURNING *`, [project.rows[0].id, taskKey, input.intendedOutcome, JSON.stringify({ head: input.repository.head, status_digest: input.repository.statusDigest })]);
      await this.insertEvent(client, taskResult.rows[0].id, 0, "task.created", input.idempotencyKey, { intended_outcome: input.intendedOutcome });
      return this.loadTask(client, taskKey);
    });
  }

  async recordOrientation(taskKey: string, expectedRevision: number, input: { contextSnapshot: Record<string, unknown>; repositorySnapshot: Record<string, unknown>; recommendedNextAction: string; idempotencyKey: string }): Promise<AgentTask> {
    return this.mutateTask(taskKey, expectedRevision, input.idempotencyKey, "task.oriented", async (client, row, revision) => {
      await client.query(`UPDATE agent_tasks SET context_snapshot = $1::jsonb, repository_snapshot = $2::jsonb,
        recommended_next_action = $3, revision = $4, updated_at = NOW() WHERE id = $5`,
      [JSON.stringify(input.contextSnapshot), JSON.stringify(input.repositorySnapshot), input.recommendedNextAction, revision, row.id]);
      return { recommended_next_action: input.recommendedNextAction };
    });
  }

  async recordCorrection(taskKey: string, expectedRevision: number, correction: string, input: { repositorySnapshot: Record<string, unknown>; idempotencyKey: string }): Promise<AgentTask> {
    return this.mutateTask(taskKey, expectedRevision, input.idempotencyKey, "task.corrected", async (client, row, revision) => {
      const context = row.context_snapshot ?? {};
      const corrections = Array.isArray(context.corrections) ? context.corrections : [];
      const contextSnapshot = { ...context, corrections: [...corrections, correction] };
      await client.query(`UPDATE agent_tasks SET context_snapshot = $1::jsonb, repository_snapshot = $2::jsonb,
        recommended_next_action = $3, revision = $4, updated_at = NOW() WHERE id = $5`,
      [JSON.stringify(contextSnapshot), JSON.stringify(input.repositorySnapshot), correction, revision, row.id]);
      return { correction };
    });
  }

  async approveGrant(taskKey: string, expectedRevision: number, input: {
    repositoryRoots: string[];
    worktreePaths: string[];
    workerAdapters: string[];
    fileOperations: string[];
    commandClasses: string[];
    verificationCommands: string[];
    renewalRequiredActions: string[];
    maxConcurrency: number;
    budget: Record<string, unknown>;
    providerIdentity: string;
    expiresAt: Date;
    idempotencyKey: string;
  }): Promise<TaskGrant> {
    if (input.expiresAt.getTime() <= Date.now()) throw new Error("Task grant expiry must be in the future");
    if (input.expiresAt.getTime() > Date.now() + 8 * 60 * 60 * 1000 + 5_000) {
      throw new Error("Release 1A task grants cannot exceed eight hours");
    }
    if (!input.providerIdentity.trim()) throw new Error("Task grant provider identity is required");
    if (input.repositoryRoots.length === 0 || input.workerAdapters.length === 0) {
      throw new Error("Task grant requires a repository root and worker adapter");
    }
    if (input.verificationCommands.length === 0) throw new Error("Task grant verification commands are required");
    if (input.renewalRequiredActions.length === 0) throw new Error("Task grant renewal actions are required");
    if (!Number.isInteger(input.maxConcurrency) || input.maxConcurrency < 1) {
      throw new Error("Task grant maximum concurrency must be a positive integer");
    }
    const maxWorkerRuns = Number(input.budget.max_worker_runs);
    const maxRuntimeMinutes = Number(input.budget.max_runtime_minutes);
    if (!Number.isInteger(maxWorkerRuns) || maxWorkerRuns < 1 || !Number.isFinite(maxRuntimeMinutes) || maxRuntimeMinutes <= 0) {
      throw new Error("Task grant requires positive worker-run and runtime budgets");
    }
    return withTransaction(this.pool, async (client) => {
      const existing = await client.query(`SELECT g.* FROM task_grants g
        JOIN runtime_events e ON e.task_grant_id = g.id
        WHERE e.idempotency_key = $1 LIMIT 1`, [input.idempotencyKey]);
      if (existing.rows[0]) return mapGrant(existing.rows[0]);
      const row = await this.lockTask(client, taskKey);
      if (Number(row.revision) !== expectedRevision) {
        throw new RevisionConflictError(`Task revision ${row.revision} does not match expected revision ${expectedRevision}`);
      }
      let revision = expectedRevision + 1;
      const expired = await client.query(`UPDATE task_grants SET status = 'expired', ended_at = NOW(), updated_at = NOW()
        WHERE agent_task_id = $1 AND status = 'approved' AND expires_at <= NOW() RETURNING id, grant_key`, [row.id]);
      if (expired.rows[0]) {
        await this.insertEvent(
          client,
          row.id,
          revision,
          "grant.expired",
          `${input.idempotencyKey}:expired:${expired.rows[0].grant_key}`,
          { grant_key: expired.rows[0].grant_key },
          String(expired.rows[0].id),
        );
        revision += 1;
      }
      const scope = {
        repository_roots: input.repositoryRoots,
        worktree_paths: input.worktreePaths,
        worker_adapters: input.workerAdapters,
        file_operations: input.fileOperations,
        command_classes: input.commandClasses,
        verification_commands: input.verificationCommands,
        renewal_required_actions: input.renewalRequiredActions,
        max_concurrency: input.maxConcurrency,
        budget: input.budget,
        provider_identity: input.providerIdentity,
        expires_at: input.expiresAt.toISOString(),
      };
      const digest = createHash("sha256").update(JSON.stringify(scope)).digest("hex");
      const result = await client.query(`INSERT INTO task_grants
        (agent_task_id, grant_key, status, scope_digest, repository_roots, worktree_paths, worker_adapters,
         file_operations, command_classes, verification_commands, renewal_required_actions, max_concurrency,
         budget, provider_identity, approved_at, expires_at, created_at, updated_at)
        VALUES ($1, $2, 'approved', $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb,
          $9::jsonb, $10::jsonb, $11, $12::jsonb, $13, NOW(), $14, NOW(), NOW()) RETURNING *`,
      [
        row.id, randomUUID(), digest, JSON.stringify(input.repositoryRoots), JSON.stringify(input.worktreePaths),
        JSON.stringify(input.workerAdapters), JSON.stringify(input.fileOperations), JSON.stringify(input.commandClasses),
        JSON.stringify(input.verificationCommands), JSON.stringify(input.renewalRequiredActions), input.maxConcurrency,
        JSON.stringify(input.budget), input.providerIdentity, input.expiresAt,
      ]);
      await client.query("UPDATE agent_tasks SET status = 'ready', revision = $1, updated_at = NOW() WHERE id = $2", [revision, row.id]);
      const grant = mapGrant(result.rows[0]);
      await this.insertEvent(
        client,
        row.id,
        revision,
        "grant.approved",
        input.idempotencyKey,
        { grant_key: grant.grantKey, scope_digest: digest },
        grant.id,
      );
      return grant;
    });
  }

  async createWorker(input: {
    taskKey: string;
    grantKey: string;
    assignmentKey?: string;
    adapter: string;
    capabilities?: string[];
    executablePath: string;
    executableVersion: string;
    workingDirectory: string;
    idempotencyKey: string;
  }): Promise<WorkerSession> {
    return withTransaction(this.pool, async (client) => {
      const existing = await client.query(`SELECT w.* FROM worker_sessions w
        JOIN runtime_events e ON e.worker_session_id = w.id
        WHERE e.idempotency_key = $1 LIMIT 1`, [input.idempotencyKey]);
      if (existing.rows[0]) return mapWorker(existing.rows[0]);
      const task = await this.lockTask(client, input.taskKey);
      const grantResult = await client.query(`SELECT * FROM task_grants
        WHERE grant_key = $1 AND agent_task_id = $2 AND status = 'approved'
        AND (expires_at IS NULL OR expires_at > NOW())`, [input.grantKey, task.id]);
      const grant = grantResult.rows[0];
      const repositoryRoots = Array.isArray(grant?.repository_roots) ? grant.repository_roots : [];
      const worktreePaths = Array.isArray(grant?.worktree_paths) ? grant.worktree_paths : [];
      const workerAdapters = Array.isArray(grant?.worker_adapters) ? grant.worker_adapters : [];
      const pathAuthorized = [...repositoryRoots, ...worktreePaths].some((root) => {
        const child = relative(resolve(root), resolve(input.workingDirectory));
        return child === "" || (child !== ".." && !child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(child));
      });
      if (!grant || !pathAuthorized || !workerAdapters.includes(input.adapter)) {
        throw new Error("No approved task grant authorizes this worker directory");
      }
      let assignmentResult = input.assignmentKey
        ? await client.query("SELECT * FROM task_assignments WHERE assignment_key = $1 AND agent_task_id = $2 FOR UPDATE", [input.assignmentKey, task.id])
        : await client.query("SELECT * FROM task_assignments WHERE agent_task_id = $1 ORDER BY created_at LIMIT 1 FOR UPDATE", [task.id]);
      if (!assignmentResult.rows[0] && !input.assignmentKey) {
        assignmentResult = await client.query(`INSERT INTO task_assignments
          (agent_task_id, assignment_key, title, instructions, success_criteria, capability_requirements,
           declared_file_scope, base_head, created_at, updated_at)
          VALUES ($1, $2, 'Primary assignment', $3, '[]'::jsonb, '["implementation"]'::jsonb,
            '["."]'::jsonb, $4, NOW(), NOW()) RETURNING *`, [
          task.id, randomUUID(), task.intended_outcome, task.repository_snapshot?.head ?? null,
        ]);
      }
      const assignment = assignmentResult.rows[0];
      if (!assignment) throw new Error("Unknown task assignment");
      const capabilities = input.capabilities ?? [ "implementation" ];
      const requirements = Array.isArray(assignment.capability_requirements) ? assignment.capability_requirements : [];
      if (!requirements.every((capability: string) => capabilities.includes(capability))) {
        throw new Error("Worker does not satisfy assignment capabilities");
      }
      const liveWorkers = await client.query(
        "SELECT COUNT(*)::int AS count FROM worker_sessions WHERE task_grant_id = $1 AND status IN ('queued','starting','running','stopping')",
        [grant.id],
      );
      if (Number(liveWorkers.rows[0].count) >= Number(grant.max_concurrency)) {
        throw new Error("Task grant maximum concurrency is exhausted");
      }
      const workerRuns = await client.query(
        "SELECT COUNT(*)::int AS count FROM worker_sessions WHERE task_grant_id = $1",
        [grant.id],
      );
      const maxWorkerRuns = Number(grant.budget?.max_worker_runs ?? 1);
      if (Number(workerRuns.rows[0].count) >= maxWorkerRuns) {
        throw new Error("Task grant worker-run budget is exhausted");
      }
      const revision = Number(task.revision) + 1;
      const result = await client.query(`INSERT INTO worker_sessions
        (agent_task_id, task_grant_id, task_assignment_id, worker_key, status, adapter, capabilities,
         executable_path, executable_version, working_directory, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'queued', $5, $6::jsonb, $7, $8, $9, NOW(), NOW()) RETURNING *`,
      [task.id, grant.id, assignment.id, randomUUID(), input.adapter, JSON.stringify(capabilities),
        input.executablePath, input.executableVersion, input.workingDirectory]);
      await client.query(
        "UPDATE task_assignments SET status = 'running', started_at = COALESCE(started_at, NOW()), updated_at = NOW() WHERE id = $1",
        [assignment.id],
      );
      await client.query("UPDATE agent_tasks SET status = 'running', revision = $1, updated_at = NOW() WHERE id = $2", [revision, task.id]);
      await this.insertEvent(
        client,
        task.id,
        revision,
        "worker.queued",
        input.idempotencyKey,
        { worker_key: result.rows[0].worker_key, assignment_key: assignment.assignment_key, adapter: input.adapter },
        grant.id,
        result.rows[0].id,
      );
      return mapWorker(result.rows[0]);
    });
  }

  async transitionWorker(workerKey: string, update: {
    status: "running" | "completed" | "failed" | "interrupted";
    processId?: number | null;
    processIdentity?: string | null;
    externalSessionId?: string;
    exitStatus?: number;
    output?: string;
    error?: string;
    idempotencyKey: string;
  }): Promise<WorkerSession> {
    return withTransaction(this.pool, async (client) => {
      const existing = await client.query("SELECT w.* FROM worker_sessions w JOIN runtime_events e ON e.worker_session_id = w.id WHERE e.idempotency_key = $1 LIMIT 1", [update.idempotencyKey]);
      if (existing.rows[0]) return mapWorker(existing.rows[0]);
      const workerResult = await client.query(`SELECT w.*, t.task_key, t.revision
        FROM worker_sessions w JOIN agent_tasks t ON t.id = w.agent_task_id
        WHERE w.worker_key = $1 FOR UPDATE OF w, t`, [workerKey]);
      const current = workerResult.rows[0];
      if (!current) throw new Error(`Unknown worker ${workerKey}`);
      const allowedTransitions: Record<string, string[]> = {
        queued: [ "running", "failed", "interrupted" ],
        starting: [ "running", "failed", "interrupted" ],
        running: [ "running", "completed", "failed", "interrupted" ],
      };
      if (!(allowedTransitions[current.status] ?? []).includes(update.status)) {
        throw new Error(`Worker cannot transition from ${current.status} to ${update.status}`);
      }
      const revision = Number(current.revision) + 1;
      const result = await client.query(`UPDATE worker_sessions SET status = $2::varchar, process_id = COALESCE($3::bigint, process_id),
        process_identity = COALESCE($4, process_identity), external_session_id = COALESCE($5, external_session_id),
        exit_status = COALESCE($6, exit_status), output = COALESCE($7, output),
        error_summary = COALESCE($8, error_summary), started_at = CASE WHEN $2::varchar = 'running' THEN COALESCE(started_at, NOW()) ELSE started_at END,
        ended_at = CASE WHEN $2::varchar IN ('completed','failed','interrupted') THEN NOW() ELSE ended_at END,
        last_heartbeat_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
      [current.id, update.status, update.processId ?? null, update.processIdentity ?? null, update.externalSessionId ?? null,
        update.exitStatus ?? null, update.output ?? null, update.error ?? null]);
      await client.query("UPDATE agent_tasks SET revision = $1, updated_at = NOW() WHERE id = $2", [revision, current.agent_task_id]);
      await this.insertEvent(client, current.agent_task_id, revision, `worker.${update.status}`, update.idempotencyKey, {
        worker_key: workerKey,
        external_session_id: update.externalSessionId,
        exit_status: update.exitStatus,
        error: update.error,
      }, current.task_grant_id, current.id);
      return mapWorker(result.rows[0]);
    });
  }

  async observeWorker(workerKey: string): Promise<void> {
    await this.pool.query(`UPDATE worker_sessions
      SET last_observed_at = NOW(), last_heartbeat_at = NOW(), updated_at = NOW()
      WHERE worker_key = $1 AND status IN ('queued','starting','running','stopping')`, [workerKey]);
  }

  async queueWorkerCommand(
    workerKey: string,
    kind: WorkerCommandKind,
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<{ command: WorkerCommand; worker: WorkerSession }> {
    return withTransaction(this.pool, async (client) => {
      const existing = await client.query(
        "SELECT * FROM worker_commands WHERE idempotency_key = $1 LIMIT 1",
        [idempotencyKey],
      );
      if (existing.rows[0]) {
        const worker = await client.query("SELECT * FROM worker_sessions WHERE id = $1", [existing.rows[0].worker_session_id]);
        return { command: mapWorkerCommand(existing.rows[0]), worker: mapWorker(worker.rows[0]) };
      }
      const result = await client.query(`SELECT w.*, t.revision AS task_revision, g.status AS grant_status,
          g.expires_at AS grant_expires_at, a.instructions AS assignment_instructions,
          a.excluded_adapters AS assignment_excluded_adapters, a.revision AS current_assignment_revision
        FROM worker_sessions w
        JOIN agent_tasks t ON t.id = w.agent_task_id
        JOIN task_grants g ON g.id = w.task_grant_id
        JOIN task_assignments a ON a.id = w.task_assignment_id
        WHERE w.worker_key = $1
        FOR UPDATE OF w, t, g, a`, [workerKey]);
      const worker = result.rows[0];
      if (!worker) throw new Error(`Unknown worker ${workerKey}`);
      const committedDuplicate = await client.query(
        "SELECT * FROM worker_commands WHERE idempotency_key = $1 LIMIT 1",
        [idempotencyKey],
      );
      if (committedDuplicate.rows[0]) {
        return {
          command: mapWorkerCommand(committedDuplicate.rows[0]),
          worker: mapWorker(worker),
        };
      }
      if (worker.grant_status !== "approved" || new Date(worker.grant_expires_at).getTime() <= Date.now()) {
        throw new Error("Worker control requires an approved unexpired task grant");
      }
      const live = [ "queued", "starting", "running", "stopping" ].includes(worker.status);
      if ([ "stop", "redirect" ].includes(kind) && !live) {
        throw new Error(`${kind} requires a live worker`);
      }
      if (kind === "retry" && live) throw new Error("retry requires a terminal worker");
      const instruction = typeof payload.instruction === "string" ? payload.instruction.trim() : "";
      if (kind === "redirect" && !instruction) throw new Error("Redirect requires a focused instruction");

      const commandResult = await client.query(`INSERT INTO worker_commands
        (agent_task_id, worker_session_id, command_key, kind, status, idempotency_key, payload, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'queued', $5, $6::jsonb, NOW(), NOW()) RETURNING *`, [
        worker.agent_task_id, worker.id, randomUUID(), kind, idempotencyKey, JSON.stringify(payload),
      ]);
      const assignmentRevision = Number(worker.current_assignment_revision) + 1;
      const excluded = Array.isArray(worker.assignment_excluded_adapters) ? worker.assignment_excluded_adapters : [];
      const updatedExcluded = kind === "replace" ? [...new Set([...excluded, worker.adapter])] : excluded;
      await client.query(`UPDATE task_assignments SET status = $2, instructions = $3,
        excluded_adapters = $4::jsonb, revision = $5, updated_at = NOW() WHERE id = $1`, [
        worker.task_assignment_id,
        kind === "stop" ? "cancelled" : "pending",
        kind === "redirect" ? instruction : worker.assignment_instructions,
        JSON.stringify(updatedExcluded),
        assignmentRevision,
      ]);
      if (live && kind !== "retry") {
        await client.query(
          "UPDATE worker_sessions SET status = 'stopping', stop_reason = $2, updated_at = NOW() WHERE id = $1",
          [worker.id, kind],
        );
      }
      const revision = Number(worker.task_revision) + 1;
      await client.query("UPDATE agent_tasks SET revision = $1, updated_at = NOW() WHERE id = $2", [revision, worker.agent_task_id]);
      await this.insertEvent(
        client,
        worker.agent_task_id,
        revision,
        "worker.command_queued",
        idempotencyKey,
        { worker_key: workerKey, command_key: commandResult.rows[0].command_key, kind, assignment_revision: assignmentRevision },
        worker.task_grant_id,
        worker.id,
      );
      const updatedWorker = await client.query("SELECT * FROM worker_sessions WHERE id = $1", [worker.id]);
      return { command: mapWorkerCommand(commandResult.rows[0]), worker: mapWorker(updatedWorker.rows[0]) };
    });
  }

  async completeWorkerCommand(commandKey: string, input: {
    workerStatus: "stopped" | "interrupted" | "replaced" | null;
    error?: string;
  }): Promise<WorkerCommand> {
    return withTransaction(this.pool, async (client) => {
      const result = await client.query(`SELECT c.*, w.worker_key, w.agent_task_id, w.task_grant_id, w.task_assignment_id,
          t.revision AS task_revision, t.status AS task_status
        FROM worker_commands c
        JOIN worker_sessions w ON w.id = c.worker_session_id
        JOIN agent_tasks t ON t.id = w.agent_task_id
        WHERE c.command_key = $1 FOR UPDATE OF c, w, t`, [commandKey]);
      const command = result.rows[0];
      if (!command) throw new Error(`Unknown worker command ${commandKey}`);
      if ([ "completed", "failed", "cancelled" ].includes(command.status)) return mapWorkerCommand(command);
      if (input.workerStatus) {
        await client.query(`UPDATE worker_sessions SET status = $2, stop_reason = $3,
          ended_at = NOW(), updated_at = NOW() WHERE id = $1`, [
          command.worker_session_id, input.workerStatus, command.kind,
        ]);
      }
      const completed = await client.query(`UPDATE worker_commands SET status = $2,
        dispatched_at = COALESCE(dispatched_at, NOW()), completed_at = NOW(),
        error_summary = $3, updated_at = NOW() WHERE id = $1 RETURNING *`, [
        command.id, input.error ? "failed" : "completed", input.error ?? null,
      ]);
      const revision = Number(command.task_revision) + 1;
      const liveWorkers = await client.query(
        "SELECT 1 FROM worker_sessions WHERE agent_task_id = $1 AND status IN ('queued','starting','running','stopping') LIMIT 1",
        [command.agent_task_id],
      );
      const taskStatus = [ "completed", "failed", "cancelled", "blocked" ].includes(command.task_status)
        ? command.task_status
        : liveWorkers.rows[0] ? "running" : "ready";
      await client.query("UPDATE agent_tasks SET status = $1, revision = $2, updated_at = NOW() WHERE id = $3", [
        taskStatus, revision, command.agent_task_id,
      ]);
      await this.insertEvent(
        client,
        command.agent_task_id,
        revision,
        input.error ? "worker.command_failed" : "worker.command_completed",
        `${command.idempotency_key}:completed`,
        { worker_key: command.worker_key, command_key: command.command_key, kind: command.kind, error: input.error },
        command.task_grant_id,
        command.worker_session_id,
      );
      return mapWorkerCommand(completed.rows[0]);
    });
  }

  async keepTaskOpen(taskKey: string, expectedRevision: number, input: { nextAction: string; repositorySnapshot: Record<string, unknown>; idempotencyKey: string }): Promise<AgentTask> {
    return this.mutateTask(taskKey, expectedRevision, input.idempotencyKey, "task.reentry_recorded", async (client, row, revision) => {
      await client.query(`UPDATE agent_tasks SET status = 'ready', recommended_next_action = $1,
        repository_snapshot = $2::jsonb, revision = $3, updated_at = NOW() WHERE id = $4`,
      [input.nextAction, JSON.stringify(input.repositorySnapshot), revision, row.id]);
      return { next_action: input.nextAction };
    });
  }

  async recordToolEscape(taskKey: string, expectedRevision: number, reason: string, idempotencyKey: string): Promise<AgentTask> {
    return this.mutateTask(taskKey, expectedRevision, idempotencyKey, "task.tool_escape", async (client, row, revision) => {
      const liveWorker = await client.query(
        "SELECT 1 FROM worker_sessions WHERE agent_task_id = $1 AND status IN ('queued','starting','running','stopping') LIMIT 1",
        [row.id],
      );
      if (liveWorker.rows[0]) throw new Error("Cannot record a tool escape while a worker is still live");
      const session = await client.query(`SELECT id FROM task_sessions
        WHERE agent_task_id = $1 ORDER BY started_at DESC LIMIT 1 FOR UPDATE`, [row.id]);
      if (session.rows[0]) {
        await client.query("UPDATE task_sessions SET tool_escape = TRUE, updated_at = NOW() WHERE id = $1", [session.rows[0].id]);
      } else {
        await client.query(`INSERT INTO task_sessions
          (agent_task_id, session_key, status, resumed, interpretation_status, tool_escape, startup_snapshot, started_at, ended_at, created_at, updated_at)
          VALUES ($1, $2, 'ended', TRUE, 'pending', TRUE, '{}'::jsonb, NOW(), NOW(), NOW(), NOW())`,
        [row.id, randomUUID()]);
      }
      await client.query(`UPDATE agent_tasks SET status = 'ready', recommended_next_action = $1,
        revision = $2, updated_at = NOW() WHERE id = $3`,
      [`Resume after manual tool escape: ${reason}`, revision, row.id]);
      return { reason };
    });
  }

  async completeTask(taskKey: string, expectedRevision: number, input: { summary: string; verification: Record<string, unknown>; repositorySnapshot: Record<string, unknown>; idempotencyKey: string }): Promise<AgentTask> {
    return this.mutateTask(taskKey, expectedRevision, input.idempotencyKey, "task.completed", async (client, row, revision) => {
      const liveWorker = await client.query(
        "SELECT 1 FROM worker_sessions WHERE agent_task_id = $1 AND status IN ('queued','starting','running','stopping') LIMIT 1",
        [row.id],
      );
      if (liveWorker.rows[0]) throw new Error("Cannot complete a task while a worker is still live");
      const successfulWorker = await client.query(
        "SELECT 1 FROM worker_sessions WHERE agent_task_id = $1 AND status = 'completed' AND exit_status = 0 LIMIT 1",
        [row.id],
      );
      if (!successfulWorker.rows[0]) throw new Error("Task completion requires a successful worker");
      const plannedAssignmentKeys = Array.isArray(row.plan?.assignment_keys) ? row.plan.assignment_keys : [];
      if (plannedAssignmentKeys.length > 0) {
        const assignments = await client.query(`SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'integrated')::int AS integrated
          FROM task_assignments WHERE agent_task_id = $1 AND assignment_key = ANY($2::varchar[])`,
        [row.id, plannedAssignmentKeys]);
        if (Number(assignments.rows[0].total) !== plannedAssignmentKeys.length
          || Number(assignments.rows[0].integrated) !== plannedAssignmentKeys.length) {
          throw new Error("Task completion requires all planned assignments to be integrated");
        }
      }
      const confirmed = input.verification.user_confirmed === true || input.verification.confirmed_by === "user";
      if (!confirmed || !input.repositorySnapshot.head || !input.repositorySnapshot.status_digest) {
        throw new Error("Task completion requires explicit repository verification");
      }
      await client.query(`UPDATE agent_tasks SET status = 'completed', outcome_summary = $1, verification_result = $2::jsonb,
        repository_snapshot = $3::jsonb, recommended_next_action = NULL, completed_at = NOW(), revision = $4, updated_at = NOW() WHERE id = $5`,
      [input.summary, JSON.stringify(input.verification), JSON.stringify(input.repositorySnapshot), revision, row.id]);
      await client.query("UPDATE task_grants SET status = 'completed', ended_at = NOW(), updated_at = NOW() WHERE agent_task_id = $1 AND status = 'approved'", [row.id]);
      return { summary: input.summary, verification: input.verification };
    });
  }

  async startTaskSession(taskId: string, resumed: boolean, startupSnapshot: Record<string, unknown>): Promise<string> {
    return withTransaction(this.pool, async (client) => {
      const task = await client.query("SELECT * FROM agent_tasks WHERE id = $1 FOR UPDATE", [taskId]);
      if (!task.rows[0]) throw new Error(`Unknown task ${taskId}`);
      const active = await client.query("SELECT session_key FROM task_sessions WHERE agent_task_id = $1 AND status = 'active' LIMIT 1", [taskId]);
      if (active.rows[0]) throw new Error(`Task already has active session ${active.rows[0].session_key}`);
      const previous = await client.query(`SELECT ended_at <= NOW() - INTERVAL '30 minutes' AS old_enough
        FROM task_sessions WHERE agent_task_id = $1 AND status = 'ended'
        ORDER BY ended_at DESC LIMIT 1`, [taskId]);
      const qualifiesAsResume = resumed && previous.rows[0]?.old_enough === true;
      const sessionKey = randomUUID();
      const revision = Number(task.rows[0].revision) + 1;
      await client.query(`INSERT INTO task_sessions
        (agent_task_id, session_key, status, resumed, startup_snapshot, started_at, created_at, updated_at)
        VALUES ($1, $2, 'active', $3, $4::jsonb, NOW(), NOW(), NOW())`,
      [taskId, sessionKey, qualifiesAsResume, JSON.stringify(startupSnapshot)]);
      await client.query("UPDATE agent_tasks SET revision = $1, updated_at = NOW() WHERE id = $2", [revision, taskId]);
      await this.insertEvent(client, taskId, revision, "task_session.started", `task-session-start:${sessionKey}`, {
        session_key: sessionKey,
        resumed: qualifiesAsResume,
      });
      return sessionKey;
    });
  }

  async finishTaskSession(sessionKey: string, input: {
    interpretation: "pending" | "accepted" | "focused_corrected" | "replaced";
    manualContextRestatement?: boolean;
    toolEscape?: boolean;
  }): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const result = await client.query(`SELECT s.*, t.revision FROM task_sessions s
        JOIN agent_tasks t ON t.id = s.agent_task_id
        WHERE s.session_key = $1 FOR UPDATE OF s, t`, [sessionKey]);
      const session = result.rows[0];
      if (!session) throw new Error(`Unknown task session ${sessionKey}`);
      if (session.status === "ended") return;
      const revision = Number(session.revision) + 1;
      await client.query(`UPDATE task_sessions SET status = 'ended', interpretation_status = $2,
        manual_context_restatement = $3, tool_escape = $4, ended_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [session.id, input.interpretation, input.manualContextRestatement ?? false, input.toolEscape ?? false]);
      await client.query("UPDATE agent_tasks SET revision = $1, updated_at = NOW() WHERE id = $2", [revision, session.agent_task_id]);
      await this.insertEvent(client, session.agent_task_id, revision, "task_session.ended", `task-session-end:${sessionKey}`, {
        session_key: sessionKey,
        interpretation: input.interpretation,
        manual_context_restatement: input.manualContextRestatement ?? false,
        tool_escape: input.toolEscape ?? false,
      });
    });
  }

  async recoverTaskSessions(projectRoot: string): Promise<number> {
    const result = await this.pool.query(`SELECT s.session_key FROM task_sessions s
      JOIN agent_tasks t ON t.id = s.agent_task_id
      JOIN projects p ON p.id = t.project_id
      WHERE p.root_path = $1 AND s.status = 'active' ORDER BY s.started_at`, [projectRoot]);
    for (const row of result.rows) {
      await this.finishTaskSession(row.session_key, { interpretation: "pending" });
    }
    return result.rowCount ?? 0;
  }

  async pendingArchiveEvents(limit = 50): Promise<ArchiveRuntimeEvent[]> {
    const result = await this.pool.query(`SELECT e.*, t.task_key FROM runtime_events e
      JOIN agent_tasks t ON t.id = e.agent_task_id
      WHERE e.archive_delivered_at IS NULL
        AND e.event_type IN ('task.corrected','task.completed','task.tool_escape')
        AND (e.next_delivery_at IS NULL OR e.next_delivery_at <= NOW())
      ORDER BY e.occurred_at
      LIMIT $1`, [limit]);
    return result.rows.map((row) => ({
      id: String(row.id),
      eventKey: row.event_key,
      eventType: row.event_type,
      taskKey: row.task_key,
      taskRevision: Number(row.task_revision),
      occurredAt: iso(row.occurred_at)!,
      payload: row.payload ?? {},
    }));
  }

  async markArchiveDelivered(eventId: string): Promise<void> {
    await this.pool.query(`UPDATE runtime_events SET archive_delivered_at = NOW(),
      delivery_attempts = delivery_attempts + 1, next_delivery_at = NULL,
      last_delivery_error = NULL, updated_at = NOW() WHERE id = $1`, [eventId]);
  }

  async markArchiveFailed(eventId: string, error: string): Promise<void> {
    await this.pool.query(`UPDATE runtime_events SET delivery_attempts = delivery_attempts + 1,
      next_delivery_at = NOW() + INTERVAL '5 minutes', last_delivery_error = $2,
      updated_at = NOW() WHERE id = $1`, [eventId, error.slice(0, 2_000)]);
  }

  private async mutateTask(taskKey: string, expectedRevision: number, idempotencyKey: string, eventType: string, mutation: (client: PoolClient, row: QueryResultRow, revision: number) => Promise<Record<string, unknown>>): Promise<AgentTask> {
    return withTransaction(this.pool, async (client) => {
      const existing = await this.taskForIdempotency(client, idempotencyKey);
      if (existing) return existing;
      const row = await this.lockTask(client, taskKey);
      if (Number(row.revision) !== expectedRevision) throw new RevisionConflictError(`Task revision ${row.revision} does not match expected revision ${expectedRevision}`);
      const revision = expectedRevision + 1;
      const payload = await mutation(client, row, revision);
      await this.insertEvent(client, row.id, revision, eventType, idempotencyKey, payload);
      return this.loadTask(client, taskKey);
    });
  }

  private async lockTask(client: PoolClient, taskKey: string): Promise<QueryResultRow> {
    const result = await client.query("SELECT * FROM agent_tasks WHERE task_key = $1 FOR UPDATE", [taskKey]);
    if (!result.rows[0]) throw new Error(`Unknown task ${taskKey}`);
    return result.rows[0];
  }

  private async loadTask(client: PoolClient, taskKey: string): Promise<AgentTask> {
    const result = await client.query(`${TASK_SELECT} WHERE t.task_key = $1`, [taskKey]);
    if (!result.rows[0]) throw new Error(`Unknown task ${taskKey}`);
    return mapTask(result.rows[0]);
  }

  private async taskForIdempotency(client: PoolClient, key: string): Promise<AgentTask | null> {
    const result = await client.query(`${TASK_SELECT} JOIN runtime_events e ON e.agent_task_id = t.id WHERE e.idempotency_key = $1 LIMIT 1`, [key]);
    return result.rows[0] ? mapTask(result.rows[0]) : null;
  }

  private async insertEvent(client: PoolClient, taskId: string, revision: number, eventType: string, idempotencyKey: string, payload: Record<string, unknown>, grantId?: string, workerId?: string): Promise<void> {
    await client.query(`INSERT INTO runtime_events
      (agent_task_id, task_grant_id, worker_session_id, event_key, event_type, idempotency_key, task_revision, payload, occurred_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW(), NOW(), NOW())`,
    [taskId, grantId ?? null, workerId ?? null, randomUUID(), eventType, idempotencyKey, revision, JSON.stringify(payload)]);
  }
}
