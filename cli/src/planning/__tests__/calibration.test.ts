import { describe, expect, it } from "vitest";
import type { WorldStateSnapshot } from "../../intelligence/world/types.js";
import { calibratedEmpiricalConfidence, empiricalCalibration } from "../calibration.js";
import { EmpiricalFutureModel } from "../empirical-future-model.js";
import {
  ActionEvaluator,
  DeterministicFutureModel,
  buildPlanningTrace,
  reconcilePrediction,
  type CandidateAction,
  type PredictionError,
} from "../future-model.js";
import type { PlanningLearningExample } from "../store.js";

function fact<T>(value: T) {
  return { value, confidence: "high" as const, provenance: ["test"] };
}

function state(dirty = false): WorldStateSnapshot {
  return {
    id: `state-${Math.random()}`,
    capturedAt: "2026-09-13T00:00:00.000Z",
    activeProjects: fact(["flyd"]),
    activeTasks: fact([]),
    repoStates: fact([{ root: "/flyd", branch: "main", dirty }]),
    blockers: fact([]),
    decisions: fact([]),
    commitments: fact([]),
    entities: fact([]),
    deadlines: fact([]),
    agentWork: fact([]),
  };
}

async function learningExample(
  index: number,
  category: PredictionError,
  action: CandidateAction = { id: "repair", description: "Execute: fix the bug", kind: "execution" },
): Promise<PlanningLearningExample> {
  const before = state(false);
  const after = state(true);
  const prediction = await new DeterministicFutureModel().predict({ currentState: before, candidateAction: action });
  const evaluation = new ActionEvaluator().evaluate(action, prediction, {
    progress: .8,
    reachability: .8,
    leverage: .7,
    urgency: .5,
    userEffort: .1,
    risk: .2,
    reversibility: .8,
    confidence: .7,
  });
  const trace = buildPlanningTrace({ snapshotId: before.id, goal: action.description, candidates: [evaluation] });
  const outcome = reconcilePrediction(prediction, after);
  outcome.category = category;
  return { correlationId: `calibration-${index}`, trace, outcome };
}

describe("empirical planning confidence calibration", () => {
  it("excludes insufficient-evidence outcomes from the accuracy denominator", async () => {
    const examples = [
      await learningExample(1, "correct"),
      await learningExample(2, "partially_correct"),
      await learningExample(3, "wrong_direction"),
      await learningExample(4, "insufficient_evidence"),
    ];

    expect(empiricalCalibration(examples)).toEqual({
      total: 4,
      scored: 3,
      unscored: 1,
      fullyCorrect: 1,
      weightedAccuracy: .5,
    });
  });

  it("allows strong repeated accurate predictions to become high confidence", async () => {
    const examples = await Promise.all([1, 2, 3, 4, 5].map((index) => learningExample(index, "correct")));
    const confidence = calibratedEmpiricalConfidence({ support: 5, total: 5, examples });

    expect(confidence.level).toBe("high");
    expect(confidence.calibration.weightedAccuracy).toBe(1);
    expect(confidence.reasons.join(" ")).toContain("calibration accuracy 100% across 5 scored outcomes");
  });

  it("downgrades repeated poorly calibrated predictions even when transition support is strong", async () => {
    const categories: PredictionError[] = ["correct", "wrong_direction", "effect_did_not_occur", "unexpected_side_effect", "wrong_direction"];
    const examples = await Promise.all(categories.map((category, index) => learningExample(index + 1, category)));
    const confidence = calibratedEmpiricalConfidence({ support: 5, total: 5, examples });

    expect(confidence.level).toBe("low");
    expect(confidence.calibration.weightedAccuracy).toBe(.2);
  });

  it("keeps insufficient-evidence history from penalising an otherwise accurate action family", async () => {
    const examples = [
      ...(await Promise.all([1, 2, 3, 4, 5].map((index) => learningExample(index, "correct")))),
      ...(await Promise.all([6, 7, 8, 9, 10].map((index) => learningExample(index, "insufficient_evidence")))),
    ];
    const confidence = calibratedEmpiricalConfidence({ support: 10, total: 10, examples });

    expect(confidence.level).toBe("high");
    expect(confidence.calibration).toMatchObject({ scored: 5, unscored: 5, weightedAccuracy: 1 });
    expect(confidence.reasons.join(" ")).toContain("5 insufficient-evidence outcomes excluded");
  });

  it("feeds poor action-family calibration back into live empirical predictions", async () => {
    const action: CandidateAction = { id: "repair", description: "Execute: fix the bug", kind: "execution" };
    const categories: PredictionError[] = ["correct", "wrong_direction", "effect_did_not_occur", "unexpected_side_effect", "wrong_direction"];
    const examples = await Promise.all(categories.map((category, index) => learningExample(index + 1, category, action)));
    const prediction = await new EmpiricalFutureModel({ examples: () => examples }).predict({
      currentState: state(false),
      candidateAction: action,
    });

    expect(prediction.expectedEffects).toEqual([
      expect.objectContaining({ path: "repoStates.value.0.dirty", after: true }),
    ]);
    expect(prediction.confidence.level).toBe("low");
    expect(prediction.risks).toContain("Prior predictions for this action family are poorly calibrated");
  });
});
