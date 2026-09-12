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
  it("supervises each active runtime project once", async () => {
    const superviseProject = vi.fn(async () => undefined);
    const roots = await runSupervisorSweep({
      listTasks: async () => [
        task({ taskKey: "a", projectRoot: "/work/flyd", status: "running" }),
        task({ taskKey: "b", projectRoot: "/work/flyd", status: "blocked" }),
        task({ taskKey: "c", projectRoot: "/work/bloom", status: "ready" }),
        task({ taskKey: "d", projectRoot: "/work/obj0", status: "completed" }),
      ],
      superviseProject,
    });

    expect(roots).toEqual(["/work/flyd", "/work/bloom"]);
    expect(superviseProject).toHaveBeenCalledTimes(2);
    expect(superviseProject).toHaveBeenNthCalledWith(1, "/work/flyd");
    expect(superviseProject).toHaveBeenNthCalledWith(2, "/work/bloom");
  });

  it("does nothing when no execution task is active", async () => {
    const superviseProject = vi.fn(async () => undefined);
    const roots = await runSupervisorSweep({
      listTasks: async () => [task({ status: "completed" }), task({ status: "cancelled" })],
      superviseProject,
    });

    expect(roots).toEqual([]);
    expect(superviseProject).not.toHaveBeenCalled();
  });
});
