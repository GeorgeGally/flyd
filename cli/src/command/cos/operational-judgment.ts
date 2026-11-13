import { createHash } from "node:crypto";
import { evaluateExecutivePredicates, type DecisionModelOptions } from "../../cognition/system-one/decision-provider.js";
import { familyEgress, questionFor } from "../../cognition/system-one/registry.js";
import { projectJevState } from "../../cognition/system-one/jev.js";
import type { PredicateEvaluation } from "../../cognition/system-one/types.js";
import type { DomainId } from "../types.js";

/**
 * A question that arrived from a domain is a request for CoS judgment, not
 * proof that George needs to decide. Model outputs can suggest tactics but
 * cannot authorize external or destructive effects.
 */
export interface OperationalQuestion {
  domain: DomainId;
  goal: string;
  question: string;
  options: string[];
  recommendation?: string;
  evidenceRefs: string[];
  /** One question already sent back to the boss is not a new permission. */
  previousResolution?: boolean;
}
export type OperationalDisposition =
  | { kind: "internal"; message: string; reason: string; judgment?: PredicateEvaluation }
  | { kind: "reason"; reason: string; judgment?: PredicateEvaluation }
  | { kind: "escalate"; reason: string; judgment?: PredicateEvaluation };

const PROTECTED = /\b(?:merge|push|publish|post publicly|deploy|release to production|purchase|pay|payment|transfer money|invoice|charge|send (?:an? )?(?:email|message|whatsapp)|email (?:a|the|him|her|them)|whatsapp|contact (?:a|the|him|her|them)|delete|destroy|erase|revoke|credentials?|password|access token|secret key|permission|security|authorize|approval|sign[- ]?off|contract|legal|liability|personal data)\b/i;
const PERSONAL = /\b(?:george(?:'s|’s)? (?:personal|taste|preference|decision|choice|approval)|only george|his own word|personal preference|subjective brand direction|client promise)\b/i;
const INTERNAL = /\b(?:test|lint|typescript|library|framework|package|implementation|function|component|layout|code|refactor|bug|fix|build|module|dependency|migration|coverage|review|debug|research|method|approach|design iteration|style rules|visual hierarchy)\b/i;

/** Deterministic veto wins over any judgment provider's confidence. */
export function protectedOperationalQuestion(question: OperationalQuestion): boolean {
  if (question.domain === "life") return true;
  const text = [question.question, ...question.options, question.recommendation ?? ""].join(" ");
  return PROTECTED.test(text) || PERSONAL.test(text);
}

function short(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function operationalQuestionKey(input: OperationalQuestion): string {
  return createHash("sha256").update([
    input.domain,
    input.question.trim().toLowerCase(),
    ...input.options.map((o) => o.trim().toLowerCase()),
  ].join("\u0000")).digest("hex").slice(0, 24);
}

export interface OperationalJudgeOptions {
  evaluate?: typeof evaluateExecutivePredicates;
  model?: DecisionModelOptions;
}

/**
 * Make a bounded internal choice. If there is no supported/grounded answer,
 * request evidence from the domain rather than passing technical admin up.
 * A repeat of the same request is for Flyd's stronger reasoning path.
 */
export async function judgeOperationalQuestion(input: OperationalQuestion, deps: OperationalJudgeOptions = {}): Promise<OperationalDisposition> {
  if (protectedOperationalQuestion(input)) {
    return { kind: "escalate", reason: "requires scoped authorization or personal judgment" };
  }
  const contextual = [input.goal, input.question, ...input.options].join(" ");
  if (!INTERNAL.test(contextual) && input.domain !== "knowledge") {
    return { kind: "escalate", reason: "no evidence this is an internal technical choice" };
  }
  if (input.previousResolution) {
    return { kind: "reason", reason: "the domain could not resolve the same internal choice after an instruction" };
  }

  const suggested = input.recommendation && input.options.includes(input.recommendation)
    ? input.recommendation : undefined;
  const state = projectJevState({
    source_kind: "domain_question",
    source_state: input.domain,
    summary: short(input.goal, 300),
    question: short(input.question, 500),
    options: input.options.map((o) => short(o, 160)).slice(0, 6),
    goal_context: "Resolve internal technical implementation questions within the accepted objective; do not authorize external effects.",
    evidence_refs: input.evidenceRefs.slice(0, 12),
  });
  const result = await (deps.evaluate ?? evaluateExecutivePredicates)(
    state,
    [questionFor("cos_operational_disposition")],
    deps.model,
    familyEgress("executive"),
  ).catch(() => undefined);
  const choice = result?.answers.cos_operational_disposition;
  const confident = result?.ok && choice?.confidence !== undefined && choice.confidence >= 0.75
    && choice.probability >= 0.75;
  if (confident && choice.choice === "escalate_to_flyd") {
    return { kind: "reason", reason: "fast judgment found a strategically consequential issue", judgment: result };
  }

  const decide = Boolean(confident && choice.choice === "use_recommendation" && suggested);
  const instruction = decide
    ? "CoS resolves the internal implementation choice: " + short(suggested!, 240) + ". Proceed and verify the result."
    : "CoS owns this implementation choice. Investigate the relevant evidence, choose the soundest internal approach and continue; report a verified result. Do not ask George for a test, library, coding or design-method choice.";
  // No model access or an abstention doesn't delegate power to a guessed option.
  return { kind: "internal", message: instruction + " This instruction grants no permission to push, merge, deploy, send, pay or delete.", reason: decide ? "grounded internal recommendation" : "internal investigation required", ...(result ? { judgment: result } : {}) };
}
