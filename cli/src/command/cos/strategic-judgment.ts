import type { OperationalQuestion } from "./operational-judgment.js";
import { protectedOperationalQuestion } from "./operational-judgment.js";

export type StrategicDecision =
  | { kind: "internal"; message: string; reason: string }
  | { kind: "hold"; reason: string }
  | { kind: "george"; reason: string };

const MAX_INPUT = 2500;
const NO_EXTERNAL = /\b(?:push|merge|deploy|publish|send|pay|purchase|buy|transfer|delete|erase|destroy|contact|password|credential|grant access|change permissions)\b/i;

/** Flyd's higher-reasoning executive review, not another task/agent framework. */
export function strategicPrompt(input: OperationalQuestion, reason: string): string {
  return [
    "You are Flyd deciding a difficult operational issue in private for the Chief of Staff.",
    "Your responsibility: use available evidence and pick a sound internal next action, or hold work when the evidence does not justify a choice.",
    "This is NOT a conversation with George. Do not announce actions, request a meeting, or narrate management.",
    "You may not authorize sending, purchases, publication, merging, pushing, deployments, deletion, security changes, or personal disclosures.",
    "If a choice affects those things or genuinely requires George's personal judgment, answer need_george, with an exact reason.",
    "If more research or diagnosis can resolve an internal issue, answer investigate.",
    "Only choose an option when it appears verbatim in the options list and is supported by the question's evidence. Never invent a third alternative.",
    "For another internal tactic answer investigate with a concise instruction, not a question.",
    "Return JSON only: {\"action\":\"choose|investigate|hold|need_george\",\"option\":\"exact provided option when choose\",\"instruction\":\"one concrete internal next step\",\"reason\":\"why\"}.",
    "Domain: " + input.domain,
    "Goal: " + input.goal.slice(0, MAX_INPUT),
    "Question: " + input.question.slice(0, MAX_INPUT),
    "Options: " + JSON.stringify(input.options.slice(0, 6)),
    ...(input.recommendation ? ["Recommendation: " + input.recommendation.slice(0, 240)] : []),
    "Evidence references: " + JSON.stringify(input.evidenceRefs.slice(0, 12)),
    "Why this needs Flyd: " + reason.slice(0, 300),
  ].join("\n");
}

export interface StrategicDeps {
  complete?: (prompt: string) => Promise<string>;
}

/** A parsed model suggestion is never permission to perform the suggested effect. */
export async function resolveStrategicQuestion(
  input: OperationalQuestion,
  reason: string,
  deps: StrategicDeps = {},
): Promise<StrategicDecision> {
  if (protectedOperationalQuestion(input)) {
    return { kind: "george", reason: "This choice involves effects outside the standing internal mandate." };
  }
  const complete = deps.complete ?? (async (prompt: string) =>
    (await import("../../lib/llm.js")).quickQuery(prompt, { json: true }));
  let candidate: Record<string, unknown>;
  try {
    candidate = JSON.parse(await complete(strategicPrompt(input, reason))) as Record<string, unknown>;
  } catch {
    return { kind: "hold", reason: "Flyd could not verify the technical choice; the evidence is retained for review." };
  }
  const why = typeof candidate.reason === "string" ? candidate.reason.slice(0, 300).trim() : "";
  if (candidate.action === "need_george") {
    // A model's requested escalation does not create user authority. For
    // internal-only questions we keep the issue instead of inventing an ask.
    return { kind: "hold", reason: why || "The choices need more evidence before an action is safe." };
  }
  if (candidate.action === "hold") return { kind: "hold", reason: why || "More evidence is needed." };
  if (candidate.action === "choose") {
    const option = typeof candidate.option === "string" ? candidate.option.trim() : "";
    if (!option || !input.options.includes(option) || NO_EXTERNAL.test(option)) {
      return { kind: "hold", reason: "The suggested option was not grounded or was outside internal authority." };
    }
    return {
      kind: "internal",
      message: "Flyd resolves this internal implementation choice: " + option.slice(0, 220)
        + ". Continue within the original objective, verify the outcome and do not request a routine decision from George."
        + " No outward or destructive effects are authorized.",
      reason: why || "A grounded internal choice exists.",
    };
  }
  if (candidate.action === "investigate") {
    const instruction = typeof candidate.instruction === "string" ? candidate.instruction.trim() : "";
    if (!instruction || NO_EXTERNAL.test(instruction)) {
      return { kind: "hold", reason: "No permitted, concrete next investigation was proposed." };
    }
    return {
      kind: "internal",
      message: "Flyd directs the next internal investigation: " + instruction.slice(0, 400)
        + ". Reconcile what already happened; choose a different justified method and verify it."
        + " No outward or destructive effects are authorized.",
      reason: why || "Investigation can resolve the ambiguity.",
    };
  }
  return { kind: "hold", reason: "The strategic decision was not a valid actionable disposition." };
}
