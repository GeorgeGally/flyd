export type RecallIntentKind = "current_state" | "task_resume" | "historical_recall" | "general";

export interface RecallIntent {
  kind: RecallIntentKind;
  confidence: number;
  reasons: string[];
}

// Present-tense activity questions — "what am I working on", "what are you
// doing right now". Must be checked before TASK_RESUME_PATTERN since some
// phrasings ("what's active") could otherwise be ambiguous.
const CURRENT_STATE_PATTERN =
  /\b(what am i (currently )?(working on|doing|building)|what('?s| is) (i'?m|i am) (working on|doing|building)|what are (you|we) (currently )?(working on|doing)|what'?s (currently )?active\b|current(ly)? (working on|active project))/i;

const TASK_RESUME_PATTERN =
  /\b(where were we|what were we doing|continue (where|from)|pick up where|resume (work|the task|where)|last thing (i|we) (was|were) doing)\b/i;

const HISTORICAL_PATTERN =
  /\b(back in\b|used to\b|in (19|20)\d{2}\b|what was i (building|working on) in|first (discuss|talked? about)|when did (i|we) first)/i;

export function classifyRecallIntent(query: string): RecallIntent {
  const q = query.trim();

  if (CURRENT_STATE_PATTERN.test(q)) {
    return { kind: "current_state", confidence: 0.9, reasons: ["present-tense activity phrasing"] };
  }
  if (TASK_RESUME_PATTERN.test(q)) {
    return { kind: "task_resume", confidence: 0.85, reasons: ["resumption phrasing"] };
  }
  if (HISTORICAL_PATTERN.test(q)) {
    return { kind: "historical_recall", confidence: 0.7, reasons: ["explicit historical marker"] };
  }
  return { kind: "general", confidence: 0.5, reasons: ["no strong temporal signal"] };
}
