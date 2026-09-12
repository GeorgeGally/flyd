import type { WorldStateSnapshot } from "../intelligence/world/types.js";
import { buildPlanningTrace, reconcilePrediction, type PlanningTrace, type PredictionOutcome } from "./future-model.js";
import type { HarnessDecision } from "./harness-decision.js";
import { PlanningStore } from "./store.js";

export interface HarnessLearningDependencies {
  saveTrace: (trace: PlanningTrace, correlationId: string) => void;
  saveOutcome: (outcome: PredictionOutcome, correlationId: string) => void;
}

const defaultDependencies: HarnessLearningDependencies = {
  saveTrace: (trace, correlationId) => {
    const store = new PlanningStore();
    try {
      store.saveTrace(trace, correlationId);
    } finally {
      store.close();
    }
  },
  saveOutcome: (outcome, correlationId) => {
    const store = new PlanningStore();
    try {
      store.savePredictionOutcome(outcome, correlationId);
    } finally {
      store.close();
    }
  },
};

/** Persist the structured prediction that actually reached execution. */
export function recordHarnessPrediction(
  decision: HarnessDecision,
  correlationId: string,
  deps: HarnessLearningDependencies = defaultDependencies,
): PlanningTrace | null {
  if (decision.recommendation.mode !== "act" || !decision.recommendation.actionId) return null;
  if (decision.evaluation.action.id !== decision.recommendation.actionId) return null;

  const trace = buildPlanningTrace({
    snapshotId: decision.evaluation.prediction.snapshotId,
    goal: decision.intent,
    candidates: [decision.evaluation],
    uncertainty: [
      ...decision.evaluation.prediction.assumptions,
      ...decision.evaluation.prediction.risks,
    ],
  });
  try {
    deps.saveTrace(trace, correlationId);
  } catch (error) {
    console.warn("[planning] live prediction trace persistence failed:", error instanceof Error ? error.message : error);
  }
  return trace;
}

/** Compare the executed prediction with the exact observed after-state. */
export function reconcileHarnessPrediction(
  decision: HarnessDecision | null,
  observed: WorldStateSnapshot | null,
  correlationId: string,
  deps: HarnessLearningDependencies = defaultDependencies,
  execution?: { status?: string; signal?: string },
): PredictionOutcome | null {
  if (!decision || !observed) return null;
  if (decision.recommendation.mode !== "act" || !decision.recommendation.actionId) return null;
  if (decision.evaluation.action.id !== decision.recommendation.actionId) return null;

  const reconciled = reconcilePrediction(decision.evaluation.prediction, observed);
  const outcome: PredictionOutcome = {
    ...reconciled,
    ...(execution?.status ? { executionStatus: execution.status } : {}),
    ...(execution?.signal ? { executionSignal: execution.signal } : {}),
  };
  try {
    deps.saveOutcome(outcome, correlationId);
  } catch (error) {
    console.warn("[planning] live prediction reconciliation persistence failed:", error instanceof Error ? error.message : error);
  }
  return outcome;
}
