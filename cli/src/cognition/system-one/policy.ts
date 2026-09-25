import { createHash } from "node:crypto";
import { PREDICATE_DEFINITIONS, predicateDefinition } from "./registry.js";
import type { PredicateEvaluation } from "./types.js";

export const SYSTEM_ONE_POLICY_VERSION = "flyd.system-one.policy.v1";

const POLICY_THRESHOLD_IDS = [
  "same_entity",
  "evidence_supported",
  "supersedes_existing_claim",
  "contradicts_existing_claim",
  "relevant_to_request",
  "useful_as_current_context",
  "requires_current_verification",
  "is_correction",
  "changes_current_state",
  "refers_to_previous_action",
  "needs_reasoning_model",
] as const;

/** Default gates for `predicatePasses`, read from the predicate registry. */
export const PREDICATE_THRESHOLDS: Record<string, number> = Object.fromEntries(
  POLICY_THRESHOLD_IDS.map((id) => [id, predicateDefinition(id).threshold as number]),
);

/**
 * Fingerprint of the whole System-1 policy: every predicate's threshold,
 * gates, evaluator version and status, plus the model. A threshold or model
 * change yields a new fingerprint, which is the version a PolicyRegistry
 * candidate would promote from holdout to canary to active.
 */
export function systemOnePolicyFingerprint(model: string): string {
  const shape = PREDICATE_DEFINITIONS.map((d) => [d.id, d.threshold, d.gates ?? null, d.evaluatorVersion, d.status]);
  return createHash("sha256").update(JSON.stringify([SYSTEM_ONE_POLICY_VERSION, model, shape])).digest("hex").slice(0, 16);
}

export function predicatePasses(evaluation: PredicateEvaluation, id: string, threshold = PREDICATE_THRESHOLDS[id] ?? 0.8): boolean {
  const answer = evaluation.answers[id];
  return Boolean(evaluation.ok && answer && answer.probability >= threshold);
}

export function predicateProbability(evaluation: PredicateEvaluation, id: string): number | undefined {
  return evaluation.answers[id]?.probability;
}
