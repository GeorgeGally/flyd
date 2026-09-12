import { describe, expect, it } from "vitest";
import type { WorldStateSnapshot } from "../../intelligence/world/types.js";
import { ActionEvaluator, DeterministicFutureModel, buildPlanningTrace, reconcilePrediction, type CandidateAction } from "../future-model.js";
import { EmpiricalFutureModel, actionFamily } from "../empirical-future-model.js";
import type { PlanningLearningExample } from "../store.js";

function state(dirty: boolean): WorldStateSnapshot {
  const fact = <T>(value: T) => ({ value, confidence: "high" as const, provenance: ["test"] });
  return {
    id: `state-${dirty}-${Math.random()}`,
    capturedAt: new Date().toISOString(),
    activeProjects: fact(["flyd"]),
    activeTasks: fact([]),
    repoStates: fact([{ root: "/flyd", branch: "main", dirty }]),
    blockers: fact([]), decisions: fact([]), commitments: fact([]), entities: fact([]), deadlines: fact([]), agentWork: fact([]),
  };
}

async function example(index: number, action: CandidateAction, afterDirty = true): Promise<PlanningLearningExample> {
  const before = state(false);
  const prediction = await new DeterministicFutureModel().predict({ currentState: before, candidateAction: action });
  const evaluation = new ActionEvaluator().evaluate(action, prediction, {
    progress: .8, reachability: .8, leverage: .7, urgency: .5, userEffort: .1, risk: .2, reversibility: .8, confidence: .7,
  });
  const trace = buildPlanningTrace({ snapshotId: before.id, goal: action.description, candidates: [evaluation] });
  const outcome = reconcilePrediction(prediction, state(afterDirty));
  return { correlationId: `run-${index}`, trace, outcome };
}

describe("empirical future model", () => {
  it("classifies action families without using volatile identifiers", () => {
    expect(actionFamily({ id: "execute-requested-outcome", description: "Execute: fix flaky tests", kind: "execution" })).toBe("execution:repair");
    expect(actionFamily({ id: "execute-requested-outcome", description: "Execute: implement caching", kind: "execution" })).toBe("execution:implementation");
    expect(actionFamily({ id: "resume-active-task", description: "Resume: anything", kind: "resume" })).toBe("resume");
  });

  it("promotes an effect only after repeated consistent real runs", async () => {
    const repair: CandidateAction = { id: "execute-requested-outcome", description: "Execute: fix the bug", kind: "execution" };
    const examples = await Promise.all([1, 2, 3].map((index) => example(index, repair)));
    const model = new EmpiricalFutureModel({ examples: () => examples });

    const prediction = await model.predict({ currentState: state(false), candidateAction: repair });

    expect(prediction.expectedEffects).toHaveLength(1);
    expect(prediction.expectedEffects[0]).toMatchObject({ path: "repoStates.value.0.dirty", after: true });
    expect(prediction.predictedState.repoStates.value[0].dirty).toBe(true);
    expect(prediction.confidence.level).toBe("medium");
  });

  it("does not learn from too few runs", async () => {
    const repair: CandidateAction = { id: "execute-requested-outcome", description: "Execute: repair CI", kind: "execution" };
    const examples = await Promise.all([1, 2].map((index) => example(index, repair)));
    const prediction = await new EmpiricalFutureModel({ examples: () => examples }).predict({
      currentState: state(false), candidateAction: repair,
    });
    expect(prediction.expectedEffects).toEqual([]);
  });

  it("does not promote inconsistent observations", async () => {
    const repair: CandidateAction = { id: "execute-requested-outcome", description: "Execute: fix CI", kind: "execution" };
    const examples = [
      await example(1, repair, true),
      await example(2, repair, true),
      await example(3, repair, false),
      await example(4, repair, false),
    ];
    const prediction = await new EmpiricalFutureModel({ examples: () => examples }).predict({
      currentState: state(false), candidateAction: repair,
    });
    expect(prediction.expectedEffects).toEqual([]);
  });

  it("falls back safely if history cannot be read", async () => {
    const model = new EmpiricalFutureModel({ examples: () => { throw new Error("db unavailable"); } });
    const prediction = await model.predict({
      currentState: state(false),
      candidateAction: { id: "execute-requested-outcome", description: "Execute: fix bug", kind: "execution" },
    });
    expect(prediction.expectedEffects).toEqual([]);
    expect(prediction.risks).toContain("Action effects are not modeled yet");
  });
});
