import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { localDay } from "./memory-store.js";

// A PA has the morning ready before George wakes. Early each day the Core
// tick gathers the briefing (calendar, what's due, today's news, what ran
// overnight, crew work) without marking any of it seen, and writes the
// opening Flyd will say. Opening the app then shows it at once instead of
// making him wait on a model, and the first "morning" in chat already knows
// it instead of looking everything up again.

export interface MorningNote {
  day: string;
  preparedAt: string;
  briefing: string[];
  greeting: string;
}

/** Earliest local hour to prepare; before the news edition exists it waits until this hour. */
export const PREPARE_FROM_HOUR = 5;
export const PREPARE_WITHOUT_NEWS_FROM_HOUR = 7;
/** A morning note is for the morning. */
export const MORNING_ENDS_HOUR = 12;

export function morningPath(): string {
  return process.env.FLYD_MORNING_PATH?.trim() || join(FLYD_DIR, "morning.json");
}

/** Today's prepared morning, while it is still morning; otherwise null. */
export function readMorning(now = new Date(), path = morningPath()): MorningNote | null {
  if (now.getHours() >= MORNING_ENDS_HOUR) return null;
  try {
    const note = JSON.parse(readFileSync(path, "utf8")) as MorningNote;
    return note.day === localDay(now) && note.greeting ? note : null;
  } catch {
    return null;
  }
}

export interface PrepareMorningDeps {
  now?: () => Date;
  /** Gathers the briefing without side effects. */
  briefing(now: Date): Promise<string[]>;
  /** Writes the opening from the briefing. */
  compose(briefing: string[], now: Date): Promise<string>;
  /** Whether today's news edition exists yet. */
  newsReady(now: Date): boolean;
  path?: string;
}

/** Prepare today's morning once; null when not due (too early, already done, or past morning). */
export async function prepareMorning(deps: PrepareMorningDeps): Promise<MorningNote | null> {
  const now = (deps.now ?? (() => new Date()))();
  const path = deps.path ?? morningPath();
  const hour = now.getHours();
  if (hour < PREPARE_FROM_HOUR || hour >= MORNING_ENDS_HOUR) return null;
  if (readMorning(now, path)) return null;
  if (hour < PREPARE_WITHOUT_NEWS_FROM_HOUR && !deps.newsReady(now)) return null;
  const briefing = await deps.briefing(now);
  const greeting = (await deps.compose(briefing, now)).trim();
  if (!greeting) return null;
  const note: MorningNote = { day: localDay(now), preparedAt: now.toISOString(), briefing, greeting };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(note, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
  return note;
}

/** For the chat prompt: what Flyd prepared this morning, so a greeting doesn't redo it. */
export function morningPromptBlock(now = new Date(), path = morningPath()): string {
  const note = readMorning(now, path);
  if (!note) return "";
  const at = new Date(note.preparedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return [
    `\n## What you prepared for him this morning (at ${at}, before he was up)`,
    note.greeting,
    "Facts behind it:",
    ...note.briefing.map((line) => `- ${line.trim()}`),
    "If he greets you or asks what's up and you haven't told him this yet in the conversation, this is your answer: no need to look it all up again. Don't repeat it once said.\n",
  ].join("\n");
}
