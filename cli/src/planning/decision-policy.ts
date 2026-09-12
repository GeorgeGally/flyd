import type { WorldStateSnapshot } from "../intelligence/world/types.js";
import { ActionEvaluator, type ActionEvaluation } from "./future-model.js";

export type GoalCriterionOperator = "equals" | "contains" | "empty" | "non_empty";

export interface GoalCriterion {
  id: string;
  description: string;
  path: string;
  operator: GoalCriterionOperator;
  value?: unknown;
}

export interface GoalSpec {
  id: string;
  statement: string;
  successCriteria: GoalCriterion[];
  constraints?: string[];
}

export interface GoalCriterionResult {
  criterion: GoalCriterion;
  satisfied: boolean | null;
  observed: unknown;
  reason: string;
}

export interface GoalAssessment {
  goalId: string;
  status: "met" | "partial" | "unmet" | "unknown";
  results: GoalCriterionResult[];
}

export type PlanningGapKind =
  | "missing_state"
  | "stale_state"
  | "conflict"
  | "external_dependency"
  | "user_preference"
  | "approval";

export type PlanningGapSeverity = "low" | "medium" | "high" | "critical";

export interface PlanningGap {
  id: string;
  kind: PlanningGapKind;
  description: string;
  severity: PlanningGapSeverity;
  blocking: boolean;
  evidenceNeeded?: string;
}

export type DecisionMode = "act" | "investigate" | "ask_user" | "defer";

export interface DecisionRecommendation {
  mode: DecisionMode;
  goal: GoalAssessment;
  actionId?: string;
  reasons: string[];
  blockingGaps: PlanningGap[];
}

function readPath(target: unknown, path: string): unknown {
  if (!path) return target;
  return path.split(".").reduce<unknown>((value, key) => {
    if (value == null) return undefined;
    if (Array.isArray(value) && /^\d+$/.test(key)) return value[Number(key)];
    return typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  }, target);
}

function normalise(value: unknown): string {
  if (value && typeof value === "object") {
    if (Array.isArray(value)) return JSON.stringify(value.map(normalise).sort());
    return JSON.stringify(Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, normalise(child)]),
    ));
  }
  return JSON.stringify(value);
}

function criterionResult(state: WorldStateSnapshot, criterion: GoalCriterion): GoalCriterionResult {
  const observed = readPath(state, criterion.path);
  let satisfied: boolean | null = null;
  let reason = "criterion could not be evaluated";

  if (observed !== undefined) {
    switch (criterion.operator) {
      case "equals":
        satisfied = normalise(observed) === normalise(criterion.value);
        reason = satisfied ? "observed value matches target" : "observed value does not match target";
        break;
      case "contains":
        if (Array.isArray(observed)) {
          satisfied = observed.some((item) => normalise(item) === normalise(criterion.value));
        } else if (typeof observed === "string" && typeof criterion.value === "string") {
          satisfied = observed.includes(criterion.value);
        }
        reason = satisfied == null
          ? "observed value does not support contains"
          : satisfied ? "observed value contains target" : "observed value does not contain target";
        break;
      case "empty":
        satisfied = Array.isArray(observed) || typeof observed === "string"
          ? observed.length === 0
          : observed == null;
        reason = satisfied ? "observed value is empty" : "observed value is not empty";
        break;
      case "non_empty":
        satisfied = Array.isArray(observed) || typeof observed === "string"
          ? observed.length > 0
          : observed != null;
        reason = satisfied ? "observed value is non-empty" : "observed value is empty";
        break;
    }
  }

  return { criterion, satisfied, observed, reason };
}

export function assessGoal(goal: GoalSpec, state: WorldStateSnapshot): GoalAssessment {
  if (goal.successCriteria.length === 0) {
    return { goalId: goal.id, status: "unknown", results: [] };
  }
  const results = goal.successCriteria.map((criterion) => criterionResult(state, criterion));
  const known = results.filter((result) => result.satisfied !== null);
  const satisfied = known.filter((result) => result.satisfied).length;
  const status: GoalAssessment["status"] = known.length === 0
    ? "unknown"
    : satisfied === results.length
      ? "met"
      : satisfied > 0
        ? "partial"
        : "unmet";
  return { goalId: goal.id, status, results };
}

function resolvesBlockingGap(evaluation: ActionEvaluation, gaps: PlanningGap[]): boolean {
  if (evaluation.action.kind === "information_gathering") return true;
  const declared = evaluation.action.metadata?.resolvesGapIds;
  if (!Array.isArray(declared)) return false;
  const ids = new Set(declared.filter((id): id is string => typeof id === "string"));
  return gaps.some((gap) => ids.has(gap.id));
}

/**
 * Decision boundary between ranking and execution. It does not execute and does
 * not grant authority. Its job is to prevent a plausible score from becoming a
 * confident action when the goal or evidence is not good enough.
 */
export class DecisionPolicy {
  constructor(private readonly evaluator = new ActionEvaluator()) {}

  decide(input: {
    goal: GoalSpec;
    state: WorldStateSnapshot;
    evaluations: ActionEvaluation[];
    gaps?: PlanningGap[];
  }): DecisionRecommendation {
    const goal = assessGoal(input.goal, input.state);
    const blockingGaps = (input.gaps ?? []).filter((gap) => gap.blocking);

    if (goal.status === "met") {
      return {
        mode: "defer",
        goal,
        reasons: ["goal success criteria are already satisfied"],
        blockingGaps,
      };
    }

    const userGap = blockingGaps.find((gap) => gap.kind === "user_preference" || gap.kind === "approval");
    if (userGap) {
      return {
        mode: "ask_user",
        goal,
        reasons: [`${userGap.kind} must be resolved before execution`],
        blockingGaps,
      };
    }

    if (blockingGaps.length > 0) {
      const investigations = this.evaluator
        .rank(input.evaluations.filter((evaluation) => resolvesBlockingGap(evaluation, blockingGaps)));
      if (investigations[0]) {
        return {
          mode: "investigate",
          goal,
          actionId: investigations[0].action.id,
          reasons: ["blocking evidence gap should be resolved before acting on the goal"],
          blockingGaps,
        };
      }
      return {
        mode: "defer",
        goal,
        reasons: ["blocking evidence gap exists and no candidate action resolves it"],
        blockingGaps,
      };
    }

    const ranked = this.evaluator.rank(input.evaluations);
    if (!ranked[0]) {
      return {
        mode: "defer",
        goal,
        reasons: ["no candidate action is available"],
        blockingGaps,
      };
    }

    return {
      mode: "act",
      goal,
      actionId: ranked[0].action.id,
      reasons: ["highest-ranked action can advance an unmet goal without a blocking gap"],
      blockingGaps,
    };
  }
}
