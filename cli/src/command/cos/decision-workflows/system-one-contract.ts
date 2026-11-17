/**
 * Strict bridge between Flyd's existing System-1 and AgentRun's optional
 * runJudge interface. No AgentRun dependency or execution authority here.
 * Remains unused in production until P0 Node/runtime and outcome gates pass.
 */
import { evaluateExecutivePredicates, type DecisionModelOptions } from "../../../cognition/system-one/decision-provider.js";
import { predicateDefinition, predicateThreshold, questionFor } from "../../../cognition/system-one/registry.js";
import { projectJevState } from "../../../cognition/system-one/jev.js";
import type { PredicateEvaluation } from "../../../cognition/system-one/types.js";

export const RECOVERY_PREDICATE = "cos_recovery_tactic" as const;

export type PilotJudgeQuestion = {
  type: string;
  instructions: string;
  criteria?: Readonly<Record<string, string | null>>;
};

export type PilotJudgeRequest = {
  kind: "judge" | "pick" | "sift" | "route" | "ask";
  state: unknown;
  questions: Record<string, PilotJudgeQuestion>;
  signal?: AbortSignal;
};

export type PilotJudgeResult = {
  answers: Record<string, {
    type: "choice";
    choice: string;
    probabilities: Record<string, number>;
    confidence: number;
  }>;
  model: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
  cost_usd: number | null;
};

export type JudgmentFailure = "invalid_workflow" | "invalid_response" | "proven_unsent" | "unknown_provider_outcome" | "cancelled";
export class PilotJudgmentError extends Error {
  constructor(readonly kind: JudgmentFailure) {
    super(kind);
    this.name = "PilotJudgmentError";
  }
}

function finiteUnit(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
}

function sameCriteria(
  received: Readonly<Record<string, string | null>> | undefined,
  expected: Record<string, string>,
): boolean {
  if (!received || typeof received !== "object" || Array.isArray(received)) return false;
  const names = Object.keys(expected);
  return Object.keys(received).length === names.length
    && names.every((name) => Object.hasOwn(received, name) && received[name] === expected[name]);
}

/** Reject authored questions and fields not in Flyd's exact live predicate. */
export function checkRecoveryQuestion(request: PilotJudgeRequest): void {
  const def = predicateDefinition(RECOVERY_PREDICATE);
  const expected = questionFor(RECOVERY_PREDICATE);
  const q = request.questions[RECOVERY_PREDICATE];
  if (request.kind !== "judge" || Object.keys(request.questions).length !== 1 ||
      !q || q.type !== "choice" || q.instructions !== expected.instructions ||
      !sameCriteria(q.criteria, expected.criteria as Record<string, string>)) {
    throw new PilotJudgmentError("invalid_workflow");
  }
  if (!request.state || typeof request.state !== "object" || Array.isArray(request.state)) {
    throw new PilotJudgmentError("invalid_workflow");
  }
  if (Object.keys(request.state).some((key) => !def.projection.includes(key))) {
    throw new PilotJudgmentError("invalid_workflow");
  }
}

export function exactRecoveryChoice(evaluation: PredicateEvaluation): PilotJudgeResult["answers"][string] {
  const q = questionFor(RECOVERY_PREDICATE);
  const criteria = q.criteria as Record<string, string>;
  const names = Object.keys(criteria);
  const answerIds = Object.keys(evaluation.answers);
  const found = evaluation.answers[RECOVERY_PREDICATE];
  if (!evaluation.ok || answerIds.length !== 1 || answerIds[0] !== RECOVERY_PREDICATE ||
      !found || found.type !== "choice" || !found.choice ||
      !Object.hasOwn(criteria, found.choice) ||
      !finiteUnit(found.confidence) || !finiteUnit(found.probability) ||
      !found.probabilities || Object.keys(found.probabilities).length !== names.length ||
      !names.every((name) => Object.hasOwn(found.probabilities!, name) && finiteUnit(found.probabilities![name]))) {
    throw new PilotJudgmentError("invalid_response");
  }
  const probabilities = found.probabilities!;
  const sum = Object.values(probabilities).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 0.001 || Math.abs(probabilities[found.choice]! - found.probability) > 0.001) {
    throw new PilotJudgmentError("invalid_response");
  }
  // Current Flyd normalization substitutes 0 if confidence was omitted.
  // Treat it as unusable, not as a source-backed confidence measurement.
  if (found.confidence === 0) throw new PilotJudgmentError("invalid_response");
  return {
    type: "choice", choice: found.choice, confidence: found.confidence,
    probabilities: Object.fromEntries(names.map((name) => [name, probabilities[name]!])),
  };
}

/** The registry gate is authoritative; a decoded DSL boolean is not. */
export function recoveryGate(answer: PilotJudgeResult["answers"][string]): "rebrief" | "hold" {
  const threshold = predicateThreshold(RECOVERY_PREDICATE);
  const probability = answer.probabilities[answer.choice];
  return finiteUnit(probability) && finiteUnit(answer.confidence) &&
    probability >= threshold && answer.confidence >= threshold &&
    answer.choice === "rebrief_with_different_tactic" ? "rebrief" : "hold";
}

export function createRecoveryDslJudge(options: {
  evaluate?: typeof evaluateExecutivePredicates;
  model?: DecisionModelOptions;
} = {}): (request: PilotJudgeRequest) => Promise<PilotJudgeResult> {
  return async (request) => {
    checkRecoveryQuestion(request);
    if (request.signal?.aborted) throw new PilotJudgmentError("cancelled");
    const state = projectJevState(request.state as Record<string, unknown>);
    const def = predicateDefinition(RECOVERY_PREDICATE);
    let evaluation: PredicateEvaluation;
    try {
      evaluation = await (options.evaluate ?? evaluateExecutivePredicates)(
        state, [questionFor(RECOVERY_PREDICATE)], options.model,
        { purpose: "executive", allowedFields: def.projection },
      );
    } catch {
      throw new PilotJudgmentError("unknown_provider_outcome");
    }
    if (request.signal?.aborted) throw new PilotJudgmentError("unknown_provider_outcome");
    if (!evaluation.ok) {
      const error = evaluation.error ?? "";
      const preflight = /^(?:jev_not_enabled|jev_not_configured|gemini_not_configured|no_questions|invalid_question|egress_denied:)/.test(error);
      throw new PilotJudgmentError(preflight ? "proven_unsent" : "unknown_provider_outcome");
    }
    const answer = exactRecoveryChoice(evaluation);
    return {
      answers: { [RECOVERY_PREDICATE]: answer },
      model: evaluation.model ?? null,
      usage: evaluation.usage
        ? { input_tokens: evaluation.usage.inputTokens, output_tokens: evaluation.usage.outputTokens }
        : null,
      cost_usd: evaluation.costUSD ?? null,
    };
  };
}
