import { evaluateExecutivePredicates, type DecisionModelOptions } from "../../cognition/system-one/decision-provider.js";
import { familyEgress, questionFor } from "../../cognition/system-one/registry.js";
import { projectJevState } from "../../cognition/system-one/jev.js";
import type { PredicateEvaluation } from "../../cognition/system-one/types.js";
import type { Objective, PlannedRun } from "./types.js";

/** Never infer permission to retry an effect that may already have happened. */
const UNSAFE_EFFECT = /\b(?:send|email|message a client|whatsapp|book|reserve|buy|purchase|pay|transfer|publish|push|merge|deploy|delete|erase|destroy|migrate production|change permissions|rotate credentials|charge)\b/i;
const DEFAULT_ATTEMPTS = 3;

export function maxAutonomousAttempts(raw = process.env.FLYD_COS_MAX_ATTEMPTS): number {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) ? Math.max(2, Math.min(value, 5)) : DEFAULT_ATTEMPTS;
}

export interface RecoveryInput {
  objective: Pick<Objective, "words" | "brief" | "adaptations" | "urgency">;
  run: Pick<PlannedRun, "key" | "team" | "outcome" | "sent" | "attempt" | "prior" | "failure" | "ref">;
  failure: string;
  retryable: boolean;
  /** Code may have executed before it failed; this must be confirmed by the domain's receipt. */
  effectKnownInternal: boolean;
}
export type RecoveryDisposition =
  | { action: "rebrief"; reason: string; evidence?: PredicateEvaluation }
  | { action: "hold"; reason: string; evidence?: PredicateEvaluation };

export interface RecoveryJudgeOptions {
  evaluate?: typeof evaluateExecutivePredicates;
  model?: DecisionModelOptions;
  maxAttempts?: number;
}

export function canRecoverInternally(input: RecoveryInput, maxAttempts = maxAutonomousAttempts()): boolean {
  if (!input.retryable || !input.effectKnownInternal) return false;
  if (input.run.team === "life" || input.run.ref?.startsWith("crew:") || input.run.ref?.startsWith("job:")) return false;
  if (input.run.attempt >= maxAttempts) return false;
  if (UNSAFE_EFFECT.test([input.objective.words, input.run.outcome, input.run.sent ?? "", input.failure].join(" "))) return false;
  return true;
}

export async function judgeRecovery(input: RecoveryInput, options: RecoveryJudgeOptions = {}): Promise<RecoveryDisposition> {
  if (!canRecoverInternally(input, options.maxAttempts)) {
    return { action: "hold", reason: "recoveries exhausted or a possible outward effect cannot be safely repeated" };
  }
  const repeated = (input.run.failure ?? "").trim() === input.failure.trim() && Boolean(input.run.failure);
  const state = projectJevState({
    source_kind: "domain_failure",
    source_state: input.run.team,
    summary: input.run.outcome.slice(0, 300),
    question: ("What is the sound next internal recovery after attempt " + input.run.attempt + ": " + input.failure).slice(0, 500),
    options: ["rebrief", "hold"],
    goal_context: (input.objective.brief?.outcome ?? input.objective.words).slice(0, 500),
    evidence_refs: (input.run.prior ?? []).slice(0, 8),
  });
  const judged = await (options.evaluate ?? evaluateExecutivePredicates)(
    state,
    [questionFor("cos_recovery_tactic")],
    options.model,
    familyEgress("executive"),
  ).catch(() => undefined);
  const answer = judged?.answers.cos_recovery_tactic;
  if (judged?.ok && answer?.confidence !== undefined && answer.confidence >= 0.8 && answer.probability >= 0.8) {
    if (answer.choice === "hold_for_evidence") {
      return { action: "hold", reason: "the evidence does not justify another attempt", evidence: judged };
    }
  }
  const reason = repeated
    ? "A prior attempt failed the same way; choose a fundamentally different internal approach, diagnose the recurring cause, and verify it."
    : "Use the failure evidence to select a different internal approach, then verify against done_when.";
  return { action: "rebrief", reason, ...(judged ? { evidence: judged } : {}) };
}
