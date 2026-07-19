import { RevisionConflictError } from "./task-store.js";
import {
  parseRuntimeCommandRequest,
  type RuntimeCommandRequest,
  type RuntimeCommandResult,
} from "./runtime-command-contract.js";
import type {
  AgentTask,
  RepositorySnapshot,
  TaskAssignment,
  TaskGrant,
  WorkerCommand,
  WorkerSession,
} from "./types.js";

interface RuntimeCommandStore {
  findTask(taskKey: string): Promise<AgentTask | null>;
  findWorker(workerKey: string): Promise<WorkerSession | null>;
  listAssignments(taskId: string): Promise<TaskAssignment[]>;
  listWorkers(taskId: string): Promise<WorkerSession[]>;
  listGrants(taskId: string): Promise<TaskGrant[]>;
  approveGrantProposal(taskKey: string, expectedRevision: number, grantKey: string, idempotencyKey: string): Promise<TaskGrant>;
  rejectGrantProposal(taskKey: string, expectedRevision: number, grantKey: string, reason: string, idempotencyKey: string): Promise<TaskGrant>;
  recordCorrection(
    taskKey: string,
    expectedRevision: number,
    correction: string,
    input: { repositorySnapshot: Record<string, unknown>; idempotencyKey: string },
  ): Promise<AgentTask>;
  completeTask(
    taskKey: string,
    expectedRevision: number,
    input: {
      summary: string;
      verification: Record<string, unknown>;
      repositorySnapshot: Record<string, unknown>;
      idempotencyKey: string;
    },
  ): Promise<AgentTask>;
}

export interface RuntimeWorkerControlInput {
  workerKey: string;
  kind: "stop" | "retry" | "redirect" | "replace";
  instruction?: string;
  expectedTaskRevision: number;
  idempotencyKey: string;
}

interface RuntimeCommandDependencies {
  store: RuntimeCommandStore;
  controlWorker(input: RuntimeWorkerControlInput): Promise<WorkerCommand>;
  inspectRepository(path?: string): Promise<RepositorySnapshot>;
  now?: () => Date;
}

function repositoryState(repository: RepositorySnapshot): Record<string, unknown> {
  return {
    root: repository.root,
    branch: repository.branch,
    head: repository.head,
    dirty: repository.dirty,
    status_lines: repository.statusLines,
    status_digest: repository.statusDigest,
  };
}

export class RuntimeCommandService {
  constructor(private readonly deps: RuntimeCommandDependencies) {}

  async execute(value: unknown): Promise<RuntimeCommandResult> {
    const request = parseRuntimeCommandRequest(value);
    if (request.action === "health") {
      return { action: request.action, data: { healthy: true } };
    }

    const task = await this.requireTask(request.taskKey);
    if (request.action === "task.status") return this.status(task);
    this.requireRevision(task, request.expectedTaskRevision);

    switch (request.action) {
      case "task.approve_grant": {
        const grant = await this.deps.store.approveGrantProposal(
          task.taskKey,
          request.expectedTaskRevision,
          request.grantKey,
          request.idempotencyKey,
        );
        return this.resultFor(request, await this.requireTask(task.taskKey), { grant });
      }
      case "task.reject_grant": {
        const grant = await this.deps.store.rejectGrantProposal(
          task.taskKey,
          request.expectedTaskRevision,
          request.grantKey,
          request.reason,
          request.idempotencyKey,
        );
        return this.resultFor(request, await this.requireTask(task.taskKey), { grant });
      }
      case "task.stop_worker":
      case "task.retry_worker":
      case "task.redirect_worker":
      case "task.replace_worker": {
        const worker = await this.requireWorker(task, request.workerKey);
        const kind = request.action.replace("task.", "").replace("_worker", "") as RuntimeWorkerControlInput["kind"];
        const command = await this.deps.controlWorker({
          workerKey: worker.workerKey,
          kind,
          instruction: request.action === "task.redirect_worker" ? request.instruction : undefined,
          expectedTaskRevision: request.expectedTaskRevision,
          idempotencyKey: request.idempotencyKey,
        });
        return this.resultFor(request, await this.requireTask(task.taskKey), { command });
      }
      case "task.correct": {
        const repository = await this.deps.inspectRepository(task.projectRoot);
        const corrected = await this.deps.store.recordCorrection(
          task.taskKey,
          request.expectedTaskRevision,
          request.correctedValue,
          {
            repositorySnapshot: repositoryState(repository),
            idempotencyKey: request.idempotencyKey,
          },
        );
        return this.resultFor(request, corrected, {
          correction: {
            originalClaim: request.originalClaim ?? null,
            correctedValue: request.correctedValue,
            surfaceRevision: request.surfaceRevision ?? null,
            actorSurface: request.actorSurface,
          },
        });
      }
      case "task.confirm_completion": {
        const repository = await this.deps.inspectRepository(task.projectRoot);
        const completed = await this.deps.store.completeTask(
          task.taskKey,
          request.expectedTaskRevision,
          {
            summary: request.summary,
            verification: {
              ...task.verificationResult,
              user_confirmed: true,
              confirmed_at: (this.deps.now?.() ?? new Date()).toISOString(),
              actor_surface: request.actorSurface,
            },
            repositorySnapshot: repositoryState(repository),
            idempotencyKey: request.idempotencyKey,
          },
        );
        return this.resultFor(request, completed, { completed: true });
      }
    }
  }

  private async status(task: AgentTask): Promise<RuntimeCommandResult> {
    const [assignments, workers, grants] = await Promise.all([
      this.deps.store.listAssignments(task.id),
      this.deps.store.listWorkers(task.id),
      this.deps.store.listGrants(task.id),
    ]);
    return {
      action: "task.status",
      taskKey: task.taskKey,
      taskRevision: task.revision,
      data: { task, assignments, workers, grants },
    };
  }

  private resultFor(
    request: RuntimeCommandRequest,
    task: AgentTask,
    data: Record<string, unknown>,
  ): RuntimeCommandResult {
    return {
      action: request.action,
      taskKey: task.taskKey,
      taskRevision: task.revision,
      data,
    };
  }

  private async requireTask(taskKey: string): Promise<AgentTask> {
    const task = await this.deps.store.findTask(taskKey);
    if (!task) throw new Error(`Unknown task ${taskKey}`);
    return task;
  }

  private async requireWorker(task: AgentTask, workerKey: string): Promise<WorkerSession> {
    const worker = await this.deps.store.findWorker(workerKey);
    if (!worker) throw new Error(`Unknown worker ${workerKey}`);
    if (worker.agentTaskId !== task.id) throw new Error(`Worker ${workerKey} does not belong to task ${task.taskKey}`);
    return worker;
  }

  private requireRevision(task: AgentTask, expectedRevision: number): void {
    if (task.revision !== expectedRevision) {
      throw new RevisionConflictError(
        `Task revision ${task.revision} does not match expected revision ${expectedRevision}`,
      );
    }
  }
}
