import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { applyVerification, scoreEvidence } from "../../lib/librarian.js";
import { scoreTailSignificance } from "../../lib/tail-significance.js";
import { configureTransitionStore, recordAction, recordNextState } from "../../transitions/writer.js";
import type { WorldStateSnapshot } from "../../intelligence/world/types.js";
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
} from "../future-model.js";
import { PLANNING_BENCHMARK, runPlanningBenchmark } from "../benchmark.js";

let planningStore: PlanningStore | null = null;
const tempPaths: string[] = [];

afterEach(() => {
  planningStore?.close();
  planningStore = null;
  configureTransitionStore();
  for (const path of tempPaths.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});

function tempPath(suffix: string): string {
  const path = join(tmpdir(), `flyd-planning-${randomUUID()}-${suffix}`);
  tempPaths.push(path);
  return path;
}

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

  it("does not call an unmodeled prediction wrong when reality changes", async () => {
    const current = state();
    const prediction = await new DeterministicFutureModel().predict({
      currentState: current,
      candidateAction: { id: "unknown", description: "execute an unmodeled action" },
    });
    const observed = state({ blockers: { value: ["new blocker"], confidence: "high", provenance: ["test"] } });
    const outcome = reconcilePrediction(prediction, observed);
    expect(outcome.category).toBe("insufficient_evidence");
    expect(outcome.missedEffects.length).toBeGreaterThan(0);
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

  it("persists snapshots, traces and calibration on the canonical intelligence spine", async () => {
    const dbPath = tempPath("intelligence.sqlite");
    const registryPath = tempPath("consents.json");
    planningStore = new PlanningStore({ dbPath, registryPath });
    const before = state();
    planningStore.saveSnapshot(before, "inv-1");
    expect(planningStore.getSnapshot(before.id)?.projectId).toBe("flyd");

    const model = new DeterministicFutureModel();
    const prediction = await model.predict({ currentState: before, candidateAction: { id: "noop", description: "no-op" } });
    const evaluation = new ActionEvaluator().evaluate({ id: "noop", description: "no-op" }, prediction, scores());
    const trace = buildPlanningTrace({ snapshotId: before.id, goal: "test", candidates: [evaluation] });
    planningStore.saveTrace(trace, "inv-1");
    expect(planningStore.getTrace(trace.id)?.goal).toBe("test");

    planningStore.saveSnapshot(prediction.predictedState, "inv-1");
    const outcome = reconcilePrediction(prediction, prediction.predictedState);
    planningStore.savePredictionOutcome(outcome, "inv-1");
    const calibration = planningStore.calibrationReport()[0];
    expect(calibration?.total).toBe(1);
    expect(calibration?.scored).toBe(0);
    expect(calibration?.unscored).toBe(1);
    expect(calibration?.correctRate).toBe(0);
  });

  it("links snapshot ids into the existing transition trajectory spine", () => {
    const dbPath = tempPath("transition.sqlite");
    const registryPath = tempPath("transition-consents.json");
    configureTransitionStore({ dbPath, registryPath });
    const before = state(); const after = state();
    const action = recordAction({ sessionId: "session-1", invocationId: "inv-trajectory", surface: "harness", intent: "fix failing build", stateBeforeId: before.id, projectId: "flyd", repositoryRoot: "/flyd" });
    const next = recordNextState({ invocationId: "inv-trajectory", surface: "harness", origin: "verifier", signal: "verified", stateAfterId: after.id });
    expect(action.ok).toBe(true); expect(next.ok).toBe(true);
    if (action.ok && !action.skipped && next.ok && !next.skipped) {
      expect(action.event.correlationId).toBe(next.event.correlationId);
      expect(action.event.payload?.stateBeforeId).toBe(before.id);
      expect(next.event.payload?.stateAfterId).toBe(after.id);
    }
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

  it("boosts retrieval utility without inflating epistemic confidence", () => {
    const base = { path: "events/failure.md", body: "production deploy failed", source: "raw" as const, score: .5, staleness: null };
    const routine = scoreEvidence({ ...base, metadata: { type: "commit", confidence: .5 } }, [], "deploy");
    const tail = scoreEvidence({ ...base, metadata: { outcome: "failure", consequence: 1, surprise: .9, confidence: .5 } }, [], "deploy");
    expect(tail.confidenceProfile.epistemicConfidence).toBe(routine.confidenceProfile.epistemicConfidence);
    expect(tail.confidenceProfile.retrievalUtility).toBeGreaterThan(routine.confidenceProfile.retrievalUtility);
    expect(tail.metadata.preservationRequired).toBe(true);
  });

  it("keeps the tail boost after verifier relevance rescoring", () => {
    const entry = scoreEvidence({
      path: "events/failure.md",
      body: "production deploy failed",
      source: "raw",
      score: .5,
      staleness: null,
      metadata: { outcome: "failure", consequence: 1, surprise: .9, confidence: .5 },
    }, [], "deploy");
    const boost = Number(entry.metadata.tailPreservationBoost);
    const verified = applyVerification([entry], {
      verified: true,
      verdicts: new Map([[entry.path, { relevant: true, reason: "directly answers the deployment question" }]]),
      sufficiency: { verdict: "sufficient", reason: "direct evidence", coverage: 1 },
      conflicts: [],
    })[0];
    expect(verified.metadata.tailPreservationBoost).toBe(boost);
    expect(verified.librarianScore).toBeGreaterThan(boost);
    expect(verified.confidenceProfile.epistemicConfidence).toBe(entry.confidenceProfile.epistemicConfidence);
  });
});

describe("planning benchmark", () => {
  it("contains representative scenarios and currently passes", async () => {
    expect(PLANNING_BENCHMARK).toHaveLength(22);
    const result = await runPlanningBenchmark();
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(22);
  });
});
