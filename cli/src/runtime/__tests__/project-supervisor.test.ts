import { describe, expect, it, vi } from "vitest";
import { superviseProject } from "../project-supervisor.js";
import type { WorkerSession } from "../types.js";

const worker: WorkerSession = {
  id: "1", workerKey: "worker-1", agentTaskId: "task-1", taskGrantId: "grant-1",
  taskAssignmentId: "assignment-1", status: "running", adapter: "codex",
  capabilities: ["implementation"], executablePath: "/usr/local/bin/codex", executableVersion: "1",
  workingDirectory: "/work/flyd", externalSessionId: "session-1", processId: 123,
  processIdentity: "identity", errorSummary: null, output: null, exitStatus: null,
  startedAt: "2026-09-12T01:00:00.000Z", endedAt: null,
  lastObservedAt: "2026-09-12T01:01:00.000Z", stopReason: null,
};

const healthy = {
  observedAt: "2026-09-12T01:02:00.000Z",
  processAlive: true,
  processIdentityMatches: true,
  worktreeExists: true,
};

describe("superviseProject", () => {
  it("keeps healthy workers quiet when no decision is open", async () => {
    const taskStore = {
      liveWorkers: vi.fn(async () => [worker]),
      transitionWorker: vi.fn(),
      observeWorker: vi.fn(async () => undefined),
    };
    const decisionStore = { listOpenDecisionFacts: vi.fn(async () => []) };

    const result = await superviseProject("/work/flyd", {
      taskStore, decisionStore, observeReality: () => healthy,
    });

    expect(result.results[0].result.reconciliation.action).toBe("noop");
    expect(taskStore.observeWorker).toHaveBeenCalledWith("worker-1");
    expect(taskStore.transitionWorker).not.toHaveBeenCalled();
  });

  it("surfaces an open decision ahead of healthy worker state without mutation", async () => {
    const taskStore = {
      liveWorkers: vi.fn(async () => [worker]),
      transitionWorker: vi.fn(),
      observeWorker: vi.fn(async () => undefined),
    };
    const decisionStore = {
      listOpenDecisionFacts: vi.fn(async () => [{
        decision: { taskId: "task-1" },
        taskKey: "task-key-1",
        projectName: "flyd",
        projectRoot: "/work/flyd",
      }]),
    };

    const result = await superviseProject("/work/flyd", {
      taskStore, decisionStore: decisionStore as never, observeReality: () => healthy,
    });

    expect(result.results[0].result.reconciliation.action).toBe("ask_user");
    expect(taskStore.observeWorker).not.toHaveBeenCalled();
    expect(taskStore.transitionWorker).not.toHaveBeenCalled();
  });

  it("ignores decisions belonging to another project", async () => {
    const taskStore = {
      liveWorkers: vi.fn(async () => [worker]),
      transitionWorker: vi.fn(),
      observeWorker: vi.fn(async () => undefined),
    };
    const decisionStore = {
      listOpenDecisionFacts: vi.fn(async () => [{
        decision: { taskId: "task-1" },
        taskKey: "other-task",
        projectName: "other",
        projectRoot: "/work/other",
      }]),
    };

    const result = await superviseProject("/work/flyd", {
      taskStore, decisionStore: decisionStore as never, observeReality: () => healthy,
    });

    expect(result.results[0].result.reconciliation.action).toBe("noop");
    expect(taskStore.observeWorker).toHaveBeenCalledWith("worker-1");
  });
});
