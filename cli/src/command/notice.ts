import { recordHeld } from "../council/reply-review.js";
import { scrubBackstage } from "../lib/backstage.js";
import { relayShortfalls, stripRetiredPhrases } from "../runtime/honesty-check.js";
import { isPlaceholderStatus } from "../conversation-view/status-text.js";
import type { DomainRun } from "./types.js";

// What of a finished domain run is worth a notification. A domain boss's
// reply can carry its own machinery — acknowledgements, supervision status,
// "no news yet", which worker picked something up — and that belongs in the
// durable result, never on George's screen. Decisions and failures always
// reach him; a completion only when it reads as an outcome.

/** Housekeeping that says nothing finished: "shipshape", "no news yet", "on it". */
const ROUTINE_OPENING = /^(shipshape|all (quiet|clear|good|calm)|no (news|updates?|progress)\b|nothing (new|to report|yet)|still (working|waiting|running|on it|going)|on it\b|ack(nowledged)?\b|got it\b|standing by|will (report|update|let you know|follow up)|working on it|picked (it|this) up|queued\b)/i;
/** Bare acknowledgements that are routine only when they are the whole brief. */
const BARE_ACK = /^(no change|received|noted|understood)\b[\w\s,']{0,20}[.!]?$/i;
/** Supervision chatter about the workers rather than the work. */
const MACHINERY = /\b(posted an update|is moving again|acknowledged (my|the|your) decision|(a|the) (worker|crewmate|supervisor) (is|has|had|will|picked|started|took)\b|no-mistakes\b|dispatched\b|is now on\b)/i;
const PULL_REQUEST = /https?:\/\/\S+\/pull\/\d+/i;
/** Words that mean something actually landed: "Got it — fixed and pushed", "the worker added a test". */
const OUTCOME = /(\bready (for (your )?review|to merge)\b|\b(merged|shipped|landed|deployed|published|released|finished|completed|fixed|pushed|failed|blocked|updated|added|done)\b|\bnow (shows|works|does)\b)/i;

/** The brief as George would read it: one line, no "Captain," salutation. */
export function plainBrief(text: string): string {
  const line = text.replace(/\s+/g, " ").trim().replace(/^captain[,:!.]?\s+/i, "");
  return line ? line[0]!.toUpperCase() + line.slice(1) : "";
}

/** A promise of an outcome is not one: "On it — will report once it's fixed". */
const FUTURE_CLAUSE = /(\b(will|once|when|until)\b|['’]ll\b)[^,.;:!?—–]*/gi;

function reportsOutcome(brief: string): boolean {
  return OUTCOME.test(brief.replace(FUTURE_CLAUSE, ""));
}

export function isRoutineChatter(text: string): boolean {
  const brief = plainBrief(text);
  if (!brief) return true;
  if (PULL_REQUEST.test(brief)) return false;
  if (ROUTINE_OPENING.test(brief) || BARE_ACK.test(brief)) return !reportsOutcome(brief);
  return MACHINERY.test(brief) && !reportsOutcome(brief);
}

/** The notification text for a run, or null when nothing George cares about happened, or when what it says may not reach him as written. */
export function captainNotice(run: DomainRun): string | null {
  if (!run.result) return null;
  const brief = plainBrief(run.result.brief);
  if (!brief) return null;
  if (run.status === "needs_decision" || run.status === "failed") return decisionNotice(run, brief);
  if (run.status !== "completed" || isRoutineChatter(brief)) return null;
  const notice = scrubBackstage(brief);
  // The same outgoing-answer checks a chat reply passes: a completion that names
  // backstage machinery or is a placeholder reaches George as nothing, and what
  // was held is recorded so a reviewer can see it.
  const held = relayShortfalls(notice);
  if (!held.length) return notice;
  recordHeld({ surface: "notification", source: `domain:${run.id}`, text: notice }, held);
  return null;
}

/**
 * A decision or a failure is his and always reaches him: a phrase he ruled out
 * is stripped, and a placeholder brief gives way to a line naming the work.
 * What the checks caught is recorded so a reviewer can see it.
 */
function decisionNotice(run: DomainRun, brief: string): string {
  const lead = run.status === "needs_decision" ? "I need your decision: " : "Work hit a problem: ";
  const said = scrubBackstage(brief);
  const held = relayShortfalls(said);
  if (!held.length) return lead + said;
  recordHeld({ surface: "notification", source: `domain:${run.id}`, text: lead + said }, held);
  const kept = stripRetiredPhrases(said);
  if (kept && !isPlaceholderStatus(kept)) return lead + kept;
  const outcome = scrubBackstage(plainBrief(run.request.intendedOutcome));
  return run.status === "needs_decision" ? `I need your decision on "${outcome}".` : `Work on "${outcome}" hit a problem.`;
}
