import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { firstmateHome } from "../lib/firstmate-home.js";
import { knownProjectName } from "./project-tags.js";

// The Week tab: eight days, hour by hour, what work happened in which project.
// Nothing new is tracked for it. The projects are firstmate's registry
// (`data/projects.md`, each line naming the project's live copy), and the work
// is each live copy's own git history: every change committed, on any branch,
// counted in the local hour it was written (its author time). A day's story is
// derived from the same changes: the busiest project's most telling change
// leads, and one change from each of the next projects follows. Pure where it
// can be: the same changes and clock always give the same week. Never read
// under vitest unless a log runner is given.

/** One project the week can show: the name he uses and the folder of its live copy. */
export interface WeekProject {
  name: string;
  dir: string;
}

/** One change, as git keeps it. */
export interface WeekChange {
  project: string;
  hash: string;
  /** Author time, epoch milliseconds. */
  at: number;
  subject: string;
}

export interface WeekDay {
  /** Local date, YYYY-MM-DD. */
  day: string;
  /** Changes per project, 24 local hours each; only projects that changed that day. */
  hours: Record<string, number[]>;
  changes: number;
  /** The day's story: what led it, then a line for each of the next projects. Empty on a day with no changes. */
  head: string;
  lines: string[];
}

export interface WeekHistory {
  /** Oldest first, today last. */
  days: WeekDay[];
  /** The week's three busiest projects, in the order they take the week's colours (Flyd first when it is one). */
  lead: string[];
  read: string;
}

const DAYS = 8;
const REFRESH_MS = 10 * 60 * 1000;
const UNIT = "\x1f";

/** Firstmate's registry lines ("- slug [mode] - Name: … live copy ~/Documents/x …") as projects. */
export function registryProjects(registry: string, home: string = homedir()): WeekProject[] {
  const out: WeekProject[] = [];
  const seen = new Set<string>();
  for (const line of registry.split("\n")) {
    const entry = /^- (\S+)(?: \[[^\]]*\])? - ([^:;(]+?)(?: \([^)]*\))?\s*[:;]/.exec(line);
    const copy = /live copy (~?\/[^\s,;)]+)/.exec(line);
    if (!entry || !copy) continue;
    const slug = entry[1]!;
    const dir = copy[1]!.replace(/^~(?=\/)/, home).replace(/\/+$/, "");
    const name = knownProjectName([slug, dir.split("/").pop() ?? ""]) ?? entry[2]!.trim();
    if (seen.has(dir)) continue;
    seen.add(dir);
    out.push({ name, dir });
  }
  return out;
}

/** Local YYYY-MM-DD of a moment. */
export function localDay(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local midnight that starts the first of the eight days ending today. */
export function weekStart(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - (DAYS - 1)).getTime();
}

/** A change's subject in plain words: no conventional-commit type or scope, no PR number, a capital first. */
export function plainSubject(subject: string): string {
  const words = subject
    .replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/i, "")
    .replace(/\s*\(#\d+\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;:,]+$/, "");
  return words ? words[0]!.toUpperCase() + words.slice(1) : "";
}

const BACKSTAGE = /^(?:merge\b|revert\b|wip\b|chore|docs|test|ci|style|build)\b/i;
function weight(subject: string): number {
  if (/^feat/i.test(subject)) return 3;
  if (/^fix/i.test(subject)) return 2;
  return BACKSTAGE.test(subject) ? 0 : 1;
}

/** The change that best tells what a project did that day: a feature over a fix over the rest, then the latest. */
function telling(changes: WeekChange[]): string {
  const best = [...changes]
    .filter((change) => plainSubject(change.subject))
    .sort((a, b) => weight(b.subject) - weight(a.subject) || b.at - a.at)[0];
  return best ? firstClause(plainSubject(best.subject)) : "";
}

/** A subject told short: up to its first colon or semicolon, and at most about 80 characters, cut at a word. */
export function firstClause(text: string): string {
  const clause = text.split(/[:;] /)[0]!.trim();
  const said = clause.length >= 12 ? clause : text;
  if (said.length <= 80) return said;
  return said.slice(0, 80).replace(/\s+\S*$/, "").replace(/[,.;:\s]+$/, "") + "…";
}

/** The eight days from these changes. Pure. */
export function buildWeek(changes: WeekChange[], now: number): WeekHistory {
  const start = weekStart(now);
  const days: WeekDay[] = [];
  for (let i = 0; i < DAYS; i += 1) {
    const d = new Date(start);
    days.push({ day: localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, 12).getTime()), hours: {}, changes: 0, head: "", lines: [] });
  }
  const byDay = new Map<string, WeekChange[]>();
  const totals = new Map<string, number>();
  // The same change can sit on two branches (a rebase, a copy): it is counted once.
  const seen = new Set<string>();
  for (const change of changes) {
    if (change.at < start || change.at > now) continue;
    const key = `${change.project}${UNIT}${change.at}${UNIT}${change.subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const day = days.find((one) => one.day === localDay(change.at));
    if (!day) continue;
    (day.hours[change.project] ??= Array.from({ length: 24 }, () => 0))[new Date(change.at).getHours()]! += 1;
    day.changes += 1;
    totals.set(change.project, (totals.get(change.project) ?? 0) + 1);
    byDay.set(day.day, [...(byDay.get(day.day) ?? []), change]);
  }
  for (const day of days) {
    const list = byDay.get(day.day) ?? [];
    const projects = Object.keys(day.hours)
      .map((project) => ({ project, changes: list.filter((change) => change.project === project) }))
      .sort((a, b) => b.changes.length - a.changes.length || a.project.localeCompare(b.project));
    const [first, ...rest] = projects;
    if (!first) continue;
    day.head = telling(first.changes);
    day.lines = rest.slice(0, 3)
      .map(({ project, changes: those }) => { const said = telling(those); return said ? `${project}: ${said}${/[.!?…]$/.test(said) ? "" : "."}` : ""; })
      .filter(Boolean);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name).slice(0, 3);
  const lead = ranked.includes("Flyd") ? ["Flyd", ...ranked.filter((name) => name !== "Flyd")] : ranked;
  return { days, lead, read: new Date(now).toISOString() };
}

/** Reads one live copy's changes since a moment, every branch. */
export type WeekLogRunner = (dir: string, since: number) => Promise<string>;

const gitLog: WeekLogRunner = (dir, since) => new Promise((resolve) => {
  execFile("git", ["-C", dir, "log", "--all", "--no-merges", `--since=${new Date(since - 86_400_000).toISOString()}`, `--format=%H${UNIT}%at${UNIT}%s`], {
    encoding: "utf8", timeout: 8_000, maxBuffer: 8 * 1024 * 1024,
  }, (error, stdout) => resolve(error ? "" : stdout));
});

/** Parses `git log --format=%H<US>%at<US>%s` lines for one project. */
export function parseLog(project: string, output: string): WeekChange[] {
  const out: WeekChange[] = [];
  for (const line of output.split("\n")) {
    const [hash, seconds, ...subject] = line.split(UNIT);
    const at = Number(seconds) * 1000;
    if (!hash || !Number.isFinite(at) || at <= 0) continue;
    out.push({ project, hash, at, subject: subject.join(UNIT).trim() });
  }
  return out;
}

/** The week as the page asks for it, read at most every ten minutes. */
export class WeekReader {
  private cached: WeekHistory | null = null;
  private cachedAt = 0;
  private pending: Promise<WeekHistory | null> | null = null;

  constructor(private readonly options: { run?: WeekLogRunner; registry?: () => Promise<string>; now?: () => number } = {}) {}

  async current(): Promise<WeekHistory | null> {
    const now = (this.options.now ?? Date.now)();
    if (this.cached && now - this.cachedAt < REFRESH_MS) return this.cached;
    if (process.env.VITEST && !this.options.run) return null;
    this.pending ??= this.read(now).finally(() => { this.pending = null; });
    return this.pending;
  }

  private async read(now: number): Promise<WeekHistory | null> {
    const registry = await (this.options.registry ?? (() => readFile(join(firstmateHome(), "data", "projects.md"), "utf8")))().catch(() => "");
    const projects = registryProjects(registry);
    if (!projects.length) return null;
    const run = this.options.run ?? gitLog;
    const start = weekStart(now);
    const logs = await Promise.all(projects.map(async (project) => parseLog(project.name, await run(project.dir, start).catch(() => ""))));
    this.cached = buildWeek(logs.flat(), now);
    this.cachedAt = now;
    return this.cached;
  }
}
