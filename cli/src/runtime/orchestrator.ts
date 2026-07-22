import { createHash, randomUUID } from "crypto";
import { realpath } from "fs/promises";
import {
  integrateVerifiedResults,
  preflightVerifiedResults,
  rollbackIntegratedResult,
  type IntegrationResult,
} from "./result-integrator.js";
import { filesOutsideScope, verifyWorkerResult, type VerifiedWorkerResult } from "./result-verifier.js";
import { chooseIntervention } from "./intervention-policy.js";
import { readProcessIdentity } from "./recovery.js";
import { inspectRepository } from "./repository-inspector.js";
import { routeWorker } from "./worker-router.js";
import type {
  AgentTask,
  RepositorySnapshot,
  TaskAssignment,
  TaskArtifactDraft,
  TaskGrant,
  WorkerCommand,
  WorkerSession,
} from "./types.js";
import { nonInteractiveAssignment, type WorkerAdapter, type WorkerHealth } from "./worker-adapter.js";
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
    resumesWorkerSessionId?: string | null;
    idempotencyKey: string;
  }): Promise<WorkerSession>;
  findResumeSource?(assignmentKey: string): Promise<WorkerSession | null>;
  claimWorkerStart?(workerKey: string, maxRuntimeMinutes: number, idempotencyKey: string): Promise<{
    worker: WorkerSession;
    deadlineAt: string;
  }>;
  findWorker?(workerKey: string): Promise<WorkerSession | null>;
  transitionWorker(workerKey: string, update: {
    status: "running" | "completed" | "failed" | "interrupted";
    processId?: number | null;
    processGroupId?: number | null;
    processIdentity?: string | null;
    externalSessionId?: string;
    exitStatus?: number;
    output?: string;
    error?: string;
    idempotencyKey: string;
  }): Promise<WorkerSession>;
  observeWorker?(workerKey: string): Promise<void>;
  workerAuthority?(workerKey: string): Promise<boolean>;
  recordAssignmentVerification(
    assignmentKey: string,
    input: {
      status: "verified" | "failed" | "blocked";
      result: Record<string, unknown>;
      artifacts?: TaskArtifactDraft[];
      idempotencyKey: string;
    },
  ): Promise<unknown>;
  queueWorkerCommand(
    workerKey: string,
    kind: "stop" | "retry" | "replace",
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<{ command: WorkerCommand; worker: WorkerSession }>;
  completeWorkerCommand(commandKey: string, input: {
    workerStatus: "stopped" | "interrupted" | "replaced" | null;
  }): Promise<WorkerCommand>;
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

export function grantRuntimeTimeoutMs(grant: TaskGrant, now = Date.now()): number {
  if (grant.status !== "approved") throw new Error("Worker start requires an approved task grant");
  const budgetMs = Number(grant.budget.max_runtime_minutes ?? 90) * 60_000;
  const expiryMs = grant.expiresAt ? new Date(grant.expiresAt).getTime() - now : budgetMs;
  const timeoutMs = Math.min(budgetMs, expiryMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Task grant expired before worker start");
  return timeoutMs;
}

function eventKey(prefix: string): string {
  return `${prefix}:${randomUUID()}`;
}

const CONTROLLED_WORKER_STATUSES = new Set([
  "stopping", "stopped", "interrupted", "replaced", "cancelled",
]);

function workerWasControlled(worker: WorkerSession | null | undefined): boolean {
  return Boolean(worker && CONTROLLED_WORKER_STATUSES.has(worker.status));
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

const MAX_TEXT_ARTIFACT_BYTES = 256 * 1024;
const MAX_REVIEW_SUMMARY_CHARACTERS = 4_000;

function reviewSummary(
  assignments: TaskAssignment[],
  workerOutcomes: Map<string, string>,
  fallback: string,
): string {
  const outcomes = assignments.filter((assignment) => workerOutcomes.get(assignment.assignmentKey)?.trim());
  if (outcomes.length === 0) return fallback;
  const summary = outcomes.length === 1
    ? workerOutcomes.get(outcomes[0].assignmentKey)!.trim()
    : outcomes.map((assignment) => (
      `## ${assignment.title}\n\n${workerOutcomes.get(assignment.assignmentKey)!.trim()}`
    )).join("\n\n");
  return summary.length > MAX_REVIEW_SUMMARY_CHARACTERS
    ? `${summary.slice(0, MAX_REVIEW_SUMMARY_CHARACTERS - 18).trimEnd()}\n\n[Summary truncated]`
    : summary;
}

function redactArtifactText(value: string): string {
  return value
    .replace(/\b(sk-[A-Za-z0-9_-]{16,})\b/g, "[REDACTED]")
    .replace(/\b(api[_-]?key|token|secret|password)(\s*[:=]\s*)([^\s]+)/gi, "$1$2[REDACTED]");
}

function textArtifact(
  kind: TaskArtifactDraft["kind"],
  title: string,
  mediaType: string,
  rawContent: string,
  verificationStatus: TaskArtifactDraft["verificationStatus"],
  provenance: Record<string, unknown>,
  repositoryHead: string,
): TaskArtifactDraft {
  const fullContent = redactArtifactText(rawContent);
  const bytes = Buffer.from(fullContent, "utf8");
  const truncated = bytes.byteLength > MAX_TEXT_ARTIFACT_BYTES;
  const content = truncated
    ? `${bytes.subarray(0, MAX_TEXT_ARTIFACT_BYTES).toString("utf8")}\n\n[Truncated ${bytes.byteLength - MAX_TEXT_ARTIFACT_BYTES} bytes]`
    : fullContent;
  const retainedBytes = Buffer.from(content, "utf8");
  return {
    kind,
    title,
    mediaType,
    byteSize: bytes.byteLength,
    sha256Digest: createHash("sha256").update(bytes).digest("hex"),
    verificationStatus,
    content,
    repositoryHead,
    provenance: {
      ...provenance,
      truncated,
      retained_bytes: retainedBytes.byteLength,
      retained_sha256_digest: createHash("sha256").update(retainedBytes).digest("hex"),
    },
  };
}

function verificationArtifacts(
  verification: VerifiedWorkerResult,
  workerResult: { output: string; error: string },
  verificationStatus: TaskArtifactDraft["verificationStatus"],
): TaskArtifactDraft[] {
  const artifacts: TaskArtifactDraft[] = [];
  if (verification.patch) {
    artifacts.push(textArtifact(
      "diff",
      `Patch across ${verification.changedFiles.length} changed file${verification.changedFiles.length === 1 ? "" : "s"}`,
      "text/x-diff",
      verification.patch,
      verificationStatus,
      { changed_files: verification.changedFiles, patch_digest: verification.patchDigest },
      verification.head,
    ));
  }
  for (const command of verification.commands) {
    artifacts.push(textArtifact(
      "test",
      command.command,
      "text/plain",
      [
        `$ ${command.command}`,
        `exit ${command.exitStatus}`,
        command.stdout ? `\nstdout:\n${command.stdout}` : "",
        command.stderr ? `\nstderr:\n${command.stderr}` : "",
      ].join("\n"),
      command.exitStatus === 0 && verificationStatus === "verified" ? "verified" : "rejected",
      { command: command.command, exit_status: command.exitStatus, output_digest: command.outputDigest },
      verification.head,
    ));
  }
  const workerLog = [workerResult.output, workerResult.error].filter(Boolean).join("\n\n");
  if (workerLog) {
    artifacts.push(textArtifact(
      "log",
      "Worker result",
      "text/plain",
      workerLog,
      verificationStatus,
      {},
      verification.head,
    ));
  }
  return artifacts;
}

interface RepositoryIntegrationGroup {
  repositoryRoot: string;
  results: VerifiedWorkerResult[];
  verificationCommands: string[];
}

export async function integrateRepositoryGroups(input: {
  groups: RepositoryIntegrationGroup[];
  taskKey: string;
  primaryRepositoryRoot: string;
  repositorySnapshots: ReadonlyMap<string, RepositorySnapshot>;
  manager: GitWorktreeManager;
  integrate?: typeof integrateVerifiedResults;
}): Promise<IntegrationResult> {
  const integrate = input.integrate ?? integrateVerifiedResults;
  const preflightResults = await Promise.all(input.groups.map(async (group) => ({
    repositoryRoot: group.repositoryRoot,
    result: await preflightVerifiedResults({
      repositoryRoot: group.repositoryRoot,
      taskKey: input.taskKey,
      baseSnapshot: input.repositorySnapshots.get(group.repositoryRoot)!,
      results: group.results,
      verificationCommands: group.verificationCommands,
      manager: input.manager,
    }),
  })));
  const blockedPreflight = preflightResults.find(({ result }) => result.status === "blocked");
  if (blockedPreflight) {
    return {
      status: "blocked",
      reason: `${blockedPreflight.repositoryRoot}: ${blockedPreflight.result.reason ?? "Integration preflight blocked"}`,
      changedFiles: preflightResults.flatMap(({ repositoryRoot, result }) => (
        result.changedFiles.map((file) => `${repositoryRoot}:${file}`)
      )),
      patchDigest: null,
    };
  }

  const repositoryResults: Array<{ repositoryRoot: string; result: IntegrationResult }> = [];
  for (const group of input.groups) {
    let result: IntegrationResult;
    try {
      result = await integrate({
        repositoryRoot: group.repositoryRoot,
        taskKey: input.taskKey,
        baseSnapshot: input.repositorySnapshots.get(group.repositoryRoot)!,
        results: group.results,
        verificationCommands: group.verificationCommands,
        manager: input.manager,
      });
    } catch (error) {
      result = {
        status: "blocked", reason: error instanceof Error ? error.message : String(error),
        changedFiles: [], patchDigest: null,
      };
    }
    repositoryResults.push({ repositoryRoot: group.repositoryRoot, result });
    if (result.status === "blocked") {
      try {
        for (const completed of repositoryResults.slice(0, -1).reverse()) {
          await rollbackIntegratedResult({
            repositoryRoot: completed.repositoryRoot,
            baseSnapshot: input.repositorySnapshots.get(completed.repositoryRoot)!,
            integration: completed.result,
          });
        }
      } catch (rollbackError) {
        result.reason = `${result.reason ?? "Integration blocked"}. Compensating rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`;
      }
      break;
    }
  }

  const blocked = repositoryResults.find(({ result }) => result.status === "blocked");
  if (blocked) {
    return {
      status: "blocked",
      reason: `${blocked.repositoryRoot}: ${blocked.result.reason ?? "Integration blocked"}`,
      changedFiles: repositoryResults.flatMap(({ repositoryRoot, result }) => (
        result.changedFiles.map((file) => `${repositoryRoot}:${file}`)
      )),
      patchDigest: null,
    };
  }
  if (repositoryResults.length === 1) return repositoryResults[0].result;
  return {
    status: "integrated",
    reason: null,
    changedFiles: repositoryResults.flatMap(({ repositoryRoot, result }) => (
      result.changedFiles.map((file) => `${repositoryRoot}:${file}`)
    )),
    patchDigest: createHash("sha256").update(repositoryResults.map(({ repositoryRoot, result }) => (
      `${repositoryRoot}:${result.patchDigest ?? ""}`
    )).join("\n")).digest("hex"),
    repositorySnapshot: repositoryResults.find(({ repositoryRoot }) => repositoryRoot === input.primaryRepositoryRoot)?.result.repositorySnapshot,
  };
}

export async function orchestrateAssignments(input: {
  task: AgentTask;
  grant: TaskGrant;
  assignments: TaskAssignment[];
  repository: RepositorySnapshot;
  verificationCommandsByRepository?: Record<string, string[]>;
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
  const primaryRepositoryRoot = await realpath(input.repository.root);
  const approvedRepositoryRoots = new Set(await Promise.all(input.grant.repositoryRoots.map((root) => realpath(root))));
  const verificationCommandsByRepository = new Map<string, string[]>();
  for (const [root, commands] of Object.entries(input.verificationCommandsByRepository ?? {})) {
    verificationCommandsByRepository.set(await realpath(root), commands);
  }
  const repositorySnapshots = new Map<string, RepositorySnapshot>([[primaryRepositoryRoot, input.repository]]);
  const assignmentRepositories = new Map<string, string>();
  const workerOutcomes = new Map<string, string>();
  const completed = new Set<string>();
  const remaining = new Map(input.assignments.map((assignment) => [assignment.assignmentKey, assignment]));
  let workerRuns = 0;
  const maxWorkerRuns = Number(input.grant.budget.max_worker_runs ?? input.assignments.length);

  for (const assignment of input.assignments) {
    const repositoryRoot = await realpath(assignment.repositoryRoot ?? input.repository.root);
    if (!approvedRepositoryRoots.has(repositoryRoot)) {
      return {
        status: "blocked",
        summary: `Assignment ${assignment.title} targets a repository outside the approved task grant`,
        verification: { passed: false },
      };
    }
    assignmentRepositories.set(assignment.assignmentKey, repositoryRoot);
    if (!repositorySnapshots.has(repositoryRoot)) {
      repositorySnapshots.set(repositoryRoot, await inspectRepository(repositoryRoot));
    }
  }

  const runAssignment = async (assignment: TaskAssignment): Promise<void> => {
    const repositoryRoot = assignmentRepositories.get(assignment.assignmentKey)!;
    const repository = repositorySnapshots.get(repositoryRoot)!;
    if (assignment.baseHead && assignment.baseHead !== repository.head) {
      const evidenceDigest = createHash("sha256")
        .update(`${assignment.assignmentKey}:${assignment.baseHead}:${repository.head}`)
        .digest("hex");
      const intervention = chooseIntervention({
        trigger: "repository_changed",
        evidenceDigest,
        priorEvidenceDigests: [],
        remainingRuns: maxWorkerRuns - workerRuns,
        replacementAvailable: false,
      });
      await input.deps.store.recordAssignmentVerification(assignment.assignmentKey, {
        status: "blocked",
        result: {
          passed: false,
          recorded_base_head: assignment.baseHead,
          current_head: repository.head,
          intervention,
        },
        idempotencyKey: eventKey(`assignment-stale:${assignment.assignmentKey}`),
      });
      throw new Error(intervention.reason);
    }
    const worktree = await input.deps.manager.prepare({
      repositoryRoot,
      taskKey: input.task.taskKey,
      assignmentKey: assignment.assignmentKey,
      baseHead: repository.head,
    });
    await input.deps.store.updateAssignmentWorkspace(assignment.assignmentKey, {
      worktreePath: worktree.path,
      branchName: worktree.branchName,
      baseHead: worktree.baseHead,
      idempotencyKey: eventKey(`assignment-worktree:${assignment.assignmentKey}`),
    });

    const excluded = [...assignment.excludedAdapters];
    let resumeSource = await input.deps.store.findResumeSource?.(assignment.assignmentKey) ?? null;
    const priorEvidenceDigests: string[] = [];
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
        resumesWorkerSessionId: resumeSource?.id ?? null,
        idempotencyKey: eventKey(`worker-create:${assignment.assignmentKey}`),
      });
      const assignmentCanWrite = input.grant.fileOperations.includes("write") &&
        assignment.capabilityRequirements.includes("implementation");
      const args = adapter.buildArgs({
        assignment: nonInteractiveAssignment(assignment.instructions),
        projectRoot: worktree.path,
        taskKey: input.task.taskKey,
        contextPath: input.contextPath,
        externalSessionId: resumeSource?.externalSessionId ?? undefined,
        readOnly: !assignmentCanWrite,
      });
      let recordedSession: string | null = null;
      let lastPersistedObservationAt = 0;
      let workerTransitions = Promise.resolve(worker);
      const timeout = {} as {
        reason?: "runtime" | "inactive" | "authority";
        control?: { command: WorkerCommand; worker: WorkerSession };
      };
      let adapterCrashed = false;
      let controlledWorker = false;
      let terminalWorker: WorkerSession | null = null;
      let result;
      try {
        const claim = await input.deps.store.claimWorkerStart?.(
          worker.workerKey,
          Number(input.grant.budget.max_runtime_minutes ?? 90),
          eventKey(`worker-starting:${worker.workerKey}`),
        );
        const timeoutMs = claim
          ? Math.max(1, new Date(claim.deadlineAt).getTime() - Date.now())
          : grantRuntimeTimeoutMs(input.grant);
        result = await adapter.run({
          executable: selected.executable,
          args,
          cwd: worktree.path,
          allowedReadPaths: [ input.contextPath ],
          timeoutMs,
          inactivityTimeoutMs: Number(input.grant.budget.max_inactivity_minutes ?? 10) * 60_000,
          onStart: async (processId) => {
            workerTransitions = workerTransitions.then(() => input.deps.store.transitionWorker(worker.workerKey, {
              status: "running",
              processId,
              processGroupId: processId,
              processIdentity: processId ? readProcessIdentity(processId) : null,
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
          onActivity: () => {
            const now = Date.now();
            if (!input.deps.store.observeWorker || now - lastPersistedObservationAt < 5_000) return;
            lastPersistedObservationAt = now;
            workerTransitions = workerTransitions.then(async (currentWorker) => {
              await input.deps.store.observeWorker!(worker.workerKey);
              return currentWorker;
            });
          },
          onAuthorityCheck: input.deps.store.workerAuthority
            ? () => input.deps.store.workerAuthority!(worker.workerKey)
            : undefined,
          onTimeout: async (reason) => {
            const evidenceDigest = createHash("sha256")
              .update(`${assignment.assignmentKey}:${worker.workerKey}:${reason}`)
              .digest("hex");
            const explanation = reason === "inactive"
              ? chooseIntervention({
                trigger: "inactive",
                evidenceDigest,
                priorEvidenceDigests,
                remainingRuns: maxWorkerRuns - workerRuns,
                replacementAvailable: false,
              }).reason
              : reason === "authority"
                ? "The worker's task grant expired or was revoked"
                : "The worker exceeded the approved absolute runtime budget";
            timeout.reason = reason;
            timeout.control = await input.deps.store.queueWorkerCommand(
              worker.workerKey,
              "stop",
              {
                trigger: reason === "inactive" ? "inactive" : reason === "authority" ? "grant_authority" : "runtime_budget",
                evidence_digest: evidenceDigest,
                reason: explanation,
              },
              eventKey(`${reason}-stop:${worker.workerKey}`),
            );
          },
        });
      } catch (error) {
        await workerTransitions;
        const message = error instanceof Error ? error.message : String(error);
        const currentWorker = await input.deps.store.findWorker?.(worker.workerKey);
        controlledWorker = workerWasControlled(currentWorker);
        if (!controlledWorker) {
          const failedWorker = await input.deps.store.transitionWorker(worker.workerKey, {
            status: "failed",
            error: message,
            idempotencyKey: eventKey(`worker-crashed:${worker.workerKey}`),
          });
          controlledWorker = workerWasControlled(failedWorker);
        }
        adapterCrashed = true;
        result = {
          exitStatus: 1,
          externalSessionId: recordedSession,
          output: "",
          error: message,
        };
      } finally {
        activeCounts[selected.name] -= 1;
      }
      await workerTransitions;
      if (timeout.control) {
        const control = timeout.control;
        const workerStatus = control.command.kind === "redirect"
          ? "interrupted"
          : control.command.kind === "replace"
            ? "replaced"
            : "stopped";
        await input.deps.store.completeWorkerCommand(control.command.commandKey, { workerStatus });
        const reason = timeout.reason === "runtime"
          ? "The worker was stopped after exceeding the approved absolute runtime budget"
          : timeout.reason === "authority"
            ? "The worker was stopped because its task grant expired or was revoked"
          : "The worker was stopped after exceeding the approved inactivity threshold";
        const intervention = {
          action: "stop",
          automatic: true,
          reason,
        };
        await input.deps.store.recordAssignmentVerification(assignment.assignmentKey, {
          status: "blocked",
          result: { passed: false, intervention },
          idempotencyKey: eventKey(`assignment-inactive:${assignment.assignmentKey}`),
        });
        throw new Error(intervention.reason);
      }
      controlledWorker ||= workerWasControlled(await input.deps.store.findWorker?.(worker.workerKey));
      if (controlledWorker) {
        throw new Error("Worker ended after an explicit control; Flyd will not retry it automatically");
      }
      if (!adapterCrashed) {
        terminalWorker = await input.deps.store.transitionWorker(worker.workerKey, {
          status: result.exitStatus === 0 ? "completed" : "failed",
          externalSessionId: result.externalSessionId ?? undefined,
          exitStatus: result.exitStatus,
          output: result.output,
          error: result.exitStatus === 0 ? undefined : result.error,
          idempotencyKey: eventKey(`worker-terminal:${worker.workerKey}`),
        });
        if (workerWasControlled(terminalWorker)) {
          throw new Error("Worker ended after an explicit control; Flyd will not retry it automatically");
        }
      }
      const verification = await verifyWorkerResult({
        worktreePath: worktree.path,
        baseHead: repository.head,
        commands: verificationCommandsByRepository.get(repositoryRoot) ?? input.grant.verificationCommands,
        requireChanges: assignmentCanWrite,
        requireUnchanged: !assignmentCanWrite,
      });
      const outOfScopeFiles = filesOutsideScope(verification.changedFiles, assignment.declaredFileScope);
      if (outOfScopeFiles.length > 0) {
        const evidenceDigest = createHash("sha256")
          .update(`${assignment.assignmentKey}:${outOfScopeFiles.join("\n")}`)
          .digest("hex");
        const intervention = chooseIntervention({
          trigger: "scope_expansion",
          evidenceDigest,
          priorEvidenceDigests,
          remainingRuns: maxWorkerRuns - workerRuns,
          replacementAvailable: false,
        });
        await input.deps.store.recordAssignmentVerification(assignment.assignmentKey, {
          status: "blocked",
          result: {
            ...verificationPayload(verification),
            declared_file_scope: assignment.declaredFileScope,
            out_of_scope_files: outOfScopeFiles,
            intervention,
          },
          artifacts: verificationArtifacts(verification, result, "rejected"),
          idempotencyKey: eventKey(`assignment-scope:${assignment.assignmentKey}`),
        });
        throw new Error(`${intervention.reason}: ${outOfScopeFiles.join(", ")}`);
      }
      if (result.exitStatus === 0 && verification.passed) {
        await input.deps.store.recordAssignmentVerification(assignment.assignmentKey, {
          status: "verified",
          result: verificationPayload(verification),
          artifacts: verificationArtifacts(verification, result, "verified"),
          idempotencyKey: eventKey(`assignment-verified:${assignment.assignmentKey}`),
        });
        verified.set(assignment.assignmentKey, verification);
        workerOutcomes.set(assignment.assignmentKey, result.output);
        return;
      }

      const evidenceDigest = createHash("sha256").update(JSON.stringify({
        assignmentKey: assignment.assignmentKey,
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
          artifacts: verificationArtifacts(verification, result, "rejected"),
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
      if (intervention.action === "replace") {
        excluded.push(selected.name);
        resumeSource = null;
      } else {
        resumeSource = terminalWorker ?? await input.deps.store.findWorker?.(worker.workerKey) ?? null;
      }
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

  let integration: IntegrationResult;
  try {
    const assignmentGroups = new Map<string, TaskAssignment[]>();
    for (const assignment of input.assignments) {
      const repositoryRoot = assignmentRepositories.get(assignment.assignmentKey)!;
      assignmentGroups.set(repositoryRoot, [...(assignmentGroups.get(repositoryRoot) ?? []), assignment]);
    }
    integration = await integrateRepositoryGroups({
      groups: [...assignmentGroups].map(([repositoryRoot, assignments]) => ({
        repositoryRoot,
        results: assignments.map((assignment) => verified.get(assignment.assignmentKey)!),
        verificationCommands: verificationCommandsByRepository.get(repositoryRoot) ?? input.grant.verificationCommands,
      })),
      taskKey: input.task.taskKey,
      primaryRepositoryRoot,
      repositorySnapshots,
      manager: input.deps.manager,
    });
  } catch (error) {
    integration = {
      status: "blocked",
      reason: `Integration failed without changing main: ${error instanceof Error ? error.message : String(error)}`,
      changedFiles: [...new Set([...verified.values()].flatMap((result) => result.changedFiles))].sort(),
      patchDigest: null,
    };
  }
  await input.deps.store.recordTaskIntegration(input.task.taskKey, {
    result: integration,
    idempotencyKey: eventKey(`task-integration:${input.task.taskKey}`),
  });
  return {
    status: integration.status,
    summary: integration.status === "integrated"
      ? reviewSummary(
          input.assignments,
          workerOutcomes,
          `Integrated ${integration.changedFiles.length} changed files from ${input.assignments.length} verified assignments`,
        )
      : integration.reason ?? "Integration blocked",
    verification: integration.verification ? verificationPayload(integration.verification) : { passed: false },
  };
}
