import { randomUUID } from "crypto";
import { actionableTaskNextAction, buildContextPackage, buildOrientation } from "./orientation.js";
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
const ORCHESTRATION_COMMAND_CLASSES = [ "inspect", "test", "lint", "build", "git_status", "git_diff" ];
const RENEWAL_REQUIRED_ACTIONS = [
  "destructive_operation", "external_write", "deploy", "publish", "purchase",
  "secret_disclosure", "permission_change",
];
const ORCHESTRATION_BUDGET = {
  max_worker_runs: 4,
  max_runtime_minutes: 90,
  max_inactivity_minutes: 10,
};

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
  offerTaskRecommendation(sessionKey: string, input: {
    taskKey: string;
    taskRevision: number;
    action: string;
  }): Promise<void>;
  actOnTaskRecommendation(
    sessionKey: string,
    disposition: "accepted" | "adapted" | "rejected",
  ): Promise<void>;
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
  completeLocalTask(taskKey: string, expectedRevision: number, input: {
    summary: string;
    verification: Record<string, unknown>;
    repositorySnapshot: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<AgentTask>;
  cancelTask(taskKey: string, expectedRevision: number, input: {
    reason: string;
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
  resolveRepositoryRoots?(outcome: string, primaryRoot: string): Promise<string[]>;
  resolveVerificationCommands?(primaryRoot: string): Promise<string[]>;
  detectWorker(): Promise<{ executable: string; version: string }>;
  workerAdapterName: string;
  buildWorkerArgs(input: {
    assignment: string;
    projectRoot: string;
    taskKey: string;
    contextPath: string;
    externalSessionId?: string;
  }): string[];
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
    permissionConfig: Record<string, unknown>;
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

function requestIsReadOnly(value: string): boolean {
  const requestsChanges = /\b(add|build|change|create|delete|fix|implement|make|migrate|modify|move|refactor|remove|repair|replace|resolve|update|write)\b/i.test(value);
  const requestsAssessment = /\b(analy[sz]e|assess|audit|explain|inspect|investigate|look at|review|status|summari[sz]e)\b/i.test(value);
  return requestsAssessment && !requestsChanges;
}

function grantSupportsOrchestration(
  grant: TaskGrant,
  scope: NonNullable<HarnessDependencies["orchestrationGrantScope"]>,
  repositoryRoots: string[],
  verificationCommands: string[],
  fileOperations: string[],
): boolean {
  const maxWorkerRuns = Number(grant.budget.max_worker_runs ?? 0);

  const sameMembers = (left: string[], right: string[]) => left.length === right.length &&
    left.every((value) => right.includes(value));

  return sameMembers(scope.workerAdapters, grant.workerAdapters)
    && sameMembers(repositoryRoots, grant.repositoryRoots)
    && sameMembers(verificationCommands, grant.verificationCommands)
    && sameMembers(ORCHESTRATION_COMMAND_CLASSES, grant.commandClasses)
    && sameMembers(RENEWAL_REQUIRED_ACTIONS, grant.renewalRequiredActions)
    && grant.fileOperations.length === fileOperations.length
    && fileOperations.every((operation) => grant.fileOperations.includes(operation))
    && sameMembers([ scope.worktreeRoot ], grant.worktreePaths)
    && grant.maxConcurrency === 2
    && maxWorkerRuns === ORCHESTRATION_BUDGET.max_worker_runs
    && Number(grant.budget.max_runtime_minutes ?? 0) === ORCHESTRATION_BUDGET.max_runtime_minutes
    && Number(grant.budget.max_inactivity_minutes ?? 0) === ORCHESTRATION_BUDGET.max_inactivity_minutes
    && grant.providerIdentity === scope.providerIdentity;
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

function requestsLocalProjectBriefing(task: AgentTask, nextAction: string): boolean {
  const outcome = task.intendedOutcome.toLowerCase();
  const text = `${outcome}\n${nextAction}`.toLowerCase();
  const asksForStatus = /\b(status|review|assess|inspect|look at|summari[sz]e|current state|what'?s going on)\b/.test(text);
  const asksForEdits = /\b(add|build|change|create|delete|fix|implement|make|migrate|modify|move|refactor|remove|repair|replace|resolve|update|write)\b/.test(outcome);
  return asksForStatus && !asksForEdits;
}

function renderLocalProjectBriefing(input: {
  task: AgentTask;
  repository: RepositorySnapshot;
  worker: WorkerSession | null;
  recoveredWorkers: number;
  recoveredSessions: number;
}): string {
  const repositoryState = input.repository.dirty
    ? `${input.repository.statusLines.length} uncommitted change${input.repository.statusLines.length === 1 ? "" : "s"}`
    : "clean working tree";
  const workerState = input.worker
    ? `${input.worker.adapter} ${input.worker.status}${input.worker.errorSummary ? ` (${input.worker.errorSummary})` : ""}`
    : "no active worker";
  const cleanup = [
    input.recoveredWorkers > 0 ? `${input.recoveredWorkers} stale worker session${input.recoveredWorkers === 1 ? "" : "s"}` : null,
    input.recoveredSessions > 0 ? `${input.recoveredSessions} abandoned Flyd session${input.recoveredSessions === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join("; ");

  return [
    "",
    "Project brief",
    "Handled locally. This was a status request, so Flyd did not launch another coding worker.",
    `Repository: ${input.repository.branch} at ${input.repository.head.slice(0, 12)}; ${repositoryState}.`,
    `Task: ${input.task.intendedOutcome}`,
    `Worker: ${workerState}.`,
    cleanup ? `Runtime cleanup: ${cleanup}.` : null,
    "Next: give Flyd a concrete outcome to change, or open the web surface for the same task.",
  ].filter(Boolean).join("\n") + "\n";
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
    const recoveredSessions = await deps.recoverSessions(repository.root);
    const resumedTask = await deps.store.findResumableTask(repository.root);
    const resumableIntegrationIsCurrent = resumedTask?.verificationResult.integrated === true &&
      Number(resumedTask.verificationResult.integration_revision) === resumedTask.revision;
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
    if (task.recommendedNextAction?.trim()) {
      await deps.store.offerTaskRecommendation(sessionKey, {
        taskKey: task.taskKey,
        taskRevision: task.revision,
        action: task.recommendedNextAction,
      });
    }

    if (workerIsLive(previousWorker)) {
      deps.terminal.write(liveWorkerMessage(previousWorker));
      await deps.store.finishTaskSession(sessionKey, sessionResult());
      sessionKey = null;
      return { status: "running", taskKey: task.taskKey };
    }

    if (resumedTask && !input.outcome?.trim() && requestsLocalProjectBriefing(resumedTask, orientation.nextAction)) {
      await deps.store.actOnTaskRecommendation(sessionKey, "accepted");
      deps.terminal.write(renderLocalProjectBriefing({
        task: resumedTask,
        repository,
        worker: previousWorker,
        recoveredWorkers,
        recoveredSessions,
      }));
      task = await deps.store.completeLocalTask(task.taskKey, task.revision, {
        summary: `Reviewed project status locally. Repository ${repository.branch} at ${repository.head.slice(0, 12)} is ${repository.dirty ? "dirty" : "clean"}.`,
        verification: {
          local_project_briefing: true,
          worker_launched: false,
          recovered_workers: recoveredWorkers,
          recovered_sessions: recoveredSessions,
        },
        repositorySnapshot: repositoryState(repository),
        idempotencyKey: eventKey(task.taskKey, "local-project-briefing"),
      });
      await deps.store.finishTaskSession(sessionKey, sessionResult());
      sessionKey = null;
      return { status: task.status, taskKey: task.taskKey };
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

    const repositoryRoots = deps.resolveRepositoryRoots
      ? await deps.resolveRepositoryRoots(assignment, repository.root)
      : [ repository.root ];
    const verificationCommands = deps.resolveVerificationCommands
      ? [...new Set((await Promise.all(repositoryRoots.map((root) => (
          deps.resolveVerificationCommands!(root)
        )))).flat())]
      : [ "git diff --check" ];
    const fileOperations = requestIsReadOnly(assignment) ? [ "read" ] : [ "read", "write" ];
    let grant = await deps.store.approvedGrant(task.id);
    if (grant && deps.orchestrationGrantScope && !grantSupportsOrchestration(
      grant, deps.orchestrationGrantScope, repositoryRoots, verificationCommands, fileOperations,
    )) {
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
      const workerLabel = orchestrationScope?.workerAdapters.length === 1 && orchestrationScope.workerAdapters[0] === "flyd"
        ? "Flyd native coding runtime"
        : orchestrationScope
          ? `Flyd-routed ${orchestrationScope.workerAdapters.join(" and ")}`
        : "Flyd native coding runtime";
      const providerLabel = orchestrationScope?.providerIdentity ?? "Flyd configured provider";
      const limitLabel = orchestrationScope
        ? "two isolated workers at a time, four total runs"
        : "one worker at a time, three runs";
      let proposal = await deps.store.proposedGrant(task.id);
      if (proposal && orchestrationScope && !grantSupportsOrchestration(
        proposal, orchestrationScope, repositoryRoots, verificationCommands, fileOperations,
      )) {
        await deps.store.rejectGrantProposal(
          task.taskKey,
          task.revision,
          proposal.grantKey,
          "The requested task scope changed before approval",
          eventKey(task.taskKey, "stale-grant-proposal"),
        );
        task = await currentTask(deps.store, task.taskKey);
        proposal = null;
      }
      if (!proposal) {
        proposal = await deps.store.proposeGrant(task.taskKey, task.revision, {
          repositoryRoots,
          worktreePaths: orchestrationScope ? [orchestrationScope.worktreeRoot] : [],
          workerAdapters: orchestrationScope?.workerAdapters ?? [deps.workerAdapterName],
          fileOperations,
          commandClasses: ORCHESTRATION_COMMAND_CLASSES,
          verificationCommands,
          renewalRequiredActions: RENEWAL_REQUIRED_ACTIONS,
          maxConcurrency: orchestrationScope ? 2 : 1,
          budget: orchestrationScope ? ORCHESTRATION_BUDGET : {
            max_worker_runs: 3,
            max_runtime_minutes: 90,
            max_inactivity_minutes: 10,
          },
          providerIdentity: orchestrationScope?.providerIdentity ?? "flyd-configured-provider",
          expiresAt: new Date(deps.now().getTime() + 8 * 60 * 60 * 1000),
          idempotencyKey: eventKey(task.taskKey, "grant-proposed"),
        });
        task = await currentTask(deps.store, task.taskKey);
      }
      deps.terminal.write(
        `\nProposed task grant\nRepositories: ${repositoryRoots.join(", ")}\nWorker: ${workerLabel}\nProvider: ${providerLabel}\nAllowed: ${fileOperations.includes("write") ? "read/write isolated worktrees in the primary repository" : "read-only repository inspection"}; read additional repositories; inspect, test, lint, build, integrate verified results, and read Git state\nLimits: ${limitLabel}, 90 minutes each, expires in 8 hours\nRenew approval: destructive actions, external writes, deployment, publication, purchases, secrets, or permission changes\nVerification: ${verificationCommands.join(", ")}\n`,
      );
      if (!await deps.terminal.confirm("Approve this task grant?")) {
        if (resumedTask) {
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
          task = await currentTask(deps.store, task.taskKey);
        } else {
          task = await deps.store.cancelTask(task.taskKey, task.revision, {
            reason: "The user rejected the proposed task grant",
            idempotencyKey: eventKey(task.taskKey, "cancelled-after-grant-rejection"),
          });
        }
        await deps.store.finishTaskSession(sessionKey, sessionResult());
        sessionKey = null;
        return { status: task.status, taskKey: task.taskKey };
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

    await deps.store.actOnTaskRecommendation(
      sessionKey,
      interpretation === "accepted" ? "accepted" : interpretation === "focused_corrected" ? "adapted" : "rejected",
    );

    const context = buildContextPackage({ task, repository, worker: previousWorker, memory });
    if (deps.orchestrate) {
      let orchestration;
      if (resumableIntegrationIsCurrent && interpretation === "accepted") {
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
    let workerRuntime: { executable: string; version: string };
    try {
      contextPath = await deps.writeContext(task.taskKey, context);
      workerRuntime = await deps.detectWorker();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      task = await deps.store.keepTaskOpen(task.taskKey, task.revision, {
        nextAction: `Prepare Flyd worker: ${message}`,
        repositorySnapshot: repositoryState(repository),
        idempotencyKey: eventKey(task.taskKey, "worker-preparation-failed"),
      });
      deps.terminal.write(`\nFlyd worker could not start. ${task.recommendedNextAction}\n`);
      await deps.store.finishTaskSession(sessionKey, sessionResult());
      sessionKey = null;
      return { status: task.status, taskKey: task.taskKey };
    }
    let worker: WorkerSession;
    try {
      worker = await deps.store.createWorker({
        taskKey: task.taskKey,
        grantKey: grant.grantKey,
        adapter: deps.workerAdapterName,
        executablePath: workerRuntime.executable,
        executableVersion: workerRuntime.version,
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
    const args = deps.buildWorkerArgs({
      assignment,
      projectRoot: repository.root,
      taskKey: task.taskKey,
      contextPath,
      externalSessionId: interruptedSessionId,
    });
    deps.terminal.write(`\nFlyd is working on: ${assignment}\n`);
    let result: { exitStatus: number; externalSessionId: string | null; output: string; error: string };
    try {
      result = await deps.runWorker({
        executable: workerRuntime.executable,
        args,
        cwd: repository.root,
        assignment,
        externalSessionId: interruptedSessionId,
        contextPath,
        timeoutMs: 90 * 60 * 1000,
        permissionConfig: {
          fileOperations: grant.fileOperations,
          commandClasses: grant.commandClasses,
        },
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
