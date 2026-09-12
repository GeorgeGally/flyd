import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { closeDb, resetWorkIndexPath, useWorkIndexPath } from "../../work/database.js";
import { scoreTailSignificance } from "../../lib/tail-significance.js";
import { PlanningStore } from "../store.js";
import {
  ActionEvaluator,
  DeterministicFutureModel,
  MultiStepPlanner,
  assessConfidence,
  buildPlanningTrace,
  diffWorldStates,
  reconcilePrediction,
  type ActionScores,
  type CandidateAction,
  type WorldStateSnapshot,
} from "../world-model.js";
import { PLANNING_BENCHMARK, runPlanningBenchmark } from "../benchmark.js";

let dbPath: string | null = null;
afterEach(() => {
  closeDb();
  resetWorkIndexPath();
  if (dbPath) rmSync(dbPath, { force: true });
  dbPath = null;
});

function state(overrides: Partial<WorldStateSnapshot> = {}): WorldStateSnapshot {
  const fact = <T>(value: T) => ({ value, confidence: "high" as const, provenance: ["test"] });
  return {
    id: randomUUID(), capturedAt: new Date().toISOString(), projectId: "flyd",
    activeProjects: fact(["flyd"]), activeTasks: fact([]),
    repoStates: fact([{ root: "/flyd", branch: "main", dirty: true }]),
    blockers: fact([]), decisions: fact([]), commitments: fact([]), entities: fact([]),
    deadlines: fact([]), agentWork: fact([]), ...overrides,
  };
}

const scores = (overrides: Partial<ActionScores> = {}): ActionScores => ({
  progress: .5, reachability: .5, leverage: .5, urgency: .5,
  userEffort: .2, risk: .2, reversibility: .8, confidence: .7, ...overrides,
});

describe("world-state planning foundations", () => {
  it("diffs meaningful state while ignoring snapshot identity", () => {
    const before = state();
    const after = state({ blockers: { value: ["CI failing"], confidence: "high", provenance: ["test"] } });
    const changes = diffWorldStates(before, after);
    expect(changes.some((change) => change.path.includes("blockers.value"))).toBe(true);
    expect(changes.some((change) => change.path === "id" || change.path === "capturedAt")).toBe(false);
  });

  it("ranks reachable safe progress over superficially closer risky progress", async () => {
    const model = new DeterministicFutureModel();
    const evaluator = new ActionEvaluator();
    const current = state();
    const close: CandidateAction = { id: "close", description: "jump to final state" };
    const reachable: CandidateAction = { id: "reachable", description: "remove blocker" };
    const closePrediction = await model.predict({ currentState: current, candidateAction: close });
    const reachablePrediction = await model.predict({ currentState: current, candidateAction: reachable });
    const ranked = evaluator.rank([
      evaluator.evaluate(close, closePrediction, scores({ progress: 1, reachability: .05, risk: 1, reversibility: .1 })),
      evaluator.evaluate(reachable, reachablePrediction, scores({ progress: .72, reachability: .95, risk: .1, leverage: .9 })),
    ]);
    expect(ranked[0].action.id).toBe("reachable");
  });

  it("applies declared deterministic effects and reconciles them against reality", async () => {
    const current = state();
    const action: CandidateAction = {
      id: "clean", description: "clean repository",
      deterministicEffects: [{ path: "repoStates.value", value: [{ root: "/flyd", branch: "main", dirty: false }] }],
    };
    const prediction = await new DeterministicFutureModel().predict({ currentState: current, candidateAction: action });
    const observed = prediction.predictedState;
    const outcome = reconcilePrediction(prediction, observed);
    expect(outcome.category).toBe("correct");
    expect(outcome.correctEffects).toHaveLength(1);
  });

  it("calibrates deterministic fresh transitions above contradictory external predictions", () => {
    expect(assessConfidence({ sourceFresh: true, deterministic: true, supportingObservations: 2 }).level).toBe("high");
    expect(assessConfidence({ sourceFresh: false, contradictions: 2, externalDependency: true, horizon: 4 }).level).toBe("unknown");
  });

  it("builds inspectable traces without hidden reasoning", async () => {
    const current = state();
    const model = new DeterministicFutureModel();
    const action: CandidateAction = { id: "a", description: "do useful thing" };
    const prediction = await model.predict({ currentState: current, candidateAction: action });
    const evaluation = new ActionEvaluator().evaluate(action, prediction, scores({ progress: .8 }));
    const trace = buildPlanningTrace({ snapshotId: current.id, goal: "ship", candidates: [evaluation], uncertainty: ["external API unknown"] });
    expect(trace.chosenActionId).toBe("a");
    expect(trace.uncertainty).toEqual(["external API unknown"]);
  });

  it("plans short trajectories without executing actions", async () => {
    const planner = new MultiStepPlanner(new DeterministicFutureModel());
    const actions = [{ id: "a", description: "first" }, { id: "b", description: "second" }];
    const plans = await planner.plan({ state: state(), actions, maxDepth: 2, maxCandidates: 3, score: () => scores({ progress: .8 }) });
    expect(plans[0].steps).toHaveLength(2);
    expect(new Set(plans[0].steps.map((step) => step.action.id)).size).toBe(2);
  });

  it("persists snapshots, trajectories, traces and calibration outcomes in the work index", async () => {
    dbPath = join(tmpdir(), `flyd-planning-${randomUUID()}.sqlite`);
    useWorkIndexPath(dbPath);
    const store = new PlanningStore();
    const before = state();
    const after = state();
    store.saveSnapshot(before);
    store.saveSnapshot(after);
    store.saveTrajectory({
      id: randomUUID(), occurredAt: new Date().toISOString(), projectId: "flyd",
      stateBeforeId: before.id, stateAfterId: after.id,
      action: { id: "fix", description: "fix issue" }, actor: "flyd", outcome: "success",
      evidence: ["verified test"], confidence: { level: "high", reasons: ["verified"] },
    });
    expect(store.trajectoriesForProject("flyd")).toHaveLength(1);

    const model = new DeterministicFutureModel();
    const prediction = await model.predict({ currentState: before, candidateAction: { id: "noop", description: "no-op" } });
    const evaluation = new ActionEvaluator().evaluate({ id: "noop", description: "no-op" }, prediction, scores());
    const trace = buildPlanningTrace({ snapshotId: before.id, goal: "test", candidates: [evaluation] });
    store.saveTrace(trace);
    expect(store.getTrace(trace.id)?.goal).toBe("test");
    const outcome = reconcilePrediction(prediction, prediction.predictedState);
    store.saveSnapshot(prediction.predictedState);
    store.savePredictionOutcome(outcome);
    expect(store.calibrationReport()[0]?.total).toBe(1);
  });
});

describe("tail event preservation", () => {
  it("protects a production failure among routine events", () => {
    const routine = Array.from({ length: 100 }, () => scoreTailSignificance({ type: "commit", consequence: .1 }));
    const failure = scoreTailSignificance({ outcome: "failure", consequence: 1, surprise: .9 });
    expect(routine.every((item) => !item.preserve)).toBe(true);
    expect(failure.preserve).toBe(true);
    expect(failure.reasons).toContain("failure");
  });

  it("protects explicit decisions and user corrections", () => {
    expect(scoreTailSignificance({ type: "decision", consequence: .7 }).preserve).toBe(true);
    expect(scoreTailSignificance({ type: "user_correction", surprise: .7 }).preserve).toBe(true);
  });
});

describe("planning benchmark", () => {
  it("contains twenty representative scenarios and currently passes", async () => {
    expect(PLANNING_BENCHMARK).toHaveLength(20);
    const result = await runPlanningBenchmark();
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(20);
  });
});
