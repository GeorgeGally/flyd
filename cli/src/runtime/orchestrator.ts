import { createHash, randomUUID } from "crypto";
import { integrateVerifiedResults, type IntegrationResult } from "./result-integrator.js";
import { verifyWorkerResult, type VerifiedWorkerResult } from "./result-verifier.js";
import { chooseIntervention } from "./intervention-policy.js";
import { routeWorker } from "./worker-router.js";
import type {
  AgentTask,
  RepositorySnapshot,
  TaskAssignment,
  TaskGrant,
  WorkerCommand,
  WorkerSession,
} from "./types.js";
import type { WorkerAdapter, WorkerHealth } from "./worker-adapter.js";
import { GitWorktreeManager } from "./worktree-manager.js";

interface OrchestrationStore {
  updateAssignmentWorkspace(
    assignmentKey: string,
    input: { worktreePath: string; branchName: string; baseHead: string; idempotencyKey: string },
  ): Promise<unknown>;
  createWorker(input: {
    taskKey: string;
    grantKey: string;
    assignmentKey: string;
    adapter: string;
    capabilities: string[];
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
  recordAssignmentVerification(
    assignmentKey: string,
    input: { status: "verified" | "failed" | "blocked"; result: Record<string, unknown>; idempotencyKey: string },
  ): Promise<unknown>;
  queueWorkerCommand(
    workerKey: string,
    kind: "retry" | "replace",
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<{ command: WorkerCommand; worker: WorkerSession }>;
  completeWorkerCommand(commandKey: string, input: { workerStatus: null }): Promise<WorkerCommand>;
  recordTaskIntegration(
    taskKey: string,
    input: { result: IntegrationResult; idempotencyKey: string },
  ): Promise<unknown>;
}

export interface OrchestrationResult {
  status: "integrated" | "blocked";
  summary: string;
  verification: Record<string, unknown>;
}

function eventKey(prefix: string): string {
  return `${prefix}:${randomUUID()}`;
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

export async function orchestrateAssignments(input: {
  task: AgentTask;
  grant: TaskGrant;
  assignments: TaskAssignment[];
  repository: RepositorySnapshot;
  contextPath: string;
  adapters: WorkerAdapter[];
  deps: { store: OrchestrationStore; manager: GitWorktreeManager };
}): Promise<OrchestrationResult> {
  const health = await Promise.all(input.adapters.map((adapter) => adapter.detect().catch((error): WorkerHealth => ({
    name: adapter.name,
    executable: "",
    version: "",
    healthy: false,
    capabilities: adapter.capabilities,
    error: error instanceof Error ? error.message : String(error),
  }))));
  const adapters = new Map(input.adapters.map((adapter) => [adapter.name, adapter]));
  const activeCounts: Record<string, number> = {};
  const verified = new Map<string, VerifiedWorkerResult>();
  const completed = new Set<string>();
  const remaining = new Map(input.assignments.map((assignment) => [assignment.assignmentKey, assignment]));
  const priorEvidenceDigests: string[] = [];
  let workerRuns = 0;
  const maxWorkerRuns = Number(input.grant.budget.max_worker_runs ?? input.assignments.length);

  const runAssignment = async (assignment: TaskAssignment): Promise<void> => {
    const worktree = await input.deps.manager.prepare({
      repositoryRoot: input.repository.root,
      taskKey: input.task.taskKey,
      assignmentKey: assignment.assignmentKey,
      baseHead: input.repository.head,
    });
    await input.deps.store.updateAssignmentWorkspace(assignment.assignmentKey, {
      worktreePath: worktree.path,
      branchName: worktree.branchName,
      baseHead: worktree.baseHead,
      idempotencyKey: eventKey(`assignment-worktree:${assignment.assignmentKey}`),
    });

    const excluded = [...assignment.excludedAdapters];
    for (;;) {
      const selected = routeWorker({
        requirements: assignment.capabilityRequirements,
        adapters: health,
        activeCounts,
        excludedAdapters: excluded,
      });
      const adapter = adapters.get(selected.name)!;
      workerRuns += 1;
      activeCounts[selected.name] = (activeCounts[selected.name] ?? 0) + 1;
      const worker = await input.deps.store.createWorker({
        taskKey: input.task.taskKey,
        grantKey: input.grant.grantKey,
        assignmentKey: assignment.assignmentKey,
        adapter: selected.name,
        capabilities: selected.capabilities,
        executablePath: selected.executable,
        executableVersion: selected.version,
        workingDirectory: worktree.path,
        idempotencyKey: eventKey(`worker-create:${assignment.assignmentKey}`),
      });
      const args = adapter.buildArgs({
        assignment: assignment.instructions,
        projectRoot: worktree.path,
        taskKey: input.task.taskKey,
        contextPath: input.contextPath,
      });
      let recordedSession: string | null = null;
      let workerTransitions = Promise.resolve(worker);
      const result = await adapter.run({
        executable: selected.executable,
        args,
        cwd: worktree.path,
        timeoutMs: Number(input.grant.budget.max_runtime_minutes ?? 90) * 60_000,
        onStart: async (processId) => {
          workerTransitions = workerTransitions.then(() => input.deps.store.transitionWorker(worker.workerKey, {
            status: "running",
            processId,
            idempotencyKey: eventKey(`worker-running:${worker.workerKey}`),
          }));
          await workerTransitions;
        },
        onEvent: (event) => {
          if (!event.sessionId || event.sessionId === recordedSession) return;
          recordedSession = event.sessionId;
          workerTransitions = workerTransitions.then(() => input.deps.store.transitionWorker(worker.workerKey, {
            status: "running",
            externalSessionId: event.sessionId!,
            idempotencyKey: eventKey(`worker-session:${worker.workerKey}`),
          }));
        },
      });
      activeCounts[selected.name] -= 1;
      await workerTransitions;
      await input.deps.store.transitionWorker(worker.workerKey, {
        status: result.exitStatus === 0 ? "completed" : "failed",
        externalSessionId: result.externalSessionId ?? undefined,
        exitStatus: result.exitStatus,
        output: result.output,
        error: result.error,
        idempotencyKey: eventKey(`worker-terminal:${worker.workerKey}`),
      });
      const verification = await verifyWorkerResult({
        worktreePath: worktree.path,
        baseHead: input.repository.head,
        commands: input.grant.verificationCommands,
      });
      if (result.exitStatus === 0 && verification.passed) {
        await input.deps.store.recordAssignmentVerification(assignment.assignmentKey, {
          status: "verified",
          result: verificationPayload(verification),
          idempotencyKey: eventKey(`assignment-verified:${assignment.assignmentKey}`),
        });
        verified.set(assignment.assignmentKey, verification);
        return;
      }

      const evidenceDigest = createHash("sha256").update(JSON.stringify({
        exitStatus: result.exitStatus,
        error: result.error,
        patchDigest: verification.patchDigest,
        commands: verification.commands.map((command) => [command.command, command.exitStatus, command.outputDigest]),
      })).digest("hex");
      const replacementAvailable = health.some((candidate) => (
        candidate.healthy && candidate.name !== selected.name && !excluded.includes(candidate.name) &&
        assignment.capabilityRequirements.every((requirement) => candidate.capabilities.includes(requirement))
      ));
      const intervention = chooseIntervention({
        trigger: result.exitStatus === 0 ? "verification_failed" : "worker_failed",
        evidenceDigest,
        priorEvidenceDigests,
        remainingRuns: maxWorkerRuns - workerRuns,
        replacementAvailable,
      });
      priorEvidenceDigests.push(evidenceDigest);
      if (intervention.action !== "retry" && intervention.action !== "replace") {
        await input.deps.store.recordAssignmentVerification(assignment.assignmentKey, {
          status: "blocked",
          result: { ...verificationPayload(verification), intervention },
          idempotencyKey: eventKey(`assignment-blocked:${assignment.assignmentKey}`),
        });
        throw new Error(intervention.reason);
      }
      const control = await input.deps.store.queueWorkerCommand(
        worker.workerKey,
        intervention.action,
        { evidence_digest: evidenceDigest, reason: intervention.reason },
        eventKey(`intervention:${worker.workerKey}`),
      );
      await input.deps.store.completeWorkerCommand(control.command.commandKey, { workerStatus: null });
      if (intervention.action === "replace") excluded.push(selected.name);
    }
  };

  try {
    while (remaining.size > 0) {
      const ready = [...remaining.values()].filter((assignment) => (
        assignment.dependencyKeys.every((key) => completed.has(key))
      )).slice(0, input.grant.maxConcurrency);
      if (ready.length === 0) throw new Error("Assignment dependencies cannot make progress");
      await Promise.all(ready.map(runAssignment));
      for (const assignment of ready) {
        completed.add(assignment.assignmentKey);
        remaining.delete(assignment.assignmentKey);
      }
    }
  } catch (error) {
    return {
      status: "blocked",
      summary: error instanceof Error ? error.message : String(error),
      verification: { passed: false },
    };
  }

  const integration = await integrateVerifiedResults({
    repositoryRoot: input.repository.root,
    taskKey: input.task.taskKey,
    baseSnapshot: input.repository,
    results: input.assignments.map((assignment) => verified.get(assignment.assignmentKey)!),
    verificationCommands: input.grant.verificationCommands,
    manager: input.deps.manager,
  });
  await input.deps.store.recordTaskIntegration(input.task.taskKey, {
    result: integration,
    idempotencyKey: eventKey(`task-integration:${input.task.taskKey}`),
  });
  return {
    status: integration.status,
    summary: integration.status === "integrated"
      ? `Integrated ${integration.changedFiles.length} changed files from ${input.assignments.length} verified assignments`
      : integration.reason ?? "Integration blocked",
    verification: integration.verification ? verificationPayload(integration.verification) : { passed: false },
  };
}
