import type { PredicateEvaluation } from "./types.js";

export const SYSTEM_ONE_POLICY_VERSION = "flyd.system-one.policy.v1";

export const PREDICATE_THRESHOLDS: Record<string, number> = {
  same_entity: 0.90,
  evidence_supported: 0.85,
  supersedes_existing_claim: 0.90,
  contradicts_existing_claim: 0.90,
  relevant_to_request: 0.70,
  useful_as_current_context: 0.72,
  requires_current_verification: 0.75,
  is_correction: 0.85,
  changes_current_state: 0.85,
  refers_to_previous_action: 0.80,
  needs_reasoning_model: 0.70,
};

export function predicatePasses(evaluation: PredicateEvaluation, id: string, threshold = PREDICATE_THRESHOLDS[id] ?? 0.8): boolean {
  const answer = evaluation.answers[id];
  return Boolean(evaluation.ok && answer && answer.probability >= threshold);
}

export function predicateProbability(evaluation: PredicateEvaluation, id: string): number | undefined {
  return evaluation.answers[id]?.probability;
}
