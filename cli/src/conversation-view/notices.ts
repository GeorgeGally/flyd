import { basename } from "node:path";

// Notices other tools would have popped up as macOS notifications (Claude
// Code's "needs your permission", "waiting for your input", a usage-limit
// warning) come to Flyd instead. One that needs him rings the island; an idle
// one sits quietly in the column. A repeated idle notice refreshes the one it
// repeats rather than adding another; every notice that needs him is a new ask
// and rings again. A session's newer notice replaces its older one: the
// session has moved on. Held in memory only; nothing is written.

export type NoticeKind = "attention" | "idle";

export interface Notice {
  /** Stable across idle repeats; new for each notice that needs him, so each rings. */
  id: string;
  kind: NoticeKind;
  /** Who sent it: "Claude Code". */
  source: string;
  title: string;
  message: string;
  /** The session it came from, when the sender said. */
  session?: string;
  /** The project's folder name, when the sender said where it was working. */
  project?: string;
  /** When it first came, and when it last repeated. ISO. */
  at: string;
  last: string;
  /** How many times it came. */
  count: number;
}

export interface NoticeInput {
  source?: unknown;
  title?: unknown;
  message?: unknown;
  session?: unknown;
  project?: unknown;
  kind?: unknown;
  /** Claude Code's Notification hook fields, taken as they come. */
  session_id?: unknown;
  cwd?: unknown;
  notification_type?: unknown;
  hook_event_name?: unknown;
}

export const MAX_NOTICES = 12;
/** An idle repeat within this long is the same notice. */
export const REPEAT_MS = 30 * 60_000;
/** Notices older than this are gone. */
export const NOTICE_TTL_MS = 12 * 3600_000;
/** The island only rings for a notice this fresh. */
export const RING_MS = 30 * 60_000;
const TEXT_CHARS = 240;

const ATTENTION_TYPES = new Set(["permission_prompt", "elicitation_dialog"]);
const ATTENTION_WORDS = /\b(?:permission|approv\w*|allow|limit|usage|quota|credits?|blocked|failed|error)\b/i;

function text(value: unknown, chars = TEXT_CHARS): string {
  if (typeof value !== "string") return "";
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > chars ? `${flat.slice(0, chars - 1).trimEnd()}…` : flat;
}

/**
 * A notice from what a sender posted: Flyd's own shape ({ source, title,
 * message, session, project, kind }) or Claude Code's Notification hook JSON
 * passed through whole. Null when there is nothing to say. Pure.
 */
export function noticeOf(input: NoticeInput, now = Date.now()): Omit<Notice, "id" | "count"> | null {
  const message = text(input.message);
  if (!message) return null;
  const type = text(input.notification_type, 40);
  const claude = Boolean(type || input.hook_event_name || input.session_id);
  const source = text(input.source, 40) || (claude ? "Claude Code" : "Notice");
  const title = text(input.title, 80) || source;
  const session = text(input.session, 120) || text(input.session_id, 120);
  const cwd = text(input.cwd, 400);
  const project = text(input.project, 80) || (cwd ? basename(cwd) : "");
  const asked = input.kind === "attention" || input.kind === "idle" ? input.kind : undefined;
  const kind: NoticeKind = asked ?? (ATTENTION_TYPES.has(type) || (type !== "idle_prompt" && ATTENTION_WORDS.test(`${title} ${message}`)) ? "attention" : "idle");
  const at = new Date(now).toISOString();
  return { kind, source, title, message, ...(session ? { session } : {}), ...(project ? { project } : {}), at, last: at };
}

/** The island's line for a notice: where, then what. Pure. */
export function noticeLine(notice: Pick<Notice, "project" | "message">): string {
  return notice.project ? `${notice.project}: ${notice.message}` : notice.message;
}

export class NoticeBoard {
  private notices: Notice[] = [];
  private serial = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Takes a notice in; returns it as held (a repeat returns the notice it repeats), or null when there was nothing to say. */
  add(input: NoticeInput): Notice | null {
    const now = this.now();
    const fresh = noticeOf(input, now);
    if (!fresh) return null;
    this.prune(now);
    const same = fresh.kind === "idle" && this.notices.find((notice) =>
      notice.kind === "idle" && notice.message === fresh.message && notice.source === fresh.source &&
      (notice.session ?? notice.project ?? "") === (fresh.session ?? fresh.project ?? "") &&
      now - Date.parse(notice.last) < REPEAT_MS);
    let held: Notice;
    if (same) {
      held = { ...same, last: fresh.last, count: same.count + 1 };
      this.notices = [...this.notices.filter((notice) => notice !== same), held];
    } else {
      held = { ...fresh, id: `notice:${now.toString(36)}-${(this.serial++).toString(36)}`, count: 1 };
      // The session moved on: what it said before no longer stands.
      const superseded = (notice: Notice) => fresh.session !== undefined && notice.session === fresh.session;
      this.notices = [...this.notices.filter((notice) => !superseded(notice)), held].slice(-MAX_NOTICES);
    }
    for (const listener of this.listeners) listener();
    return held;
  }

  /** Every notice still standing, oldest first. */
  list(): Notice[] {
    this.prune(this.now());
    return [...this.notices];
  }

  /** The newest notice that needs him, while it is fresh enough to ring for. */
  ringing(): Notice | undefined {
    const now = this.now();
    return this.list().reverse().find((notice) => notice.kind === "attention" && now - Date.parse(notice.at) < RING_MS);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private prune(now: number): void {
    this.notices = this.notices.filter((notice) => now - Date.parse(notice.last) < NOTICE_TTL_MS);
  }
}
