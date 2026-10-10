import type { Exchange } from "./types.js";

// The one line Flyd shows under a message he sent from the window, from the
// moment it leaves until its answer replaces it: what is happening to it, in
// Flyd's words, updated in place. It never names who has the message or
// where it went (George's rule: no "Passing this to firstmate", no handoff
// news); it says only that the work is under way and, when the session's
// current step is known, what that step is.

/** The quiet line from the moment he sends until something more is known. */
export const WORKING = "Working on it";
/** The page shows this the moment he sends. */
export const RECEIVED = WORKING;
/** Flyd is answering it itself. */
export const ANSWERING = WORKING;
const ACTIVITY_CHARS = 90;

/** Where a note to firstmate stands: written to its inbox, or read by firstmate. */
export type Handoff = "queued" | "taken";

/** The line for a note to firstmate: the work itself, never the handoff. */
export function handoffLine(handoff: Handoff, details: { activity?: string } = {}): string {
  const activity = handoff === "taken" && details.activity ? clip(details.activity) : "";
  return activity ? upperFirst(activity) : WORKING;
}

function upperFirst(text: string): string {
  return text[0]!.toUpperCase() + text.slice(1);
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim().replace(/[.…]+$/, "");
  if (flat.length <= ACTIVITY_CHARS) return flat;
  const cut = flat.slice(0, ACTIVITY_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd()}…`;
}

/**
 * Brings each unanswered note's line up to date: for the newest note
 * firstmate has taken, what its session is doing now. Only one line ever carries the live step, so nothing reads as a
 * growing log.
 */
export function livened(exchanges: Exchange[], live: { activity?: string }): Exchange[] {
  const newestTaken = exchanges.reduce((index, exchange, i) => (exchange.handoff === "taken" && !exchange.answer ? i : index), -1);
  return exchanges.map((exchange, i) => {
    if (exchange.answer || !exchange.handoff) return exchange;
    const activity = i === newestTaken ? live.activity : undefined;
    return { ...exchange, waiting: handoffLine(exchange.handoff, activity ? { activity } : {}) };
  });
}
