import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import { FLYD_DIR } from '../lib/config.js';
import type { AgentSituation } from './agent-session.js';
import { composeMorning } from './session-briefing.js';

// The daily brief is George's morning written to a file (and shown by /brief).
// It is not composed here: composeMorning (session-briefing.ts) is the one
// composer of the morning, so the brief carries exactly what every other
// morning surface does, today's news included.

export interface DailyBriefDeps {
  situation?: AgentSituation | null;
  now?: () => Date;
  /** Read Calendar and Reminders only if they are open (the background scheduler); /brief asks them directly. */
  background?: boolean;
}

export interface DailyBrief {
  heading: string;
  lines: string[];
}

export function dailyBriefFile(): string {
  return join(FLYD_DIR, 'overlay', 'daily-brief.md');
}

/** Compose the brief without marking anything seen: writing a file tells George nothing yet. */
export async function composeDailyBrief(deps: DailyBriefDeps = {}): Promise<DailyBrief> {
  const now = (deps.now ?? (() => new Date()))();
  const lines = await composeMorning({ now: () => now, peek: true, background: deps.background ?? false, situation: deps.situation ?? null });
  return { heading: `Daily brief — ${now.toLocaleString()}`, lines };
}

export function briefToMarkdown(brief: DailyBrief): string {
  return [`# ${brief.heading}`, "", ...(brief.lines.length ? brief.lines : ["Nothing pressing this morning."])].join("\n");
}

export function persistDailyBrief(brief: DailyBrief, file = dailyBriefFile()): string {
  const dir = resolvePath(file, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, briefToMarkdown(brief), { encoding: "utf-8", mode: 0o600 });
  return file;
}

export interface LatestBrief {
  body: string;
  writtenAt: number;
}

export function readLatestBrief(file = dailyBriefFile(), maxAgeMs = 12 * 60 * 60 * 1000): LatestBrief | null {
  if (!existsSync(file)) return null;
  try {
    const writtenAt = statSync(file).mtimeMs;
    if (Date.now() - writtenAt > maxAgeMs) return null;
    return { body: readFileSync(file, "utf-8"), writtenAt };
  } catch {
    return null;
  }
}
