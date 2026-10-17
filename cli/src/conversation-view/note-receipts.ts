import type { Exchange } from "./types.js";

// Whether firstmate has read each note he sent, from firstmate's own durable
// record: `fm-inbox.sh drain --ack <id>` moves state/inbox/<id>.note into
// state/inbox/handled/, and that move is the one acknowledgement there is.
// A note still in the inbox is only sent. On 2026-10-12 thirteen notes sat
// unread for over an hour while nothing here said so; a note left unread past
// UNREAD_AFTER_MS now raises a warning in the window and one macOS notification.

/** How long a note may sit unread before Flyd warns him. */
export const UNREAD_AFTER_MS = 3 * 60_000;
/** How often the view checks the inbox records for notes left unread. */
export const UNREAD_CHECK_MS = 30_000;

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
    .filter((exchange) => exchange.question.receipt === "sent" && !readUnacknowledged(exchange))
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

/** The warning, in plain words: how many of his notes are still waiting, and how long the oldest has waited. */
export function unreadWarning(unread: UnreadNotes, now = Date.now()): string {
  const notes = unread.count === 1 ? "1 note" : `${unread.count} notes`;
  const age = waited(unread.oldest, now);
  return unread.count === 1
    ? `You have 1 note still waiting — sent ${age} ago.`
    : `${notes} you sent are still waiting; the oldest has waited ${age}.`;
}

/**
 * Checks the inbox records on a timer and sends one macOS notification when a
 * note crosses into unread, naming how many are unread. A note already told
 * about is not told again; one that is read and later found unread cannot
 * happen, since an acknowledgement is never undone.
 */
export class UnreadNoteWatcher {
  private readonly told = new Set<string>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly exchanges: () => Exchange[],
    private readonly notify: (title: string, message: string) => Promise<unknown>,
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

  /** Notifies when a note has newly crossed into unread; returns whether it did. */
  async check(): Promise<boolean> {
    let unread: UnreadNotes | null;
    try {
      unread = unreadNotes(this.exchanges(), this.now());
    } catch {
      return false;
    }
    if (!unread || unread.ids.every((id) => this.told.has(id))) return false;
    for (const id of unread.ids) this.told.add(id);
    await this.notify("Flyd", unreadWarning(unread, this.now())).catch(() => undefined);
    return true;
  }
}
