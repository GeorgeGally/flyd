import { authorSummary, firstSentence } from "./summaries.js";
import type { ConversationSnapshot } from "./types.js";

// A glanceable status of the conversation for Flyd's notch island: is the
// assistant working on something George said, and what did its newest reply
// worth his attention say (or ask)?
//
// Firstmate also replies to its own wakes and supervision ("Captain,
// shipshape.", "no news yet", "the worker has posted an update"). Those stay
// in the conversation but never reach the island: only a decision, a real
// outcome (a PR ready, something fixed, pushed or merged) or a real problem
// does. The outcome rule matches the one domain-run notifications use.

export interface ConversationStatus {
  working: boolean;
  lastActivity?: string;
  reply?: { id: string; headline: string; asks: boolean };
}

/** Working only counts while there was activity recently; a stalled turn is not "working". */
const WORKING_STALE_MS = 10 * 60 * 1000;
const HEADLINE_CHARS = 72;

/** The reply's closing words ask the captain something: a question, or a call for his decision. */
export function asksForDecision(text: string): boolean {
  const prose = text.replace(/```[\s\S]*?```/g, "").trim();
  const last = prose.split(/\n\s*\n/).filter((block) => block.trim()).pop() ?? "";
  const summary = authorSummary(text)?.summary ?? "";
  const asking = /\b(do you want|would you like|should i|shall i|want me to|which (one|option|do you)|your call|your decision|needs? your (decision|call|ok|approval)|ok to|okay to|approve)\b/i;
  return /\?/.test(last) || /\?/.test(summary) || asking.test(last) || asking.test(summary);
}

export function headlineOf(text: string): string {
  const headline = plain(authorSummary(text)?.summary ?? firstSentence(text));
  if (headline.length <= HEADLINE_CHARS) return headline;
  const cut = headline.slice(0, HEADLINE_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd()}…`;
}

/** One line, without firstmate's "Captain," salutation. */
function plain(text: string): string {
  const line = text.replace(/\s+/g, " ").trim().replace(/^captain[,:!.]?\s+/i, "");
  return line ? line[0]!.toUpperCase() + line.slice(1) : "";
}

/** Housekeeping that says nothing happened: "shipshape", "no news yet", "on it". */
const ROUTINE_OPENING = /^(shipshape|all (quiet|clear|good|calm)|no (news|updates?|progress)\b|nothing (new|to report|yet)|still (working|waiting|running|going)|on it\b|ack(nowledged)?\b|noted\b|got it\b|standing by|will (report|update|let you know|follow up))/i;
/** Supervision chatter about the workers rather than the work. */
const MACHINERY = /\b(posted an update|is moving again|acknowledged (my|the|your) decision|(a|the) (worker|crewmate|supervisor) (is|has|had|will|picked|started|took)\b|is now on\b|dispatched\b)/i;
/** Talk about firstmate's own crew and process rather than George's work. */
const WORKER_TALK = /\b(workers?|crewmates?|supervisors?|review step|checks?|brief|plan|pass|wakes?|monitoring|lanes?|panes?)\b/i;
const PULL_REQUEST = /https?:\/\/\S+\/pull\/\d+/i;
/** Something George would want to hear without asking: a result ready for him... */
const OUTCOME = /(\bready (for (your )?review|to merge)\b|\b(done|fixed|pushed|landed|committed|finished|completed|merged|shipped|deployed|released|updated|added|is live)\b|\bnow (shows|works)\b)/i;
/** ...or a real problem. */
const PROBLEM = /\b(failed|failing|broken|blocked|stuck|overloaded|crashed)\b/i;
/** A promise of an outcome is not one: "On it — will report once it's fixed". */
const FUTURE_CLAUSE = /(\b(will|once|when|until|after)\b|['’]ll\b)[^,.;:!?—–]*/gi;

function reportsOutcome(lead: string): boolean {
  const present = lead.replace(FUTURE_CLAUSE, "");
  return PULL_REQUEST.test(lead) || OUTCOME.test(present) || PROBLEM.test(present);
}

/**
 * Whether a reply belongs on the island. A reply to George's own words shows
 * unless it is routine; a reply firstmate makes on its own (to a wake or a
 * worker's status) shows only for a decision, an outcome or a problem — and
 * when it talks about its crew, only for a decision, a PR or a problem.
 */
export function worthAnnouncing(text: string, prompted: boolean): boolean {
  if (asksForDecision(text)) return true;
  const prose = text.replace(/```[\s\S]*?```/g, "").trim();
  const lead = plain([authorSummary(text)?.summary ?? "", prose.split(/\n\s*\n/)[0] ?? ""].join(" "));
  if (!lead) return false;
  const routine = ROUTINE_OPENING.test(lead);
  if (prompted && !routine) return !MACHINERY.test(lead) || reportsOutcome(lead);
  if (WORKER_TALK.test(lead)) return PULL_REQUEST.test(lead) || PROBLEM.test(lead.replace(FUTURE_CLAUSE, ""));
  return reportsOutcome(lead);
}

export function statusOf(snapshot: ConversationSnapshot, now = Date.now()): ConversationStatus {
  const recent = snapshot.lastActivity ? now - Date.parse(snapshot.lastActivity) < WORKING_STALE_MS : false;
  const messages = snapshot.messages;
  let reply: ConversationSnapshot["messages"][number] | undefined;
  for (let index = messages.length - 1; index >= 0 && !reply; index -= 1) {
    const message = messages[index]!;
    if (message.role === "assistant" && worthAnnouncing(message.text, messages[index - 1]?.role === "user")) reply = message;
  }
  // Working means the open turn answers George — his message is newest — not
  // firstmate handling its own wakes.
  const awaitingAnswer = messages[messages.length - 1]?.role === "user";
  return {
    working: snapshot.working && recent && awaitingAnswer,
    ...(snapshot.lastActivity ? { lastActivity: snapshot.lastActivity } : {}),
    ...(reply ? { reply: { id: reply.id, headline: headlineOf(reply.text), asks: asksForDecision(reply.text) } } : {}),
  };
}
