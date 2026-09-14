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

export interface LiveTaskDelegation {
  taskKey: string;
  projectRoot: string;
  status: string;
  created: boolean;
}

export interface LiveTaskPlanResult {
  augmentations: Record<string, unknown>[];
  delegatedTask: LiveTaskDelegation | null;
  planned: boolean;
  trackingFailed: boolean;
}

export interface LiveTaskPlanOptions {
  decision: LiveTaskDecision;
  projectRoot: string | null | undefined;
  intakeOptions: LiveTaskIntakeOptions;
  currentWork: string;
  plan: (intent: string) => Promise<unknown>;
  deps: LiveTaskIntakeDeps;
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

// ponytail: whole-utterance continuation cues only. A cue embedded in new content
// ("continue fixing X") is treated as a new task rather than hijacking the resumable one.
const CONTINUATION_CUE = /^(?:ok(?:ay)?|please|now)?[,\s]*(?:continue|carry on|keep going|keep working|keep at it|resume|proceed|go on|finish (?:it|that|this)|same task|as before|pick up where (?:we|i) left off|where we left off)[.!\s]*$/i;

function normalizeIntent(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
}

export function isTaskContinuation(utterance: string, task: AgentTask): boolean {
  const normalized = normalizeIntent(utterance);
  if (!normalized) return false;
  if (normalized === normalizeIntent(task.intendedOutcome)) return true;
  return CONTINUATION_CUE.test(normalized);
}

function describeTrackingFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/no repository identified/i.test(message)) {
    return "No git repository was identified, so this request was not tracked as a task.";
  }
  if (/one_unfinished_per_project|duplicate key/i.test(message)) {
    return "An unfinished task already exists for this project, so this request was not tracked as a new task.";
  }
  if (/econnrefused|connect|timeout|database|pool|does not exist/i.test(message)) {
    return "The task database is unavailable, so this request was not tracked as a task.";
  }
  return "This request was not tracked as a task.";
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
  if (resumed && isTaskContinuation(decision.intendedOutcome, resumed)) {
    return { task: resumed, created: false };
  }

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

export async function trackLiveTaskAndPlan(options: LiveTaskPlanOptions): Promise<LiveTaskPlanResult> {
  const augmentations: Record<string, unknown>[] = [];
  let delegatedTask: LiveTaskDelegation | null = null;
  let trackingFailed = false;
  let tracked: LiveTaskIntakeResult | null = null;

  try {
    tracked = await intakeLiveTask(options.decision, options.projectRoot, options.intakeOptions, options.deps);
    augmentations.push({
      kind: "explanation",
      content: tracked.created
        ? `Task created: ${tracked.task.intendedOutcome}`
        : `Continuing existing task: ${tracked.task.intendedOutcome}`,
      placement: "cursor",
    });
    delegatedTask = {
      taskKey: tracked.task.taskKey,
      projectRoot: tracked.task.projectRoot,
      status: tracked.task.status,
      created: tracked.created,
    };
  } catch (error) {
    trackingFailed = true;
    augmentations.push({
      kind: "explanation",
      content: describeTrackingFailure(error),
      placement: "cursor",
    });
  }

  const planIntent = tracked?.task.intendedOutcome ?? options.decision.intendedOutcome;
  let planned = false;
  try {
    const plan = await options.plan(planIntent);
    if (plan) {
      planned = true;
      augmentations.push({
        kind: "task_plan",
        content: options.currentWork,
        placement: "cursor",
        taskPlan: plan,
      });
    } else {
      augmentations.push({
        kind: "explanation",
        content: `Failed to produce task plan for: ${planIntent}`,
        placement: "cursor",
      });
    }
  } catch {
    augmentations.push({
      kind: "explanation",
      content: `Task planning failed. Try a more specific request.`,
      placement: "cursor",
    });
  }

  return { augmentations, delegatedTask, planned, trackingFailed };
}