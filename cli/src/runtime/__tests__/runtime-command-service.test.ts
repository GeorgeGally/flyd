import { describe, expect, it, vi } from "vitest";
import { RuntimeCommandService } from "../runtime-command-service.js";
import type { AgentTask, TaskGrant, WorkerCommand, WorkerSession } from "../types.js";

const task: AgentTask = {
  id: "1", taskKey: "task-1", projectId: "1", projectName: "flyd", projectRoot: "/work/flyd",
  status: "running", intendedOutcome: "Implement Rails parity", successCriteria: ["Parity"],
  verificationCriteria: ["npm test"], plan: {}, contextSnapshot: {}, repositorySnapshot: {},
  recommendedNextAction: "Monitor the worker", outcomeSummary: null, verificationResult: { integrated: true },
  revision: 7, startedAt: "2026-07-19T00:00:00.000Z", completedAt: null, updatedAt: "2026-07-19T00:01:00.000Z",
};

const worker: WorkerSession = {
  id: "2", workerKey: "worker-1", agentTaskId: task.id, taskGrantId: "3", taskAssignmentId: "4",
  status: "running", adapter: "codex", capabilities: ["implementation"], executablePath: "/bin/codex",
  executableVersion: "0.144.2", workingDirectory: "/work/flyd", externalSessionId: "thread-1",
  processId: 42, processIdentity: "process-42", errorSummary: null, output: null, exitStatus: null,
  startedAt: "2026-07-19T00:00:30.000Z", endedAt: null, lastObservedAt: "2026-07-19T00:01:00.000Z",
  stopReason: null,
};

const grant: TaskGrant = {
  id: "3", grantKey: "grant-1", agentTaskId: task.id, status: "proposed", scopeDigest: "digest",
  repositoryRoots: ["/work/flyd"], worktreePaths: [], workerAdapters: ["codex"],
  fileOperations: ["read", "write"], commandClasses: ["test"], verificationCommands: ["npm test"],
  renewalRequiredActions: ["deploy"], maxConcurrency: 1, budget: { max_worker_runs: 2, max_runtime_minutes: 90 },
  providerIdentity: "codex:local", approvedAt: null, expiresAt: "2026-07-19T08:00:00.000Z",
  decisionReason: null, decidedAt: null,
};

function dependencies() {
  let currentTask = { ...task };
  const command: WorkerCommand = {
    id: "5", commandKey: "command-1", agentTaskId: task.id, workerSessionId: worker.id,
    kind: "stop", status: "completed", idempotencyKey: "request-1", payload: {},
    dispatchedAt: "2026-07-19T00:01:00.000Z", completedAt: "2026-07-19T00:01:01.000Z", errorSummary: null,
  };
  const store = {
    findTask: vi.fn(async () => currentTask),
    findWorker: vi.fn(async () => worker),
    listAssignments: vi.fn(async () => []),
    listWorkers: vi.fn(async () => [worker]),
    listGrants: vi.fn(async () => [grant]),
    listArtifacts: vi.fn(async () => []),
    approveGrantProposal: vi.fn(async () => ({ ...grant, status: "approved" as const })),
    rejectGrantProposal: vi.fn(async () => ({ ...grant, status: "revoked" as const })),
    recordCorrection: vi.fn(async () => {
      currentTask = { ...currentTask, revision: currentTask.revision + 1 };
      return currentTask;
    }),
    completeTask: vi.fn(async () => {
      currentTask = { ...currentTask, status: "completed" as const, revision: currentTask.revision + 1 };
      return currentTask;
    }),
  };
  return {
    store,
    controlWorker: vi.fn(async () => command),
    inspectRepository: vi.fn(async () => ({
      root: "/work/flyd", name: "flyd", remote: null, branch: "main", head: "head-1",
      dirty: false, statusLines: [], statusDigest: "clean",
    })),
  };
}

describe("RuntimeCommandService", () => {
  it("returns one authoritative task projection", async () => {
    const deps = dependencies();
    const result = await new RuntimeCommandService(deps).execute({
      schemaVersion: 1,
      action: "task.status",
      actorSurface: "rails",
      taskKey: task.taskKey,
    });

    expect(result).toMatchObject({
      action: "task.status",
      taskKey: task.taskKey,
      taskRevision: 7,
      data: { task: { taskKey: task.taskKey }, workers: [{ workerKey: worker.workerKey }] },
    });
  });

  it("executes worker controls with the expected task revision and caller idempotency key", async () => {
    const deps = dependencies();
    const result = await new RuntimeCommandService(deps).execute({
      schemaVersion: 1,
      action: "task.stop_worker",
      actorSurface: "rails",
      taskKey: task.taskKey,
      expectedTaskRevision: 7,
      workerKey: worker.workerKey,
      idempotencyKey: "request-1",
    });

    expect(deps.controlWorker).toHaveBeenCalledWith(expect.objectContaining({
      workerKey: worker.workerKey,
      kind: "stop",
      expectedTaskRevision: 7,
      idempotencyKey: "request-1",
    }));
    expect(result).toMatchObject({ taskKey: task.taskKey, data: { command: { commandKey: "command-1" } } });
  });

  it("rejects selectors from another task before executing a worker control", async () => {
    const deps = dependencies();
    deps.store.findWorker.mockResolvedValue({ ...worker, agentTaskId: "different-task-id" });

    await expect(new RuntimeCommandService(deps).execute({
      schemaVersion: 1,
      action: "task.stop_worker",
      actorSurface: "rails",
      taskKey: task.taskKey,
      expectedTaskRevision: 7,
      workerKey: worker.workerKey,
      idempotencyKey: "request-1",
    })).rejects.toThrow(/does not belong/i);

    expect(deps.controlWorker).not.toHaveBeenCalled();
  });

  it("rejects unknown request fields and oversized authored text", async () => {
    const service = new RuntimeCommandService(dependencies());

    await expect(service.execute({
      schemaVersion: 1,
      action: "task.stop_worker",
      actorSurface: "rails",
      taskKey: task.taskKey,
      expectedTaskRevision: 7,
      workerKey: worker.workerKey,
      idempotencyKey: "request-1",
      replacementWorkerKey: "tampered",
    })).rejects.toThrow(/unknown field/i);

    await expect(service.execute({
      schemaVersion: 1,
      action: "task.correct",
      actorSurface: "rails",
      taskKey: task.taskKey,
      expectedTaskRevision: 7,
      correctedValue: "x".repeat(4_001),
      idempotencyKey: "request-2",
    })).rejects.toThrow(/too long/i);
  });

  it("approves the exact persisted proposal and records corrections through the store", async () => {
    const deps = dependencies();
    const service = new RuntimeCommandService(deps);

    await service.execute({
      schemaVersion: 1,
      action: "task.approve_grant",
      actorSurface: "rails",
      taskKey: task.taskKey,
      expectedTaskRevision: 7,
      grantKey: grant.grantKey,
      idempotencyKey: "approve-1",
    });
    await service.execute({
      schemaVersion: 1,
      action: "task.correct",
      actorSurface: "rails",
      taskKey: task.taskKey,
      expectedTaskRevision: 7,
      correctedValue: "Rails is a first-class surface",
      idempotencyKey: "correct-1",
    });

    expect(deps.store.approveGrantProposal).toHaveBeenCalledWith(
      task.taskKey, 7, grant.grantKey, "approve-1",
    );
    expect(deps.store.recordCorrection).toHaveBeenCalledWith(
      task.taskKey,
      7,
      "Rails is a first-class surface",
      expect.objectContaining({ idempotencyKey: "correct-1" }),
    );
  });
});
