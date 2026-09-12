import { describe, expect, it, vi } from "vitest";
import { runContinuityHarness, type HarnessDependencies } from "../harness.js";
import type { AgentTask, RepositorySnapshot, TaskGrant } from "../types.js";

const repository: RepositorySnapshot = {
  root: "/tmp/flyd",
  name: "flyd",
  remote: null,
  branch: "main",
  head: "abc123",
  dirty: false,
  statusLines: [],
  statusDigest: "clean",
};

function task(): AgentTask {
  return {
    id: "task-id",
    taskKey: "task-1",
    projectId: "project-1",
    projectName: "flyd",
    projectRoot: repository.root,
    status: "blocked",
    intendedOutcome: "Ship the planner integration",
    successCriteria: [],
    verificationCriteria: [],
    plan: {},
    contextSnapshot: {},
    repositorySnapshot: {},
    recommendedNextAction: "Investigate failing CI",
    outcomeSummary: null,
    verificationResult: {},
    revision: 1,
    startedAt: "2026-09-12T00:00:00.000Z",
    completedAt: null,
    updatedAt: "2026-09-12T00:00:00.000Z",
  };
}

function grant(): TaskGrant {
  return {
    id: "grant-id",
    grantKey: "grant-1",
    agentTaskId: "task-id",
    status: "approved",
    scopeDigest: "scope",
    repositoryRoots: [repository.root],
    externalRoots: [],
    worktreePaths: [],
    workerAdapters: ["test"],
    fileOperations: ["read"],
    commandClasses: ["inspect", "test", "lint", "build", "git_status", "git_diff"],
    verificationCommands: ["git diff --check"],
    renewalRequiredActions: [],
    maxConcurrency: 1,
    budget: {},
    providerIdentity: "test",
    approvedAt: "2026-09-12T00:00:00.000Z",
    expiresAt: "2026-09-13T00:00:00.000Z",
    decisionReason: null,
    decidedAt: "2026-09-12T00:00:00.000Z",
  };
}

describe("planner-focused harness assignment", () => {
  it("runs investigation as a scoped assignment without recording a user correction or completing the parent task", async () => {
    let current = task();
    const recordCorrection = vi.fn();
    const completeTask = vi.fn();
    const orchestrate = vi.fn(async (input: { assignment: string }) => ({
      status: "integrated" as const,
      summary: `Investigation complete: ${input.assignment}`,
      verification: { inspected: true },
    }));
    const confirm = vi.fn(async () => true);

    const store = {
      findResumableTask: vi.fn(async () => current),
      findTask: vi.fn(async () => current),
      latestWorker: vi.fn(async () => null),
      approvedGrant: vi.fn(async () => grant()),
      workerRunCount: vi.fn(async () => 0),
      startTaskSession: vi.fn(async () => "session-1"),
      recordOrientation: vi.fn(async (_key: string, _revision: number, input: { recommendedNextAction: string }) => {
        current = { ...current, revision: current.revision + 1, recommendedNextAction: input.recommendedNextAction };
        return current;
      }),
      offerTaskRecommendation: vi.fn(async () => undefined),
      actOnTaskRecommendation: vi.fn(async () => undefined),
      recordCorrection,
      finishTaskSession: vi.fn(async () => undefined),
      keepTaskOpen: vi.fn(async (_key: string, _revision: number, input: { nextAction: string }) => {
        current = {
          ...current,
          status: "ready",
          revision: current.revision + 1,
          recommendedNextAction: input.nextAction,
        };
        return current;
      }),
      completeTask,
    };

    const deps = {
      store,
      terminal: {
        write: vi.fn(),
        ask: vi.fn(async () => ""),
        confirm,
        close: vi.fn(async () => undefined),
      },
      inspectRepository: vi.fn(async () => repository),
      retrieveMemory: vi.fn(async () => ({ verdict: "sufficient" as const, matches: [] })),
      recoverWorkers: vi.fn(async () => 0),
      recoverSessions: vi.fn(async () => 0),
      writeContext: vi.fn(async () => "/tmp/context.json"),
      now: () => new Date("2026-09-12T00:00:00.000Z"),
      workerAdapterName: "test",
      detectWorker: vi.fn(async () => ({ executable: "worker", version: "1" })),
      buildWorkerArgs: vi.fn(() => []),
      runWorker: vi.fn(),
      runtimeCommands: { execute: vi.fn() },
      orchestrate,
    } as unknown as HarnessDependencies;

    const focusedAssignment = "Investigate the active-task blocker before resuming: CI is failing";
    const result = await runContinuityHarness({
      cwd: repository.root,
      deps,
      focusedAssignment,
    });

    expect(result.status).toBe("ready");
    expect(orchestrate).toHaveBeenCalledWith(expect.objectContaining({ assignment: focusedAssignment }));
    expect(recordCorrection).not.toHaveBeenCalled();
    expect(completeTask).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalledWith("Does the verified integrated result satisfy the intended outcome?");
    expect(current.intendedOutcome).toBe("Ship the planner integration");
    expect(current.recommendedNextAction).toContain("Investigation complete");
  });
});
