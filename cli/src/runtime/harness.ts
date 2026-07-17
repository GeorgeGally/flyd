import { randomUUID } from "crypto";
import { buildContextPackage, buildOrientation } from "./orientation.js";
import { buildOpenCodeArgs, buildOpenCodePermissionConfig } from "./opencode-adapter.js";
import type {
  AgentTask,
  ContextPackage,
  MemoryEvidence,
  RepositorySnapshot,
  TaskGrant,
  WorkerSession,
} from "./types.js";

type Interpretation = "accepted" | "focused_corrected" | "replaced";

interface TaskStore {
  findResumableTask(projectRoot: string): Promise<AgentTask | null>;
  findTask(taskKey: string): Promise<AgentTask | null>;
  latestWorker(taskId: string): Promise<WorkerSession | null>;
  approvedGrant(taskId: string): Promise<TaskGrant | null>;
  createTask(input: {
    projectName: string;
    projectRoot: string;
    intendedOutcome: string;
    repository: RepositorySnapshot;
    idempotencyKey: string;
  }): Promise<AgentTask>;
  recordOrientation(taskKey: string, expectedRevision: number, input: {
    contextSnapshot: Record<string, unknown>;
    repositorySnapshot: Record<string, unknown>;
    recommendedNextAction: string;
    idempotencyKey: string;
  }): Promise<AgentTask>;
  recordCorrection(taskKey: string, expectedRevision: number, correction: string, input: {
    repositorySnapshot: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<AgentTask>;
  approveGrant(taskKey: string, expectedRevision: number, input: {
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
  }): Promise<TaskGrant>;
  startTaskSession(taskId: string, resumed: boolean, startupSnapshot: Record<string, unknown>): Promise<string>;
  finishTaskSession(sessionKey: string, input: {
    interpretation: "pending" | Interpretation;
    manualContextRestatement?: boolean;
    toolEscape?: boolean;
  }): Promise<void>;
  createWorker(input: {
    taskKey: string;
    grantKey: string;
    adapter: string;
    executablePath: string;
    executableVersion: string;
    workingDirectory: string;
    idempotencyKey: string;
  }): Promise<WorkerSession>;
  transitionWorker(workerKey: string, update: {
    status: "running" | "completed" | "failed" | "interrupted";
    processId?: number | null;
    externalSessionId?: string;
    exitStatus?: number;
    output?: string;
    error?: string;
    idempotencyKey: string;
  }): Promise<WorkerSession>;
  completeTask(taskKey: string, expectedRevision: number, input: {
    summary: string;
    verification: Record<string, unknown>;
    repositorySnapshot: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<AgentTask>;
  keepTaskOpen(taskKey: string, expectedRevision: number, input: {
    nextAction: string;
    repositorySnapshot: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<AgentTask>;
}

interface HarnessTerminal {
  write(message: string): void;
  ask(prompt: string): Promise<string>;
  confirm(prompt: string): Promise<boolean>;
  close(): Promise<void>;
}

export interface HarnessDependencies {
  store: TaskStore;
  terminal: HarnessTerminal;
  inspectRepository(path?: string): Promise<RepositorySnapshot>;
  retrieveMemory(query: string): Promise<MemoryEvidence>;
  detectOpenCode(): Promise<{ executable: string; version: string }>;
  recoverWorkers(projectRoot: string): Promise<number>;
  recoverSessions(projectRoot: string): Promise<number>;
  runWorker(input: {
    executable: string;
    args: string[];
    cwd: string;
    assignment: string;
    externalSessionId?: string;
    contextPath: string;
    timeoutMs: number;
    permissionConfig: ReturnType<typeof buildOpenCodePermissionConfig>;
    onStart?: (processId: number | null) => void | Promise<void>;
    onEvent?: (event: { sessionId: string | null }) => void;
  }): Promise<{ exitStatus: number; externalSessionId: string | null; output: string; error: string }>;
  writeContext(taskKey: string, context: ContextPackage): Promise<string>;
  now(): Date;
}

export interface HarnessResult {
  status: AgentTask["status"];
  taskKey: string;
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

function eventKey(taskKey: string, event: string): string {
  return `${taskKey}:${event}:${randomUUID()}`;
}

async function currentTask(store: TaskStore, taskKey: string): Promise<AgentTask> {
  const task = await store.findTask(taskKey);
  if (!task) throw new Error(`Task ${taskKey} disappeared`);
  return task;
}

export async function runContinuityHarness(input: {
  outcome?: string;
  cwd?: string;
  deps: HarnessDependencies;
}): Promise<HarnessResult> {
  const { deps } = input;
  let sessionKey: string | null = null;
  let interpretation: Interpretation = "accepted";
  let manualContextRestatement = false;
  const sessionResult = () => ({ interpretation, manualContextRestatement });

  try {
    let repository = await deps.inspectRepository(input.cwd);
    const recoveredWorkers = await deps.recoverWorkers(repository.root);
    if (recoveredWorkers > 0) {
      deps.terminal.write(`Recovered ${recoveredWorkers} interrupted worker ${recoveredWorkers === 1 ? "session" : "sessions"}.\n`);
    }
    const recoveredSessions = await deps.recoverSessions(repository.root);
    if (recoveredSessions > 0) {
      deps.terminal.write(`Closed ${recoveredSessions} abandoned Flyd ${recoveredSessions === 1 ? "session" : "sessions"}.\n`);
    }
    const resumedTask = await deps.store.findResumableTask(repository.root);
    const previousWorker = resumedTask ? await deps.store.latestWorker(resumedTask.id) : null;
    const outcome = input.outcome?.trim() || resumedTask?.intendedOutcome ||
      (await deps.terminal.ask("What outcome should Flyd accomplish?")).trim();
    if (!outcome) throw new Error("An intended outcome is required");

    let memory: MemoryEvidence;
    try {
      memory = await deps.retrieveMemory(`${repository.name}: ${outcome}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      memory = { verdict: "insufficient", matches: [] };
      deps.terminal.write(`Memory retrieval is unavailable (${message}). Continuing from task and repository truth.\n`);
    }
    const orientation = buildOrientation({ task: resumedTask, repository, worker: previousWorker, memory });
    deps.terminal.write(`\n${orientation.headline}\n${orientation.detail}\nNext: ${orientation.nextAction}\n`);

    let task = resumedTask ?? await deps.store.createTask({
      projectName: repository.name,
      projectRoot: repository.root,
      intendedOutcome: outcome,
      repository,
      idempotencyKey: eventKey(repository.statusDigest, "task-create"),
    });

    sessionKey = await deps.store.startTaskSession(task.id, Boolean(resumedTask), {
      repository: repositoryState(repository),
      orientation: orientation.kind,
      memory_verdict: memory.verdict,
      evidence_refs: orientation.evidenceRefs,
    });
    task = await currentTask(deps.store, task.taskKey);

    task = await deps.store.recordOrientation(task.taskKey, task.revision, {
      contextSnapshot: {
        memory_verdict: memory.verdict,
        evidence_refs: orientation.evidenceRefs,
        orientation: orientation.kind,
      },
      repositorySnapshot: repositoryState(repository),
      recommendedNextAction: resumedTask ? orientation.nextAction : outcome,
      idempotencyKey: eventKey(task.taskKey, "oriented"),
    });

    if (previousWorker && ["queued", "starting", "running"].includes(previousWorker.status)) {
      deps.terminal.write(
        `\nOpenCode worker ${previousWorker.workerKey} is still running${previousWorker.processId ? ` as process ${previousWorker.processId}` : ""}. Flyd will not launch a duplicate.\n`,
      );
      await deps.store.finishTaskSession(sessionKey, sessionResult());
      sessionKey = null;
      return { status: "running", taskKey: task.taskKey };
    }

    let assignment = outcome;
    if (resumedTask) {
      const explicitOutcome = input.outcome?.trim();
      let replacesInterpretation = Boolean(explicitOutcome && explicitOutcome !== resumedTask.intendedOutcome);
      const correction = explicitOutcome && explicitOutcome !== resumedTask.intendedOutcome
        ? explicitOutcome
        : explicitOutcome
          ? ""
          : (await deps.terminal.ask(
              `Press Enter to continue with "${orientation.nextAction}", or type a focused correction:`,
            )).trim();
      assignment = correction || explicitOutcome || orientation.nextAction;
      if (correction) {
        if (!replacesInterpretation) {
          replacesInterpretation = await deps.terminal.confirm(
            "Does this replace or restate the intended outcome, rather than focus the next action?",
          );
        }
        interpretation = replacesInterpretation ? "replaced" : "focused_corrected";
        manualContextRestatement = replacesInterpretation;
        task = await deps.store.recordCorrection(task.taskKey, task.revision, correction, {
          repositorySnapshot: repositoryState(repository),
          idempotencyKey: eventKey(task.taskKey, "corrected"),
        });
      }
    }

    let grant = await deps.store.approvedGrant(task.id);
    if (!grant) {
      deps.terminal.write(
        `\nProposed task grant\nRepository: ${repository.root}\nWorker: OpenCode\nProvider: OpenCode configured provider\nAllowed: read/write this repository; inspect, test, lint, build, and read Git state\nLimits: one worker at a time, three runs, 90 minutes each, expires in 8 hours\nRenew approval: destructive actions, external writes, deployment, publication, purchases, secrets, or permission changes\nVerification: git diff --check plus repository tests selected by the worker\n`,
      );
      if (!await deps.terminal.confirm("Approve this task grant?")) {
        await deps.store.finishTaskSession(sessionKey, sessionResult());
        sessionKey = null;
        return { status: "awaiting_grant", taskKey: task.taskKey };
      }
      grant = await deps.store.approveGrant(task.taskKey, task.revision, {
        repositoryRoots: [repository.root],
        worktreePaths: [],
        workerAdapters: ["opencode"],
        fileOperations: ["read", "write"],
        commandClasses: ["inspect", "test", "lint", "build", "git_status", "git_diff"],
        verificationCommands: ["git diff --check"],
        renewalRequiredActions: [
          "destructive_operation", "external_write", "deploy", "publish", "purchase",
          "secret_disclosure", "permission_change",
        ],
        maxConcurrency: 1,
        budget: { max_worker_runs: 3, max_runtime_minutes: 90 },
        providerIdentity: "opencode-configured-provider",
        expiresAt: new Date(deps.now().getTime() + 8 * 60 * 60 * 1000),
        idempotencyKey: eventKey(task.taskKey, "grant"),
      });
      task = await currentTask(deps.store, task.taskKey);
    }

    const context = buildContextPackage({ task, repository, worker: previousWorker, memory });
    let contextPath: string;
    let openCode: { executable: string; version: string };
    try {
      contextPath = await deps.writeContext(task.taskKey, context);
      openCode = await deps.detectOpenCode();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      task = await deps.store.keepTaskOpen(task.taskKey, task.revision, {
        nextAction: `Prepare OpenCode worker: ${message}`,
        repositorySnapshot: repositoryState(repository),
        idempotencyKey: eventKey(task.taskKey, "worker-preparation-failed"),
      });
      deps.terminal.write(`\nOpenCode could not start. ${task.recommendedNextAction}\n`);
      await deps.store.finishTaskSession(sessionKey, sessionResult());
      sessionKey = null;
      return { status: task.status, taskKey: task.taskKey };
    }
    let worker: WorkerSession;
    try {
      worker = await deps.store.createWorker({
        taskKey: task.taskKey,
        grantKey: grant.grantKey,
        adapter: "opencode",
        executablePath: openCode.executable,
        executableVersion: openCode.version,
        workingDirectory: repository.root,
        idempotencyKey: eventKey(task.taskKey, "worker-queued"),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      task = await deps.store.keepTaskOpen(task.taskKey, task.revision, {
        nextAction: `Create approved worker: ${message}`,
        repositorySnapshot: repositoryState(repository),
        idempotencyKey: eventKey(task.taskKey, "worker-create-failed"),
      });
      await deps.store.finishTaskSession(sessionKey, sessionResult());
      sessionKey = null;
      return { status: task.status, taskKey: task.taskKey };
    }

    let workerTransitions = Promise.resolve<WorkerSession>(worker);
    let recordedSessionId: string | null = null;
    const externalSessionId = previousWorker?.status === "interrupted"
      ? previousWorker.externalSessionId ?? undefined
      : undefined;
    const args = buildOpenCodeArgs({
      assignment,
      projectRoot: repository.root,
      taskKey: task.taskKey,
      contextPath,
      externalSessionId,
    });
    deps.terminal.write(`\nOpenCode is working on: ${assignment}\n`);
    let result: { exitStatus: number; externalSessionId: string | null; output: string; error: string };
    try {
      result = await deps.runWorker({
        executable: openCode.executable,
        args,
        cwd: repository.root,
        assignment,
        externalSessionId,
        contextPath,
        timeoutMs: 90 * 60 * 1000,
        permissionConfig: buildOpenCodePermissionConfig({
          fileOperations: grant.fileOperations,
          commandClasses: grant.commandClasses,
        }),
        onStart: async (processId) => {
          workerTransitions = workerTransitions.then(() =>
            deps.store.transitionWorker(worker.workerKey, {
              status: "running",
              processId,
              idempotencyKey: eventKey(task.taskKey, "worker-running"),
            }),
          );
          await workerTransitions;
        },
        onEvent: (event) => {
          if (!event.sessionId || event.sessionId === recordedSessionId) return;
          recordedSessionId = event.sessionId;
          workerTransitions = workerTransitions.then(() =>
            deps.store.transitionWorker(worker.workerKey, {
              status: "running",
              externalSessionId: event.sessionId!,
              idempotencyKey: eventKey(task.taskKey, "worker-session-observed"),
            }),
          );
        },
      });
    } catch (error) {
      await workerTransitions;
      const message = error instanceof Error ? error.message : String(error);
      await deps.store.transitionWorker(worker.workerKey, {
        status: "failed",
        error: message,
        idempotencyKey: eventKey(task.taskKey, "worker-launch-failed"),
      });
      task = await currentTask(deps.store, task.taskKey);
      repository = await deps.inspectRepository(repository.root);
      task = await deps.store.keepTaskOpen(task.taskKey, task.revision, {
        nextAction: `Investigate worker failure: ${message}`,
        repositorySnapshot: repositoryState(repository),
        idempotencyKey: eventKey(task.taskKey, "worker-launch-reentry"),
      });
      await deps.store.finishTaskSession(sessionKey, sessionResult());
      sessionKey = null;
      return { status: task.status, taskKey: task.taskKey };
    }
    await workerTransitions;
    await deps.store.transitionWorker(worker.workerKey, {
      status: result.exitStatus === 0 ? "completed" : "failed",
      externalSessionId: result.externalSessionId ?? undefined,
      exitStatus: result.exitStatus,
      output: result.output,
      error: result.error,
      idempotencyKey: eventKey(task.taskKey, result.exitStatus === 0 ? "worker-completed" : "worker-failed"),
    });
    task = await currentTask(deps.store, task.taskKey);
    repository = await deps.inspectRepository(repository.root);

    if (result.exitStatus !== 0) {
      const nextAction = `Investigate worker failure: ${result.error.trim() || `exit ${result.exitStatus}`}`;
      task = await deps.store.keepTaskOpen(task.taskKey, task.revision, {
        nextAction,
        repositorySnapshot: repositoryState(repository),
        idempotencyKey: eventKey(task.taskKey, "worker-failure-reentry"),
      });
      deps.terminal.write(`\nWorker stopped. ${nextAction}\n`);
      await deps.store.finishTaskSession(sessionKey, sessionResult());
      sessionKey = null;
      return { status: task.status, taskKey: task.taskKey };
    }

    deps.terminal.write(`\nWorker report\n${result.output.trim() || "No textual summary was returned."}\n`);
    const verified = await deps.terminal.confirm("Does the repository now satisfy the intended outcome?");
    if (verified) {
      task = await deps.store.completeTask(task.taskKey, task.revision, {
        summary: result.output.trim() || "Worker completed and the user verified the repository outcome.",
        verification: { user_confirmed: true, confirmed_at: deps.now().toISOString() },
        repositorySnapshot: repositoryState(repository),
        idempotencyKey: eventKey(task.taskKey, "completed"),
      });
    } else {
      task = await deps.store.keepTaskOpen(task.taskKey, task.revision, {
        nextAction: "Review the worker changes and provide a focused correction",
        repositorySnapshot: repositoryState(repository),
        idempotencyKey: eventKey(task.taskKey, "verification-deferred"),
      });
    }

    await deps.store.finishTaskSession(sessionKey, sessionResult());
    sessionKey = null;
    return { status: task.status, taskKey: task.taskKey };
  } finally {
    if (sessionKey) {
      await deps.store.finishTaskSession(sessionKey, sessionResult());
    }
    await deps.terminal.close();
  }
}
