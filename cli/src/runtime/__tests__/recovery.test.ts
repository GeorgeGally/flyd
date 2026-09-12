import { describe, expect, it, vi } from "vitest";
import { recoverInterruptedWorkers, workerProcessIsAlive } from "../recovery.js";
import type { WorkerSession } from "../types.js";

function worker(overrides: Partial<WorkerSession>): WorkerSession {
  return {
    id: "1", workerKey: "worker-1", agentTaskId: "task-1", taskGrantId: "grant-1",
    taskAssignmentId: "assignment-1", status: "running", adapter: "opencode",
    capabilities: ["implementation"], executablePath: "/bin/opencode",
    executableVersion: "1.17.18", workingDirectory: "/work/flyd", externalSessionId: "ses_1",
    processId: 123, processIdentity: "Thu Jul 17 00:00:00 2026",
    errorSummary: null, output: null, exitStatus: null,
    startedAt: "2026-07-17T00:00:00.000Z", endedAt: null,
    lastObservedAt: "2026-07-17T00:00:00.000Z", stopReason: null, ...overrides,
  };
}

describe("recoverInterruptedWorkers", () => {
  it("marks dead and never-started workers interrupted while preserving live workers", async () => {
    const workers = [
      worker({ workerKey: "dead", processId: 123 }),
      worker({ workerKey: "queued", status: "queued", processId: null }),
      worker({ workerKey: "alive", processId: 456 }),
    ];
    const transition = vi.fn(async () => workers[0]);
    const terminateProcessGroup = vi.fn(async () => undefined);

    const recovered = await recoverInterruptedWorkers({
      workers,
      isProcessAlive: (processId) => processId === 456,
      worktreeExists: () => true,
      terminateProcessGroup,
      transition,
    });

    expect(recovered).toBe(2);
    expect(transition).toHaveBeenCalledTimes(2);
    expect(transition).toHaveBeenCalledWith("dead", expect.objectContaining({
      status: "interrupted",
      error: expect.stringContaining("worktree survives"),
    }));
    expect(transition).toHaveBeenCalledWith("queued", expect.objectContaining({
      status: "interrupted",
    }));
    expect(terminateProcessGroup).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalledWith("alive", expect.anything());
  });

  it("rejects a reused live PID whose command is not the recorded executable", () => {
    const recorded = worker({ processId: process.pid, executablePath: "/usr/local/bin/opencode" });

    const sameStart = () => recorded.processIdentity;
    expect(workerProcessIsAlive(recorded, () => "node unrelated-server.js", sameStart)).toBe(false);
    expect(workerProcessIsAlive(recorded, () => "/tmp/opencode run another-task", sameStart)).toBe(false);
    expect(workerProcessIsAlive(recorded, () => "/usr/local/bin/opencode run task", () => "different process")).toBe(false);
    expect(workerProcessIsAlive(recorded, () => "/usr/local/bin/opencode run task", sameStart)).toBe(true);
    expect(workerProcessIsAlive(recorded, () => "node /usr/local/bin/opencode run task", sameStart)).toBe(true);
  });

  it("preserves an identity-proven live running worker", async () => {
    const transition = vi.fn();
    const recovered = await recoverInterruptedWorkers({
      workers: [worker({ processId: 123 })],
      isProcessAlive: () => true,
      worktreeExists: () => true,
      transition,
    });

    expect(recovered).toBe(0);
    expect(transition).not.toHaveBeenCalled();
  });

  it("reattaches an identity-proven live worker whose durable status is starting", async () => {
    const current = worker({ status: "starting", processId: 123 });
    const transition = vi.fn(async () => current);

    const recovered = await recoverInterruptedWorkers({
      workers: [current],
      isProcessAlive: () => true,
      worktreeExists: () => true,
      transition,
    });

    expect(recovered).toBe(1);
    expect(transition).toHaveBeenCalledWith("worker-1", expect.objectContaining({
      status: "running",
      processId: 123,
      processIdentity: current.processIdentity,
    }));
  });

  it("preserves a worker after a transient liveness miss confirms the process is alive", async () => {
    const transition = vi.fn();
    const isProcessAlive = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    const recovered = await recoverInterruptedWorkers({
      workers: [worker({ processId: 123 })],
      isProcessAlive,
      worktreeExists: () => true,
      transition,
    });

    expect(recovered).toBe(0);
    expect(isProcessAlive).toHaveBeenCalledTimes(2);
    expect(transition).not.toHaveBeenCalled();
  });

  it("interrupts only when two liveness checks fail and the worktree survives", async () => {
    const transition = vi.fn();
    const isProcessAlive = vi.fn().mockReturnValue(false);

    const recovered = await recoverInterruptedWorkers({
      workers: [worker({})],
      isProcessAlive,
      worktreeExists: () => true,
      transition,
    });

    expect(recovered).toBe(1);
    expect(isProcessAlive).toHaveBeenCalledTimes(2);
    expect(transition).toHaveBeenCalledWith("worker-1", expect.objectContaining({
      status: "interrupted",
      error: expect.stringContaining("worktree survives"),
    }));
  });

  it("does not invent a terminal state when both process and worktree are missing", async () => {
    const transition = vi.fn();

    const recovered = await recoverInterruptedWorkers({
      workers: [worker({})],
      isProcessAlive: () => false,
      worktreeExists: () => false,
      transition,
    });

    expect(recovered).toBe(0);
    expect(transition).not.toHaveBeenCalled();
  });
});
