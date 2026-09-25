import { classifyRecallIntent } from "../lib/recall-intent.js";
import { evaluatePredicates } from "./system-one/jev.js";
import { familyEgress, familyQuestions, predicateThreshold } from "./system-one/registry.js";
import type { JevOptions } from "./system-one/types.js";
import type { IntentInterpretation, IntentKind } from "./types.js";

const ACTION = /\b(fix|implement|build|create|write|change|update|delete|send|run|commit|deploy|continue|do that|do it)\b/i;
const CORRECTION = /\b(no,?|actually|that's wrong|that is wrong|not anymore|is done|already happened|stop telling me|correction)\b/i;
const PAST = /\b(yesterday|before|previously|last time|what did|used to|back when|history|historical)\b/i;
const FUTURE = /\b(tomorrow|next|upcoming|will|plan to|going to)\b/i;

export function deterministicInterpretation(text: string): IntentInterpretation {
  const recall = classifyRecallIntent(text);
  let intentKind: IntentKind = "conversation";
  if (CORRECTION.test(text)) intentKind = "correction";
  else if (ACTION.test(text)) intentKind = "action";
  else if (recall.kind === "current_state") intentKind = "current_state";
  else if (recall.kind === "task_resume") intentKind = "task_resume";
  else if (recall.kind === "historical_recall") intentKind = "historical_recall";
  else if (/\?$|^(what|why|how|who|where|when|which|is|are|do|does|can|should)\b/i.test(text.trim())) intentKind = "question";

  const temporalFrame = PAST.test(text) && FUTURE.test(text) ? "mixed"
    : PAST.test(text) ? "past"
    : FUTURE.test(text) ? "future"
    : "present";
  return {
    intentKind,
    entities: [],
    projectIds: [],
    referents: /\b(this|that|it|the backend|the repo|that project)\b/i.test(text) ? [text.match(/\b(this|that|it|the backend|the repo|that project)\b/i)?.[0] ?? "referent"] : [],
    temporalFrame,
    needsCurrentState: ["current_state","task_resume","action","correction"].includes(intentKind),
    needsDeepMemory: ["historical_recall","task_resume"].includes(intentKind),
    needsExternalEvidence: false,
    ...(intentKind === "action" ? { requestedAction: text.trim() } : {}),
    source: "deterministic",
    confidence: 0.65,
  };
}

export async function interpretIntent(text: string, options: { jev?: JevOptions; conversationRecap?: string } = {}): Promise<IntentInterpretation> {
  const fallback = deterministicInterpretation(text);
  // The state carries only what the questions need. The deterministic guess
  // stays out of it so Jev is not anchored to the heuristic it replaces.
  const evaluation = await evaluatePredicates(
    { utterance: text, conversation_recap: options.conversationRecap ?? "" },
    familyQuestions("interpret"),
    options.jev,
    familyEgress("interpret"),
  );
  const systemOne = {
    model: evaluation.model,
    predicates: Object.fromEntries(Object.entries(evaluation.answers).map(([id, answer]) => [id, answer.probability])),
    latencyMs: evaluation.latencyMs,
    ...(evaluation.error ? { error: evaluation.error } : {}),
  };
  if (!evaluation.ok) return { ...fallback, systemOne };
  const ranked = (["correction","action","task_resume","current_state","historical_recall"] as const)
    .map((id) => ({ id, p: evaluation.answers[id]?.probability ?? 0 }))
    .sort((a,b) => b.p-a.p)[0];
  if (!ranked || ranked.p < predicateThreshold(ranked.id)) return fallback;
  const mapped: IntentKind = ranked.id;
  return {
    ...fallback,
    intentKind: mapped,
    needsCurrentState: (evaluation.answers.needs_current_state?.probability ?? 0) >= predicateThreshold("needs_current_state"),
    needsDeepMemory: (evaluation.answers.needs_deep_memory?.probability ?? 0) >= predicateThreshold("needs_deep_memory"),
    source: "jev",
    confidence: ranked.p,
    systemOne,
  };
}
