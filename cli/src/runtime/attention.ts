import { statSync } from "node:fs";
import { basename, join } from "node:path";

// When to tell George, and how much (split plan, "When to tell George").
//
// Focus is the project he is on right now, read only from signals Flyd already
// has: his recent commits and the foreground repo in the work hypothesis, his
// last chat or window turn, and a meeting on his calendar. PRESENT is never
// widened. The rules below are pure, so every row of the timing table is
// unit-tested; `readSignals` is the one reader of the live signals.
//
// | The report…                                   | Delivered                                   |
// | irreversible, credential, or blocks him now   | now, whatever he is doing                   |
// | arrives while he is in a meeting              | held to the meeting's end                   |
// | is about the project he is focused on         | now, fuller: the lead plus its detail       |
// | is about another project while he is focused  | held until focus breaks, then batched       |
// | arrives while he has no particular focus      | now, as a lead line                         |
//
// Focus breaks when he switches project, goes quiet for about 20 minutes, or
// starts a chat turn. Held reports come out together as one delivery; those
// that never found a break go into the morning brief.

/** Quiet this long and he has no particular focus. */
export const QUIET_MS = 20 * 60_000;

export interface Activity {
  /** The project's name or folder. */
  project: string;
  at: number;
}

export interface FocusSignals {
  now: number;
  /** Where he has been working lately (commits, the foreground repo); the newest decides. */
  activity: Activity[];
  /** His last chat or window turn. */
  lastTurnAt?: number;
  /** When the meeting he is in now ends. */
  meetingEndsAt?: number;
}

export interface Focus {
  /** The project he is on now; none when he has been quiet for QUIET_MS. */
  project?: string;
  lastTurnAt?: number;
  meetingEndsAt?: number;
}

export type Timing =
  | { when: "now"; depth: "full" | "lead" }
  | { when: "held"; until: "break" | "meeting" };

export interface Arrival {
  project?: string;
  /** Irreversible and credential reports never wait; nor does one that blocks him now. */
  kind?: string;
  blocking?: boolean;
}

export interface Held {
  key: string;
  line: string;
  heldAt: number;
  until: "break" | "meeting";
  /** What he was on when it was held. */
  focus?: string;
  project?: string;
  /** Finished work, rather than a call or a blocker. */
  finished?: boolean;
}

/** A project by its name or its folder, compared loosely. Pure. */
export function projectKey(project: string | undefined): string {
  return basename((project ?? "").trim().replace(/\/+$/, "")).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function sameProject(a: string | undefined, b: string | undefined): boolean {
  const left = projectKey(a);
  return left !== "" && left === projectKey(b);
}

/** What he is on now, from the signals. Pure. */
export function readFocus(signals: FocusSignals): Focus {
  const recent = signals.activity
    .filter((activity) => activity.project.trim() && signals.now - activity.at < QUIET_MS)
    .sort((left, right) => right.at - left.at)[0];
  return {
    ...(recent ? { project: recent.project } : {}),
    ...(signals.lastTurnAt !== undefined ? { lastTurnAt: signals.lastTurnAt } : {}),
    ...(signals.meetingEndsAt !== undefined && signals.meetingEndsAt > signals.now ? { meetingEndsAt: signals.meetingEndsAt } : {}),
  };
}

/** When a report arriving now is told, and how much. Pure. */
export function timing(report: Arrival, focus: Focus): Timing {
  const onFocus = focus.project !== undefined && sameProject(report.project, focus.project);
  if (report.kind === "irreversible" || report.kind === "credential" || report.blocking) return { when: "now", depth: onFocus ? "full" : "lead" };
  if (focus.meetingEndsAt !== undefined) return { when: "held", until: "meeting" };
  if (focus.project === undefined) return { when: "now", depth: "lead" };
  return onFocus ? { when: "now", depth: "full" } : { when: "held", until: "break" };
}

/** Held reports whose wait is over: the meeting ended, or his focus broke since they were held. Pure. */
export function released<T extends Held>(held: T[], focus: Focus): T[] {
  return held.filter((report) => {
    if (focus.meetingEndsAt !== undefined) return false;
    if (report.until === "meeting") return true;
    return focus.project === undefined
      || (focus.lastTurnAt !== undefined && focus.lastTurnAt > report.heldAt)
      || !sameProject(report.focus, focus.project);
  });
}

const COUNT = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
/** Lines a batch shows; the rest are a count he can ask about (each is in Flyd's next-turn context). */
export const BATCH_LINES = 2;

/** Held reports told together, as one delivery: each its own line, never a stream. Pure. */
export function batch(held: Held[]): string {
  if (held.length <= 1) return held[0]?.line ?? "";
  const count = COUNT[held.length] ?? String(held.length);
  const what = held.every((report) => report.finished) ? "finished" : "came in";
  const on = held.find((report) => report.focus)?.focus;
  const lead = held.every((report) => report.until === "meeting")
    ? `${count} things ${what} while you were in your meeting.`
    : on ? `${count} things ${what} while you were on ${basename(on)}.` : `${count} things ${what} while you were busy.`;
  const shown = held.slice(0, BATCH_LINES).map((report) => report.line);
  const rest = held.length - shown.length;
  return [lead, ...shown, ...(rest > 0 ? [`And ${(COUNT[rest] ?? String(rest)).toLowerCase()} more; ask me for ${rest === 1 ? "it" : "them"}.`] : [])].join("\n");
}

/** The morning brief's lines for reports that never found a break. Pure. */
export function morningLines(held: Held[]): string[] {
  if (!held.length) return [];
  return [`Held for you (${held.length}):`, ...held.map((report) => `  • ${report.line.split("\n")[0]}`)];
}

// The live signals. Never in tests without a sandbox home, never anything PRESENT keeps.

const CALENDAR_CACHE_MS = 5 * 60_000;
let meeting: { readAt: number; endsAt?: number } | null = null;

/** Seconds until the end of each timed event on now, from every calendar. */
const MEETING_NOW = `
on run argv
  set nowDate to current date
  set out to ""
  tell application "Calendar"
    repeat with c in calendars
      try
        repeat with e in (every event of c whose start date ≤ nowDate and end date > nowDate and allday event is false)
          set out to out & (((end date of e) - nowDate) as integer) & linefeed
        end repeat
      end try
    end repeat
  end tell
  return out
end run`;

/** When the meeting he is in ends, or nothing. Read only when Calendar is open, at most every five minutes. */
async function meetingEndsAt(now: number): Promise<number | undefined> {
  if (meeting && now - meeting.readAt < CALENDAR_CACHE_MS) return meeting.endsAt;
  let endsAt: number | undefined;
  try {
    const { appRunning } = await import("./personal-tools.js");
    if (process.platform === "darwin" && await appRunning("Calendar")) {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const { stdout } = await promisify(execFile)("osascript", ["-e", MEETING_NOW], { timeout: 6_000 });
      const ends = stdout.split("\n").map((line) => Number(line.trim())).filter((seconds) => Number.isFinite(seconds) && seconds > 0);
      if (ends.length) endsAt = now + Math.max(...ends) * 1_000;
    }
  } catch {
    // Calendar access can be denied or slow: no meeting known.
  }
  meeting = { readAt: now, ...(endsAt !== undefined ? { endsAt } : {}) };
  return endsAt;
}

/** The focus signals as they stand now. Best effort: a signal that cannot be read is left out. */
export async function readSignals(now = Date.now()): Promise<FocusSignals> {
  // A test without a sandbox home reads nothing real: he has no particular focus.
  if (process.env.VITEST && !process.env.FLYD_DIR) return { now, activity: [] };
  const activity: Activity[] = [];
  try {
    const { readPresentModel } = await import("../work/work-hypothesis/store.js");
    const model = readPresentModel();
    for (const thread of [...(model?.primaryThreads ?? []), ...(model?.secondaryThreads ?? [])]) {
      if (thread.demoted) continue;
      const commit = thread.lastCommitAt ? Date.parse(thread.lastCommitAt) : NaN;
      if (Number.isFinite(commit)) activity.push({ project: thread.name || thread.root, at: commit });
      const seen = Date.parse(thread.observedAt ?? model?.revisedAt ?? "");
      if (thread.isForeground && Number.isFinite(seen)) activity.push({ project: thread.name || thread.root, at: seen });
    }
  } catch {
    // No work hypothesis yet.
  }
  let lastTurnAt: number | undefined;
  try {
    const { FLYD_DIR } = await import("../lib/config.js");
    lastTurnAt = statSync(join(FLYD_DIR, "turn-receipts", "latest.json")).mtimeMs;
  } catch {
    // No turn yet.
  }
  const ends = process.env.VITEST ? undefined : await meetingEndsAt(now);
  return { now, activity, ...(lastTurnAt !== undefined ? { lastTurnAt } : {}), ...(ends !== undefined ? { meetingEndsAt: ends } : {}) };
}
