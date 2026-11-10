import { statSync } from "node:fs";
import { basename, join } from "node:path";
import { assessConsequence } from "../consequence.js";

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
// | is about the project he is focused on         | now, fuller: the lead line with its link    |
// | is about another project while he is focused  | held until focus breaks, then batched       |
// | arrives while he has no particular focus      | now, as a lead line                         |
//
// Focus breaks when he switches project, goes quiet for about 20 minutes, or
// starts a chat turn. Held reports come out together as one notification line
// naming each; those that never found a break go into the morning brief.

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
  | { when: "now" }
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

const SECRET = String.raw`(?:login|log-in|password|passcode|api keys?|tokens?|credentials?|2fa(?: code)?|two[- ]factor(?: code)?|otp(?: code)?|one[- ]time (?:code|password)|verification code)`;
const NOT_A_THING = String.raw`\b(?!\s+(?:page|screen|form|button|flow|field|parser|handler|module|path|logic|code|component|endpoint|route|view))`;
/** Asks him for his own secret: "your password", "an API key from you", "log in to Stripe", "the 2FA code". */
const ASKS_CREDENTIAL = new RegExp([
  String.raw`\byour\s+(?:[\w.-]+\s+){0,2}${SECRET}${NOT_A_THING}`,
  String.raw`\b${SECRET}\s+from\s+you\b`,
  String.raw`(?:^|[.!?]\s+|\byou\s+(?:to\s+)?|\bplease\s+)(?:log|sign)\s?in\s+(?:to|into)\s+\w`,
  String.raw`\bthe\s+(?:2fa|two[- ]factor|one[- ]time|otp|verification)\s+code${NOT_A_THING}`,
].join("|"), "im");
const MONEY_OR_FINAL = /\b(pay|charge|refund|spend|buy|purchase|cancel|delete|deploy|publish|release|merge\s+(?:\w+\s+){0,3}(?:to|into)\s+(?:production|prod)|sign\s+(?:the|a|this)\s+contract)\b/i;
const FINAL_VERBS = new Set(["send", "publish", "purchase", "delete"]);

/** A call he is asked: "credential" or "irreversible" when its own words say so, which never wait. Pure. */
export function callKind(question: string): "credential" | "irreversible" | undefined {
  if (ASKS_CREDENTIAL.test(question)) return "credential";
  const consequence = assessConsequence(question);
  const final = consequence.class === "consequential" && consequence.verbs.some((verb) => FINAL_VERBS.has(verb));
  return final || MONEY_OR_FINAL.test(question) ? "irreversible" : undefined;
}

/** When a report arriving now is told. Pure. */
export function timing(report: Arrival, focus: Focus): Timing {
  if (report.kind === "irreversible" || report.kind === "credential" || report.blocking) return { when: "now" };
  if (focus.meetingEndsAt !== undefined) return { when: "held", until: "meeting" };
  if (focus.project === undefined || sameProject(report.project, focus.project)) return { when: "now" };
  return { when: "held", until: "break" };
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
/** A notification is one line of at most this many characters (council/standard.ts notificationLine). */
const BATCH_MAX = 140;
const NAME_MAX = 48;

function countWord(n: number): string {
  return COUNT[n] ?? String(n);
}

/** A held report named short, from the line it would have been told by (already screened for him). */
function nameOf(report: Held): string {
  const words = (report.line.split(/(?<=[.!?])\s/)[0] ?? "").replace(/^Done:\s*/, "").replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
  if (words.length <= NAME_MAX) return words;
  const cut = words.slice(0, NAME_MAX - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : cut.length)}…`;
}

function listed(names: string[], rest: number): string {
  if (rest > 0) return `${names.join(", ")} and ${countWord(rest).toLowerCase()} more`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
}

/** Held reports told together, as one notification line naming each that fits. Pure. */
export function batch(held: Held[]): string {
  if (held.length <= 1) return held[0]?.line ?? "";
  const what = held.every((report) => report.finished) ? "finished" : "came in";
  const on = held.find((report) => report.focus)?.focus;
  const lead = held.every((report) => report.until === "meeting")
    ? `${countWord(held.length)} things ${what} while you were in your meeting`
    : on ? `${countWord(held.length)} things ${what} while you were on ${basename(on)}` : `${countWord(held.length)} things ${what} while you were busy`;
  const names = held.map(nameOf);
  for (let shown = names.length; shown > 0; shown -= 1) {
    const line = `${lead}: ${listed(names.slice(0, shown), names.length - shown)}.`;
    if (line.length <= BATCH_MAX) return line;
  }
  return `${lead}.`;
}

/** The morning brief's lines for reports that never found a break. Pure. */
export function morningLines(held: Held[]): string[] {
  if (!held.length) return [];
  return [`Held for you (${held.length}):`, ...held.map((report) => `  • ${report.line.split("\n")[0]}`)];
}

// The live signals. Never in tests without a sandbox home, never anything PRESENT keeps.

const CALENDAR_CACHE_MS = 5 * 60_000;
let meeting: { readAt: number; endsAt?: number } | null = null;

/**
 * Seconds until the end of each timed event on now, from every calendar. Recurring meetings are not yet seen:
 * Calendar's AppleScript gives a series' first occurrence. Reading the calendar through the Mac adapter
 * (EventKit) is the follow-up.
 */
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
