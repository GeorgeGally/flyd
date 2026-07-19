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
  repositoryRoots: [repository.root], worktreePaths: [], workerAdapters: ["opencode"],
  fileOperations: ["read", "write"], commandClasses: ["test", "git_status"],
  verificationCommands: ["git diff --check"], renewalRequiredActions: ["deploy"],
  maxConcurrency: 1, budget: { max_worker_runs: 3 }, providerIdentity: "opencode-configured-provider",
  approvedAt: "2026-07-17T00:01:00.000Z", expiresAt: "2026-07-17T08:00:00.000Z",
};

const worker: WorkerSession = {
  id: "3", workerKey: "worker-1", agentTaskId: "1", taskGrantId: "2", taskAssignmentId: "4",
  status: "queued", adapter: "opencode", capabilities: ["implementation"],
  executablePath: "/bin/opencode", executableVersion: "1.17.18", workingDirectory: repository.root,
  externalSessionId: null, processId: null, processIdentity: null, errorSummary: null, output: null, exitStatus: null,
  startedAt: null, endedAt: null, lastObservedAt: null, stopReason: null,
};

function dependencies(overrides: Record<string, unknown> = {}) {
  let currentTask = task();
  const store = {
    findResumableTask: vi.fn(async (): Promise<AgentTask | null> => null),
    latestWorker: vi.fn(async (): Promise<WorkerSession | null> => null),
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
    revokeGrant: vi.fn(async () => { currentTask = { ...currentTask, revision: currentTask.revision + 1, status: "awaiting_grant" }; return currentTask; }),
    approveGrant: vi.fn(async () => { currentTask = { ...currentTask, revision: currentTask.revision + 1, status: "ready" }; return grant; }),
    startTaskSession: vi.fn(async () => "session-1"),
    finishTaskSession: vi.fn(async () => undefined),
    createWorker: vi.fn(async () => { currentTask = { ...currentTask, revision: currentTask.revision + 1, status: "running" }; return worker; }),
    transitionWorker: vi.fn(async () => worker),
    findTask: vi.fn(async () => currentTask),
    completeTask: vi.fn(async () => { currentTask = { ...currentTask, revision: currentTask.revision + 1, status: "completed" }; return currentTask; }),
    keepTaskOpen: vi.fn(async () => { currentTask = { ...currentTask, revision: currentTask.revision + 1, status: "ready" }; return currentTask; }),
  };
  const terminal = {
    write: vi.fn(),
    ask: vi.fn(async () => "Implement continuity"),
    confirm: vi.fn(async () => true),
    close: vi.fn(async () => undefined),
  };
  return {
    store, terminal,
    inspectRepository: vi.fn(async () => repository),
    retrieveMemory: vi.fn(async () => ({ verdict: "partial" as const, matches: [] })),
    detectOpenCode: vi.fn(async () => ({ executable: "/bin/opencode", version: "1.17.18" })),
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
    expect(deps.store.approveGrant).toHaveBeenCalledWith(
      "task-1", expect.any(Number), expect.objectContaining({
        workerAdapters: ["codex", "opencode"],
        worktreePaths: ["/tmp/flyd-worktrees"],
        maxConcurrency: 2,
      }),
    );
  });

  it("creates, grants, runs, and verifies a new task", async () => {
    const deps = dependencies();

    const result = await runContinuityHarness({ outcome: "Implement continuity", deps });

    expect(result).toMatchObject({ status: "completed", taskKey: "task-1" });
    expect(deps.store.createTask).toHaveBeenCalled();
    expect(deps.store.approveGrant).toHaveBeenCalled();
    expect(deps.store.createWorker).toHaveBeenCalled();
    expect(deps.runWorker).toHaveBeenCalledWith(expect.objectContaining({ cwd: repository.root, externalSessionId: undefined }));
    expect(deps.store.completeTask).toHaveBeenCalledWith("task-1", expect.any(Number), expect.objectContaining({ summary: "Implemented it" }));
    expect(deps.store.finishTaskSession).toHaveBeenCalledWith("session-1", expect.objectContaining({ interpretation: "accepted" }));
  });

  it("resumes an interrupted OpenCode session with a focused correction", async () => {
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

  it("stops before worker creation when the task grant is rejected", async () => {
    const deps = dependencies();
    deps.terminal.confirm.mockResolvedValue(false);

    const result = await runContinuityHarness({ outcome: "Implement continuity", deps });

    expect(result.status).toBe("awaiting_grant");
    expect(deps.store.createWorker).not.toHaveBeenCalled();
    expect(deps.runWorker).not.toHaveBeenCalled();
    expect(deps.store.finishTaskSession).toHaveBeenCalled();
  });

  it("keeps a failed worker task open with an exact re-entry point", async () => {
    const deps = dependencies({ runWorker: vi.fn(async () => ({ exitStatus: 1, externalSessionId: "ses_1", output: "", error: "Tests failed" })) });

    const result = await runContinuityHarness({ outcome: "Implement continuity", deps });

    expect(result.status).toBe("ready");
    expect(deps.store.keepTaskOpen).toHaveBeenCalledWith("task-1", expect.any(Number), expect.objectContaining({ nextAction: "Investigate worker failure: Tests failed" }));
    expect(deps.store.completeTask).not.toHaveBeenCalled();
  });

  it("preserves a launch failure as a resumable task instead of leaving it running", async () => {
    const deps = dependencies({ runWorker: vi.fn(async () => { throw new Error("OpenCode disappeared"); }) });

    const result = await runContinuityHarness({ outcome: "Implement continuity", deps });

    expect(result.status).toBe("ready");
    expect(deps.store.transitionWorker).toHaveBeenCalledWith("worker-1", expect.objectContaining({
      status: "failed",
      error: "OpenCode disappeared",
    }));
    expect(deps.store.keepTaskOpen).toHaveBeenCalledWith("task-1", expect.any(Number), expect.objectContaining({
      nextAction: "Investigate worker failure: OpenCode disappeared",
    }));
  });

  it("journals the external OpenCode session as soon as it is observed", async () => {
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

  it("continues from task and repository truth when memory retrieval is unavailable", async () => {
    const deps = dependencies({ retrieveMemory: vi.fn(async () => { throw new Error("QMD unavailable"); }) });

    const result = await runContinuityHarness({ outcome: "Implement continuity", deps });

    expect(result.status).toBe("completed");
    expect(deps.runWorker).toHaveBeenCalled();
    expect(deps.terminal.write).toHaveBeenCalledWith(expect.stringContaining("Memory retrieval is unavailable"));
  });

  it("preserves an exact re-entry point when OpenCode discovery fails", async () => {
    const deps = dependencies({ detectOpenCode: vi.fn(async () => { throw new Error("OpenCode is not installed"); }) });

    const result = await runContinuityHarness({ outcome: "Implement continuity", deps });

    expect(result.status).toBe("ready");
    expect(deps.store.createWorker).not.toHaveBeenCalled();
    expect(deps.store.keepTaskOpen).toHaveBeenCalledWith("task-1", expect.any(Number), expect.objectContaining({
      nextAction: "Prepare OpenCode worker: OpenCode is not installed",
    }));
  });
});
