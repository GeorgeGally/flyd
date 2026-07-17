import { describe, expect, it, vi } from "vitest";
import { recoverInterruptedWorkers, workerProcessIsAlive } from "../recovery.js";
import type { WorkerSession } from "../types.js";

function worker(overrides: Partial<WorkerSession>): WorkerSession {
  return {
    id: "1", workerKey: "worker-1", agentTaskId: "task-1", taskGrantId: "grant-1",
    status: "running", adapter: "opencode", executablePath: "/bin/opencode",
    executableVersion: "1.17.18", workingDirectory: "/work/flyd", externalSessionId: "ses_1",
    processId: 123, errorSummary: null, output: null, exitStatus: null,
    startedAt: "2026-07-17T00:00:00.000Z", endedAt: null, ...overrides,
  };
}

describe("recoverInterruptedWorkers", () => {
  it("marks dead and never-started live workers interrupted without touching a live process", async () => {
    const workers = [
      worker({ workerKey: "dead", processId: 123 }),
      worker({ workerKey: "queued", status: "queued", processId: null }),
      worker({ workerKey: "alive", processId: 456 }),
    ];
    const transition = vi.fn(async () => workers[0]);

    const recovered = await recoverInterruptedWorkers({
      workers,
      isProcessAlive: (processId) => processId === 456,
      transition,
    });

    expect(recovered).toBe(2);
    expect(transition).toHaveBeenCalledTimes(2);
    expect(transition).toHaveBeenCalledWith("dead", expect.objectContaining({
      status: "interrupted",
      error: "Flyd restarted after the worker process ended",
    }));
    expect(transition).not.toHaveBeenCalledWith("alive", expect.anything());
  });

  it("rejects a reused live PID whose command is not the recorded executable", () => {
    const recorded = worker({ processId: process.pid, executablePath: "/usr/local/bin/opencode" });

    expect(workerProcessIsAlive(recorded, () => "node unrelated-server.js")).toBe(false);
    expect(workerProcessIsAlive(recorded, () => "/tmp/opencode run another-task")).toBe(false);
    expect(workerProcessIsAlive(recorded, () => "/usr/local/bin/opencode run task")).toBe(true);
    expect(workerProcessIsAlive(recorded, () => "node /usr/local/bin/opencode run task")).toBe(true);
  });
});
