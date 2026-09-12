import { describe, expect, it } from "vitest";
import type { WorldStateSnapshot } from "../../intelligence/world/types.js";
import { decideHarnessEntry } from "../harness-decision.js";

function fact<T>(value: T) {
  return { value, confidence: "high" as const, provenance: ["test"] };
}

function state(overrides: Partial<WorldStateSnapshot> = {}): WorldStateSnapshot {
  return {
    id: "state-before",
    capturedAt: "2026-09-12T00:00:00.000Z",
    activeProjects: fact(["flyd"]),
    activeTasks: fact([]),
    repoStates: fact([{ root: "/flyd", branch: "main", dirty: false, head: "abc" }]),
    blockers: fact([]),
    decisions: fact([]),
    commitments: fact([]),
    entities: fact([]),
    deadlines: fact([]),
    agentWork: fact([]),
    ...overrides,
  };
}

describe("live harness decision policy", () => {
  it("investigates a grounded blocker before resuming a blocked task", async () => {
    const decision = await decideHarnessEntry({
      state: state({
        activeTasks: fact([{
          id: "task-1",
          description: "Ship the planner integration",
          status: "blocked",
        }]),
        blockers: fact(["CI is failing before deployment"]),
      }),
      requestedOutcome: "continue",
    });

    expect(decision.recommendation.mode).toBe("investigate");
    expect(decision.recommendation.actionId).toBe("investigate-active-task-blocker");
    expect(decision.recommendation.blockingGaps).toEqual([
      expect.objectContaining({ id: "active-task-blocker", blocking: true }),
    ]);
    expect(decision.evaluations).toHaveLength(2);
    expect(decision.evaluation.action.kind).toBe("information_gathering");
    expect(decision.evaluation.action.description).toContain("CI is failing before deployment");
  });

  it("keeps investigating when the task is ready but grounded blocker evidence remains", async () => {
    const decision = await decideHarnessEntry({
      state: state({
        activeTasks: fact([{
          id: "task-1",
          description: "Ship the planner integration",
          status: "ready",
        }]),
        blockers: fact(["The verification environment is still unavailable"]),
      }),
      requestedOutcome: "continue",
    });

    expect(decision.recommendation.mode).toBe("investigate");
    expect(decision.recommendation.actionId).toBe("investigate-active-task-blocker");
    expect(decision.evaluation.action.description).toContain("verification environment");
  });

  it("resumes after refreshed state has no blocker evidence", async () => {
    const decision = await decideHarnessEntry({
      state: state({
        activeTasks: fact([{
          id: "task-1",
          description: "Ship the planner integration",
          status: "ready",
        }]),
        blockers: fact([]),
      }),
      requestedOutcome: "continue",
    });

    expect(decision.recommendation.mode).toBe("act");
    expect(decision.recommendation.actionId).toBe("resume-active-task");
  });

  it("keeps contextual resume behavior for an unblocked active task", async () => {
    const decision = await decideHarnessEntry({
      state: state({
        activeTasks: fact([{
          id: "task-1",
          description: "Ship the planner integration",
          status: "running",
        }]),
      }),
      requestedOutcome: "continue",
    });

    expect(decision.recommendation.mode).toBe("act");
    expect(decision.recommendation.actionId).toBe("resume-active-task");
    expect(decision.evaluations).toHaveLength(1);
  });

  it("asks for a concrete outcome when a contextual request has no active task", async () => {
    const decision = await decideHarnessEntry({ state: state(), requestedOutcome: "fix it" });

    expect(decision.recommendation.mode).toBe("ask_user");
    expect(decision.recommendation.blockingGaps[0]).toMatchObject({
      id: "coding-outcome",
      kind: "user_preference",
      blocking: true,
    });
  });

  it("judges an explicit new outcome independently from an existing active task", async () => {
    const decision = await decideHarnessEntry({
      state: state({
        activeTasks: fact([{
          id: "task-old",
          description: "Old unfinished work",
          status: "running",
        }]),
      }),
      requestedOutcome: "Implement issue #123",
    });

    expect(decision.recommendation.mode).toBe("act");
    expect(decision.recommendation.actionId).toBe("execute-requested-outcome");
    expect(decision.recommendation.goal.status).toBe("unknown");
    expect(decision.recommendation.goal.results).toEqual([]);
    expect(decision.intent).toBe("Implement issue #123");
  });

  it("treats an omitted outcome as resume when a resumable task exists", async () => {
    const decision = await decideHarnessEntry({
      state: state({ activeTasks: fact([{ description: "Ship planner", status: "ready" }]) }),
    });

    expect(decision.recommendation.mode).toBe("act");
    expect(decision.intent).toBe("Ship planner");
  });
});
