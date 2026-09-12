import { randomUUID } from "node:crypto";

export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";
export type Actor = "user" | "flyd" | "external";
export type OutcomeState = "success" | "failure" | "partial" | "unknown";
export type PredictionError =
  | "correct"
  | "partially_correct"
  | "wrong_direction"
  | "effect_did_not_occur"
  | "unexpected_side_effect"
  | "insufficient_evidence";

export interface ConfidenceAssessment {
  level: ConfidenceLevel;
  reasons: string[];
}

export interface StateFact<T = unknown> {
  value: T;
  confidence: ConfidenceLevel;
  freshness?: string;
  provenance: string[];
}

export interface WorldStateSnapshot {
  id: string;
  capturedAt: string;
  projectId?: string;
  activeProjects: StateFact<string[]>;
  activeTasks: StateFact<Array<{ id?: string; description: string; status: string }>>;
  repoStates: StateFact<Array<{ root: string; branch?: string; dirty: boolean; head?: string }>>;
  blockers: StateFact<string[]>;
  decisions: StateFact<string[]>;
  commitments: StateFact<string[]>;
  entities: StateFact<string[]>;
  deadlines: StateFact<string[]>;
  agentWork: StateFact<string[]>;
}

export interface StateChange {
  path: string;
  before: unknown;
  after: unknown;
}

export interface CandidateAction {
  id: string;
  description: string;
  kind?: string;
  deterministicEffects?: Array<{ path: string; value: unknown }>;
  metadata?: Record<string, unknown>;
}

export interface PredictedEffect {
  path: string;
  before?: unknown;
  after: unknown;
  rationale: string;
}

export interface FuturePrediction {
  id: string;
  snapshotId: string;
  actionId: string;
  horizon: number;
  predictedState: WorldStateSnapshot;
  expectedEffects: PredictedEffect[];
  assumptions: string[];
  confidence: ConfidenceAssessment;
  risks: string[];
  createdAt: string;
}

export interface ActionScores {
  progress: number;
  reachability: number;
  leverage: number;
  urgency: number;
  userEffort: number;
  risk: number;
  reversibility: number;
  confidence: number;
}

export interface ActionEvaluation {
  action: CandidateAction;
  prediction: FuturePrediction;
  scores: ActionScores;
  score: number;
  reasons: string[];
}

export interface TrajectoryEvent {
  id: string;
  occurredAt: string;
  projectId?: string;
  repositoryRoot?: string;
  taskId?: string;
  threadId?: string;
  stateBeforeId: string;
  action: CandidateAction;
  actor: Actor;
  stateAfterId?: string;
  outcome: OutcomeState;
  evidence: string[];
  confidence: ConfidenceAssessment;
}

export interface PlanningTrace {
  id: string;
  createdAt: string;
  snapshotId: string;
  goal: string;
  candidates: ActionEvaluation[];
  chosenActionId?: string;
  rejectedActionIds: string[];
  uncertainty: string[];
  outcomeId?: string;
}

export interface PredictionOutcome {
  id: string;
  predictionId: string;
  observedSnapshotId: string;
  correctEffects: PredictedEffect[];
  incorrectEffects: PredictedEffect[];
  missedEffects: StateChange[];
  confidenceAtPrediction: ConfidenceAssessment;
  horizon: number;
  category: PredictionError;
  reconciledAt: string;
}

export interface PlanStep {
  action: CandidateAction;
  prediction: FuturePrediction;
  evaluation: ActionEvaluation;
}

export interface CandidatePlan {
  id: string;
  steps: PlanStep[];
  finalState: WorldStateSnapshot;
  score: number;
  accumulatedRisk: number;
  userEffort: number;
  confidence: ConfidenceAssessment;
  assumptions: string[];
}

export interface FutureModel {
  predict(input: {
    currentState: WorldStateSnapshot;
    candidateAction: CandidateAction;
    horizon?: number;
  }): Promise<FuturePrediction>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalise(value: unknown): unknown {
  if (Array.isArray(value)) return [...value].map(normalise).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalise(v)]));
  }
  return value;
}

export function diffWorldStates(before: WorldStateSnapshot, after: WorldStateSnapshot): StateChange[] {
  const ignored = new Set(["id", "capturedAt"]);
  const changes: StateChange[] = [];
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (JSON.stringify(normalise(a)) === JSON.stringify(normalise(b))) return;
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      for (const key of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) {
        if (path === "" && ignored.has(key)) continue;
        walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
      }
      return;
    }
    changes.push({ path, before: a, after: b });
  };
  walk(before, after, "");
  return changes;
}

function getPath(target: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, target);
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let cursor = target;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) cursor[key] = clone(value);
    else {
      const next = cursor[key];
      cursor[key] = next && typeof next === "object" && !Array.isArray(next) ? next : {};
      cursor = cursor[key] as Record<string, unknown>;
    }
  });
}

export function assessConfidence(input: {
  sourceFresh?: boolean;
  supportingObservations?: number;
  contradictions?: number;
  deterministic?: boolean;
  seenBefore?: boolean;
  horizon?: number;
  externalDependency?: boolean;
}): ConfidenceAssessment {
  const reasons: string[] = [];
  let points = 0;
  if (input.sourceFresh) { points += 2; reasons.push("source data is fresh"); } else reasons.push("source freshness is uncertain");
  if ((input.supportingObservations ?? 0) >= 2) { points += 1; reasons.push("multiple observations support this"); }
  if ((input.contradictions ?? 0) > 0) { points -= 2; reasons.push("contradictory evidence exists"); }
  if (input.deterministic) { points += 2; reasons.push("transition is deterministic"); }
  if (input.seenBefore) { points += 1; reasons.push("similar transition was observed before"); }
  if ((input.horizon ?? 1) > 2) { points -= 1; reasons.push("longer prediction horizon"); }
  if (input.externalDependency) { points -= 1; reasons.push("depends on an external actor or system"); }
  return { level: points >= 4 ? "high" : points >= 1 ? "medium" : points >= -1 ? "low" : "unknown", reasons };
}

/**
 * Baseline world model. It only predicts effects Flyd can state explicitly.
 * Semantic/LLM prediction can implement FutureModel later without changing callers.
 */
export class DeterministicFutureModel implements FutureModel {
  async predict({ currentState, candidateAction, horizon = 1 }: { currentState: WorldStateSnapshot; candidateAction: CandidateAction; horizon?: number }): Promise<FuturePrediction> {
    const predicted = clone(currentState);
    predicted.id = randomUUID();
    predicted.capturedAt = new Date().toISOString();
    const effects: PredictedEffect[] = [];
    for (const effect of candidateAction.deterministicEffects ?? []) {
      const before = getPath(predicted, effect.path);
      setPath(predicted as unknown as Record<string, unknown>, effect.path, effect.value);
      effects.push({ path: effect.path, before, after: effect.value, rationale: "declared deterministic action effect" });
    }
    const deterministic = effects.length > 0;
    return {
      id: randomUUID(), snapshotId: currentState.id, actionId: candidateAction.id, horizon,
      predictedState: predicted, expectedEffects: effects,
      assumptions: deterministic ? [] : ["No deterministic transition is known; state is held constant"],
      confidence: assessConfidence({ sourceFresh: true, deterministic, horizon }),
      risks: deterministic ? [] : ["Action effects are not modeled yet"], createdAt: new Date().toISOString(),
    };
  }
}

const DEFAULT_WEIGHTS: Readonly<Record<keyof ActionScores, number>> = {
  progress: 0.24, reachability: 0.20, leverage: 0.14, urgency: 0.12,
  userEffort: -0.08, risk: -0.12, reversibility: 0.06, confidence: 0.12,
};

export class ActionEvaluator {
  evaluate(action: CandidateAction, prediction: FuturePrediction, scores: ActionScores): ActionEvaluation {
    const clamp = (n: number) => Math.max(0, Math.min(1, n));
    const safe = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, clamp(v)])) as unknown as ActionScores;
    const score = (Object.keys(DEFAULT_WEIGHTS) as Array<keyof ActionScores>)
      .reduce((sum, key) => sum + safe[key] * DEFAULT_WEIGHTS[key], 0);
    return {
      action, prediction, scores: safe, score: Math.round(score * 1000) / 1000,
      reasons: [
        `progress=${safe.progress.toFixed(2)}`,
        `reachability=${safe.reachability.toFixed(2)}`,
        `risk=${safe.risk.toFixed(2)}`,
        `confidence=${safe.confidence.toFixed(2)}`,
      ],
    };
  }

  rank(evaluations: ActionEvaluation[]): ActionEvaluation[] {
    return [...evaluations].sort((a, b) => b.score - a.score);
  }
}

export function reconcilePrediction(prediction: FuturePrediction, observed: WorldStateSnapshot): PredictionOutcome {
  const observedChanges = diffWorldStates(prediction.predictedState, observed);
  const correct: PredictedEffect[] = [];
  const incorrect: PredictedEffect[] = [];
  for (const effect of prediction.expectedEffects) {
    const observedValue = getPath(observed, effect.path);
    if (JSON.stringify(normalise(observedValue)) === JSON.stringify(normalise(effect.after))) correct.push(effect);
    else incorrect.push(effect);
  }
  const predictedPaths = new Set(prediction.expectedEffects.map((e) => e.path));
  const missed = observedChanges.filter((change) => !predictedPaths.has(change.path));
  let category: PredictionError;
  if (prediction.expectedEffects.length === 0 && missed.length === 0) category = "insufficient_evidence";
  else if (incorrect.length === 0 && missed.length === 0) category = "correct";
  else if (correct.length > 0) category = "partially_correct";
  else if (incorrect.length > 0) category = "effect_did_not_occur";
  else category = "unexpected_side_effect";
  return {
    id: randomUUID(), predictionId: prediction.id, observedSnapshotId: observed.id,
    correctEffects: correct, incorrectEffects: incorrect, missedEffects: missed,
    confidenceAtPrediction: prediction.confidence, horizon: prediction.horizon,
    category, reconciledAt: new Date().toISOString(),
  };
}

export function buildPlanningTrace(input: {
  snapshotId: string; goal: string; candidates: ActionEvaluation[]; uncertainty?: string[];
}): PlanningTrace {
  const ranked = new ActionEvaluator().rank(input.candidates);
  return {
    id: randomUUID(), createdAt: new Date().toISOString(), snapshotId: input.snapshotId,
    goal: input.goal, candidates: ranked, chosenActionId: ranked[0]?.action.id,
    rejectedActionIds: ranked.slice(1).map((c) => c.action.id), uncertainty: input.uncertainty ?? [],
  };
}

export class MultiStepPlanner {
  constructor(private readonly futureModel: FutureModel, private readonly evaluator = new ActionEvaluator()) {}

  async plan(input: {
    state: WorldStateSnapshot;
    actions: CandidateAction[];
    score: (action: CandidateAction, prediction: FuturePrediction, depth: number) => ActionScores;
    maxDepth?: number;
    maxCandidates?: number;
  }): Promise<CandidatePlan[]> {
    const maxDepth = Math.max(1, Math.min(4, input.maxDepth ?? 3));
    const width = Math.max(1, Math.min(8, input.maxCandidates ?? 5));
    let frontier: CandidatePlan[] = [{
      id: randomUUID(), steps: [], finalState: input.state, score: 0, accumulatedRisk: 0,
      userEffort: 0, confidence: { level: "high", reasons: ["initial observed state"] }, assumptions: [],
    }];
    for (let depth = 0; depth < maxDepth; depth += 1) {
      const next: CandidatePlan[] = [];
      for (const plan of frontier) {
        for (const action of input.actions) {
          if (plan.steps.some((step) => step.action.id === action.id)) continue;
          const prediction = await this.futureModel.predict({ currentState: plan.finalState, candidateAction: action, horizon: depth + 1 });
          const evaluation = this.evaluator.evaluate(action, prediction, input.score(action, prediction, depth));
          const steps = [...plan.steps, { action, prediction, evaluation }];
          next.push({
            id: randomUUID(), steps, finalState: prediction.predictedState,
            score: Math.round((plan.score + evaluation.score) * 1000) / 1000,
            accumulatedRisk: plan.accumulatedRisk + evaluation.scores.risk,
            userEffort: plan.userEffort + evaluation.scores.userEffort,
            confidence: prediction.confidence,
            assumptions: [...plan.assumptions, ...prediction.assumptions],
          });
        }
      }
      frontier = next.sort((a, b) => b.score - a.score).slice(0, width);
      if (frontier.length === 0) break;
    }
    return frontier;
  }
}
