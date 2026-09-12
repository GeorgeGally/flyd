import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { WorldStateSnapshot } from "../../intelligence/world/types.js";
import { ActionEvaluator, DeterministicFutureModel, type ActionScores, type CandidateAction } from "../future-model.js";
import { DecisionPolicy, assessGoal, type GoalSpec, type PlanningGap } from "../decision-policy.js";

function state(overrides: Partial<WorldStateSnapshot> = {}): WorldStateSnapshot {
  const fact = <T>(value: T) => ({ value, confidence: "high" as const, provenance: ["test"] });
  return {
    id: randomUUID(),
    capturedAt: new Date().toISOString(),
    projectId: "flyd",
    activeProjects: fact(["flyd"]),
    activeTasks: fact([{ id: "task-1", description: "Ship planner", status: "running" }]),
    repoStates: fact([{ root: "/flyd", branch: "main", dirty: true }]),
    blockers: fact([]),
    decisions: fact([]),
    commitments: fact([]),
    entities: fact([]),
    deadlines: fact([]),
    agentWork: fact([]),
    ...overrides,
  };
}

const scores = (overrides: Partial<ActionScores> = {}): ActionScores => ({
  progress: .7,
  reachability: .8,
  leverage: .6,
  urgency: .5,
  userEffort: .2,
  risk: .2,
  reversibility: .8,
  confidence: .8,
  ...overrides,
});

const goal: GoalSpec = {
  id: "goal:clean-repo",
  statement: "Reach a clean repository",
  successCriteria: [{
    id: "repo-clean",
    description: "repository is clean",
    path: "repoStates.value.0.dirty",
    operator: "equals",
    value: false,
  }],
};

async function evaluate(action: CandidateAction, scoreOverrides: Partial<ActionScores> = {}) {
  const current = state();
  const prediction = await new DeterministicFutureModel().predict({ currentState: current, candidateAction: action });
  return new ActionEvaluator().evaluate(action, prediction, scores(scoreOverrides));
}

describe("goal assessment", () => {
  it("knows when explicit success criteria are already met", () => {
    const current = state({ repoStates: { value: [{ root: "/flyd", branch: "main", dirty: false }], confidence: "high", provenance: ["test"] } });
    const result = assessGoal(goal, current);
    expect(result.status).toBe("met");
    expect(result.results[0].satisfied).toBe(true);
  });

  it("reports unknown when a criterion cannot be observed", () => {
    const result = assessGoal({
      id: "goal:unknown",
      statement: "Know deployment state",
      successCriteria: [{ id: "deployed", description: "deployment complete", path: "deployment.status", operator: "equals", value: "complete" }],
    }, state());
    expect(result.status).toBe("unknown");
  });
});

describe("decision policy", () => {
  it("does not keep acting after the goal is already met", async () => {
    const current = state({ repoStates: { value: [{ root: "/flyd", branch: "main", dirty: false }], confidence: "high", provenance: ["test"] } });
    const candidate = await evaluate({ id: "more", description: "do more work" });
    const decision = new DecisionPolicy().decide({ goal, state: current, evaluations: [candidate] });
    expect(decision.mode).toBe("defer");
    expect(decision.actionId).toBeUndefined();
  });

  it("chooses investigation over a high-scoring action when evidence is blocking", async () => {
    const act = await evaluate({ id: "act", description: "change architecture" }, { progress: 1 });
    const inspect = await evaluate({ id: "inspect", description: "inspect authoritative state", kind: "information_gathering" }, { progress: .2, risk: .05, confidence: 1 });
    const gaps: PlanningGap[] = [{ id: "live-state", kind: "missing_state", description: "live state is missing", severity: "high", blocking: true }];
    const decision = new DecisionPolicy().decide({ goal, state: state(), evaluations: [act, inspect], gaps });
    expect(decision.mode).toBe("investigate");
    expect(decision.actionId).toBe("inspect");
  });

  it("asks the user when the missing fact is preference or approval", async () => {
    const candidate = await evaluate({ id: "deploy", description: "deploy" });
    const gaps: PlanningGap[] = [{ id: "approval", kind: "approval", description: "deployment approval missing", severity: "critical", blocking: true }];
    const decision = new DecisionPolicy().decide({ goal, state: state(), evaluations: [candidate], gaps });
    expect(decision.mode).toBe("ask_user");
    expect(decision.actionId).toBeUndefined();
  });

  it("defers instead of guessing when no candidate can close a blocking gap", async () => {
    const candidate = await evaluate({ id: "implement", description: "implement assumption" });
    const gaps: PlanningGap[] = [{ id: "conflict", kind: "conflict", description: "sources disagree", severity: "high", blocking: true }];
    const decision = new DecisionPolicy().decide({ goal, state: state(), evaluations: [candidate], gaps });
    expect(decision.mode).toBe("defer");
    expect(decision.actionId).toBeUndefined();
  });
});
