import { randomUUID } from "crypto";
import { actionableTaskNextAction, buildContextPackage, buildOrientation } from "./orientation.js";
import { buildOpenCodeArgs, buildOpenCodePermissionConfig } from "./opencode-adapter.js";
import type {
  AgentTask,
  ContextPackage,
  MemoryEvidence,
  Orientation,
  RepositorySnapshot,
  TaskGrant,
  WorkerSession,
} from "./types.js";
import type { RuntimeCommandResult } from "./runtime-command-contract.js";

type Interpretation = "accepted" | "focused_corrected" | "replaced";

interface TaskStore {
  findResumableTask(projectRoot: string): Promise<AgentTask | null>;
  findTask(taskKey: string): Promise<AgentTask | null>;
  latestWorker(taskId: string): Promise<WorkerSession | null>;
  approvedGrant(taskId: string): Promise<TaskGrant | null>;
  workerRunCount(grantId: string): Promise<number>;
  proposedGrant(taskId: string): Promise<TaskGrant | null>;
  revokeGrant(taskKey: string, expectedRevision: number, grantKey: string, input: {
    reason: string;
    idempotencyKey: string;
  }): Promise<AgentTask>;
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
    originalClaim?: string;
    actorSurface?: "cli" | "rails";
    idempotencyKey: string;
  }): Promise<AgentTask>;
  proposeGrant(taskKey: string, expectedRevision: number, input: {
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
  approveGrantProposal(
    taskKey: string,
    expectedRevision: number,
    grantKey: string,
    idempotencyKey: string,
  ): Promise<TaskGrant>;
  rejectGrantProposal(
    taskKey: string,
    expectedRevision: number,
    grantKey: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<TaskGrant>;
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
  runtimeCommands: {
    execute(request: unknown): Promise<RuntimeCommandResult>;
  };
  orchestrationGrantScope?: {
    workerAdapters: string[];
    worktreeRoot: string;
    providerIdentity: string;
  };
  orchestrate?(input: {
    task: AgentTask;
    grant: TaskGrant;
    repository: RepositorySnapshot;
    memory: MemoryEvidence;
    contextPath: string;
    assignment: string;
  }): Promise<{
    status: "integrated" | "blocked";
    summary: string;
    verification: Record<string, unknown>;
  }>;
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

function grantSupportsOrchestration(
  grant: TaskGrant,
  scope: NonNullable<HarnessDependencies["orchestrationGrantScope"]>,
): boolean {
  const maxWorkerRuns = Number(grant.budget.max_worker_runs ?? 0);

  return scope.workerAdapters.every((adapter) => grant.workerAdapters.includes(adapter))
    && grant.worktreePaths.includes(scope.worktreeRoot)
    && grant.maxConcurrency >= 2
    && maxWorkerRuns >= 4;
}

async function currentTask(store: TaskStore, taskKey: string): Promise<AgentTask> {
  const task = await store.findTask(taskKey);
  if (!task) throw new Error(`Task ${taskKey} disappeared`);
  return task;
}

function orchestrationReentryAction(task: AgentTask, assignment: string, summary: string): string {
  if (!summary.trim().startsWith("No healthy worker satisfies:")) return summary;
  return assignment.trim().startsWith("No healthy worker satisfies:")
    ? actionableTaskNextAction(task)
    : assignment;
}

function startupStateLabel(orientation: Orientation): string {
  switch (orientation.kind) {
    case "new":
      return orientation.detail;
    case "resume_changed":
      return "The repository changed since Flyd last recorded this task. Current Git state is the source of truth.";
    case "resume_interrupted":
      return "The last worker stopped before Flyd could finish the task.";
    case "resume":
      return "The repository matches Flyd's last recorded task state.";
  }
  return orientation.detail;
}

function renderStartupOrientation(input: {
  orientation: Orientation;
  outcome: string;
  worker: WorkerSession | null;
}): string {
  const workerLine = input.worker
    ? `\nWorker: ${input.worker.adapter} ${input.worker.status}${input.worker.errorSummary ? ` (${input.worker.errorSummary})` : ""}`
    : "";

  return [
    "",
    "Flyd Daily Agent",
    `You are working on: ${input.outcome}`,
    `Current state: ${startupStateLabel(input.orientation)}${workerLine}`,
    `Recommended move: ${input.orientation.nextAction}`,
  ].join("\n") + "\n";
}

function workerIsLive(worker: WorkerSession | null): worker is WorkerSession {
  return Boolean(worker && ["queued", "starting", "running", "stopping"].includes(worker.status));
}

function liveWorkerMessage(worker: WorkerSession): string {
  return `\n${worker.adapter} worker ${worker.workerKey} is still running${worker.processId ? ` as process ${worker.processId}` : ""}. Flyd will not launch a duplicate.\n`;
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
    deps.terminal.write(renderStartupOrientation({ orientation, outcome, worker: previousWorker }));
    const interruptedSessionId = previousWorker?.status === "interrupted"
      ? previousWorker.externalSessionId ?? undefined
      : undefined;

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

    if (workerIsLive(previousWorker)) {
      deps.terminal.write(liveWorkerMessage(previousWorker));
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
              "Press Enter to let Flyd handle this, or type a focused correction:",
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
          originalClaim: replacesInterpretation ? resumedTask.intendedOutcome : orientation.nextAction,
          actorSurface: "cli",
          idempotencyKey: eventKey(task.taskKey, "corrected"),
        });
      }
    }

    if (resumedTask) {
      const concurrentWorker = await deps.store.latestWorker(task.id);
      if (workerIsLive(concurrentWorker)) {
        deps.terminal.write(liveWorkerMessage(concurrentWorker));
        await deps.store.finishTaskSession(sessionKey, sessionResult());
        sessionKey = null;
        return { status: "running", taskKey: task.taskKey };
      }
    }

    let grant = await deps.store.approvedGrant(task.id);
    if (grant && deps.orchestrationGrantScope && !grantSupportsOrchestration(grant, deps.orchestrationGrantScope)) {
      task = await deps.store.revokeGrant(task.taskKey, task.revision, grant.grantKey, {
        reason: "Release 1B orchestration requires renewed bounded authority",
        idempotencyKey: eventKey(task.taskKey, "grant-renewal"),
      });
      grant = null;
    }
    if (grant) {
      const maxWorkerRuns = Number(grant.budget.max_worker_runs ?? 0);
      if (maxWorkerRuns > 0 && await deps.store.workerRunCount(grant.id) >= maxWorkerRuns) {
        task = await deps.store.revokeGrant(task.taskKey, task.revision, grant.grantKey, {
          reason: "The approved worker-run budget is exhausted",
          idempotencyKey: eventKey(task.taskKey, "grant-budget-renewal"),
        });
        grant = null;
      }
    }
    if (!grant) {
      const orchestrationScope = deps.orchestrationGrantScope;
      const workerLabel = orchestrationScope ? "Flyd-routed Codex and OpenCode" : "OpenCode";
      const providerLabel = orchestrationScope?.providerIdentity ?? "OpenCode configured provider";
      const limitLabel = orchestrationScope
        ? "two isolated workers at a time, four total runs"
        : "one worker at a time, three runs";
      let proposal = await deps.store.proposedGrant(task.id);
      if (!proposal) {
        proposal = await deps.store.proposeGrant(task.taskKey, task.revision, {
          repositoryRoots: [repository.root],
          worktreePaths: orchestrationScope ? [orchestrationScope.worktreeRoot] : [],
          workerAdapters: orchestrationScope?.workerAdapters ?? ["opencode"],
          fileOperations: ["read", "write"],
          commandClasses: ["inspect", "test", "lint", "build", "git_status", "git_diff"],
          verificationCommands: ["git diff --check"],
          renewalRequiredActions: [
            "destructive_operation", "external_write", "deploy", "publish", "purchase",
            "secret_disclosure", "permission_change",
          ],
          maxConcurrency: orchestrationScope ? 2 : 1,
          budget: {
            max_worker_runs: orchestrationScope ? 4 : 3,
            max_runtime_minutes: 90,
            max_inactivity_minutes: 10,
          },
          providerIdentity: orchestrationScope?.providerIdentity ?? "opencode-configured-provider",
          expiresAt: new Date(deps.now().getTime() + 8 * 60 * 60 * 1000),
          idempotencyKey: eventKey(task.taskKey, "grant-proposed"),
        });
        task = await currentTask(deps.store, task.taskKey);
      }
      deps.terminal.write(
        `\nProposed task grant\nRepository: ${repository.root}\nWorker: ${workerLabel}\nProvider: ${providerLabel}\nAllowed: read/write isolated worktrees; inspect, test, lint, build, integrate verified results, and read Git state\nLimits: ${limitLabel}, 90 minutes each, expires in 8 hours\nRenew approval: destructive actions, external writes, deployment, publication, purchases, secrets, or permission changes\nVerification: grant-approved commands, including git diff --check\n`,
      );
      if (!await deps.terminal.confirm("Approve this task grant?")) {
        await deps.runtimeCommands.execute({
          schemaVersion: 1,
          action: "task.reject_grant",
          actorSurface: "cli",
          taskKey: task.taskKey,
          expectedTaskRevision: task.revision,
          grantKey: proposal.grantKey,
          reason: "The user rejected the proposed task grant",
          idempotencyKey: eventKey(task.taskKey, "grant-rejected"),
        });
        await deps.store.finishTaskSession(sessionKey, sessionResult());
        sessionKey = null;
        return { status: "awaiting_grant", taskKey: task.taskKey };
      }
      const approval = await deps.runtimeCommands.execute({
        schemaVersion: 1,
        action: "task.approve_grant",
        actorSurface: "cli",
        taskKey: task.taskKey,
        expectedTaskRevision: task.revision,
        grantKey: proposal.grantKey,
        idempotencyKey: eventKey(task.taskKey, "grant-approved"),
      });
      grant = approval.data.grant as TaskGrant;
      task = await currentTask(deps.store, task.taskKey);
    }

    const context = buildContextPackage({ task, repository, worker: previousWorker, memory });
    if (deps.orchestrate) {
      let orchestration;
      if (task.verificationResult.integrated === true) {
        const changedFiles = Array.isArray(task.verificationResult.changed_files)
          ? task.verificationResult.changed_files
          : [];
        orchestration = {
          status: "integrated" as const,
          summary: `Review the previously verified integration (${changedFiles.length} changed files)`,
          verification: task.verificationResult,
        };
      } else {
        let contextPath: string;
        try {
          contextPath = await deps.writeContext(task.taskKey, context);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          task = await deps.store.keepTaskOpen(task.taskKey, task.revision, {
            nextAction: `Prepare worker context: ${message}`,
            repositorySnapshot: repositoryState(repository),
            idempotencyKey: eventKey(task.taskKey, "orchestration-preparation-failed"),
          });
          await deps.store.finishTaskSession(sessionKey, sessionResult());
          sessionKey = null;
          return { status: task.status, taskKey: task.taskKey };
        }
        orchestration = await deps.orchestrate({
          task,
          grant,
          repository,
          memory,
          contextPath,
          assignment,
        });
      }
      task = await currentTask(deps.store, task.taskKey);
      repository = await deps.inspectRepository(repository.root);
      deps.terminal.write(`\nFlyd review\n${orchestration.summary}\n`);
      if (orchestration.status === "integrated" &&
          await deps.terminal.confirm("Does the verified integrated result satisfy the intended outcome?")) {
        task = await deps.store.completeTask(task.taskKey, task.revision, {
          summary: orchestration.summary.trim().slice(0, 4_000) || "Verified integrated result confirmed by the user.",
          verification: {
            ...orchestration.verification,
            user_confirmed: true,
            confirmed_at: deps.now().toISOString(),
          },
          repositorySnapshot: repositoryState(repository),
          idempotencyKey: eventKey(task.taskKey, "orchestration-completed"),
        });
      } else {
        task = await deps.store.keepTaskOpen(task.taskKey, task.revision, {
          nextAction: orchestration.status === "blocked"
            ? orchestrationReentryAction(task, assignment, orchestration.summary)
            : "Review the integrated changes and provide a focused correction",
          repositorySnapshot: repositoryState(repository),
          idempotencyKey: eventKey(task.taskKey, "orchestration-reentry"),
        });
      }
      await deps.store.finishTaskSession(sessionKey, sessionResult());
      sessionKey = null;
      return { status: task.status, taskKey: task.taskKey };
    }

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
    const args = buildOpenCodeArgs({
      assignment,
      projectRoot: repository.root,
      taskKey: task.taskKey,
      contextPath,
      externalSessionId: interruptedSessionId,
    });
    deps.terminal.write(`\nOpenCode is working on: ${assignment}\n`);
    let result: { exitStatus: number; externalSessionId: string | null; output: string; error: string };
    try {
      result = await deps.runWorker({
        executable: openCode.executable,
        args,
        cwd: repository.root,
        assignment,
        externalSessionId: interruptedSessionId,
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
      error: result.exitStatus === 0 ? undefined : result.error,
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
        summary: result.output.trim().slice(0, 4_000) || "Worker completed and the user verified the repository outcome.",
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
