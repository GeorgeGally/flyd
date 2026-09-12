import { randomUUID } from "node:crypto";
import type { PlanningConfidence, WorldStateSnapshot } from "../intelligence/world/types.js";
import type { PlanningLearningExample } from "./store.js";
import {
  DeterministicFutureModel,
  type CandidateAction,
  type ExecutionForecast,
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
  | { kind: "repo_dirty"; root: string; value: boolean }
  | { kind: "active_task_status"; value: string }
  | { kind: "blockers_cleared" };

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
  const beforeByRoot = new Map(before.filter((repo) => repo.root).map((repo) => [repo.root as string, repo]));
  const effects: SemanticEffect[] = [];
  for (const repo of after) {
    if (!repo.root || typeof repo.dirty !== "boolean") continue;
    const previous = beforeByRoot.get(repo.root);
    if (!previous || typeof previous.dirty !== "boolean" || previous.dirty === repo.dirty) continue;
    effects.push({ kind: "repo_dirty", root: repo.root, value: repo.dirty });
  }
  return effects;
}

function activeTaskEffects(change: StateChange): SemanticEffect[] {
  if (change.path !== "activeTasks.value" || !Array.isArray(change.before) || !Array.isArray(change.after)) return [];
  const before = change.before as Array<{ id?: string; description?: string; status?: string }>;
  const after = change.after as Array<{ id?: string; description?: string; status?: string }>;
  // Live PRESENT currently exposes one active task. Keep the learned rule generic
  // across task ids, but do not guess when multiple tasks are present.
  if (before.length !== 1 || after.length !== 1) return [];
  const sameTask = before[0]?.id && after[0]?.id
    ? before[0].id === after[0].id
    : before[0]?.description === after[0]?.description;
  if (!sameTask || !before[0]?.status || !after[0]?.status || before[0].status === after[0].status) return [];
  return [{ kind: "active_task_status", value: after[0].status }];
}

function blockerEffects(change: StateChange): SemanticEffect[] {
  if (change.path !== "blockers.value" || !Array.isArray(change.before) || !Array.isArray(change.after)) return [];
  // We can safely generalise "blockers cleared" without memorising blocker text.
  // We deliberately do not predict newly-created blocker contents.
  if (change.before.length > 0 && change.after.length === 0) return [{ kind: "blockers_cleared" }];
  return [];
}

function exactEffect(effect: PredictedEffect): SemanticEffect[] {
  const repo = effect.path.match(/^repoStates\.value\.(\d+)\.dirty$/);
  if (repo && typeof effect.after === "boolean" && repo[1] === "0") {
    // Exact persisted effects do not carry the repository root. Retain backward
    // compatibility for the primary repo; richer cross-repo learning comes from
    // observed whole-array diffs where roots are available.
    return [{ kind: "repo_dirty", root: "__primary__", value: effect.after }];
  }
  const task = effect.path.match(/^activeTasks\.value\.0\.status$/);
  if (task && typeof effect.after === "string") return [{ kind: "active_task_status", value: effect.after }];
  if (effect.path === "blockers.value" && Array.isArray(effect.after) && effect.after.length === 0) {
    return [{ kind: "blockers_cleared" }];
  }
  return [];
}

export function observedSemanticEffects(example: PlanningLearningExample): SemanticEffect[] {
  const effects: SemanticEffect[] = [];
  for (const change of example.outcome.missedEffects) {
    effects.push(...repoDirtyEffects(change), ...activeTaskEffects(change), ...blockerEffects(change));
  }
  for (const effect of example.outcome.correctEffects) effects.push(...exactEffect(effect));
  return effects;
}

function effectKey(effect: SemanticEffect): string {
  if (effect.kind === "repo_dirty") return `${effect.kind}:${effect.root}:${effect.value}`;
  if (effect.kind === "active_task_status") return `${effect.kind}:${JSON.stringify(effect.value)}`;
  return effect.kind;
}

function materializeEffect(effect: SemanticEffect, state: WorldStateSnapshot, support: number, total: number): PredictedEffect | null {
  const rationale = `empirical transition observed in ${support}/${total} matching prior runs`;
  if (effect.kind === "repo_dirty") {
    const index = effect.root === "__primary__"
      ? (state.repoStates.value.length === 1 ? 0 : -1)
      : state.repoStates.value.findIndex((repo) => repo.root === effect.root);
    if (index < 0) return null;
    return {
      path: `repoStates.value.${index}.dirty`,
      before: state.repoStates.value[index].dirty,
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
  if (effect.kind === "blockers_cleared" && state.blockers.value.length > 0) {
    return {
      path: "blockers.value",
      before: state.blockers.value,
      after: [],
      rationale,
    };
  }
  return null;
}

function applyEffect(state: WorldStateSnapshot, effect: PredictedEffect): void {
  const repo = effect.path.match(/^repoStates\.value\.(\d+)\.dirty$/);
  if (repo) {
    const index = Number(repo[1]);
    if (state.repoStates.value[index]) state.repoStates.value[index].dirty = Boolean(effect.after);
    return;
  }
  if (effect.path === "activeTasks.value.0.status" && state.activeTasks.value[0] && typeof effect.after === "string") {
    state.activeTasks.value[0].status = effect.after;
    return;
  }
  if (effect.path === "blockers.value" && Array.isArray(effect.after)) {
    state.blockers.value = effect.after.filter((item): item is string => typeof item === "string");
  }
}

function empiricalConfidence(support: number, total: number): PlanningConfidence {
  const ratio = total ? support / total : 0;
  return support >= 5 && ratio >= 0.9 ? "high" : "medium";
}

function executionForecast(examples: PlanningLearningExample[], minExamples: number, consistency: number): ExecutionForecast | undefined {
  const observed = examples.filter((example) => typeof example.outcome.executionStatus === "string");
  if (observed.length < minExamples) return undefined;
  const successes = observed.filter((example) => example.outcome.executionStatus === "completed").length;
  const successRate = successes / observed.length;
  const disposition: ExecutionForecast["disposition"] = successRate >= consistency
    ? "likely_success"
    : successRate <= 1 - consistency
      ? "likely_failure"
      : "mixed";
  return {
    disposition,
    successRate,
    samples: observed.length,
    rationale: `${successes}/${observed.length} matching supervised runs completed successfully`,
  };
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
    const forecast = executionForecast(matching, this.minExamples, this.minConsistency);
    if (promoted.length === 0 && !forecast) return baseline;

    const predictedState = clone(input.currentState);
    predictedState.id = randomUUID();
    predictedState.capturedAt = new Date().toISOString();
    for (const { effect } of promoted) applyEffect(predictedState, effect);

    const weakestSupport = promoted.length > 0
      ? Math.min(...promoted.map(({ count }) => count))
      : Math.round((forecast?.successRate ?? 0.5) * (forecast?.samples ?? matching.length));
    const confidence = empiricalConfidence(Math.max(weakestSupport, this.minExamples), matching.length);
    const assumptions = [`Action family ${family} is comparable to ${matching.length} prior local runs`];
    if (forecast) assumptions.push(forecast.rationale);
    const risks = promoted.length > 0
      ? ["Empirical state effect is learned from local history and is not deterministic"]
      : ["State effects are not modeled yet"];
    if (forecast?.disposition === "mixed") risks.push("Comparable supervised runs have mixed verification outcomes");
    if (forecast?.disposition === "likely_failure") risks.push("Comparable supervised runs usually fail to complete successfully");

    return {
      ...baseline,
      id: randomUUID(),
      predictedState,
      expectedEffects: promoted.map(({ effect }) => effect),
      assumptions,
      confidence: {
        level: confidence,
        reasons: [
          promoted.length > 0
            ? `${weakestSupport}/${matching.length} prior matching runs support the weakest promoted state effect`
            : forecast?.rationale ?? "empirical history is available",
        ],
      },
      risks,
      ...(forecast ? { outcomeForecast: forecast } : {}),
      createdAt: new Date().toISOString(),
    };
  }
}
