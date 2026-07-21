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
  it("marks dead and never-started workers interrupted and terminates orphaned live groups", async () => {
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
      terminateProcessGroup,
      transition,
    });

    expect(recovered).toBe(3);
    expect(transition).toHaveBeenCalledTimes(3);
    expect(transition).toHaveBeenCalledWith("dead", expect.objectContaining({
      status: "interrupted",
      error: "Flyd restarted after the worker process ended",
    }));
    expect(terminateProcessGroup).toHaveBeenCalledWith(workers[2]);
    expect(transition).toHaveBeenCalledWith("alive", expect.objectContaining({
      error: "Flyd restarted and terminated an orphaned worker process group",
    }));
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

  it("leaves a live worker alone while another Flyd supervisor holds a fresh lease", async () => {
    const transition = vi.fn();
    const terminateProcessGroup = vi.fn();

    const recovered = await recoverInterruptedWorkers({
      workers: [ worker({ processId: 123, lastObservedAt: "2026-07-21T10:00:00.000Z" }) ],
      isProcessAlive: () => true,
      terminateProcessGroup,
      transition,
      now: () => new Date("2026-07-21T10:00:05.000Z"),
    });

    expect(recovered).toBe(0);
    expect(terminateProcessGroup).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  it("terminates a worker after a transient liveness miss confirms the process is alive", async () => {
    const transition = vi.fn();
    const terminateProcessGroup = vi.fn();
    const isProcessAlive = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    const recovered = await recoverInterruptedWorkers({
      workers: [ worker({ processId: 123 }) ],
      isProcessAlive,
      terminateProcessGroup,
      transition,
    });

    expect(recovered).toBe(1);
    expect(isProcessAlive).toHaveBeenCalledTimes(2);
    expect(terminateProcessGroup).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledTimes(1);
  });

  it("interrupts a recently observed worker once two liveness checks confirm it is dead", async () => {
    const transition = vi.fn();
    const isProcessAlive = vi.fn().mockReturnValue(false);

    const recovered = await recoverInterruptedWorkers({
      workers: [ worker({ lastObservedAt: "2026-07-20T10:49:39.000Z" }) ],
      isProcessAlive,
      transition,
      now: () => new Date("2026-07-20T10:49:46.000Z"),
    });

    expect(recovered).toBe(1);
    expect(isProcessAlive).toHaveBeenCalledTimes(2);
    expect(transition).toHaveBeenCalledWith("worker-1", expect.objectContaining({
      status: "interrupted",
      error: "Flyd restarted after the worker process ended",
    }));
  });
});
