import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { constants } from "fs";
import { access, readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { createRuntimePool } from "../runtime/database.js";
import { deliverArchiveOutbox } from "../runtime/archive-outbox.js";
import { inspectRepository } from "../runtime/repository-inspector.js";
import { recoverInterruptedWorkers, workerProcessIsAlive } from "../runtime/recovery.js";
import { PostgresTaskStore } from "../runtime/task-store.js";
import { RuntimeCommandService } from "../runtime/runtime-command-service.js";
import { NodeTerminal } from "../runtime/terminal.js";
import { controlWorker, defaultWorkerControlDependencies } from "../runtime/worker-controller.js";
import { hasControlTrialEvidence } from "../runtime/metrics.js";
import { buildReleaseAcceptanceReport, type ReleaseAcceptanceReport } from "../runtime/release-acceptance.js";
import type { ReleaseAcceptanceObservationKind } from "../runtime/release-acceptance.js";
import type { AgentTask, RuntimeMetrics, WorkerCommandKind, WorkerSession } from "../runtime/types.js";

function commandService(store: PostgresTaskStore): RuntimeCommandService {
  return new RuntimeCommandService({
    store,
    inspectRepository,
    controlWorker: (input) => controlWorker({
      ...input,
      deps: defaultWorkerControlDependencies(store),
    }),
  });
}

export function formatTask(task: AgentTask): string {
  const lines = [
    `${task.taskKey}  ${task.status}`,
    task.intendedOutcome,
    `Project: ${task.projectName}`,
    `Updated: ${task.updatedAt}`,
  ];
  if (task.status !== "completed" && task.recommendedNextAction) {
    lines.push(`Next: ${formatNextAction(task.recommendedNextAction)}`);
  }
  if (task.outcomeSummary) lines.push(`Outcome: ${task.outcomeSummary}`);
  return lines.join("\n");
}

export function formatNextAction(nextAction: string): string {
  const trimmed = nextAction.trim();
  if (trimmed.startsWith("No healthy worker satisfies:")) {
    return "Worker routing is unavailable; Flyd needs to recover or replace its worker before continuing.";
  }
  if (trimmed === "Current repository evidence invalidated the assignment base") {
    return "The repository changed while work was running; Flyd needs to re-check the current files before continuing.";
  }
  if (trimmed === "Flyd already intervened on this exact evidence") {
    return "Flyd already tried the safe automatic move here; review the current state before intervening again.";
  }
  return trimmed;
}

export function formatWorker(worker: WorkerSession): string {
  return [
    `${worker.workerKey}  ${worker.status}`,
    `Assignment: ${worker.taskAssignmentId}`,
    `Assignment revision: ${worker.assignmentRevision ?? "unknown"}`,
    `Adapter: ${worker.adapter} ${worker.executableVersion ?? "unknown version"}`,
    `Worktree: ${worker.workingDirectory}`,
    `Last heartbeat: ${worker.lastObservedAt ?? "not yet"}`,
    worker.pendingControl ? `Pending control: ${worker.pendingControl}` : null,
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

export async function recoverLiveWorkersForStatus(
  store: Pick<PostgresTaskStore, "liveWorkers" | "transitionWorker">,
  projectRoot: string,
  deps: {
    isProcessAlive?: typeof workerProcessIsAlive;
    transition?: Pick<PostgresTaskStore, "transitionWorker">["transitionWorker"];
  } = {},
): Promise<number> {
  return recoverInterruptedWorkers({
    workers: await store.liveWorkers(projectRoot),
    isProcessAlive: (_processId, worker) => (deps.isProcessAlive ?? workerProcessIsAlive)(worker),
    transition: deps.transition ?? ((workerKey, update) => store.transitionWorker(workerKey, update)),
  });
}

export function formatMetrics(metrics: RuntimeMetrics): string {
  if (metrics.sessions === 0) return "No coding sessions recorded yet. The 5-day dogfood trial has not produced evidence.";
  const interpreted = metrics.acceptedInterpretations + metrics.correctedInterpretations + metrics.replacedInterpretations;
  const successfulResumes = metrics.resumedWithoutRestatement;
  const lines = [
    `Rolling five-working-day window since ${metrics.windowStartedAt}`,
    `Verified tasks: ${metrics.completedTasks}/${metrics.tasks}`,
    `Sessions: ${metrics.sessions}`,
    `Resumed without context restatement: ${rate(successfulResumes, metrics.resumedSessions)} (${successfulResumes}/${metrics.resumedSessions})`,
    `Interpretation accepted unchanged: ${rate(metrics.acceptedInterpretations, interpreted)}`,
    `Focused corrections: ${metrics.correctedInterpretations}`,
    `Manual context restatements: ${metrics.manualContextRestatements}`,
    `Escapes to another coding tool: ${metrics.toolEscapes}`,
  ];
  if (!hasControlTrialEvidence(metrics)) {
    lines.push("Release 1B control trial: insufficient evidence; no routed assignment, control, renewal, conflict, or integration has been recorded.");
  } else {
    lines.push(
      `Routed assignments: ${metrics.routedAssignments} (Codex ${metrics.codexAssignments}, OpenCode ${metrics.openCodeAssignments})`,
      `Accepted automatic interventions: ${metrics.acceptedInterventions}`,
      `Controls: stop ${metrics.stopControls}, retry ${metrics.retryControls}, redirect ${metrics.redirectControls}, replace ${metrics.replaceControls}`,
      `Integration conflicts: ${metrics.integrationConflicts}`,
      `Permission renewals: ${metrics.permissionRenewals}`,
      `Verified integrations: ${metrics.verifiedIntegrations}`,
      `Manual context transfers: ${metrics.manualContextTransfers}`,
    );
  }
  return lines.join("\n");
}

export function formatAcceptanceReport(report: ReleaseAcceptanceReport): string {
  const status = report.status === "qualified" ? "QUALIFIED" : report.status.replace("_", " ").toUpperCase();
  const lines = [
    `Release 1 acceptance: ${status}`,
    `Two-week primary-product trial: ${report.primaryProductTrial.status.replace("_", " ")}`,
    `Qualifying working days: ${report.primaryProductTrial.qualifyingWorkingDays}/10`,
    `Real sessions: ${report.technicalTrial.realSessions}/10`,
    `Resumed sessions: ${report.technicalTrial.resumedSessions}/5`,
    `Browser-visible propagation p95: ${report.propagation.p95Ms == null ? "no data" : `${report.propagation.p95Ms} ms`} (${report.propagation.sampleSize} samples; target <2000 ms)`,
    `Automated acceptance runs: ${report.automatedAcceptance.runs} (${report.automatedAcceptance.status.replace("_", " ")})`,
    ...report.measures.map((measure) =>
      `${measure.label}: ${measure.status.replace("_", " ")} (${measure.result})`
    ),
  ];
  if (report.status !== "qualified") {
    lines.push("Release 1 is not qualified. Missing or failing persisted evidence cannot be treated as success.");
  }
  return lines.join("\n");
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
    const recoveredWorkers = await recoverLiveWorkersForStatus(store, repository.root);
    if (recoveredWorkers > 0) {
      console.log(`Recovered ${recoveredWorkers} stale worker ${recoveredWorkers === 1 ? "session" : "sessions"} before reading task status.`);
    }
    const task = taskKey
      ? await store.findTask(taskKey)
      : await store.findResumableTask(repository.root) ?? (await store.listTasks(repository.root, 1))[0] ?? null;
    if (!task) {
      console.log("No Flyd coding task was found.");
      return;
    }
    const status = await commandService(store).execute({
      schemaVersion: 1,
      action: "task.status",
      actorSurface: "cli",
      taskKey: task.taskKey,
    });
    const currentTask = status.data.task as AgentTask;
    const workers = status.data.workers as WorkerSession[];
    const worker = workers.at(-1) ?? null;
    console.log(formatTask(currentTask));
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

export async function runTaskAcceptance(): Promise<void> {
  const pool = createRuntimePool();
  try {
    const store = new PostgresTaskStore(pool);
    const evidence = await store.releaseAcceptanceEvidence();
    console.log(formatAcceptanceReport(buildReleaseAcceptanceReport(evidence)));
  } finally {
    await pool.end();
  }
}

export async function runTaskAcceptanceReview(
  review: "memory" | "rationale",
  result: "passed" | "failed",
  note: string,
): Promise<void> {
  const boundedNote = note.trim();
  if (!boundedNote) throw new Error("An acceptance review note is required");
  if (boundedNote.length > 2_000) throw new Error("The acceptance review note is too long");
  const pool = createRuntimePool();
  try {
    const store = new PostgresTaskStore(pool);
    const kind: ReleaseAcceptanceObservationKind = review === "memory"
      ? "memory_safety"
      : "recommendation_rationale";
    await store.recordReleaseAcceptanceObservation({
      kind,
      passed: result === "passed",
      evidence: { note: boundedNote },
      idempotencyKey: randomUUID(),
    });
    console.log(`${review} review recorded: ${result}`);
  } finally {
    await pool.end();
  }
}

async function runAcceptanceCommand(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ command: string; exitStatus: number }> {
  const command = [executable, ...args].join(" ");
  const exitStatus = await new Promise<number>((resolve) => {
    const child = spawn(executable, args, { cwd, env, stdio: "inherit" });
    child.once("error", () => resolve(127));
    child.once("exit", (code) => resolve(code ?? 1));
  });
  return { command, exitStatus };
}

export function cleanRubyEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...env };
  for (const key of ["BUNDLE_GEMFILE", "BUNDLE_PATH", "GEM_HOME", "GEM_PATH", "RUBYLIB", "RUBYOPT"]) {
    delete clean[key];
  }
  return clean;
}

export async function resolveRepositoryRuby(
  repositoryRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): Promise<string> {
  try {
    const version = (await readFile(join(repositoryRoot, ".ruby-version"), "utf8")).trim();
    const rbenvRoot = env.RBENV_ROOT || join(home, ".rbenv");
    const executable = join(rbenvRoot, "versions", version, "bin", "ruby");
    await access(executable, constants.X_OK);
    return executable;
  } catch {
    return "ruby";
  }
}

export async function runTaskAcceptanceVerification(): Promise<void> {
  const repository = await inspectRepository();
  const packageJson = JSON.parse(await readFile(join(repository.root, "cli/package.json"), "utf8")) as {
    name?: string;
  };
  if (packageJson.name !== "@radarboy/flyd") {
    throw new Error("Automated Release 1 acceptance must run from the Flyd repository");
  }
  const ruby = await resolveRepositoryRuby(repository.root);
  const checks = [
    await runAcceptanceCommand(
      ruby,
      ["bin/rails", "test:all"],
      repository.root,
      cleanRubyEnvironment(process.env),
    ),
    await runAcceptanceCommand("npm", ["test"], join(repository.root, "cli")),
    await runAcceptanceCommand("npm", ["run", "lint"], join(repository.root, "cli")),
  ];
  const passed = checks.every((check) => check.exitStatus === 0);
  const pool = createRuntimePool();
  try {
    const store = new PostgresTaskStore(pool);
    await store.recordReleaseAcceptanceObservation({
      kind: "automated_acceptance",
      passed,
      evidence: {
        idempotent: passed,
        permissions_enforced: passed,
        no_duplicate_effects: passed,
        checks,
      },
      idempotencyKey: randomUUID(),
    });
    console.log(formatAcceptanceReport(
      buildReleaseAcceptanceReport(await store.releaseAcceptanceEvidence()),
    ));
  } finally {
    await pool.end();
  }
  if (!passed) throw new Error("The automated Release 1 acceptance run failed");
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
    const worker = await store.findWorker(workerKey);
    if (!worker) throw new Error(`Unknown worker ${workerKey}`);
    const task = await store.findTaskById(worker.agentTaskId);
    if (!task) throw new Error(`Unknown task for worker ${workerKey}`);
    const result = await commandService(store).execute({
      schemaVersion: 1,
      action: `task.${kind}_worker` as
        | "task.stop_worker"
        | "task.retry_worker"
        | "task.redirect_worker"
        | "task.replace_worker",
      actorSurface: "cli",
      taskKey: task.taskKey,
      expectedTaskRevision: task.revision,
      workerKey,
      ...(kind === "redirect" ? { instruction: instruction ?? "" } : {}),
      idempotencyKey: randomUUID(),
    });
    const command = result.data.command as { status: string; commandKey: string };
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
    const result = await commandService(store).execute({
      schemaVersion: 1,
      action: "task.confirm_completion",
      actorSurface: "cli",
      taskKey: task.taskKey,
      expectedTaskRevision: task.revision,
      summary,
      idempotencyKey: randomUUID(),
    });
    terminal.write(`Task ${result.taskKey}: completed\n`);
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
