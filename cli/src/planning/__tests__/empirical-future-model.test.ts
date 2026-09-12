import { describe, expect, it } from "vitest";
import type { WorldStateSnapshot } from "../../intelligence/world/types.js";
import { ActionEvaluator, DeterministicFutureModel, buildPlanningTrace, reconcilePrediction, type CandidateAction } from "../future-model.js";
import { EmpiricalFutureModel, actionFamily } from "../empirical-future-model.js";
import type { PlanningLearningExample } from "../store.js";

interface StateOptions {
  dirty?: boolean;
  secondDirty?: boolean;
  blockers?: string[];
  taskStatus?: string;
}

function state(options: StateOptions = {}): WorldStateSnapshot {
  const fact = <T>(value: T) => ({ value, confidence: "high" as const, provenance: ["test"] });
  const repos = [{ root: "/flyd", branch: "main", dirty: options.dirty ?? false }];
  if (typeof options.secondDirty === "boolean") repos.push({ root: "/cleanx", branch: "main", dirty: options.secondDirty });
  return {
    id: `state-${Math.random()}`,
    capturedAt: new Date().toISOString(),
    activeProjects: fact(["flyd"]),
    activeTasks: fact(options.taskStatus ? [{ id: "task-1", description: "fix the thing", status: options.taskStatus }] : []),
    repoStates: fact(repos),
    blockers: fact(options.blockers ?? []),
    decisions: fact([]), commitments: fact([]), entities: fact([]), deadlines: fact([]), agentWork: fact([]),
  };
}

async function example(
  index: number,
  action: CandidateAction,
  before: WorldStateSnapshot = state(),
  after: WorldStateSnapshot = state({ dirty: true }),
  executionStatus?: string,
): Promise<PlanningLearningExample> {
  const prediction = await new DeterministicFutureModel().predict({ currentState: before, candidateAction: action });
  const evaluation = new ActionEvaluator().evaluate(action, prediction, {
    progress: .8, reachability: .8, leverage: .7, urgency: .5, userEffort: .1, risk: .2, reversibility: .8, confidence: .7,
  });
  const trace = buildPlanningTrace({ snapshotId: before.id, goal: action.description, candidates: [evaluation] });
  const outcome = reconcilePrediction(prediction, after);
  if (executionStatus) outcome.executionStatus = executionStatus;
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

    const prediction = await model.predict({ currentState: state(), candidateAction: repair });

    expect(prediction.expectedEffects).toHaveLength(1);
    expect(prediction.expectedEffects[0]).toMatchObject({ path: "repoStates.value.0.dirty", after: true });
    expect(prediction.predictedState.repoStates.value[0].dirty).toBe(true);
    expect(prediction.confidence.level).toBe("medium");
  });

  it("learns a cross-repo dirty-state effect by repository root", async () => {
    const action: CandidateAction = { id: "execute-requested-outcome", description: "Execute: fix shared integration", kind: "execution" };
    const before = () => state({ dirty: false, secondDirty: false });
    const after = () => state({ dirty: false, secondDirty: true });
    const examples = await Promise.all([1, 2, 3].map((index) => example(index, action, before(), after())));
    const prediction = await new EmpiricalFutureModel({ examples: () => examples }).predict({
      currentState: before(),
      candidateAction: action,
    });

    expect(prediction.expectedEffects).toEqual([
      expect.objectContaining({ path: "repoStates.value.1.dirty", after: true }),
    ]);
    expect(prediction.predictedState.repoStates.value[0].dirty).toBe(false);
    expect(prediction.predictedState.repoStates.value[1].dirty).toBe(true);
  });

  it("learns blockers being cleared without memorising blocker text", async () => {
    const action: CandidateAction = { id: "execute-requested-outcome", description: "Execute: resolve the blocker", kind: "execution" };
    const examples = await Promise.all([1, 2, 3].map((index) => example(
      index,
      action,
      state({ blockers: [`blocker-${index}`] }),
      state({ blockers: [] }),
    )));
    const prediction = await new EmpiricalFutureModel({ examples: () => examples }).predict({
      currentState: state({ blockers: ["different blocker"] }),
      candidateAction: action,
    });

    expect(prediction.expectedEffects).toEqual([
      expect.objectContaining({ path: "blockers.value", after: [] }),
    ]);
    expect(prediction.predictedState.blockers.value).toEqual([]);
  });

  it("learns task progress as a generic active-task status transition", async () => {
    const action: CandidateAction = { id: "resume-active-task", description: "Resume: fix the thing", kind: "resume" };
    const examples = await Promise.all([1, 2, 3].map((index) => example(
      index,
      action,
      state({ taskStatus: "running" }),
      state({ taskStatus: "completed" }),
    )));
    const prediction = await new EmpiricalFutureModel({ examples: () => examples }).predict({
      currentState: state({ taskStatus: "running" }),
      candidateAction: action,
    });

    expect(prediction.expectedEffects).toEqual([
      expect.objectContaining({ path: "activeTasks.value.0.status", after: "completed" }),
    ]);
  });

  it("forecasts supervised verification success separately from world-state effects", async () => {
    const verify: CandidateAction = { id: "execute-requested-outcome", description: "Execute: verify the release", kind: "execution" };
    const examples = await Promise.all([1, 2, 3, 4].map((index) => example(
      index,
      verify,
      state(),
      state(),
      index <= 3 ? "completed" : "failed",
    )));
    const prediction = await new EmpiricalFutureModel({ examples: () => examples }, { minConsistency: .75 }).predict({
      currentState: state(),
      candidateAction: verify,
    });

    expect(prediction.expectedEffects).toEqual([]);
    expect(prediction.outcomeForecast).toMatchObject({
      disposition: "likely_success",
      successRate: .75,
      samples: 4,
    });
  });

  it("does not learn from too few runs", async () => {
    const repair: CandidateAction = { id: "execute-requested-outcome", description: "Execute: repair CI", kind: "execution" };
    const examples = await Promise.all([1, 2].map((index) => example(index, repair)));
    const prediction = await new EmpiricalFutureModel({ examples: () => examples }).predict({
      currentState: state(), candidateAction: repair,
    });
    expect(prediction.expectedEffects).toEqual([]);
  });

  it("does not promote inconsistent observations", async () => {
    const repair: CandidateAction = { id: "execute-requested-outcome", description: "Execute: fix CI", kind: "execution" };
    const examples = [
      await example(1, repair, state(), state({ dirty: true })),
      await example(2, repair, state(), state({ dirty: true })),
      await example(3, repair, state(), state({ dirty: false })),
      await example(4, repair, state(), state({ dirty: false })),
    ];
    const prediction = await new EmpiricalFutureModel({ examples: () => examples }).predict({
      currentState: state(), candidateAction: repair,
    });
    expect(prediction.expectedEffects).toEqual([]);
  });

  it("falls back safely if history cannot be read", async () => {
    const model = new EmpiricalFutureModel({ examples: () => { throw new Error("db unavailable"); } });
    const prediction = await model.predict({
      currentState: state(),
      candidateAction: { id: "execute-requested-outcome", description: "Execute: fix bug", kind: "execution" },
    });
    expect(prediction.expectedEffects).toEqual([]);
    expect(prediction.risks).toContain("Action effects are not modeled yet");
  });
});
