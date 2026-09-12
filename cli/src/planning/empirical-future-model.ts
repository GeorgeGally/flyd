import { randomUUID } from "node:crypto";
import type { PlanningConfidence, WorldStateSnapshot } from "../intelligence/world/types.js";
import type { PlanningLearningExample } from "./store.js";
import {
  DeterministicFutureModel,
  type CandidateAction,
  type FutureModel,
  type FuturePrediction,
  type PredictedEffect,
  type StateChange,
} from "./future-model.js";

export interface EmpiricalHistoryProvider {
  examples(): PlanningLearningExample[];
}

export interface EmpiricalFutureModelOptions {
  minExamples?: number;
  minConsistency?: number;
}

type SemanticEffect =
  | { kind: "primary_repo_dirty"; value: boolean }
  | { kind: "active_task_status"; value: string };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normaliseIntent(text: string): string {
  return text.replace(/^(?:execute|resume):\s*/i, "").toLowerCase();
}

export function actionFamily(action: CandidateAction): string {
  if (action.id === "resume-active-task" || action.kind === "resume") return "resume";
  const text = normaliseIntent(action.description);
  if (/\b(fix|repair|resolve|debug|restore)\b/.test(text)) return "execution:repair";
  if (/\b(implement|add|build|create|ship|make)\b/.test(text)) return "execution:implementation";
  if (/\b(refactor|cleanup|clean up|restructure|simplify)\b/.test(text)) return "execution:refactor";
  if (/\b(test|verify|validate|check)\b/.test(text)) return "execution:verification";
  if (/\b(review|inspect|investigate|analyse|analyze|audit)\b/.test(text)) return "execution:inspection";
  return "execution:other";
}

function repoDirtyEffects(change: StateChange): SemanticEffect[] {
  if (change.path !== "repoStates.value" || !Array.isArray(change.before) || !Array.isArray(change.after)) return [];
  const before = change.before as Array<{ root?: string; dirty?: boolean }>;
  const after = change.after as Array<{ root?: string; dirty?: boolean }>;
  if (before.length !== 1 || after.length !== 1) return [];
  if (typeof before[0]?.dirty !== "boolean" || typeof after[0]?.dirty !== "boolean") return [];
  if (before[0].dirty === after[0].dirty) return [];
  return [{ kind: "primary_repo_dirty", value: after[0].dirty }];
}

function activeTaskEffects(change: StateChange): SemanticEffect[] {
  if (change.path !== "activeTasks.value" || !Array.isArray(change.before) || !Array.isArray(change.after)) return [];
  const before = change.before as Array<{ id?: string; description?: string; status?: string }>;
  const after = change.after as Array<{ id?: string; description?: string; status?: string }>;
  if (before.length !== 1 || after.length !== 1) return [];
  const sameTask = before[0]?.id && after[0]?.id
    ? before[0].id === after[0].id
    : before[0]?.description === after[0]?.description;
  if (!sameTask || !before[0]?.status || !after[0]?.status || before[0].status === after[0].status) return [];
  return [{ kind: "active_task_status", value: after[0].status }];
}

function exactEffect(effect: PredictedEffect): SemanticEffect[] {
  const repo = effect.path.match(/^repoStates\.value\.0\.dirty$/);
  if (repo && typeof effect.after === "boolean") return [{ kind: "primary_repo_dirty", value: effect.after }];
  const task = effect.path.match(/^activeTasks\.value\.0\.status$/);
  if (task && typeof effect.after === "string") return [{ kind: "active_task_status", value: effect.after }];
  return [];
}

export function observedSemanticEffects(example: PlanningLearningExample): SemanticEffect[] {
  const effects: SemanticEffect[] = [];
  for (const change of example.outcome.missedEffects) {
    effects.push(...repoDirtyEffects(change), ...activeTaskEffects(change));
  }
  for (const effect of example.outcome.correctEffects) effects.push(...exactEffect(effect));
  return effects;
}

function effectKey(effect: SemanticEffect): string {
  return `${effect.kind}:${JSON.stringify(effect.value)}`;
}

function materializeEffect(effect: SemanticEffect, state: WorldStateSnapshot, support: number, total: number): PredictedEffect | null {
  const rationale = `empirical transition observed in ${support}/${total} matching prior runs`;
  if (effect.kind === "primary_repo_dirty" && state.repoStates.value.length === 1) {
    return {
      path: "repoStates.value.0.dirty",
      before: state.repoStates.value[0].dirty,
      after: effect.value,
      rationale,
    };
  }
  if (effect.kind === "active_task_status" && state.activeTasks.value.length === 1) {
    return {
      path: "activeTasks.value.0.status",
      before: state.activeTasks.value[0].status,
      after: effect.value,
      rationale,
    };
  }
  return null;
}

function applyEffect(state: WorldStateSnapshot, effect: PredictedEffect): void {
  if (effect.path === "repoStates.value.0.dirty" && state.repoStates.value[0]) {
    state.repoStates.value[0].dirty = Boolean(effect.after);
  }
  if (effect.path === "activeTasks.value.0.status" && state.activeTasks.value[0] && typeof effect.after === "string") {
    state.activeTasks.value[0].status = effect.after;
  }
}

function empiricalConfidence(support: number, total: number): PlanningConfidence {
  const ratio = total ? support / total : 0;
  return support >= 5 && ratio >= 0.9 ? "high" : "medium";
}

/**
 * Conservative local transition learner. It only promotes stable effects from
 * repeated, correlated real runs. Exact deterministic effects always win.
 */
export class EmpiricalFutureModel implements FutureModel {
  private readonly baseline = new DeterministicFutureModel();
  private readonly minExamples: number;
  private readonly minConsistency: number;

  constructor(
    private readonly history: EmpiricalHistoryProvider,
    options: EmpiricalFutureModelOptions = {},
  ) {
    this.minExamples = Math.max(3, options.minExamples ?? 3);
    this.minConsistency = Math.max(0.5, Math.min(1, options.minConsistency ?? 0.8));
  }

  async predict(input: { currentState: WorldStateSnapshot; candidateAction: CandidateAction; horizon?: number }): Promise<FuturePrediction> {
    const baseline = await this.baseline.predict(input);
    if (baseline.expectedEffects.length > 0) return baseline;

    let examples: PlanningLearningExample[];
    try {
      examples = this.history.examples();
    } catch {
      return baseline;
    }
    const family = actionFamily(input.candidateAction);
    const matching = examples.filter((example) => {
      const chosen = example.trace.candidates.find((candidate) => candidate.action.id === example.trace.chosenActionId);
      return chosen ? actionFamily(chosen.action) === family : false;
    });
    if (matching.length < this.minExamples) return baseline;

    const counts = new Map<string, { effect: SemanticEffect; count: number }>();
    for (const example of matching) {
      const unique = new Map(observedSemanticEffects(example).map((effect) => [effectKey(effect), effect]));
      for (const [key, effect] of unique) {
        const current = counts.get(key) ?? { effect, count: 0 };
        current.count += 1;
        counts.set(key, current);
      }
    }

    const promoted = [...counts.values()]
      .filter(({ count }) => count / matching.length >= this.minConsistency)
      .map(({ effect, count }) => ({ effect: materializeEffect(effect, input.currentState, count, matching.length), count }))
      .filter((item): item is { effect: PredictedEffect; count: number } => Boolean(item.effect));
    if (promoted.length === 0) return baseline;

    const predictedState = clone(input.currentState);
    predictedState.id = randomUUID();
    predictedState.capturedAt = new Date().toISOString();
    for (const { effect } of promoted) applyEffect(predictedState, effect);
    const weakestSupport = Math.min(...promoted.map(({ count }) => count));
    const confidence = empiricalConfidence(weakestSupport, matching.length);
    return {
      ...baseline,
      id: randomUUID(),
      predictedState,
      expectedEffects: promoted.map(({ effect }) => effect),
      assumptions: [`Action family ${family} is comparable to ${matching.length} prior local runs`],
      confidence: {
        level: confidence,
        reasons: [`${weakestSupport}/${matching.length} prior matching runs support the weakest promoted effect`],
      },
      risks: ["Empirical effect is learned from local history and is not deterministic"],
      createdAt: new Date().toISOString(),
    };
  }
}
