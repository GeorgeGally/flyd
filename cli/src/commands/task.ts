import { createRuntimePool } from "../runtime/database.js";
import { deliverArchiveOutbox } from "../runtime/archive-outbox.js";
import { inspectRepository } from "../runtime/repository-inspector.js";
import { PostgresTaskStore } from "../runtime/task-store.js";
import { NodeTerminal } from "../runtime/terminal.js";
import { controlWorker, defaultWorkerControlDependencies } from "../runtime/worker-controller.js";
import type { AgentTask, RuntimeMetrics, WorkerCommandKind, WorkerSession } from "../runtime/types.js";

export function formatTask(task: AgentTask): string {
  const lines = [
    `${task.taskKey}  ${task.status}`,
    task.intendedOutcome,
    `Project: ${task.projectName}`,
    `Updated: ${task.updatedAt}`,
  ];
  if (task.status !== "completed" && task.recommendedNextAction) lines.push(`Next: ${task.recommendedNextAction}`);
  if (task.outcomeSummary) lines.push(`Outcome: ${task.outcomeSummary}`);
  return lines.join("\n");
}

export function formatWorker(worker: WorkerSession): string {
  return [
    `${worker.workerKey}  ${worker.status}`,
    `Assignment: ${worker.taskAssignmentId}`,
    `Adapter: ${worker.adapter} ${worker.executableVersion ?? "unknown version"}`,
    `Worktree: ${worker.workingDirectory}`,
    `Revision observed: ${worker.lastObservedAt ?? "not yet"}`,
    worker.externalSessionId ? `Session: ${worker.externalSessionId}` : null,
    worker.errorSummary ? `Error: ${worker.errorSummary}` : null,
  ].filter(Boolean).join("\n");
}

function rate(numerator: number, denominator: number): string {
  return denominator === 0 ? "no data" : `${Math.round((numerator / denominator) * 100)}%`;
}

async function flushArchiveOutbox(store: PostgresTaskStore): Promise<void> {
  try {
    await deliverArchiveOutbox(store);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Flyd memory delivery is delayed: ${message}\n`);
  }
}

export function formatMetrics(metrics: RuntimeMetrics): string {
  if (metrics.sessions === 0) return "No coding sessions recorded yet. The 5-day dogfood trial has not produced evidence.";
  const interpreted = metrics.acceptedInterpretations + metrics.correctedInterpretations + metrics.replacedInterpretations;
  const successfulResumes = metrics.resumedWithoutRestatement;
  return [
    `Rolling five-working-day window since ${metrics.windowStartedAt}`,
    `Verified tasks: ${metrics.completedTasks}/${metrics.tasks}`,
    `Sessions: ${metrics.sessions}`,
    `Resumed without context restatement: ${rate(successfulResumes, metrics.resumedSessions)} (${successfulResumes}/${metrics.resumedSessions})`,
    `Interpretation accepted unchanged: ${rate(metrics.acceptedInterpretations, interpreted)}`,
    `Focused corrections: ${metrics.correctedInterpretations}`,
    `Manual context restatements: ${metrics.manualContextRestatements}`,
    `Escapes to another coding tool: ${metrics.toolEscapes}`,
  ].join("\n");
}

export async function runTaskList(): Promise<void> {
  const pool = createRuntimePool();
  try {
    const repository = await inspectRepository();
    const tasks = await new PostgresTaskStore(pool).listTasks(repository.root);
    if (tasks.length === 0) {
      console.log("No Flyd coding tasks exist for this repository.");
      return;
    }
    console.log(tasks.map(formatTask).join("\n\n"));
  } finally {
    await pool.end();
  }
}

export async function runTaskStatus(taskKey?: string): Promise<void> {
  const pool = createRuntimePool();
  try {
    const store = new PostgresTaskStore(pool);
    const repository = await inspectRepository();
    const task = taskKey
      ? await store.findTask(taskKey)
      : await store.findResumableTask(repository.root) ?? (await store.listTasks(repository.root, 1))[0] ?? null;
    if (!task) {
      console.log("No Flyd coding task was found.");
      return;
    }
    const worker = await store.latestWorker(task.id);
    console.log(formatTask(task));
    if (worker) {
      console.log(`Worker: ${worker.adapter} ${worker.status}${worker.externalSessionId ? ` (${worker.externalSessionId})` : ""}`);
      if (worker.errorSummary) console.log(`Worker error: ${worker.errorSummary}`);
    }
  } finally {
    await pool.end();
  }
}

export async function runTaskMetrics(): Promise<void> {
  const pool = createRuntimePool();
  try {
    const repository = await inspectRepository();
    const metrics = await new PostgresTaskStore(pool).metrics(repository.root);
    console.log(formatMetrics(metrics));
  } finally {
    await pool.end();
  }
}

export async function runTaskWorkers(): Promise<void> {
  const pool = createRuntimePool();
  try {
    const store = new PostgresTaskStore(pool);
    const repository = await inspectRepository();
    const task = await store.findResumableTask(repository.root) ?? (await store.listTasks(repository.root, 1))[0] ?? null;
    if (!task) {
      console.log("No Flyd coding task was found.");
      return;
    }
    const workers = await store.listWorkers(task.id);
    console.log(workers.length ? workers.map(formatWorker).join("\n\n") : "No workers have run for this task.");
  } finally {
    await pool.end();
  }
}

export async function runTaskControl(
  kind: WorkerCommandKind,
  workerKey: string,
  instruction?: string,
): Promise<void> {
  const pool = createRuntimePool();
  const store = new PostgresTaskStore(pool);
  try {
    const command = await controlWorker({
      workerKey,
      kind,
      instruction,
      idempotencyKey: `${kind}:${workerKey}:${instruction?.trim() ?? ""}`,
      deps: defaultWorkerControlDependencies(store),
    });
    console.log(`${kind} ${command.status}: ${command.commandKey}`);
  } finally {
    await pool.end();
  }
}

export async function runTaskComplete(): Promise<void> {
  const pool = createRuntimePool();
  const terminal = new NodeTerminal();
  const store = new PostgresTaskStore(pool);
  try {
    const repository = await inspectRepository();
    const task = await store.findResumableTask(repository.root);
    if (!task) {
      terminal.write("No unfinished Flyd coding task was found.\n");
      return;
    }
    terminal.write(`${formatTask(task)}\n`);
    if (!await terminal.confirm("Have you verified this outcome against the current repository?")) return;
    const summary = (await terminal.ask("What verified outcome should Flyd record?")).trim();
    if (!summary) throw new Error("A verified outcome summary is required");
    const completed = await store.completeTask(task.taskKey, task.revision, {
      summary,
      verification: { user_confirmed: true, confirmed_at: new Date().toISOString() },
      repositorySnapshot: {
        root: repository.root, branch: repository.branch, head: repository.head,
        dirty: repository.dirty, status_lines: repository.statusLines,
        status_digest: repository.statusDigest,
      },
      idempotencyKey: `manual-complete:${task.taskKey}:${task.revision}`,
    });
    terminal.write(`Task ${completed.taskKey}: completed\n`);
  } finally {
    await flushArchiveOutbox(store);
    await terminal.close();
    await pool.end();
  }
}

export async function runTaskEscape(reason = "continued in another coding tool"): Promise<void> {
  const pool = createRuntimePool();
  const store = new PostgresTaskStore(pool);
  try {
    const repository = await inspectRepository();
    const task = await store.findResumableTask(repository.root);
    if (!task) {
      console.log("No unfinished Flyd coding task was found.");
      return;
    }
    const updated = await store.recordToolEscape(
      task.taskKey,
      task.revision,
      reason,
      `tool-escape:${task.taskKey}:${task.revision}`,
    );
    console.log(`Recorded tool escape. Next: ${updated.recommendedNextAction}`);
  } finally {
    await flushArchiveOutbox(store);
    await pool.end();
  }
}
