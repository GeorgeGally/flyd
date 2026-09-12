import { describe, expect, it, vi } from "vitest";
import type { WorldStateSnapshot } from "../../intelligence/world/types.js";
import { beginHarnessTrajectory, completeHarnessTrajectory, type HarnessTrajectoryDependencies } from "../harness-trajectory.js";

function snapshot(id: string): WorldStateSnapshot {
  const fact = <T>(value: T) => ({ value, confidence: "high" as const, provenance: ["test"] });
  return {
    id,
    capturedAt: "2026-09-12T00:00:00.000Z",
    activeProjects: fact(["flyd"]), activeTasks: fact([]), repoStates: fact([]), blockers: fact([]),
    decisions: fact([]), commitments: fact([]), entities: fact([]), deadlines: fact([]), agentWork: fact([]),
  };
}

function deps(): HarnessTrajectoryDependencies & {
  capture: ReturnType<typeof vi.fn>;
  recordAction: ReturnType<typeof vi.fn>;
  recordNextState: ReturnType<typeof vi.fn>;
} {
  return {
    disabled: () => false,
    capture: vi.fn()
      .mockResolvedValueOnce(snapshot("before-1"))
      .mockResolvedValueOnce(snapshot("after-1")),
    recordAction: vi.fn(() => ({ ok: true, skipped: false, sequence: 1 } as never)),
    recordNextState: vi.fn(() => ({ ok: true, skipped: false, sequence: 2 } as never)),
  };
}

describe("harness trajectory bridge", () => {
  it("links a worker action to before and after snapshots", async () => {
    const d = deps();
    const handle = await beginHarnessTrajectory({
      sessionId: "task-1",
      invocationId: "harness:worker-1",
      intent: "repair the failing build",
      projectRoot: "/tmp/flyd-worktree",
      taskId: "task-id",
      threadId: "assignment-1",
    }, d);

    expect(handle.actionCaptured).toBe(true);
    expect(d.recordAction).toHaveBeenCalledWith(expect.objectContaining({
      invocationId: "harness:worker-1",
      surface: "harness",
      stateBeforeId: "before-1",
      taskId: "task-id",
      threadId: "assignment-1",
    }));

    await completeHarnessTrajectory({ handle, signal: "verified", detail: { exitCode: 0 } }, d);
    expect(d.recordNextState).toHaveBeenCalledWith(expect.objectContaining({
      invocationId: "harness:worker-1",
      surface: "harness",
      origin: "verifier",
      signal: "verified",
      causalComplete: true,
      stateAfterId: "after-1",
      detail: { exitCode: 0 },
    }));
  });

  it("does not claim causal completeness when the action event was not captured", async () => {
    const d = deps();
    d.recordAction.mockReturnValueOnce({ ok: false, rejection: "disabled" } as never);
    const handle = await beginHarnessTrajectory({
      sessionId: "task-1", invocationId: "harness:worker-2", intent: "inspect", projectRoot: "/tmp/flyd",
    }, d);
    await completeHarnessTrajectory({ handle, signal: "failed" }, d);
    expect(d.recordNextState).toHaveBeenCalledWith(expect.objectContaining({ causalComplete: false }));
  });

  it("is a no-op when transition capture is disabled", async () => {
    const d = deps();
    d.disabled = () => true;
    const handle = await beginHarnessTrajectory({ sessionId: "task-1", intent: "inspect", projectRoot: "/tmp/flyd" }, d);
    await completeHarnessTrajectory({ handle, signal: "verified" }, d);
    expect(d.capture).not.toHaveBeenCalled();
    expect(d.recordAction).not.toHaveBeenCalled();
    expect(d.recordNextState).not.toHaveBeenCalled();
  });
});
