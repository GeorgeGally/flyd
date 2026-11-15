import { gateOutgoing, outgoingShortfalls, recordHeld, relayMayShow, screenOutgoing } from "../council/reply-review.js";
import type { Said } from "../council/standard.js";
import { plainSaid } from "../lib/backstage.js";
import type { GeorgeKind } from "../lib/reaches-george.js";
import { relayShortfalls, stripCommitIds, stripRetiredPhrases } from "../runtime/honesty-check.js";
import type { DomainRun } from "./types.js";

// What of a finished domain run is worth a notification. A domain boss's
// reply can carry its own machinery — acknowledgements, supervision status,
// "no news yet", which worker picked something up — and that belongs in the
// durable result, never on George's screen. Decisions and failures always
// reach him (a failure once Flyd has sent it back and is out of moves); a
// completion only when it reads as an outcome.

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

/** What a settled run's notice is to George (lib/reaches-george.ts): his call, a blocker the boss could not clear, or finished work. */
export function noticeKind(run: DomainRun): GeorgeKind {
  if (run.status === "needs_decision") return "decision";
  return run.status === "failed" ? "blocker" : "deliverable";
}

/** Whether Flyd has already sent this failed run back to its boss once (scheduler.ts). */
export function sentBack(run: DomainRun): boolean {
  return run.messages?.some((message) => message.from === "flyd" && message.kind === "correction" && message.deliveredAt) ?? false;
}

/**
 * A notice about to reach George, for the outgoing review (council/reply-review.ts
 * screenOutgoing): the backstage-name scan, the decision-routing check, and the
 * rest of the pre-send standard. His own words on the run are what he asked, so
 * a notice answering "how does Flyd work" may name the machinery.
 */
function outgoing(run: DomainRun, text: string): Said & { source: string } {
  return { surface: "notification", source: `domain:${run.id}`, text, ...(run.request?.originalMessage ? { asked: run.request.originalMessage } : {}) };
}

/** A reviewed run's notice as the outgoing review leaves it: its text, or none; `flydsCall` when it was held as an implementation call Flyd makes. */
export interface GatedNotice {
  text: string | null;
  flydsCall: boolean;
}

/**
 * The scheduler's notice for a reviewed run (scheduler.ts tellRun), as it may
 * reach George: the report's own words (`written`) and the line delivered from
 * them pass the same outgoing review a relay passes. A report that hands him
 * an implementation call is not sent: the call is Flyd's (tellRun hands it
 * back to the boss), unless the boss `insisted`, after that hand-back, that it
 * is his. One that only says something is happening is not sent either. One
 * that names machinery gives way to a line naming the work. What was held is
 * recorded in the self-review record.
 */
export function gateNotice(run: DomainRun, text: string, asks: boolean, written = text, insisted = false): GatedNotice {
  const holds = (screened: { shortfalls: Array<{ requirement: string }> }) =>
    screened.shortfalls.filter((shortfall) => !insisted || shortfall.requirement !== "decisions_handled");
  const flydsCall = (screened: { shortfalls: Array<{ requirement: string }> }): GatedNotice | null =>
    holds(screened).some((shortfall) => shortfall.requirement === "decisions_handled") ? { text: null, flydsCall: true }
      : holds(screened).some((shortfall) => shortfall.requirement === "real_status") ? { text: null, flydsCall: false } : null;
  const own = screenOutgoing(outgoing(run, written));
  const ownHeld = flydsCall(own);
  if (ownHeld) return ownHeld;
  const shown = written === text ? own : screenOutgoing(outgoing(run, text));
  if (!holds(shown).length) return { text, flydsCall: false };
  const shownHeld = flydsCall(shown);
  if (shownHeld) return shownHeld;
  const named = namedOutcome(run);
  const neutral = !named ? null : asks ? `I need your decision on ${named}.` : `There is news on ${named}. Ask Flyd for the details.`;
  return { text: neutral && relayMayShow(neutral) ? neutral : null, flydsCall: false };
}

/** The notification text for a run, or null when nothing George cares about happened, or when what it says may not reach him as written. */
export function captainNotice(run: DomainRun): string | null {
  if (!run.result) return null;
  // An unstructured handoff is not an outcome. The contract's reason code and
  // the re-request are Flyd's own process (runtime/acceptance.ts): he hears
  // that nothing counts as done, never the code or a process call, and the
  // line it would have been is recorded.
  if (run.incompleteReason?.startsWith("handoff:missing")) {
    const raw = `${run.incompleteReason} - nothing was reported as done. Rerun it with a brief, a report and evidence.`;
    return gateOutgoing(outgoing(run, raw), `${namedWork(run).replace(/[.!?]+$/, "") || "Some of your work"} came back without a clear report, so nothing counts as done yet.`);
  }
  const brief = stripCommitIds(plainBrief(run.result.brief));
  if (!brief) return null;
  if (run.status === "needs_decision") return decisionNotice(run, brief);
  if (run.status === "failed") return blockerLine(run);
  if (run.status !== "completed" || isRoutineChatter(brief)) return null;
  // The same outgoing-answer checks a chat reply passes: a placeholder or a
  // ruled-out phrase reaches George as nothing; a completion that names
  // backstage machinery or hands him an internal call gives way to a neutral
  // line naming the work; what was held is recorded so a reviewer can see it.
  const said = plainSaid(brief);
  const screened = screenOutgoing(outgoing(run, said));
  if (screened.send) return said;
  if (screened.shortfalls.some((shortfall) => shortfall.requirement === "real_status" || shortfall.requirement === "his_voice")) return null;
  const named = namedOutcome(run);
  return named ? `There is news on ${named}. Ask Flyd for the details.` : null;
}

/**
 * A decision that is his always reaches him: a phrase he ruled out is
 * stripped, and a brief that names machinery or is a placeholder gives way to
 * a line naming the work. An implementation call (which test approach, gate it
 * behind config, retry or drop) is not his: it is not relayed, and Flyd makes
 * it. What the checks caught is recorded so a reviewer can see it.
 */
function decisionNotice(run: DomainRun, brief: string): string | null {
  const lead = "I need your decision: ";
  const held = outgoingShortfalls(outgoing(run, brief));
  if (!held.length) return lead + brief;
  recordHeld(outgoing(run, lead + brief), held);
  if (held.some((shortfall) => shortfall.requirement === "decisions_handled")) return null;
  const kept = stripRetiredPhrases(brief);
  if (kept && relayMayShow(kept) && relayMayShow(lead + kept)) return lead + kept;
  const named = namedOutcome(run);
  return `I need your decision on ${named || "some of your work"}.`;
}

/** The work in a few words, or nothing when its own words would not pass the outgoing-answer checks. */
function namedWork(run: DomainRun): string {
  const outcome = clip(stripCommitIds(plainBrief(run.request?.intendedOutcome ?? "")));
  return outcome && !relayShortfalls(outcome).length ? outcome : "";
}

/**
 * A failure as George hears it, once Flyd is out of moves: what failed, what
 * Flyd tried, the one thing needed; never the error itself. A recommendation
 * that would not pass the outgoing-answer checks gives way to the plain ask,
 * and what was held is recorded.
 */
function blockerLine(run: DomainRun): string {
  const what = namedWork(run).replace(/[.!?]+$/, "") || "Some of your work";
  const tried = sentBack(run) ? "I sent it back once and it failed again" : "it couldn't be finished";
  const plain = `${what} is blocked: ${tried}. Tell me whether to try another way or drop it.`;
  const needed = stripCommitIds(plainBrief(run.result?.recommendation?.action ?? "")).replace(/[.!?]+$/, "");
  if (!needed) return plain;
  return gateOutgoing(outgoing(run, `${what} is blocked: ${tried}. ${needed}.`), plain) ?? plain;
}

function namedOutcome(run: DomainRun): string {
  return quotedWork(run.request.intendedOutcome);
}

/** The work in a few words, quoted, or "" when it cannot be named without backstage. */
export function quotedWork(text: string): string {
  const outcome = clip(stripCommitIds(plainBrief(text)));
  return outcome && !relayShortfalls(outcome).length ? `"${outcome}"` : "";
}

function clip(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
