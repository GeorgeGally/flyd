import { authorSummary, digestReply, isRoutine } from "./summaries.js";
import type { ConversationSnapshot } from "./types.js";

// A glanceable status of the conversation for Flyd's notch island: is the
// assistant working, what is it doing, and what did its newest reply say
// (or ask)? Routine replies (an acknowledgement, a status ping) never
// surface: the island keeps naming the last reply that mattered.

export interface ConversationStatus {
  working: boolean;
  /** What the assistant is doing now, while working. */
  activity?: string;
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
  const asking = /\b(do you want|would you like|should i|shall i|want me to|which (one|option|do you)|your call|your decision|needs? your (decision|call|ok|approval)|ok to|okay to|approve)\b|\bsay ["“]\w+/i;
  return /\?/.test(last) || /\?/.test(summary) || asking.test(last) || asking.test(summary);
}

const PR_LINK = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+\b/;
/** Firstmate's own states for work that went wrong or stopped for him. */
const FAILURE_STATE = /\b(?:failed|blocked|needs-decision)\b/i;

/**
 * Whether a reply firstmate gave to its own machinery (a supervision wake)
 * is for the captain: it names a pull request, asks for his decision, or
 * reports a failure. Anything else (a stale wake that needed nothing, an
 * outcome already reported) is supervision chatter. The window and the
 * island both see only what passes this.
 */
export function forCaptain(text: string): boolean {
  return PR_LINK.test(text) || asksForDecision(text) || FAILURE_STATE.test(text);
}

/**
 * A few words for the island. The reply's own » summary, else the labels of
 * its numbered points (so a three-part report names all three), else its lead
 * sentence without the salutation.
 */
export function headlineOf(text: string): string {
  const own = authorSummary(text)?.summary;
  const digest = own ? null : digestReply(text);
  const labels = digest?.points.map((point) => point.label).filter((label): label is string => Boolean(label)) ?? [];
  const headline = (own ?? (labels.length >= 2 && labels.length === digest!.points.length ? labels.join(" · ") : digest!.lead)).replace(/\s+/g, " ").trim();
  if (headline.length <= HEADLINE_CHARS) return headline;
  const cut = headline.slice(0, HEADLINE_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd()}…`;
}

export function statusOf(snapshot: ConversationSnapshot, now = Date.now()): ConversationStatus {
  const recent = snapshot.lastActivity ? now - Date.parse(snapshot.lastActivity) < WORKING_STALE_MS : false;
  const reply = [...snapshot.messages].reverse().find((message) => message.role === "assistant" && !isRoutine(message.text));
  const working = snapshot.working && recent;
  return {
    working,
    ...(working && snapshot.activity ? { activity: snapshot.activity } : {}),
    ...(snapshot.lastActivity ? { lastActivity: snapshot.lastActivity } : {}),
    ...(reply ? { reply: { id: reply.id, headline: headlineOf(reply.text), asks: asksForDecision(reply.text) } } : {}),
  };
}
