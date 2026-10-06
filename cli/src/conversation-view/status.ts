import { authorSummary, firstSentence } from "./summaries.js";
import type { ConversationSnapshot } from "./types.js";

// A glanceable status of the conversation for Flyd's notch island: is the
// assistant working, and what did its newest reply say (or ask)?

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
  const headline = (authorSummary(text)?.summary ?? firstSentence(text)).replace(/\s+/g, " ").trim();
  if (headline.length <= HEADLINE_CHARS) return headline;
  const cut = headline.slice(0, HEADLINE_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd()}…`;
}

export function statusOf(snapshot: ConversationSnapshot, now = Date.now()): ConversationStatus {
  const recent = snapshot.lastActivity ? now - Date.parse(snapshot.lastActivity) < WORKING_STALE_MS : false;
  const reply = [...snapshot.messages].reverse().find((message) => message.role === "assistant");
  return {
    working: snapshot.working && recent,
    ...(snapshot.lastActivity ? { lastActivity: snapshot.lastActivity } : {}),
    ...(reply ? { reply: { id: reply.id, headline: headlineOf(reply.text), asks: asksForDecision(reply.text) } } : {}),
  };
}
