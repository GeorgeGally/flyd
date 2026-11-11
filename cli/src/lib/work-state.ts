import type { DomainResult, DomainRunStatus } from "../command/types.js";

// Where a piece of work stands, read from the staff's words once.
//
// Every surface that says where work stands (the rail, the reply cards, the
// status card, the state of play, Jobs) reads it through this one reader and
// shows it in its own words; none keeps a regex reader of its own. A domain
// run's state is read here whenever the run is written (command/store.ts), so
// the state stored with its result always follows its status and reply. The golden table in
// lib/__tests__/work-state-golden.ts is the one list of sentences every surface
// is checked against.

export const WORK_STATES = ["moving", "needs_you", "blocked", "ready", "landed", "handled"] as const;
/**
 * moving: under way. needs_you: asks George to decide, approve or answer. blocked: stopped and staying stopped.
 * ready: finished and waiting only for its last step (a merge, a look). landed: done.
 * handled: a question of his Flyd already answered under his standing rules; never read from words, only set by policy.
 */
export type WorkState = typeof WORK_STATES[number];

/** What words can say: every state but handled, which only Flyd's own policy sets. */
export type ReadState = Exclude<WorkState, "handled">;

/** The one definition of work that waits on George: a call of his, or finished work waiting for his look. */
export function needsGeorge(state: string | undefined): boolean {
  return state === "needs_you" || state === "ready";
}

/** Quoted words are someone else's ("like "Merged deployed.""), never the state of the work. */
export const QUOTED = /"[^"\n]*"|“[^”\n]*”/g;
/** "No checks failed", "isn't blocked", "none is waiting on you": the word without the news. */
const NEGATED = /\b(?:not|no|never|nothing|none|without|\w+n['’]t)(?:\s+[\w'’-]+){0,2}\s*$/i;

/** A sentence put to him as a question, by its mood: it ends asking, or opens with what asks. */
const QUESTION = /\?["”')\]]*$|^(?:so,?\s+|and\s+)?(?:shall|should|may|can|could|would|will|do|does|did|is|are|want) (?:i|we|you|it|they|firstmate|flyd)\b/i;
/** His word asked for: his call, his leave, his review, his choice. */
const ASKS = new RegExp([
  String.raw`\bwaiting (?:on|for) (?:you|your|george)\b`,
  String.raw`\bneeds? (?:you|your|george)\b`,
  String.raw`\byour (?:call|decision|word|ok|go-ahead|approval|answer)\b`,
  String.raw`\bfor your (?:review|ok|look)\b`,
  String.raw`\bover to you\b`,
  String.raw`\byou (?:need|have) to\b`,
  String.raw`\b(?:you|george) (?:to |must |should )?decide\b`,
  String.raw`\b(?:may|can|shall|should) (?:i|we)\b`,
  String.raw`\b(?:do|would) you (?:want|like|prefer)\b`,
  String.raw`\bwant me to\b`,
  String.raw`\bsay the word\b`,
  String.raw`\bwhich (?:one|option|do you)\b`,
  // "Approve the page" or "you decide" asks him; "I'll approve it" does not.
  String.raw`(?:^|[.!?:;]\s+|\b(?:you|please)\s+)(?:approve|decide)\b`,
].join("|"), "i");
/** 'Say "X" to keep it' asks, when it leads its clause: read before quoted words are set aside. */
const SAY_ASK = /(?:^|[:;.]\s+)say\s*["“']/i;
/** Words that only talk about states ("a row tagged done, under way or needs you") say none. */
const TALKS_ABOUT = /\b(?:tagged|labell?ed|marked(?: as)?|reads?|shows?)\s+(?:as\s+)?["“]?(?:done|under ?way|landed|needs you|moving|blocked|ready)\b/i;

/** Stopped, said as such: blocked, stuck, failed, can't get past it, gave up. */
const BLOCKED = /\b(?:blocked|stuck|failed|failing|gave up|(?:can(?:no|['’])t|couldn['’]t|could not|unable to) (?:reach|get|finish|proceed|continue|deploy|push|publish|log in|sign in|access|connect))\b/i;
/** A stop already put right, or worked around, is progress, not a blocker. */
const UNBLOCKING = /\b(?:no longer|unblocked|so i|instead|worked around|fixing|retrying|re-?running|repairing|rerun|re-?trying|patching|fix(?:ed)? (?:it|that|this)|now passing|passes now|green now)\b/i;

/** Finished, waiting only for its last step. */
const READY = /\b(?:ready (?:to (?:merge|land|ship|go live|deploy|publish|release)|for (?:review|merge|merging|landing|a look))|awaiting (?:a )?(?:merge|review)|waiting to (?:be )?merged?|green and waiting)\b/i;

/** Moving: under way, being worked, going through its checks, landing still to come. */
const MOVING = new RegExp([
  String.raw`\bunder ?way\b`,
  String.raw`\bin progress\b`,
  String.raw`\bstill (?:going|running|working|in (?:its |their )?(?:checks|review))\b`,
  String.raw`\bworking on\b`,
  String.raw`\bin flight\b`,
  String.raw`\bqueued\b`,
  String.raw`\bstart(?:ed|ing)\b`,
  String.raw`\b(?:deploying|building|fixing|bringing|updating|rebasing|retrying)\b`,
  String.raw`\bbeing (?:fixed|updated|built|reviewed|merged|deployed|worked on|rebased|tested|checked|retried|redone|rewritten|landed|shipped|prepared|written|made)\b`,
  String.raw`\b(?:will|['’]ll|going to)\s+(?:be\s+|get\s+)?(?:merged?|land(?:ed)?|ship(?:ped)?|deployed|released|live)\b`,
  String.raw`\bgoing through (?:its |their )?checks\b`,
  String.raw`\bmerges itself\b`,
  String.raw`\bin (?:its |their )?(?:checks|review)\b`,
  String.raw`\bfinal review\b`,
  // "Up next", "…the layout next.": queued work, still to move.
  String.raw`\bup next\b|\bnext[.!]?$`,
  String.raw`\b(?:checks?|tests?|ci) (?:are |is )?(?:still )?running\b`,
  String.raw`\b(?:is|are|now|still|i['’]m|we['’]re)\s+running (?:the |its )?(?:checks|tests)\b`,
].join("|"), "i");

/** Landed: merged, shipped, live, done. */
export const LANDED = /\b(?:merged|landed|shipped|released|deployed|pushed|(?:is|are) (?:now )?live|now live|went live|in main|on main|done|finished|complete(?:d)?|fixed|added|works now|now works|(?:is|are) gone|removed|replaced)\b/i;
/** Landing that has not happened: ahead, conditional, negated, or waiting. */
export const NOT_LANDED = /\b(?:ll|no|nothing|wrongly|marked|recorded|said|will|would|should|could|shall|going to|once|when|after|before|until|unless|if|ready to|waiting to|wait(?:ing)? for|to be|not|never|isn['’]?t|hasn['’]?t|wasn['’]?t|haven['’]?t|didn['’]?t|unmerged|yet|can|needs? to|about to|plan)\b/i;
/** What is still to be done: the future or a plan, which is no state of the work yet. */
const PLAN = /\b(?:will|['’]ll|going to|plan(?:s|ned)? to|next,? (?:i|we)|to be)\b/i;

/** Where a clause turns: punctuation, or a word that opens the next one ("…after the review passed"). */
const CLAUSE = /[;—–]|\b(?:but|once|when|after|before|until|unless|if|because|while)\b/gi;
/** A pull request or commit named by its link: a landing verb beside it is news, whatever surrounds it. */
const WORK_LINK = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull\/\d+|commit\/[0-9a-f]{7,})/i;
/** "Everything that has landed", "what landed earlier": a landing that names a subject, not news. */
const SUBJECT = /\b(?:(?:everything|anything|all (?:of )?the \w+)\s+that|what(?:ever)?)\s+(?:(?:has|have|had)\s+)?(?:been\s+)?$/i;
/** The verb that subject goes on to take ("…is already running"), before any colon. */
const LATER_VERB = /\b(?:is|are|was|were|has|have|had|needs?|needed|stays?|stayed|runs?|ran|keeps?|kept)\b/i;

/** Whether some match of `verb` says it happened, read in its own clause only. */
export function happened(sentence: string, verb: RegExp = LANDED): boolean {
  for (const match of sentence.matchAll(new RegExp(verb.source, "gi"))) {
    if (!WORK_LINK.test(sentence) && SUBJECT.test(sentence.slice(0, match.index)) && LATER_VERB.test(sentence.slice(match.index! + match[0].length).split(":")[0]!)) continue;
    let start = 0;
    let end = sentence.length;
    for (const turn of sentence.matchAll(CLAUSE)) {
      if (turn.index! <= match.index!) start = /\w/.test(turn[0]) ? turn.index! : turn.index! + 1;
      else if (turn.index! >= match.index! + match[0].length) { end = turn.index!; break; }
    }
    if (!NOT_LANDED.test(sentence.slice(start, end))) return true;
  }
  return false;
}

/** Whether some match of `pattern` in the sentence is said, not negated ("nothing is waiting on you"). */
function says(sentence: string, pattern: RegExp): boolean {
  for (const match of sentence.matchAll(new RegExp(pattern.source, "gi"))) {
    if (!NEGATED.test(sentence.slice(0, match.index))) return true;
  }
  return false;
}

/** A stop said of the work, not a word naming a thing ("the failing previews", "a failed upload") or one already put right. */
function stopped(sentence: string): boolean {
  if (UNBLOCKING.test(sentence)) return false;
  for (const match of sentence.matchAll(new RegExp(BLOCKED.source, "gi"))) {
    const before = sentence.slice(0, match.index);
    if (!NEGATED.test(before) && !/\b(?:the|a|an|its|their|our|any)\s+$/i.test(before)) return true;
  }
  return false;
}

/** The text's sentences, split where one ends and the next opens. */
export function workSentences(text: string): string[] {
  return text.split(/(?<=[.!?]["”')\]]*)\s+(?=[A-Z0-9"“])|\n+/).map((part) => part.trim()).filter(Boolean);
}

/** What one sentence says of the work, or "plan" for what is still only intended, or null for nothing. Pure. */
export function readSentence(sentence: string): ReadState | "plan" | null {
  const said = sentence.replace(QUOTED, "…").replace(/\*\*|__|`/g, "").trim();
  if (!said || TALKS_ABOUT.test(said)) return null;
  if (QUESTION.test(said) || says(said, ASKS) || SAY_ASK.test(sentence.trim())) return "needs_you";
  if (stopped(said)) return "blocked";
  if (says(said, READY)) return "ready";
  if (says(said, MOVING)) return "moving";
  if (happened(said)) return "landed";
  // A landing word held back ("hasn't merged yet", "not deployed") is work still moving; one in the future is a plan.
  if (LANDED.test(said) && !PLAN.test(said)) return "moving";
  if (PLAN.test(said)) return "plan";
  return null;
}

/** The strength of each reading: a passage says the strongest of its sentences. */
const ORDER: Array<ReadState | "plan"> = ["needs_you", "blocked", "ready", "moving", "landed", "plan"];

/** What a passage says of the work, with "plan" for intent only; null when it says nothing. Pure. */
export function readPassage(text: string): ReadState | "plan" | null {
  const readings = new Set(workSentences(text).map(readSentence));
  return ORDER.find((reading) => readings.has(reading)) ?? null;
}

/**
 * Where the work a passage reports stands: the strongest state any of its
 * sentences says (needs you, blocked, ready, moving, landed), or null when it
 * says none (only a plan, or no word about the work). The one reader. Pure.
 */
export function readWork(text: string): ReadState | null {
  const reading = readPassage(text);
  return reading === "plan" ? null : reading;
}

/**
 * A domain run's work state from its judged outcome, with the reply's own
 * words for what the outcome alone cannot say: finished work only waiting for
 * a merge is ready, open work that says it is stopped is blocked. Pure.
 */
export function workStateOfRun(status: DomainRunStatus, result?: Pick<DomainResult, "brief" | "detailedReport">): WorkState | undefined {
  const words = result ? readWork(result.brief || result.detailedReport.split(/\n+/)[0] || "") : null;
  switch (status) {
    case "needs_decision": return "needs_you";
    case "failed": return "blocked";
    case "cancelled": return "handled";
    case "completed": return words === "ready" ? "ready" : "landed";
    default: return words === "blocked" ? "blocked" : "moving";
  }
}

/**
 * The run with its work state read from its status and, unless its reply is
 * an older one its status has since moved past, the reply's words: applied on
 * every write of a run (command/store.ts). Pure.
 */
export function withWorkState<T extends { status: DomainRunStatus; result?: DomainResult }>(run: T, readWords = true): T {
  if (!run.result) return run;
  const workState = workStateOfRun(run.status, readWords ? run.result : undefined);
  return workState === run.result.workState ? run : { ...run, result: { ...run.result, ...(workState ? { workState } : {}) } };
}
