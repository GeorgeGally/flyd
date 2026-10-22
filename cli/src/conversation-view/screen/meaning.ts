import type { ManifestationPlan, SemanticObject } from "../semantic.js";

/** The small typed set of things a turn can mean. Every meaning has one reviewed screen pattern. */
export const SCREEN_MEANINGS = [
  "answer",
  "decision",
  "status",
  "comparison",
  "result",
  "artefact",
  "briefing",
  "ask",
] as const;

export type ScreenMeaning = typeof SCREEN_MEANINGS[number];

export function isScreenMeaning(value: string): value is ScreenMeaning {
  return (SCREEN_MEANINGS as readonly string[]).includes(value);
}

/**
 * The meaning of a semantic object, read from the object itself. A shaped answer
 * declares its plan; a briefing is named by the runtime because no object field
 * distinguishes a daily brief from an ordinary answer.
 */
export function meaningOf(object: SemanticObject, plan?: ManifestationPlan, named?: ScreenMeaning): ScreenMeaning {
  if (named) return named;
  if (plan?.form === "comparison") return "comparison";
  if (plan?.form === "diagnosis") return "result";
  switch (object.kind) {
    case "decision": {
      if ((object.decision?.alternatives ?? []).length >= 2) return "decision";
      if (object.action?.requiresApproval) return "decision";
      return "ask";
    }
    case "action": return object.action?.requiresApproval ? "decision" : "status";
    case "artifact": return "artefact";
    case "investigation": return "result";
    case "monitor": return "status";
    case "conversation": return "answer";
    case "activity": {
      const phase = object.activity?.phase;
      if (phase === "needs_you") return "decision";
      if (phase === "finished" || phase === "ready") return "result";
      return "status";
    }
  }
}
