import { describe, expect, it } from "vitest";
import type { WorldStateSnapshot } from "../../intelligence/world/types.js";
import { decideHarnessEntry } from "../harness-decision.js";

function state(tasks: WorldStateSnapshot["activeTasks"]["value"]): WorldStateSnapshot {
  const fact = <T>(value: T) => ({ value, confidence: "high" as const, provenance: ["test"] });
  return {
    id: "state-1",
    capturedAt: "2026-09-12T00:00:00.000Z",
    activeProjects: fact(["flyd"]),
    activeTasks: fact(tasks),
    repoStates: fact([{ root: "/flyd", branch: "main", dirty: false }]),
    blockers: fact([]), decisions: fact([]), commitments: fact([]), entities: fact([]), deadlines: fact([]), agentWork: fact([]),
  };
}

describe("live harness decision policy", () => {
  it("resumes the active task for contextual requests", async () => {
    const result = await decideHarnessEntry({
      state: state([{ id: "task-1", description: "Fix memory retrieval", status: "blocked" }]),
      requestedOutcome: "continue",
    });

    expect(result.recommendation.mode).toBe("act");
    expect(result.recommendation.actionId).toBe("resume-active-task");
    expect(result.intent).toBe("Fix memory retrieval");
    expect(result.activeTask?.id).toBe("task-1");
  });

  it("asks for a concrete outcome when a contextual request has no active task", async () => {
    const result = await decideHarnessEntry({ state: state([]), requestedOutcome: "fix it" });

    expect(result.recommendation.mode).toBe("ask_user");
    expect(result.recommendation.blockingGaps[0]).toMatchObject({
      id: "coding-outcome",
      kind: "user_preference",
      blocking: true,
    });
  });

  it("allows a concrete coding outcome without inventing success criteria", async () => {
    const result = await decideHarnessEntry({
      state: state([]),
      requestedOutcome: "Fix the flaky planning benchmark",
    });

    expect(result.recommendation.mode).toBe("act");
    expect(result.recommendation.goal.status).toBe("unknown");
    expect(result.recommendation.actionId).toBe("execute-requested-outcome");
  });

  it("treats an omitted outcome as resume when a resumable task exists", async () => {
    const result = await decideHarnessEntry({
      state: state([{ description: "Ship planner", status: "ready" }]),
    });

    expect(result.recommendation.mode).toBe("act");
    expect(result.intent).toBe("Ship planner");
  });
});
