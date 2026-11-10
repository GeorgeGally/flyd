import { existsSync, readFileSync } from "node:fs";
import { userProfilePath } from "../../lib/user-profile.js";
import { HIS_TASTE, NEVER, recordedLine, speaksForHim, standingAnswer, TAKE_CONTROL, WANTS_HIM } from "../../conversation-view/auto-answers.js";

// George's standing rules as an authority grant in the review step. When a
// staff question that would go to him is one his recorded words already
// settle, Flyd answers it for him through the note path his own answer takes,
// and he sees one quiet "handled" line he can take back. Each answer stands on
// a line he wrote in USER.md: delete the line and Flyd stops answering by it.
// Never settled here: anything
// destructive or irreversible, anything that costs money, touches security or
// access, goes public or speaks for him, a taste call, or anything the staff
// say needs his own word.

export const STANDING_RULES_POLICY = {
  id: "flyd.standing-rules.v1",
  capability: "firstmate.answer",
  provenance: "George's own recorded preferences (USER.md)",
  effect: "Answer a routine staff question the way his recorded words already settle it; grant no new scope and nothing destructive, costly, public or security-related.",
} as const;

/** How every answer Flyd gives for him opens, so the staff and Flyd's own record can tell it from his. */
export const STANDING_ANSWER_MARK = "George's answer, given by Flyd,";

/** His recorded preferences Flyd may answer by: his own profile, USER.md. */
export function standingPreferences(): string {
  const path = userProfilePath();
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  } catch {
    return "";
  }
}

/** Whether any of his recorded lines lets Flyd settle routine calls for him. */
export function hasStandingRules(preferences: string): boolean {
  return [...TAKE_CONTROL, ...MERGE_GREEN_FLYD].some((preference) => recordedLine(preferences, preference) !== null);
}

export interface StandingSettlement {
  rule: string;
  /** The answer, as it is given to the staff. */
  answer: string;
  /** His recorded words the answer stands on, one line. */
  because: string;
  /** The staff's question it settles. */
  question: string;
  /** The one quiet line he sees, in Flyd's words; absent when nothing is his to see (a call already put to him elsewhere). */
  line?: string;
  /** The note that carries the answer to the work's boss; absent when nothing needs saying. */
  note?: string;
}

export interface CallToSettle {
  taskId?: string;
  /** The work it is about, in a few words. */
  label: string;
  question: string;
  /** Everything the staff said about it. */
  sourceText: string;
  /** The option the staff recommend, when the interpretation grounded one. */
  recommendation?: string;
  /** The tasks whose calls are open for him right now. */
  openCalls?: readonly string[];
}

const MERGE_GREEN_FLYD = [/merge green flyd (?:prs|pull requests|changes) without asking/i];
const NO_EXTRA_DECISIONS = [/does not want to be given extra work or decisions/i, ...TAKE_CONTROL];
/** The staff want his own word ("awaiting George's go-ahead", "needs George's OK"). */
const HIS_WORD = /\b(?:george|captain)(?:'s|’s)?\s+(?:own\s+)?(?:ok|okay|go-?ahead|approval|yes|sign-?off|word|permission)\b/i;
/** The question points at the same calls already put to him under another task. */
const ASKED_ELSEWHERE = /\b(?:recorded|asked|listed|kept|open|pending)\s+(?:in|under|on)\s+([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b/i;
/** What the staff recommend: "recommended phase 0+1 first", "recommendation: B". */
const RECOMMENDED = /\brecommend(?:ed|s|ation)?(?:\s+is)?\s*:?\s+([^;.()\n]{2,80})/i;
/** "do not recommend X", "recommend against X": advice not to take it. */
const ADVISED_AGAINST = /(?:\bnot|\bnever|n['’]t)\s+(?:\w+\s+)?$/i;

/** The option the staff's own words recommend, never one they advise against. */
function recommendedIn(text: string): string | undefined {
  const found = RECOMMENDED.exec(text);
  if (!found || ADVISED_AGAINST.test(text.slice(0, found.index)) || /^against\b/i.test(found[1]!)) return undefined;
  return found[1];
}
/** A choice among options of the work's own (which phases, which order, which step). */
const PICKS = /\b(?:pick|choose|which|start|begin|order|phase|step|option|approach|go with)\b/i;
/** A recurring routine that has come due. */
const ROUTINE_DUE = /\b(?:recurring|weekly|daily|monthly|scheduled)\b[^.?]*\bdue\b/i;
/** The staff report work closed of its own accord: nothing is asked. */
const CLOSED = /\b(?:on purpose|not shipping|superseded|replaced by|replaces it|no longer needed|closed as)\b/i;
/** One plain ask to go on ("Want me to add tests?", "OK to rebase onto main?"). */
const YES_OR_NO = /^[^?]*\b(?:do you want|would you like|want me to|shall (?:i|we)|should (?:i|we)|ok(?:ay)? to|can (?:i|we)|may (?:i|we)|ready to)\b[^?]*\??$/i;
/** Alternatives, a pick among options, or stopping and clearing something away. */
const EITHER_OR = /\bor\b|\b(?:which|pick|choose|stop|done looking|clean ?up|tear ?down)\b/i;
const ASKS = /\?|\b(?:pick|choose|which|whether|approve|go-?ahead|decide|confirm|should|shall|want|ok(?:ay)? to)\b/i;

function note(question: string, answer: string, because: string): string {
  return [
    `${STANDING_ANSWER_MARK} to: ${question.replace(/\s+/g, " ").trim()}`,
    "",
    answer,
    "",
    `Flyd gives this answer for George by his standing rule: "${because}". Act on it as his word; he can take it back. Anything destructive, costly, public or touching security or access still comes back to him, restated in plain words with your recommendation.`,
  ].join("\n");
}

/**
 * How his standing rules settle a call the staff put to him, or null when it
 * stays his. Pure: the same call and the same recorded words settle the same way.
 */
export function settleCall(call: CallToSettle, preferences: string): StandingSettlement | null {
  const question = call.question.replace(/\s+/g, " ").trim();
  if (!question) return null;
  const said = `${question}\n${call.label}`;

  if (NEVER.test(said) || NEVER.test(call.sourceText) || HIS_TASTE.test(said) || WANTS_HIM.test(call.sourceText) || HIS_WORD.test(call.sourceText) || speaksForHim(question)) return null;

  // The same calls already open for him under another task: asking him twice is extra work, and nothing needs saying.
  const elsewhere = ASKED_ELSEWHERE.exec(question)?.[1]?.toLowerCase();
  if (elsewhere && elsewhere !== call.taskId?.toLowerCase() && call.openCalls?.some((task) => task.toLowerCase() === elsewhere)) {
    const because = firstLine(preferences, NO_EXTRA_DECISIONS);
    if (because) return { rule: "asked-elsewhere", answer: "Already with him under its own call.", because, question };
  }

  // A yes stands only on a plain yes-or-no ask to go on: never an either/or, a pick, or an ask to stop something.
  const yes = YES_OR_NO.test(question) && !EITHER_OR.test(question) ? standingAnswer(question, call.sourceText, preferences) : null;
  if (yes) return settled(yes.rule, `${yes.answer}.`, yes.because, question, `Said yes for you: ${question.replace(/[?.\s]+$/, "")}.`);

  // The staff recommend one of the work's own options and nothing in it is irreversible or costs money: take it.
  const recommended = (call.recommendation?.trim() || recommendedIn(question) || recommendedIn(call.sourceText) || "").replace(/[\s,;:]+$/, "").trim();
  if (recommended && PICKS.test(question) && !NEVER.test(recommended)) {
    const because = firstLine(preferences, TAKE_CONTROL);
    if (because) return settled("staff-recommendation", `Go with your recommendation: ${recommended}.`, because, question, `Went with the team's recommendation: ${recommended}.`);
  }

  if (ROUTINE_DUE.test(question) && !question.includes("?")) {
    const because = firstLine(preferences, TAKE_CONTROL);
    if (because) return settled("routine-due", "Run it as scheduled.", because, question, "Told the team to run it as scheduled.");
  }

  if (CLOSED.test(question) && !ASKS.test(question)) {
    const because = firstLine(preferences, TAKE_CONTROL);
    if (because) return settled("nothing-to-decide", "Nothing here needs him: close it as you reported.", because, question, "Nothing to decide here, so the team closes it as reported.");
  }
  return null;
}

function settled(rule: string, answer: string, because: string, question: string, line: string): StandingSettlement {
  return { rule, answer, because, question, line, note: note(question, answer, because) };
}

function firstLine(preferences: string, rules: RegExp[]): string | null {
  for (const rule of rules) {
    const line = recordedLine(preferences, rule);
    if (line) return line;
  }
  return null;
}
