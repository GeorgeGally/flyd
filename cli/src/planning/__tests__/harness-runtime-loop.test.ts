import { describe, expect, it, vi } from "vitest";
import type { WorldStateSnapshot } from "../../intelligence/world/types.js";
import { DeterministicFutureModel } from "../future-model.js";
import { runContinuityHarness } from "../harness-runtime.js";
import type { HarnessTrajectoryHandle } from "../harness-trajectory.js";

function fact<T>(value: T) {
  return { value, confidence: "high" as const, provenance: ["test"] };
}

function state(input: { status: string; blockers?: string[]; id?: string }): WorldStateSnapshot {
  return {
    id: input.id ?? `state-${input.status}`,
    capturedAt: "2026-09-12T00:00:00.000Z",
    activeProjects: fact(["flyd"]),
    activeTasks: fact([{
      id: "task-1",
      description: "Ship the planner integration",
      status: input.status,
    }]),
    repoStates: fact([{ root: "/flyd", branch: "main", dirty: false, head: "abc" }]),
    blockers: fact(input.blockers ?? []),
    decisions: fact([]), commitments: fact([]), entities: fact([]), deadlines: fact([]), agentWork: fact([]),
  };
}

function handle(id: string, snapshot: WorldStateSnapshot): HarnessTrajectoryHandle {
  return {
    invocationId: id,
    sessionId: "code:test",
    projectRoot: "/flyd",
    actionCaptured: true,
    stateBefore: snapshot,
  };
}

function input(close: ReturnType<typeof vi.fn>) {
  return {
    outcome: "continue",
    cwd: "/flyd",
    deps: {
      inspectRepository: vi.fn(async () => ({
        root: "/flyd", name: "flyd", remote: null, branch: "main", head: "abc",
        dirty: false, statusLines: [], statusDigest: "clean",
      })),
      terminal: {
        write: vi.fn(),
        ask: vi.fn(async () => ""),
        confirm: vi.fn(async () => true),
        close,
      },
    },
  } as unknown as Parameters<typeof runContinuityHarness>[0];
}

describe("live investigate → refresh → replan loop", () => {
  it("automatically resumes once when blocker evidence clears", async () => {
    const before = state({ status: "blocked", blockers: ["CI is failing"] });
    const refreshed = state({ status: "ready", blockers: [], id: "state-refreshed" });
    const final = state({ status: "completed", blockers: [], id: "state-final" });
    const close = vi.fn(async () => undefined);
    const runHarness = vi.fn(async (runtimeInput: Parameters<typeof runContinuityHarness>[0]) => {
      await runtimeInput.deps.terminal.close();
      return runHarness.mock.calls.length === 1
        ? { status: "ready" as const, taskKey: "task-1" }
        : { status: "completed" as const, taskKey: "task-1" };
    });
    const beginTrajectory = vi.fn()
      .mockResolvedValueOnce(handle("trajectory-investigate", before))
      .mockResolvedValueOnce(handle("trajectory-resume", refreshed));
    const completeTrajectory = vi.fn()
      .mockResolvedValueOnce(refreshed)
      .mockResolvedValueOnce(final);
    const recordPrediction = vi.fn(() => null);
    const reconcilePrediction = vi.fn(() => null);

    const result = await runContinuityHarness(input(close), {
      futureModelFactory: () => new DeterministicFutureModel(),
      beginTrajectory,
      completeTrajectory,
      runHarness: runHarness as never,
      recordPrediction: recordPrediction as never,
      reconcilePrediction: reconcilePrediction as never,
    });

    expect(result.status).toBe("completed");
    expect(runHarness).toHaveBeenCalledTimes(2);
    expect(runHarness.mock.calls[0]![0]).toMatchObject({
      outcome: undefined,
      focusedAssignment: expect.stringContaining("Investigate the active-task blocker"),
    });
    expect(runHarness.mock.calls[1]![0]).toMatchObject({
      outcome: "Ship the planner integration",
      focusedAssignment: undefined,
    });
    expect(beginTrajectory).toHaveBeenCalledTimes(2);
    expect(recordPrediction).toHaveBeenCalledTimes(2);
    expect(reconcilePrediction).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("stops after one investigation when blocker evidence remains", async () => {
    const before = state({ status: "blocked", blockers: ["CI is failing"] });
    const refreshed = state({
      status: "ready",
      blockers: ["CI is still failing"],
      id: "state-still-blocked",
    });
    const close = vi.fn(async () => undefined);
    const runHarness = vi.fn(async (runtimeInput: Parameters<typeof runContinuityHarness>[0]) => {
      await runtimeInput.deps.terminal.close();
      return { status: "ready" as const, taskKey: "task-1" };
    });
    const beginTrajectory = vi.fn().mockResolvedValueOnce(handle("trajectory-investigate", before));
    const completeTrajectory = vi.fn().mockResolvedValueOnce(refreshed);

    const result = await runContinuityHarness(input(close), {
      futureModelFactory: () => new DeterministicFutureModel(),
      beginTrajectory,
      completeTrajectory,
      runHarness: runHarness as never,
      recordPrediction: vi.fn(() => null) as never,
      reconcilePrediction: vi.fn(() => null) as never,
    });

    expect(result.status).toBe("ready");
    expect(runHarness).toHaveBeenCalledTimes(1);
    expect(beginTrajectory).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
