import { describe, expect, it, vi } from "vitest";
import { runSupervisorSweep } from "../continuous-supervisor.js";
import type { AgentTask } from "../types.js";

function task(overrides: Partial<AgentTask>): AgentTask {
  return {
    id: "1",
    taskKey: "task-1",
    projectId: "project-1",
    projectName: "Flyd",
    projectRoot: "/work/flyd",
    status: "running",
    intendedOutcome: "Ship it",
    successCriteria: [],
    verificationCriteria: [],
    plan: {},
    contextSnapshot: {},
    repositorySnapshot: {},
    recommendedNextAction: null,
    outcomeSummary: null,
    verificationResult: {},
    revision: 1,
    startedAt: "2026-09-12T01:00:00.000Z",
    completedAt: null,
    updatedAt: "2026-09-12T01:00:00.000Z",
    ...overrides,
  };
}

describe("runSupervisorSweep", () => {
  it("reconciles then finalizes each active runtime project once", async () => {
    const calls: string[] = [];
    const superviseProject = vi.fn(async (root: string) => { calls.push(`supervise:${root}`); });
    const finalizeProject = vi.fn(async (root: string) => { calls.push(`finalize:${root}`); });
    const roots = await runSupervisorSweep({
      listTasks: async () => [
        task({ taskKey: "a", projectRoot: "/work/flyd", status: "running" }),
        task({ taskKey: "b", projectRoot: "/work/flyd", status: "blocked" }),
        task({ taskKey: "c", projectRoot: "/work/bloom", status: "ready" }),
        task({ taskKey: "d", projectRoot: "/work/obj0", status: "completed" }),
      ],
      superviseProject,
      finalizeProject,
    });

    expect(roots).toEqual(["/work/flyd", "/work/bloom"]);
    expect(calls).toEqual([
      "supervise:/work/flyd",
      "finalize:/work/flyd",
      "supervise:/work/bloom",
      "finalize:/work/bloom",
    ]);
  });

  it("does nothing when no execution task is active", async () => {
    const superviseProject = vi.fn(async () => undefined);
    const finalizeProject = vi.fn(async () => undefined);
    const roots = await runSupervisorSweep({
      listTasks: async () => [task({ status: "completed" }), task({ status: "cancelled" })],
      superviseProject,
      finalizeProject,
    });

    expect(roots).toEqual([]);
    expect(superviseProject).not.toHaveBeenCalled();
    expect(finalizeProject).not.toHaveBeenCalled();
  });
});
