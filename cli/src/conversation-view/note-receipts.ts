import { createHash } from "node:crypto";
import type { Exchange } from "./types.js";

// Whether firstmate has read each note he sent, from firstmate's own durable
// record: `fm-inbox.sh drain --ack <id>` moves state/inbox/<id>.note into
// state/inbox/handled/, and that move is the one acknowledgement there is.
// A note still in the inbox is only sent. On 2026-10-12 thirteen notes sat
// unread for over an hour while nothing here said so. A note left unread past
// UNREAD_AFTER_MS is now Flyd's to chase: its own note to firstmate, and
// another while the notes stay unread. Unread notes are staff silence, which
// never reaches George (lib/reaches-george.ts).

/** How long a note may sit unread before Flyd chases it. */
export const UNREAD_AFTER_MS = 3 * 60_000;
/** How often the view checks the inbox records for notes left unread. */
export const UNREAD_CHECK_MS = 30_000;
/** While notes stay unread, how long between Flyd's chases. */
export const UNREAD_CHASE_MS = 15 * 60_000;

/** Notes firstmate has left unread past UNREAD_AFTER_MS: how many, and when the oldest was sent. */
export interface UnreadNotes {
  count: number;
  /** ISO time the oldest unread note was sent. */
  oldest: string;
  /** Their ids, oldest first. */
  ids: string[];
}

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

/**
 * The notes firstmate has not read for longer than UNREAD_AFTER_MS: still in
 * its inbox, and with nothing to show firstmate has them (see readUnacknowledged).
 */
export function unreadNotes(exchanges: Exchange[], now = Date.now()): UnreadNotes | null {
  const late = exchanges
    .filter((exchange) => exchange.question.receipt === "sent" && !exchange.question.flydAsked && !readUnacknowledged(exchange))
    .map((exchange) => ({ id: exchange.question.id, at: Date.parse(exchange.question.timestamp ?? "") }))
    .filter((note) => Number.isFinite(note.at) && now - note.at > UNREAD_AFTER_MS)
    .sort((a, b) => a.at - b.at);
  if (late.length === 0) return null;
  return { count: late.length, oldest: new Date(late[0]!.at).toISOString(), ids: late.map((note) => note.id) };
}

/** "4 min", "1 h 5 min", "2 days". */
export function waited(fromIso: string, now = Date.now()): string {
  const minutes = Math.max(1, Math.floor((now - Date.parse(fromIso)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

/** Flyd's chase, to firstmate: which of George's notes sit unread, and since when. */
export function chaseNote(unread: UnreadNotes, now = Date.now()): string {
  const notes = unread.count === 1 ? "1 of George's notes has" : `${unread.count} of George's notes have`;
  return [
    `FLYD CHECK-IN: ${notes} sat unread in your inbox for ${waited(unread.oldest, now)} (${unread.ids.join(", ")}).`,
    "Take them up now and answer each as usual.",
  ].join(" ");
}

/**
 * Checks the inbox records on a timer and chases firstmate when a note
 * crosses into unread, and again every UNREAD_CHASE_MS while notes stay
 * unread. Each chase is Flyd's own note under its own request id, so a repeat
 * is a replay, never a second note; one that does not go through is tried on
 * the next check. A note read and later found unread cannot happen, since an
 * acknowledgement is never undone.
 */
export class UnreadNoteWatcher {
  /** Each unread note, by id: when Flyd last chased it. */
  private readonly chased = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly exchanges: () => Exchange[],
    private readonly chase: (note: string, requestId: string) => Promise<unknown>,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.check(), UNREAD_CHECK_MS);
    this.timer.unref?.();
    void this.check();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Chases firstmate when a note is newly unread or its last chase has gone unanswered; returns whether it did. */
  async check(): Promise<boolean> {
    let unread: UnreadNotes | null;
    try {
      unread = unreadNotes(this.exchanges(), this.now());
    } catch {
      return false;
    }
    const now = this.now();
    for (const id of this.chased.keys()) if (!unread?.ids.includes(id)) this.chased.delete(id);
    if (!unread || unread.ids.every((id) => now - (this.chased.get(id) ?? Number.NEGATIVE_INFINITY) < UNREAD_CHASE_MS)) return false;
    const round = Math.floor(now / UNREAD_CHASE_MS);
    const requestId = `flyd-unread-${createHash("sha256").update(`${unread.ids.join(",")}\0${round}`).digest("hex").slice(0, 16)}`;
    const sent = await this.chase(chaseNote(unread, now), requestId).then(() => true, () => false);
    if (sent) for (const id of unread.ids) this.chased.set(id, now);
    return sent;
  }
}
