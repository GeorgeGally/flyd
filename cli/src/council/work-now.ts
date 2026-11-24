// What George is working on right now, as a few lines for the news curator, so
// it can notice what sits next to his work: his live projects, the last few
// days' commits, his recent Claude Code session titles and the Liesel boards
// he has open. Everything is read from what Flyd already keeps on this Mac;
// nothing is stored, and a reader that fails just leaves its line out.

import { liveProjects } from "./projects.js";

export interface WorkSignals {
  projects?: string[];
  commits?: string[];
  sessions?: string[];
  boards?: string[];
}

/** How far back commits and sessions count as "now". */
export const WORK_NOW_DAYS = 3;
const PER_LINE = 8;
const MAX_CHARS = 1_600;

function line(label: string, items: string[] | undefined): string | null {
  const kept = [...new Set((items ?? []).map((item) => item.replace(/\s+/g, " ").trim().slice(0, 120)).filter(Boolean))].slice(0, PER_LINE);
  return kept.length ? `${label}: ${kept.join("; ")}` : null;
}

/** The brief itself: one short line per signal, or null when there is nothing to say. Pure. */
export function workNowBrief(signals: WorkSignals): string | null {
  const lines = [
    line("Projects", signals.projects),
    line("Recent commits", signals.commits),
    line("Coding sessions", signals.sessions),
    line("Boards open", signals.boards),
  ].filter((entry): entry is string => Boolean(entry));
  return lines.length ? lines.join("\n").slice(0, MAX_CHARS) : null;
}

/** Reads each signal from Flyd's existing local readers. */
export async function readWorkSignals(now = new Date()): Promise<WorkSignals> {
  const since = now.getTime() - WORK_NOW_DAYS * 86_400_000;
  const signals: WorkSignals = {};
  try {
    signals.projects = liveProjects().map((project) => `${project.name}${project.now ? ` (${project.now})` : ""}`);
  } catch { /* no projects file */ }
  try {
    const { WeekReader } = await import("../conversation-view/week.js");
    const week = await new WeekReader({ now: () => now.getTime() }).current();
    signals.commits = (week?.days ?? []).flatMap((day) => day.work).filter((work) => work.at >= since)
      .sort((a, b) => b.at - a.at).map((work) => `${work.project}: ${work.title}`);
  } catch { /* no registry or git */ }
  try {
    const { recentSessionTitles } = await import("../conversation-view/claude-code-source.js");
    signals.sessions = recentSessionTitles(since, PER_LINE);
  } catch { /* no Claude Code home */ }
  try {
    const { openBoardNames } = await import("../conversation-view/liesel.js");
    signals.boards = openBoardNames();
  } catch { /* no Liesel state */ }
  return signals;
}
