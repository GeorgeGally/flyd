import type {
  ConsequenceAssessment,
  ConsequenceTarget,
  ConsequentialVerb,
} from "./verification-types.js";

/**
 * Heuristic consequence assessment — the fallback when the router
 * classifier is unavailable. Design rule: verb + target, never verb alone.
 * "delete the last sentence" is a benign text edit; "delete the branch"
 * acts on an external object and is consequential.
 */

const VERB_PATTERNS: Array<{ verb: ConsequentialVerb; pattern: RegExp }> = [
  { verb: "send", pattern: /\b(send|submit|post|tweet|email|forward|share)\b/i },
  { verb: "publish", pattern: /\b(publish|deploy|release|ship|launch|merge|push)\b/i },
  { verb: "purchase", pattern: /\b(purchase|buy|order|pay|subscribe|checkout|book)\b/i },
  { verb: "delete", pattern: /\b(delete|remove|drop|cancel|unsubscribe|revoke|uninstall)\b/i },
  { verb: "create", pattern: /\b(create|make|set up|register|sign up|open an account)\b/i },
  { verb: "modify", pattern: /\b(update|rename|move|transfer|reschedule|reassign)\b/i },
];

// Objects that live outside the focused text field — acting on these has
// effects beyond the current element.
const EXTERNAL_OBJECTS =
  /\b(email|mail|message|dm|post|tweet|thread|order|payment|invoice|subscription|account|branch|repo|repository|pr|pull request|deployment|database|table|record|server|website|page|calendar|event|meeting|ticket|issue|card|listing|campaign)\b/i;

const FILE_OBJECTS = /\b(file|files|folder|directory|document|documents|spreadsheet|photo|image|backup)\b/i;

// Objects that are just text in the focused element — editing them is what
// flyd is for; never gate these.
const TEXTUAL_OBJECTS =
  /\b(sentence|sentences|paragraph|paragraphs|word|words|line|lines|text|wording|phrase|phrasing|typo|typos|draft|reply|comma|spelling|grammar)\b/i;

// "send it" / "publish this" — irreversible verb aimed at a pronoun whose
// referent we cannot see. Treat as consequential; the cost of a wrong guess
// is asymmetric.
const PRONOUN_ACTION =
  /\b(send|submit|publish|post|deploy|ship|release|merge|push|buy|order|pay|delete|cancel)\s+(it|this|that|them|everything)\b/i;

export function assessConsequence(intent: string): ConsequenceAssessment {
  const text = intent.trim();

  const verbs = VERB_PATTERNS.filter((v) => v.pattern.test(text)).map((v) => v.verb);
  if (verbs.length === 0) {
    return benign("No consequential verb detected");
  }

  const hasTextualObject = TEXTUAL_OBJECTS.test(text);
  const hasExternalObject = EXTERNAL_OBJECTS.test(text);
  const hasFileObject = FILE_OBJECTS.test(text);

  if (PRONOUN_ACTION.test(text) && !hasTextualObject) {
    return consequential(verbs, "unknown", "Irreversible verb aimed at an unresolvable referent");
  }

  if (hasExternalObject) {
    return consequential(verbs, "external_system", "Consequential verb targeting an external object");
  }
  if (hasFileObject) {
    return consequential(verbs, "file_system", "Consequential verb targeting the file system");
  }
  if (hasTextualObject) {
    return benign("Verb targets text in the focused element");
  }

  return benign("Consequential verb without an external target");
}

function benign(reason: string): ConsequenceAssessment {
  return { class: "benign", verbs: [], target: "text_in_focus", reason, source: "heuristic" };
}

function consequential(
  verbs: ConsequentialVerb[],
  target: ConsequenceTarget,
  reason: string
): ConsequenceAssessment {
  return { class: "consequential", verbs, target, reason, source: "heuristic" };
}
