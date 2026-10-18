import type { Exchange } from "./types.js";

// Whether firstmate has read each note he sent, from firstmate's own durable
// record: `fm-inbox.sh drain --ack <id>` moves state/inbox/<id>.note into
// state/inbox/handled/, and that move is the one acknowledgement there is.
// A note still in the inbox is only sent. The window shows that per note; it
// says nothing to George about notes left waiting, which is Flyd's to chase,
// not his to hear.

/** How long a note may sit unread before the window marks it late. */
export const UNREAD_AFTER_MS = 3 * 60_000;

/**
 * Whether firstmate has plainly read a note it has not acknowledged yet. It acknowledges a note only once it is done
 * with it, so a note it answered (formally or in its own chat), settled, or is working on now (its turn names the
 * note, or a crewmate has it) was read, however long the work takes.
 */
export function readUnacknowledged(exchange: Exchange, workingOn: ReadonlySet<string> = new Set()): boolean {
  return !!exchange.answer || !!exchange.answered || !!exchange.settled || workingOn.has(exchange.question.id);
}

/** The note as read by firstmate. */
export function markRead(exchange: Exchange): Exchange {
  return exchange.question.receipt === "sent" ? { ...exchange, question: { ...exchange.question, receipt: "read" } } : exchange;
}
