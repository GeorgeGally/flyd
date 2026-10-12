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
 * The notes firstmate has not acknowledged for longer than UNREAD_AFTER_MS.
 * A note firstmate has replied to is not counted: the reply names the note,
 * so it was read even if the acknowledgement never came.
 */
export function unreadNotes(exchanges: Exchange[], now = Date.now()): UnreadNotes | null {
  const late = exchanges
    .filter((exchange) => exchange.question.receipt === "sent" && !exchange.answer)
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

/** The warning, in plain words: how many notes firstmate has not read, and how long the oldest has waited. */
export function unreadWarning(unread: UnreadNotes, now = Date.now()): string {
  const notes = unread.count === 1 ? "1 note" : `${unread.count} notes`;
  const age = waited(unread.oldest, now);
  return unread.count === 1
    ? `Firstmate has not read ${notes} you sent ${age} ago.`
    : `Firstmate has not read ${notes} you sent; the oldest has waited ${age}.`;
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
    private readonly notify: (title: string, message: string) => Promise<void>,
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
