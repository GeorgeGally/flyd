import { createRuntimePool } from "./database.js";
import { buildRuntimeTaskRequest } from "./delegation-request.js";
import { inspectRepository } from "./repository-inspector.js";
import { PostgresTaskStore } from "./task-store.js";
import { materializeRuntimeTaskRequest } from "./task-request-materializer.js";
import type { AgentTask, RepositorySnapshot } from "./types.js";

export interface LiveTaskDecision {
  intendedOutcome: string;
  taskIntent: "scout" | "ship";
}

export interface LiveTaskIntakeResult {
  task: AgentTask;
  created: boolean;
}

export interface LiveTaskIntakeOptions {
  invocationId?: string;
  observationRefs?: string[];
  source?: "manifest" | "cli" | "voice" | "system";
}

export interface LiveTaskIntakeStore {
  findResumableTask(projectRoot: string): Promise<AgentTask | null>;
  createTask(input: {
    projectName: string;
    projectRoot: string;
    intendedOutcome: string;
    repository: RepositorySnapshot;
    idempotencyKey: string;
  }): Promise<AgentTask>;
  startTaskSession(taskId: string, resumed: boolean, startupSnapshot: Record<string, unknown>): Promise<string>;
  findTask(taskKey: string): Promise<AgentTask | null>;
  recordOrientation(
    taskKey: string,
    expectedRevision: number,
    input: {
      contextSnapshot: Record<string, unknown>;
      repositorySnapshot: Record<string, unknown>;
      recommendedNextAction: string;
      idempotencyKey: string;
    },
  ): Promise<AgentTask>;
}

export interface LiveTaskIntakeDeps {
  store: LiveTaskIntakeStore;
  inspectRepository?: (cwd: string) => Promise<RepositorySnapshot>;
}

let store: PostgresTaskStore | null = null;

export function runtimeTaskStore(): PostgresTaskStore {
  store ??= new PostgresTaskStore(createRuntimePool());
  return store;
}

export function resolveLiveTaskIntent(
  action: { kind?: string; taskIntent?: string } | null | undefined,
): LiveTaskDecision | null {
  if (!action || action.kind !== "task_plan") return null;
  const intendedOutcome = action.taskIntent?.trim();
  if (!intendedOutcome) return null;
  return { intendedOutcome, taskIntent: "ship" };
}

export async function intakeLiveTask(
  decision: LiveTaskDecision,
  projectRoot: string | null | undefined,
  options: LiveTaskIntakeOptions,
  deps: LiveTaskIntakeDeps,
): Promise<LiveTaskIntakeResult> {
  const root = projectRoot?.trim();
  if (!root) throw new Error("no repository identified for live task intake");
  const repository = await (deps.inspectRepository ?? inspectRepository)(root);
  const resumed = await deps.store.findResumableTask(repository.root);
  if (resumed) return { task: resumed, created: false };

  const request = buildRuntimeTaskRequest({
    intent: decision.intendedOutcome,
    contextSnapshot: {},
    observationRefs: options.observationRefs ?? [],
    projectRoot: repository.root,
    invocationId: options.invocationId,
    source: options.source ?? "manifest",
    taskIntent: decision.taskIntent,
  });
  const materialization = materializeRuntimeTaskRequest(request, repository);

  let task = await deps.store.createTask(materialization.createTask);
  await deps.store.startTaskSession(task.id, false, {
    repository: repositoryState(repository),
    orientation: decision.taskIntent,
    evidence_refs: request.observationRefs,
    source: request.source,
    invocation_id: request.invocationId ?? null,
  });
  const current = await deps.store.findTask(task.taskKey);
  if (!current) throw new Error(`task ${task.taskKey} vanished after session start`);
  task = await deps.store.recordOrientation(current.taskKey, current.revision, materialization.orientation);
  return { task, created: true };
}

function repositoryState(repository: RepositorySnapshot): Record<string, unknown> {
  return {
    root: repository.root,
    branch: repository.branch,
    head: repository.head,
    dirty: repository.dirty,
    status_lines: repository.statusLines,
    status_digest: repository.statusDigest,
    observed_at: new Date().toISOString(),
  };
}