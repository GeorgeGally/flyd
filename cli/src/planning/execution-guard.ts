import type { WorldStateSnapshot } from "../intelligence/world/types.js";
import { assessGoal, type GoalCriterion } from "./decision-policy.js";
import { diffWorldStates, type FuturePrediction, type StateChange } from "./future-model.js";

export interface ExecutionContract {
  actionId: string;
  preconditions: GoalCriterion[];
  postconditions: GoalCriterion[];
  requiresApproval?: boolean;
}

export interface ExecutionCheck {
  allowed: boolean;
  reasons: string[];
  failedPreconditions: GoalCriterion[];
}

export interface ExecutionVerification {
  status: "verified" | "partial" | "failed" | "unknown";
  satisfiedPostconditions: GoalCriterion[];
  failedPostconditions: GoalCriterion[];
  reasons: string[];
}

export interface AttributionEvidence {
  origin: "user" | "tool" | "verifier" | "external" | "unknown";
  correlationMatched: boolean;
  causalComplete: boolean;
}

export type AttributionCategory =
  | "attributed_to_action"
  | "action_consistent"
  | "external_or_unknown"
  | "contradictory";

export interface AttributedChange {
  change: StateChange;
  category: AttributionCategory;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface CausalAttribution {
  predictionId: string;
  changes: AttributedChange[];
  actionAttributed: number;
  externalOrUnknown: number;
  contradictory: number;
}

function criterionAssessment(criteria: GoalCriterion[], state: WorldStateSnapshot) {
  return assessGoal({
    id: "execution-contract",
    statement: "execution contract conditions",
    successCriteria: criteria,
  }, state);
}

/**
 * Pure execution boundary. It can deny or verify an action, but it never runs
 * the action itself and therefore cannot bypass Flyd's existing authority path.
 */
export class ExecutionGuard {
  checkBefore(input: {
    contract: ExecutionContract;
    state: WorldStateSnapshot;
    approved?: boolean;
  }): ExecutionCheck {
    const reasons: string[] = [];
    if (input.contract.requiresApproval && !input.approved) {
      reasons.push("required approval is missing");
    }

    const assessment = criterionAssessment(input.contract.preconditions, input.state);
    const failedPreconditions = assessment.results
      .filter((result) => result.satisfied !== true)
      .map((result) => result.criterion);

    if (failedPreconditions.length > 0) {
      reasons.push(`${failedPreconditions.length} precondition(s) are unmet or unobservable`);
    }

    const allowed = reasons.length === 0;
    if (allowed) reasons.push("all execution preconditions are satisfied");
    return { allowed, reasons, failedPreconditions };
  }

  verifyAfter(input: {
    contract: ExecutionContract;
    state: WorldStateSnapshot;
  }): ExecutionVerification {
    if (input.contract.postconditions.length === 0) {
      return {
        status: "unknown",
        satisfiedPostconditions: [],
        failedPostconditions: [],
        reasons: ["no postconditions were declared"],
      };
    }

    const assessment = criterionAssessment(input.contract.postconditions, input.state);
    const satisfiedPostconditions = assessment.results
      .filter((result) => result.satisfied === true)
      .map((result) => result.criterion);
    const failedPostconditions = assessment.results
      .filter((result) => result.satisfied !== true)
      .map((result) => result.criterion);

    const status: ExecutionVerification["status"] = assessment.status === "met"
      ? "verified"
      : assessment.status === "partial"
        ? "partial"
        : assessment.status === "unmet"
          ? "failed"
          : "unknown";

    return {
      status,
      satisfiedPostconditions,
      failedPostconditions,
      reasons: [`postcondition assessment is ${assessment.status}`],
    };
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Cautious attribution: correlation is not treated as proof. We only use the
 * stronger `attributed_to_action` label when a predicted effect is observed and
 * the outcome came from an action-owned tool/verifier with complete causal
 * context. Everything else stays explicitly weaker or unknown.
 */
export function attributeObservedChanges(input: {
  prediction: FuturePrediction;
  before: WorldStateSnapshot;
  after: WorldStateSnapshot;
  evidence: AttributionEvidence;
}): CausalAttribution {
  const changes = diffWorldStates(input.before, input.after);
  const expected = new Map(input.prediction.expectedEffects.map((effect) => [effect.path, effect]));
  const attributed: AttributedChange[] = changes.map((change) => {
    const effect = expected.get(change.path);
    if (!effect) {
      return {
        change,
        category: "external_or_unknown" as const,
        confidence: "low" as const,
        reason: "observed change was not predicted as an action effect",
      };
    }

    if (!sameValue(change.after, effect.after)) {
      return {
        change,
        category: "contradictory" as const,
        confidence: "high" as const,
        reason: "observed value contradicts the predicted action effect",
      };
    }

    const actionOwned = input.evidence.origin === "tool" || input.evidence.origin === "verifier";
    if (actionOwned && input.evidence.correlationMatched && input.evidence.causalComplete) {
      return {
        change,
        category: "attributed_to_action" as const,
        confidence: "high" as const,
        reason: "predicted effect observed with complete correlated tool/verifier evidence",
      };
    }

    return {
      change,
      category: "action_consistent" as const,
      confidence: "medium" as const,
      reason: "change matches the prediction but causal ownership is not proven",
    };
  });

  return {
    predictionId: input.prediction.id,
    changes: attributed,
    actionAttributed: attributed.filter((item) => item.category === "attributed_to_action").length,
    externalOrUnknown: attributed.filter((item) => item.category === "external_or_unknown" || item.category === "action_consistent").length,
    contradictory: attributed.filter((item) => item.category === "contradictory").length,
  };
}
