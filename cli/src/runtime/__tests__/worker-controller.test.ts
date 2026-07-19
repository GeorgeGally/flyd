import { describe, expect, it, vi } from "vitest";
import { controlWorker } from "../worker-controller.js";
import type { WorkerCommand, WorkerSession } from "../types.js";

const worker: WorkerSession = {
  id: "1",
  workerKey: "worker-1",
  agentTaskId: "task-1",
  taskGrantId: "grant-1",
  taskAssignmentId: "assignment-1",
  status: "running",
  adapter: "codex",
  capabilities: ["implementation", "testing"],
  executablePath: "/bin/codex",
  executableVersion: "codex-cli 0.144.2",
  workingDirectory: "/worktree",
  externalSessionId: "thread-1",
  processId: 42,
  processIdentity: "process-42",
  errorSummary: null,
  output: null,
  exitStatus: null,
  startedAt: "2026-07-17T00:00:00.000Z",
  endedAt: null,
  lastObservedAt: "2026-07-17T00:01:00.000Z",
  stopReason: null,
};

function command(kind: WorkerCommand["kind"]): WorkerCommand {
  return {
    id: "2",
    commandKey: "command-1",
    agentTaskId: "task-1",
    workerSessionId: "1",
    kind,
    status: "queued",
    idempotencyKey: `${kind}-1`,
    payload: {},
    dispatchedAt: null,
    completedAt: null,
    errorSummary: null,
  };
}

function dependencies(kind: WorkerCommand["kind"]) {
  const calls: string[] = [];
  const store = {
    queueWorkerCommand: vi.fn(async () => {
      calls.push("journaled");
      return { command: command(kind), worker };
    }),
    completeWorkerCommand: vi.fn(async () => {
      calls.push("completed");
      return command(kind);
    }),
  };
  return {
    calls,
    store,
    isProcessAlive: vi.fn(() => true),
    signal: vi.fn((_pid: number, signal: NodeJS.Signals) => {
      calls.push(signal);
    }),
    wait: vi.fn(async () => undefined),
  };
}

describe("controlWorker", () => {
  it("journals stop before graceful and forced termination", async () => {
    const deps = dependencies("stop");

    await controlWorker({
      workerKey: worker.workerKey,
      kind: "stop",
      idempotencyKey: "stop-1",
      killGraceMs: 1,
      deps,
    });

    expect(deps.calls).toEqual(["journaled", "SIGTERM", "SIGKILL", "completed"]);
    expect(deps.store.completeWorkerCommand).toHaveBeenCalledWith(
      "command-1",
      expect.objectContaining({ workerStatus: "stopped" }),
    );
  });

  it("redirects by creating a new assignment revision before stopping the old worker", async () => {
    const deps = dependencies("redirect");
    deps.isProcessAlive
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    await controlWorker({
      workerKey: worker.workerKey,
      kind: "redirect",
      instruction: "Focus only on the failing integration test",
      idempotencyKey: "redirect-1",
      expectedTaskRevision: 12,
      deps,
    });

    expect(deps.store.queueWorkerCommand).toHaveBeenCalledWith(
      worker.workerKey,
      "redirect",
      { instruction: "Focus only on the failing integration test" },
      "redirect-1",
      12,
    );
    expect(deps.signal).toHaveBeenCalledTimes(1);
    expect(deps.store.completeWorkerCommand).toHaveBeenCalledWith(
      "command-1",
      expect.objectContaining({ workerStatus: "interrupted" }),
    );
  });

  it("queues retry without signaling a terminal worker", async () => {
    const deps = dependencies("retry");
    deps.store.queueWorkerCommand.mockResolvedValue({
      command: command("retry"),
      worker: { ...worker, status: "failed", processId: null },
    });

    await controlWorker({
      workerKey: worker.workerKey,
      kind: "retry",
      idempotencyKey: "retry-1",
      deps,
    });

    expect(deps.signal).not.toHaveBeenCalled();
    expect(deps.store.completeWorkerCommand).toHaveBeenCalledWith(
      "command-1",
      expect.objectContaining({ workerStatus: null }),
    );
  });

  it.each(["completed", "failed", "cancelled"] as const)(
    "does not repeat a consequential effect for an existing %s command",
    async (status) => {
      const deps = dependencies("stop");
      deps.store.queueWorkerCommand.mockResolvedValue({
        command: { ...command("stop"), status },
        worker,
      });

      const result = await controlWorker({
        workerKey: worker.workerKey,
        kind: "stop",
        idempotencyKey: "stop-1",
        deps,
      });

      expect(result.status).toBe(status);
      expect(deps.signal).not.toHaveBeenCalled();
      expect(deps.store.completeWorkerCommand).not.toHaveBeenCalled();
    },
  );

  it("requires a focused instruction for redirect", async () => {
    const deps = dependencies("redirect");

    await expect(controlWorker({
      workerKey: worker.workerKey,
      kind: "redirect",
      instruction: " ",
      idempotencyKey: "redirect-empty",
      deps,
    })).rejects.toThrow("Redirect requires");
    expect(deps.store.queueWorkerCommand).not.toHaveBeenCalled();
  });
});
