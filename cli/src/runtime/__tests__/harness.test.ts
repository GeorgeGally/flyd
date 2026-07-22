import { describe, expect, it, vi } from "vitest";
import { runContinuityHarness } from "../harness.js";
import type { AgentTask, RepositorySnapshot, TaskGrant, WorkerSession } from "../types.js";

const repository: RepositorySnapshot = {
  root: "/work/flyd", name: "GeorgeGally/flyd", remote: "git@github.com:GeorgeGally/flyd.git",
  branch: "main", head: "abc", dirty: false, statusLines: [], statusDigest: "clean",
};

function task(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "1", taskKey: "task-1", projectId: "1", projectName: repository.name, projectRoot: repository.root,
    status: "awaiting_grant", intendedOutcome: "Implement continuity",
    successCriteria: [], verificationCriteria: [], plan: {}, contextSnapshot: {},
    repositorySnapshot: { head: "abc", status_digest: "clean" }, recommendedNextAction: "Start the worker",
    outcomeSummary: null, verificationResult: {}, revision: 0, startedAt: "2026-07-17T00:00:00.000Z",
    completedAt: null, updatedAt: "2026-07-17T00:00:00.000Z", ...overrides,
  };
}

const grant: TaskGrant = {
  id: "2", grantKey: "grant-1", agentTaskId: "1", status: "approved", scopeDigest: "digest",
  repositoryRoots: [repository.root], worktreePaths: [], workerAdapters: ["flyd"],
  fileOperations: ["read", "write"], commandClasses: ["test", "git_status"],
  verificationCommands: ["git diff --check"], renewalRequiredActions: ["deploy"],
  maxConcurrency: 1, budget: { max_worker_runs: 3 }, providerIdentity: "flyd-configured-provider",
  approvedAt: "2026-07-17T00:01:00.000Z", expiresAt: "2026-07-17T08:00:00.000Z",
  decisionReason: null, decidedAt: "2026-07-17T00:01:00.000Z",
};

const worker: WorkerSession = {
  id: "3", workerKey: "worker-1", agentTaskId: "1", taskGrantId: "2", taskAssignmentId: "4",
  status: "queued", adapter: "flyd", capabilities: ["implementation"],
  executablePath: "/usr/bin/node", executableVersion: "native-1", workingDirectory: repository.root,
  externalSessionId: null, processId: null, processIdentity: null, errorSummary: null, output: null, exitStatus: null,
  startedAt: null, endedAt: null, lastObservedAt: null, stopReason: null,
};

function dependencies(overrides: Record<string, unknown> = {}) {
  let currentTask = task();
  const store = {
    findResumableTask: vi.fn(async (): Promise<AgentTask | null> => null),
    latestWorker: vi.fn(async (): Promise<WorkerSession | null> => null),
    proposedGrant: vi.fn(async (): Promise<TaskGrant | null> => null),
    createTask: vi.fn(async () => currentTask),
    recordOrientation: vi.fn(async (_key: string, _revision: number, input: { recommendedNextAction: string }) => {
      currentTask = { ...currentTask, revision: currentTask.revision + 1, recommendedNextAction: input.recommendedNextAction };
      return currentTask;
    }),
    recordCorrection: vi.fn(async (_key: string, _revision: number, correction: string) => {
      currentTask = { ...currentTask, revision: currentTask.revision + 1, recommendedNextAction: correction };
      return currentTask;
    }),
    approvedGrant: vi.fn(async (): Promise<TaskGrant | null> => null),
    workerRunCount: vi.fn(async () => 0),
    revokeGrant: vi.fn(async () => { currentTask = { ...currentTask, revision: currentTask.revision + 1, status: "awaiting_grant" }; return currentTask; }),
    proposeGrant: vi.fn(async () => {
      currentTask = { ...currentTask, revision: currentTask.revision + 1, status: "awaiting_grant" };
      return { ...grant, status: "proposed" as const, approvedAt: null, decidedAt: null };
    }),
    approveGrantProposal: vi.fn(async (
      _taskKey: string,
      _expectedRevision: number,
      _grantKey: string,
      _idempotencyKey: string,
    ) => {
      currentTask = { ...currentTask, revision: currentTask.revision + 1, status: "ready" };
      return grant;
    }),
    rejectGrantProposal: vi.fn(async (
      _taskKey: string,
      _expectedRevision: number,
      _grantKey: string,
      _reason: string,
      _idempotencyKey: string,
    ) => ({ ...grant, status: "revoked" as const })),
    startTaskSession: vi.fn(async () => "session-1"),
    offerTaskRecommendation: vi.fn(async () => undefined),
    actOnTaskRecommendation: vi.fn(async () => undefined),
    finishTaskSession: vi.fn(async () => undefined),
    createWorker: vi.fn(async () => { currentTask = { ...currentTask, revision: currentTask.revision + 1, status: "running" }; return worker; }),
    transitionWorker: vi.fn(async () => worker),
    findTask: vi.fn(async () => currentTask),
    completeTask: vi.fn(async () => { currentTask = { ...currentTask, revision: currentTask.revision + 1, status: "completed" }; return currentTask; }),
    completeLocalTask: vi.fn(async () => { currentTask = { ...currentTask, revision: currentTask.revision + 1, status: "completed" }; return currentTask; }),
    cancelTask: vi.fn(async () => {
      currentTask = { ...currentTask, revision: currentTask.revision + 1, status: "cancelled", recommendedNextAction: null };
      return currentTask;
    }),
    keepTaskOpen: vi.fn(async (_key: string, _revision: number, input: { nextAction: string }) => {
      currentTask = {
        ...currentTask,
        revision: currentTask.revision + 1,
        status: "ready",
        recommendedNextAction: input.nextAction,
      };
      return currentTask;
    }),
  };
  const terminal = {
    write: vi.fn(),
    ask: vi.fn(async () => "Implement continuity"),
    confirm: vi.fn(async () => true),
    close: vi.fn(async () => undefined),
  };
  const runtimeCommands = {
    execute: vi.fn(async (request: unknown) => {
      const command = request as { action: string; taskKey: string; expectedTaskRevision: number; grantKey: string; idempotencyKey: string; reason?: string };
      const decided = command.action === "task.approve_grant"
        ? await store.approveGrantProposal(command.taskKey, command.expectedTaskRevision, command.grantKey, command.idempotencyKey)
        : await store.rejectGrantProposal(
          command.taskKey,
          command.expectedTaskRevision,
          command.grantKey,
          command.reason ?? "rejected",
          command.idempotencyKey,
        );
      return {
        action: command.action as "task.approve_grant" | "task.reject_grant",
        taskKey: command.taskKey,
        taskRevision: currentTask.revision,
        data: { grant: decided },
      };
    }),
  };
  return {
    store, terminal, runtimeCommands,
    inspectRepository: vi.fn(async () => repository),
    retrieveMemory: vi.fn(async () => ({ verdict: "partial" as const, matches: [] })),
    detectWorker: vi.fn(async () => ({ executable: "/usr/bin/node", version: "native-1" })),
    workerAdapterName: "flyd",
    buildWorkerArgs: vi.fn(() => [ "/app/flyd-worker-process.js" ]),
    recoverWorkers: vi.fn(async () => 0),
    recoverSessions: vi.fn(async () => 0),
    runWorker: vi.fn(async () => ({ exitStatus: 0, externalSessionId: "ses_1", output: "Implemented it", error: "" })),
    writeContext: vi.fn(async () => "/tmp/context.md"),
    now: () => new Date("2026-07-17T00:00:00.000Z"),
    ...overrides,
  };
}

describe("runContinuityHarness", () => {
  it("delegates an approved task to the Release 1B orchestrator when available", async () => {
    const orchestrate = vi.fn(async () => ({
      status: "integrated" as const,
      summary: "Two assignments integrated",
      verification: { passed: true },
      repositorySnapshot: { head: "def", status_digest: "changed" },
    }));
    const deps = dependencies({
      orchestrate,
      planAssignments: vi.fn(async () => ({
        successCriteria: ["Implemented"],
        verificationCriteria: ["git diff --check"],
        assignments: [],
        source: "fallback" as const,
      })),
    });

    await runContinuityHarness({ outcome: "Implement continuity", deps });

    expect(orchestrate).toHaveBeenCalledOnce();
    expect(deps.runWorker).not.toHaveBeenCalled();
  });

  it("reviews an already integrated result without rerunning its workers", async () => {
    const orchestrate = vi.fn();
    const deps = dependencies({ orchestrate });
    let integratedTask = task({
      status: "ready",
      revision: 4,
      verificationResult: {
        integrated: true,
        integration_revision: 4,
        changed_files: ["app/models/task.rb"],
        patch_digest: "digest",
      },
    });
    deps.store.findResumableTask.mockResolvedValue(integratedTask);
    deps.store.recordOrientation.mockImplementation(async () => {
      integratedTask = { ...integratedTask, revision: integratedTask.revision + 1 };
      return integratedTask;
    });
    deps.store.findTask.mockImplementation(async () => integratedTask);
    deps.store.completeTask.mockImplementation(async () => {
      integratedTask = { ...integratedTask, revision: integratedTask.revision + 1, status: "completed" };
      return integratedTask;
    });
    deps.store.approvedGrant.mockResolvedValue(grant);

    const result = await runContinuityHarness({ outcome: "Implement continuity", deps });

    expect(orchestrate).not.toHaveBeenCalled();
    expect(deps.store.completeTask).toHaveBeenCalledWith(
      "task-1", expect.any(Number), expect.objectContaining({
        verification: expect.objectContaining({ integrated: true, user_confirmed: true }),
      }),
    );
    expect(result.status).toBe("completed");
  });

  it("reruns orchestration when integrated evidence belongs to an older revision", async () => {
    const orchestrate = vi.fn(async () => ({
      status: "integrated" as const,
      summary: "Fresh integration",
      verification: { passed: true },
    }));
    const deps = dependencies({ orchestrate });
    let staleTask = task({
      status: "ready",
      revision: 4,
      verificationResult: {
        integrated: true,
        integration_revision: 3,
        changed_files: ["old.txt"],
      },
    });
    deps.store.findResumableTask.mockResolvedValue(staleTask);
    deps.store.recordOrientation.mockImplementation(async () => {
      staleTask = { ...staleTask, revision: staleTask.revision + 1 };
      return staleTask;
    });
    deps.store.findTask.mockImplementation(async () => staleTask);
    deps.store.approvedGrant.mockResolvedValue(grant);

    await runContinuityHarness({ outcome: "Implement continuity", deps });

    expect(orchestrate).toHaveBeenCalledOnce();
  });

  it("renews a narrower Release 1A grant before starting Release 1B orchestration", async () => {
    const deps = dependencies({
      orchestrationGrantScope: {
        workerAdapters: ["codex", "opencode"],
        worktreeRoot: "/tmp/flyd-worktrees",
        providerIdentity: "codex:local,opencode:local",
      },
      orchestrate: vi.fn(async () => ({
        status: "integrated" as const,
        summary: "Integrated",
        verification: { passed: true },
      })),
    });
    deps.store.approvedGrant.mockResolvedValue(grant);

    await runContinuityHarness({ outcome: "Implement continuity", deps });

    expect(deps.store.revokeGrant).toHaveBeenCalledWith(
      "task-1", expect.any(Number), "grant-1", expect.objectContaining({
        reason: expect.stringMatching(/Release 1B/),
      }),
    );
    expect(deps.store.proposeGrant).toHaveBeenCalledWith(
      "task-1", expect.any(Number), expect.objectContaining({
        workerAdapters: ["codex", "opencode"],
        worktreePaths: ["/tmp/flyd-worktrees"],
        maxConcurrency: 2,
      }),
    );
    expect(deps.store.approveGrantProposal).toHaveBeenCalledWith(
      "task-1", expect.any(Number), "grant-1", expect.any(String),
    );
  });

  it("renews an exhausted orchestration grant before creating another worker", async () => {
    const worktreeRoot = "/tmp/flyd-worktrees";
    const orchestrationGrant = {
      ...grant,
      fileOperations: ["read"],
      worktreePaths: [worktreeRoot],
      workerAdapters: ["codex", "opencode"],
      providerIdentity: "codex:local,opencode:local",
      commandClasses: ["inspect", "test", "lint", "build", "git_status", "git_diff"],
      renewalRequiredActions: [
        "destructive_operation", "external_write", "deploy", "publish", "purchase",
        "secret_disclosure", "permission_change",
      ],
      maxConcurrency: 2,
      budget: { max_worker_runs: 4, max_runtime_minutes: 90, max_inactivity_minutes: 10 },
    };
    const deps = dependencies({
      orchestrationGrantScope: {
        workerAdapters: ["codex", "opencode"],
        worktreeRoot,
        providerIdentity: "codex:local,opencode:local",
      },
      orchestrate: vi.fn(async () => ({
        status: "integrated" as const,
        summary: "Assessment integrated",
        verification: { passed: true },
      })),
    });
    deps.store.approvedGrant.mockResolvedValue(orchestrationGrant);
    deps.store.workerRunCount.mockResolvedValue(4);

    await runContinuityHarness({ outcome: "Assess the project", deps });

    expect(deps.store.revokeGrant).toHaveBeenCalledWith(
      "task-1", expect.any(Number), "grant-1", expect.objectContaining({
        reason: expect.stringMatching(/worker-run budget/i),
      }),
    );
    expect(deps.store.proposeGrant).toHaveBeenCalled();
  });

  it("creates, grants, runs, and verifies a new task", async () => {
    const deps = dependencies();

    const result = await runContinuityHarness({ outcome: "Implement continuity", deps });

    expect(result).toMatchObject({ status: "completed", taskKey: "task-1" });
    expect(deps.store.createTask).toHaveBeenCalled();
    expect(deps.store.proposeGrant).toHaveBeenCalled();
    expect(deps.store.approveGrantProposal).toHaveBeenCalled();
    expect(deps.store.createWorker).toHaveBeenCalled();
    expect(deps.runWorker).toHaveBeenCalledWith(expect.objectContaining({ cwd: repository.root, externalSessionId: undefined }));
    expect(deps.store.completeTask).toHaveBeenCalledWith("task-1", expect.any(Number), expect.objectContaining({ summary: "Implemented it" }));
    expect(deps.store.offerTaskRecommendation).toHaveBeenCalledWith("session-1", expect.objectContaining({ action: "Implement continuity" }));
    expect(deps.store.actOnTaskRecommendation).toHaveBeenCalledWith("session-1", "accepted");
    expect(deps.store.finishTaskSession).toHaveBeenCalledWith("session-1", expect.objectContaining({ interpretation: "accepted" }));
  });

  it("includes every requested repository in the bounded grant", async () => {
    const sharedRoot = "/work/shared";
    const deps = dependencies({
      resolveRepositoryRoots: vi.fn(async () => [ repository.root, sharedRoot ]),
    });

    await runContinuityHarness({ outcome: `Update ${sharedRoot} and Flyd`, deps });

    expect(deps.store.proposeGrant).toHaveBeenCalledWith(
      "task-1", expect.any(Number), expect.objectContaining({
        repositoryRoots: [ repository.root, sharedRoot ],
      }),
    );
    expect(deps.terminal.write).toHaveBeenCalledWith(expect.stringContaining(sharedRoot));
  });

  it("resolves repository grants from the effective resumed correction", async () => {
    const resolveRepositoryRoots = vi.fn(async () => [ repository.root ]);
    const deps = dependencies({
      resolveRepositoryRoots,
    });
    deps.store.findResumableTask.mockResolvedValue(task({ status: "ready", revision: 4 }));
    deps.store.approvedGrant.mockResolvedValue(grant);

    await runContinuityHarness({ outcome: "Update /work/other-repository instead", deps });

    expect(resolveRepositoryRoots).toHaveBeenCalledWith(
      "Update /work/other-repository instead",
      repository.root,
    );
  });

  it("proposes repository-derived verification commands for independent integration checks", async () => {
    const commands = [ "git diff --check", "bin/rails test" ];
    const deps = dependencies({
      resolveVerificationCommands: vi.fn(async () => commands),
    });

    await runContinuityHarness({ outcome: "Implement continuity", deps });

    expect(deps.store.proposeGrant).toHaveBeenCalledWith(
      "task-1", expect.any(Number), expect.objectContaining({ verificationCommands: commands }),
    );
  });

  it("does not grant writes for a review-only outcome", async () => {
    const deps = dependencies();

    await runContinuityHarness({ outcome: "Review the current implementation", deps });

    expect(deps.store.proposeGrant).toHaveBeenCalledWith(
      "task-1", expect.any(Number), expect.objectContaining({ fileOperations: [ "read" ] }),
    );
  });

  it("revokes a stale pending proposal before displaying and approving the current scope", async () => {
    const deps = dependencies({
      orchestrationGrantScope: {
        workerAdapters: ["flyd"],
        worktreeRoot: "/tmp/flyd-worktrees",
        providerIdentity: "models.example.test/current",
      },
      orchestrate: vi.fn(async () => ({
        status: "integrated" as const, summary: "Reviewed", verification: { passed: true },
      })),
    });
    deps.store.proposedGrant.mockResolvedValue({
      ...grant,
      status: "proposed",
      fileOperations: ["read"],
      commandClasses: ["inspect", "test", "lint", "build", "git_status", "git_diff"],
      renewalRequiredActions: [
        "destructive_operation", "external_write", "deploy", "publish", "purchase",
        "secret_disclosure", "permission_change",
      ],
      worktreePaths: ["/tmp/flyd-worktrees"],
      workerAdapters: ["flyd"],
      maxConcurrency: 2,
      budget: { max_worker_runs: 5, max_runtime_minutes: 90, max_inactivity_minutes: 10 },
      providerIdentity: "models.example.test/current",
    });

    await runContinuityHarness({ outcome: "Review the current implementation", deps });

    expect(deps.store.rejectGrantProposal).toHaveBeenCalledWith(
      "task-1", expect.any(Number), "grant-1",
      "The requested task scope changed before approval", expect.any(String),
    );
    expect(deps.store.proposeGrant).toHaveBeenCalledWith(
      "task-1", expect.any(Number), expect.objectContaining({
        fileOperations: ["read"],
        providerIdentity: "models.example.test/current",
      }),
    );
  });

  it("does not record successful worker diagnostics as an error", async () => {
    const deps = dependencies({
      runWorker: vi.fn(async () => ({
        exitStatus: 0,
        externalSessionId: "ses_1",
        output: "Assessment complete",
        error: "Reading additional input from stdin...",
      })),
    });

    await runContinuityHarness({ outcome: "Assess the project", deps });

    expect(deps.store.transitionWorker).toHaveBeenCalledWith("worker-1", expect.objectContaining({
      status: "completed",
      error: undefined,
    }));
  });

  it("resumes an interrupted Flyd session with a focused correction", async () => {
    const deps = dependencies();
    const existing = task({ status: "ready", revision: 4, recommendedNextAction: "Old action" });
    const interrupted = { ...worker, status: "interrupted" as const, externalSessionId: "ses_old" };
    deps.store.findResumableTask.mockResolvedValue(existing);
    deps.store.latestWorker.mockResolvedValue(interrupted);
    deps.store.approvedGrant.mockResolvedValue(grant);
    deps.terminal.ask.mockResolvedValue("Continue with the migration first");
    deps.terminal.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await runContinuityHarness({ deps });

    expect(deps.store.recordCorrection).toHaveBeenCalledWith("task-1", expect.any(Number), "Continue with the migration first", expect.any(Object));
    expect(deps.runWorker).toHaveBeenCalledWith(expect.objectContaining({ externalSessionId: "ses_old", assignment: "Continue with the migration first" }));
    expect(deps.store.actOnTaskRecommendation).toHaveBeenCalledWith("session-1", "adapted");
    expect(deps.store.finishTaskSession).toHaveBeenCalledWith("session-1", expect.objectContaining({ interpretation: "focused_corrected" }));
  });

  it("records an interactive task replacement as a manual context restatement", async () => {
    const deps = dependencies();
    deps.store.findResumableTask.mockResolvedValue(task({ status: "ready", revision: 4 }));
    deps.store.approvedGrant.mockResolvedValue(grant);
    deps.terminal.ask.mockResolvedValue("Replace this with a different task");
    deps.terminal.confirm.mockResolvedValue(true);

    await runContinuityHarness({ deps });

    expect(deps.store.finishTaskSession).toHaveBeenCalledWith("session-1", expect.objectContaining({
      interpretation: "replaced",
      manualContextRestatement: true,
    }));
    expect(deps.store.actOnTaskRecommendation).toHaveBeenCalledWith("session-1", "rejected");
  });

  it("treats an explicit new outcome as the authoritative correction for an active task", async () => {
    const deps = dependencies();
    deps.store.findResumableTask.mockResolvedValue(task({ status: "ready", revision: 3 }));
    deps.store.approvedGrant.mockResolvedValue(grant);

    await runContinuityHarness({ outcome: "Fix the task journal first", deps });

    expect(deps.terminal.ask).not.toHaveBeenCalled();
    expect(deps.store.recordCorrection).toHaveBeenCalledWith(
      "task-1", expect.any(Number), "Fix the task journal first", expect.any(Object),
    );
    expect(deps.runWorker).toHaveBeenCalledWith(expect.objectContaining({ assignment: "Fix the task journal first" }));
    expect(deps.store.finishTaskSession).toHaveBeenCalledWith("session-1", expect.objectContaining({
      interpretation: "replaced",
      manualContextRestatement: true,
    }));
  });

  it("uses a repeated explicit outcome as the resume assignment", async () => {
    const deps = dependencies();
    deps.store.findResumableTask.mockResolvedValue(task({ status: "ready", revision: 3 }));
    deps.store.approvedGrant.mockResolvedValue(grant);

    await runContinuityHarness({ outcome: "Implement continuity", deps });

    expect(deps.store.recordCorrection).not.toHaveBeenCalled();
    expect(deps.runWorker).toHaveBeenCalledWith(expect.objectContaining({ assignment: "Implement continuity" }));
  });

  it("handles a resumed project-status request locally instead of launching another worker", async () => {
    const deps = dependencies();
    deps.store.findResumableTask.mockResolvedValue(task({
      status: "ready",
      revision: 3,
      intendedOutcome: "i want you to look at the status of this project.",
      repositorySnapshot: { head: "old", status_digest: "old" },
      recommendedNextAction: "State the concrete outcome you want Flyd to change",
    }));
    deps.store.latestWorker.mockResolvedValue({
      ...worker,
      status: "interrupted",
      adapter: "codex",
      externalSessionId: "thread-1",
      errorSummary: "Flyd restarted after the worker process ended",
    });
    deps.recoverWorkers.mockResolvedValue(1);
    deps.recoverSessions.mockResolvedValue(1);
    deps.store.approvedGrant.mockResolvedValue(grant);

    const result = await runContinuityHarness({ deps });

    const writes = deps.terminal.write.mock.calls.map(([text]) => text).join("\n");
    expect(writes).toContain("Flyd Daily Agent");
    expect(writes).toContain("You are working on: i want you to look at the status of this project.");
    expect(writes).toContain("Project brief");
    expect(writes).toContain("Handled locally");
    expect(writes).not.toContain("Recovered 1 interrupted worker session.");
    expect(writes).not.toContain("Closed 1 abandoned Flyd session.");
    expect(writes).not.toContain("Resume:");
    expect(deps.terminal.ask).not.toHaveBeenCalled();
    expect(deps.store.createWorker).not.toHaveBeenCalled();
    expect(deps.runWorker).not.toHaveBeenCalled();
    expect(deps.store.completeLocalTask).toHaveBeenCalledWith(
      "task-1",
      expect.any(Number),
      expect.objectContaining({
        summary: expect.stringContaining("Reviewed project status locally"),
        verification: expect.objectContaining({
          local_project_briefing: true,
          worker_launched: false,
        }),
      }),
    );
    expect(deps.store.keepTaskOpen).not.toHaveBeenCalled();
    expect(deps.store.completeTask).not.toHaveBeenCalled();
    expect(result.status).toBe("completed");
  });

  it("does not let an old status task swallow an explicit implementation outcome", async () => {
    const deps = dependencies();
    deps.store.findResumableTask.mockResolvedValue(task({
      status: "ready",
      revision: 3,
      intendedOutcome: "Look at the status of this project",
      recommendedNextAction: "Review the current state",
    }));
    deps.store.approvedGrant.mockResolvedValue(grant);

    await runContinuityHarness({ outcome: "Fix the failing runtime test", deps });

    expect(deps.store.completeLocalTask).not.toHaveBeenCalled();
    expect(deps.store.createWorker).toHaveBeenCalled();
    expect(deps.runWorker).toHaveBeenCalledWith(expect.objectContaining({
      assignment: "Fix the failing runtime test",
    }));
  });

  it("keeps the real resume assignment when orchestration is blocked by worker health", async () => {
    const deps = dependencies({
      orchestrate: vi.fn(async () => ({
        status: "blocked" as const,
        summary: "No healthy worker satisfies: implementation, testing",
        verification: { passed: false },
      })),
    });
    const existing = task({
      status: "ready",
      revision: 4,
      intendedOutcome: "Build the Release 1 acceptance gate",
      recommendedNextAction: "Implement the acceptance gate non-interactively",
    });
    deps.store.findResumableTask.mockResolvedValue(existing);
    deps.store.approvedGrant.mockResolvedValue(grant);
    deps.terminal.ask.mockResolvedValue("");

    await runContinuityHarness({ deps });

    expect(deps.store.keepTaskOpen).toHaveBeenCalledWith(
      "task-1",
      expect.any(Number),
      expect.objectContaining({
        nextAction: "Implement the acceptance gate non-interactively",
      }),
    );
    expect(deps.terminal.write).toHaveBeenCalledWith(expect.stringContaining("No healthy worker satisfies"));
  });

  it("cancels a brand-new task when its grant is rejected", async () => {
    const deps = dependencies();
    deps.terminal.confirm.mockResolvedValue(false);

    const result = await runContinuityHarness({ outcome: "Implement continuity", deps });

    expect(result.status).toBe("cancelled");
    expect(deps.store.cancelTask).toHaveBeenCalledWith(
      "task-1",
      expect.any(Number),
      expect.objectContaining({ reason: "The user rejected the proposed task grant" }),
    );
    expect(deps.runtimeCommands.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "task.reject_grant" }),
    );
    expect(deps.store.actOnTaskRecommendation).not.toHaveBeenCalled();
    expect(deps.store.createWorker).not.toHaveBeenCalled();
    expect(deps.runWorker).not.toHaveBeenCalled();
    expect(deps.store.finishTaskSession).toHaveBeenCalled();
  });

  it("rejects a resumed task grant without cancelling the user's existing work", async () => {
    const deps = dependencies();
    const existing = task({ revision: 4 });
    deps.store.findResumableTask.mockResolvedValue(existing);
    deps.store.findTask.mockResolvedValue(existing);
    deps.terminal.confirm.mockResolvedValue(false);

    const result = await runContinuityHarness({ deps });

    expect(result.status).toBe("awaiting_grant");
    expect(deps.runtimeCommands.execute).toHaveBeenCalledWith(
      expect.objectContaining({ action: "task.reject_grant" }),
    );
    expect(deps.store.cancelTask).not.toHaveBeenCalled();
  });

  it("keeps a failed worker task open with an exact re-entry point", async () => {
    const deps = dependencies({ runWorker: vi.fn(async () => ({ exitStatus: 1, externalSessionId: "ses_1", output: "", error: "Tests failed" })) });

    const result = await runContinuityHarness({ outcome: "Implement continuity", deps });

    expect(result.status).toBe("ready");
    expect(deps.store.keepTaskOpen).toHaveBeenCalledWith("task-1", expect.any(Number), expect.objectContaining({ nextAction: "Investigate worker failure: Tests failed" }));
    expect(deps.store.completeTask).not.toHaveBeenCalled();
  });

  it("preserves a launch failure as a resumable task instead of leaving it running", async () => {
    const deps = dependencies({ runWorker: vi.fn(async () => { throw new Error("Flyd worker disappeared"); }) });

    const result = await runContinuityHarness({ outcome: "Implement continuity", deps });

    expect(result.status).toBe("ready");
    expect(deps.store.transitionWorker).toHaveBeenCalledWith("worker-1", expect.objectContaining({
      status: "failed",
      error: "Flyd worker disappeared",
    }));
    expect(deps.store.keepTaskOpen).toHaveBeenCalledWith("task-1", expect.any(Number), expect.objectContaining({
      nextAction: "Investigate worker failure: Flyd worker disappeared",
    }));
  });

  it("journals the external Flyd session as soon as it is observed", async () => {
    const runWorker = vi.fn(async (input: {
      onStart?: (processId: number | null) => void;
      onEvent?: (event: { sessionId: string | null }) => void;
    }) => {
      input.onStart?.(123);
      input.onEvent?.({ sessionId: "ses_live" });
      return { exitStatus: 0, externalSessionId: "ses_live", output: "Done", error: "" };
    });
    const deps = dependencies({ runWorker });

    await runContinuityHarness({ outcome: "Implement continuity", deps });

    expect(deps.store.transitionWorker).toHaveBeenCalledWith("worker-1", expect.objectContaining({
      status: "running",
      externalSessionId: "ses_live",
    }));
  });

  it("renders monitoring and does not duplicate a worker that survived the Flyd process", async () => {
    const deps = dependencies();
    deps.store.findResumableTask.mockResolvedValue(task({ status: "running", revision: 5 }));
    deps.store.latestWorker.mockResolvedValue({ ...worker, status: "running", processId: 456, externalSessionId: "ses_live" });

    const result = await runContinuityHarness({ deps });

    expect(result.status).toBe("running");
    expect(deps.store.createWorker).not.toHaveBeenCalled();
    expect(deps.runWorker).not.toHaveBeenCalled();
    expect(deps.terminal.write).toHaveBeenCalledWith(expect.stringContaining("still running"));
  });

  it("rechecks for a worker that started while Flyd waited for resume input", async () => {
    const deps = dependencies();
    const interrupted = { ...worker, status: "interrupted" as const };
    const concurrent = {
      ...worker,
      workerKey: "worker-concurrent",
      status: "running" as const,
      processId: 789,
      externalSessionId: "ses_concurrent",
    };
    deps.store.findResumableTask.mockResolvedValue(task({ status: "ready", revision: 5 }));
    deps.store.latestWorker
      .mockResolvedValueOnce(interrupted)
      .mockResolvedValueOnce(concurrent);
    deps.terminal.ask.mockResolvedValue("");

    const result = await runContinuityHarness({ deps });

    expect(result.status).toBe("running");
    expect(deps.store.createWorker).not.toHaveBeenCalled();
    expect(deps.runWorker).not.toHaveBeenCalled();
    expect(deps.terminal.write).toHaveBeenCalledWith(expect.stringContaining("still running"));
  });

  it("continues from task and repository truth when memory retrieval is unavailable", async () => {
    const deps = dependencies({ retrieveMemory: vi.fn(async () => { throw new Error("QMD unavailable"); }) });

    const result = await runContinuityHarness({ outcome: "Implement continuity", deps });

    expect(result.status).toBe("completed");
    expect(deps.runWorker).toHaveBeenCalled();
    expect(deps.terminal.write).toHaveBeenCalledWith(expect.stringContaining("Memory retrieval is unavailable"));
  });

  it("preserves an exact re-entry point when Flyd worker discovery fails", async () => {
    const deps = dependencies({ detectWorker: vi.fn(async () => { throw new Error("Flyd worker is unavailable"); }) });

    const result = await runContinuityHarness({ outcome: "Implement continuity", deps });

    expect(result.status).toBe("ready");
    expect(deps.store.createWorker).not.toHaveBeenCalled();
    expect(deps.store.keepTaskOpen).toHaveBeenCalledWith("task-1", expect.any(Number), expect.objectContaining({
      nextAction: "Prepare Flyd worker: Flyd worker is unavailable",
    }));
  });
});
