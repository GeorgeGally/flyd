import { describe, expect, it, vi } from "vitest";
import { superviseWorker } from "../worker-supervisor.js";
import type { WorkerSession } from "../types.js";

function makeWorker(status: WorkerSession["status"] = "running"): WorkerSession {
  return {
    id: "1", workerKey: "worker-1", agentTaskId: "task-1", taskGrantId: "grant-1",
    taskAssignmentId: "assignment-1", status, adapter: "codex", capabilities: ["implementation"],
    executablePath: "/usr/local/bin/codex", executableVersion: "1", workingDirectory: "/work/flyd",
    externalSessionId: "session-1", processId: 123, processIdentity: "identity",
    errorSummary: null, output: null, exitStatus: null, startedAt: "2026-09-12T01:00:00.000Z",
    endedAt: null, lastObservedAt: "2026-09-12T01:01:00.000Z", stopReason: null,
  };
}

const healthy = {
  observedAt: "2026-09-12T01:02:00.000Z",
  processAlive: true,
  processIdentityMatches: true,
  worktreeExists: true,
};

function runtimeStore() {
  return {
    transitionWorker: vi.fn(async (_key: string, update: { status: "running" | "interrupted" }) => makeWorker(update.status)),
    observeWorker: vi.fn(async () => undefined),
  };
}

describe("superviseWorker", () => {
  it("keeps a healthy running worker unchanged", async () => {
    const store = runtimeStore();
    const result = await superviseWorker({ worker: makeWorker(), store, observeReality: () => healthy });
    expect(result.reconciliation.action).toBe("noop");
    expect(result.mutated).toBe(false);
    expect(store.observeWorker).toHaveBeenCalledWith("worker-1");
    expect(store.transitionWorker).not.toHaveBeenCalled();
  });

  it("reattaches an identity-proven live worker", async () => {
    const store = runtimeStore();
    const result = await superviseWorker({ worker: makeWorker("starting"), store, observeReality: () => healthy });
    expect(result.reconciliation.action).toBe("reattach");
    expect(result.mutated).toBe(true);
    expect(store.transitionWorker).toHaveBeenCalledWith("worker-1", expect.objectContaining({ status: "running" }));
  });

  it("marks interruption when the process is gone but work survives", async () => {
    const store = runtimeStore();
    const result = await superviseWorker({
      worker: makeWorker(), store,
      observeReality: () => ({ ...healthy, processAlive: false, processIdentityMatches: false }),
    });
    expect(result.reconciliation.action).toBe("mark_interrupted");
    expect(store.transitionWorker).toHaveBeenCalledWith("worker-1", expect.objectContaining({ status: "interrupted" }));
  });

  it("does not mutate ambiguous ownership or an open decision", async () => {
    const store = runtimeStore();
    const ambiguous = await superviseWorker({
      worker: makeWorker(), store,
      observeReality: () => ({ ...healthy, processIdentityMatches: false }),
    });
    expect(ambiguous.reconciliation.action).toBe("recheck");
    expect(store.transitionWorker).not.toHaveBeenCalled();

    const decision = await superviseWorker({ worker: makeWorker(), store, openDecision: true, observeReality: () => healthy });
    expect(decision.reconciliation.action).toBe("ask_user");
    expect(store.transitionWorker).not.toHaveBeenCalled();
  });
});
