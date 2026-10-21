import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Exchange } from "./types.js";

// Whether firstmate has read each note he sent, from firstmate's own durable
// record: `fm-inbox.sh drain --ack <id>` moves state/inbox/<id>.note into
// state/inbox/handled/, and that move is the one acknowledgement there is.
// A note still in the inbox is only sent. On 2026-10-12 thirteen notes sat
// unread for over an hour while nothing here said so. A note left unread past
// UNREAD_AFTER_MS is now Flyd's to chase: its own note to firstmate, another
// each grace, and one plain line to George only once the chase is two days
// unanswered, then no more (the same policy as the staff chase,
// command/fleet-monitor.ts). Unread notes are staff silence, which otherwise
// never reaches George (lib/reaches-george.ts).

/** How long a note may sit unread before Flyd chases it. */
export const UNREAD_AFTER_MS = 3 * 60_000;
/** How often the view checks the inbox records for notes left unread. */
export const UNREAD_CHECK_MS = 30_000;
// The page imports this module, so the staff chase's own figures
// (command/fleet-monitor.ts RENUDGE_MS and ESCALATE_MS) are kept here as
// values rather than imported with the monitor's runtime.
/** While notes stay unread, how long between Flyd's chases: the staff chase's own six hours. */
export const UNREAD_CHASE_MS = 6 * 60 * 60_000;
/** Notes unread this long, chased and still unread, are a blocker Flyd has run out of moves on: the staff chase's two days. */
export const UNREAD_GIVE_UP_MS = 48 * 60 * 60_000;

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
 * The notes firstmate has not read for longer than `after` (UNREAD_AFTER_MS
 * unless given): still in its inbox, and with nothing to show firstmate has
 * them (see readUnacknowledged). Notes in `skip` are left out.
 */
export function unreadNotes(exchanges: Exchange[], now = Date.now(), skip: ReadonlySet<string> = new Set(), after = UNREAD_AFTER_MS): UnreadNotes | null {
  const late = exchanges
    .filter((exchange) => exchange.question.receipt === "sent" && !exchange.question.flydAsked && !readUnacknowledged(exchange) && !skip.has(exchange.question.id))
    .map((exchange) => ({ id: exchange.question.id, at: Date.parse(exchange.question.timestamp ?? "") }))
    .filter((note) => Number.isFinite(note.at) && now - note.at > after)
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

/** The chase Flyd has run out of moves on, as George hears it: what is stuck, and the one thing he can do. */
export function unreadBlocker(unread: UnreadNotes, now = Date.now()): string {
  const notes = unread.count === 1 ? "A note you sent the staff" : `${unread.count} notes you sent the staff`;
  return `${notes} ${unread.count === 1 ? "has" : "have"} sat unread for ${waited(unread.oldest, now)} and nothing has taken ${unread.count === 1 ? "it" : "them"} up. Tell me whether to send again or drop ${unread.count === 1 ? "it" : "them"}.`;
}

/** Where the view keeps its unread-note chase, so a restart neither chases again early nor tells George twice. */
export function defaultUnreadChaseState(): string {
  return join(homedir(), ".flyd", "view", "unread-chase.json");
}

/**
 * Checks the inbox records on a timer and chases firstmate when a note
 * crosses into unread, and again each grace while notes stay unread. Each
 * chase is Flyd's own note under its own request id, so a repeat is a replay,
 * never a second note; one that does not go through is tried on the next
 * check. A note read and later found unread cannot happen, since an
 * acknowledgement is never undone. A note chased and still unread after two
 * days reaches George once, in plain words, and is chased no more.
 */
export class UnreadNoteWatcher {
  /** Each unread note, by id: when Flyd last chased it. */
  private readonly chased = new Map<string, number>();
  /** The unread note Flyd has run out of moves on and told George about. */
  private readonly told = new Set<string>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly exchanges: () => Exchange[],
    private readonly chase: (note: string, requestId: string) => Promise<unknown>,
    private readonly now: () => number = Date.now,
    private readonly notify?: (title: string, message: string, kind: "blocker") => Promise<unknown>,
    private readonly stateFile?: string,
  ) {
    if (!stateFile) return;
    try {
      const saved = JSON.parse(readFileSync(stateFile, "utf8")) as { chased?: Record<string, number>; told?: string[] };
      for (const [id, at] of Object.entries(saved.chased ?? {})) if (Number.isFinite(at)) this.chased.set(id, at);
      for (const id of saved.told ?? []) if (typeof id === "string") this.told.add(id);
    } catch {
      // No chase recorded yet.
    }
  }

  private save(): void {
    if (!this.stateFile) return;
    try {
      mkdirSync(dirname(this.stateFile), { recursive: true, mode: 0o700 });
      const temporary = `${this.stateFile}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify({ chased: Object.fromEntries(this.chased), told: [...this.told] })}\n`, { encoding: "utf8", mode: 0o600 });
      renameSync(temporary, this.stateFile);
    } catch {
      // Kept in memory; the next change tries again.
    }
  }

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

  /** Chases firstmate when a note is newly unread or its last chase has gone unanswered, and tells George once when the chase runs out of moves; returns whether it did anything. */
  async check(): Promise<boolean> {
    const now = this.now();
    let exchanges: Exchange[];
    let unread: UnreadNotes | null;
    try {
      exchanges = this.exchanges();
      unread = unreadNotes(exchanges, now);
    } catch {
      return false;
    }
    const before = this.chased.size + this.told.size;
    for (const id of this.chased.keys()) if (!unread?.ids.includes(id)) this.chased.delete(id);
    for (const id of this.told) if (!unread?.ids.includes(id)) this.told.delete(id);
    if (this.chased.size + this.told.size !== before) this.save();
    const pending = unreadNotes(exchanges, now, this.told);
    if (!pending) return false;
    // Chased, unanswered for a whole grace, and unread two days: Flyd is out of moves
    // on those notes, so George hears of them once and they are chased no more; the
    // rest are still chased. With nowhere to tell him, the chase goes on rather than
    // stopping in silence.
    const notDue = new Set([...this.told, ...pending.ids.filter((id) => {
      const nudgedAt = this.chased.get(id);
      return nudgedAt === undefined || now - nudgedAt < UNREAD_CHASE_MS;
    })]);
    const due = this.notify ? unreadNotes(exchanges, now, notDue, UNREAD_GIVE_UP_MS) : null;
    if (this.notify && due) {
      for (const id of due.ids) this.told.add(id);
      this.save();
      await this.notify("Flyd", unreadBlocker(due, now), "blocker").catch(() => undefined);
      return true;
    }
    if (pending.ids.every((id) => now - (this.chased.get(id) ?? Number.NEGATIVE_INFINITY) < UNREAD_CHASE_MS)) return false;
    const round = Math.floor(now / UNREAD_CHASE_MS);
    const requestId = `flyd-unread-${createHash("sha256").update(`${pending.ids.join(",")}\0${round}`).digest("hex").slice(0, 16)}`;
    const sent = await this.chase(chaseNote(pending, now), requestId).then(() => true, () => false);
    if (sent) {
      for (const id of pending.ids) this.chased.set(id, now);
      this.save();
    }
    return sent;
  }
}
