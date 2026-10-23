import { displayName, hasDisplayAlias } from "./candidates.js";
import { listOpenConfirmedTodos, splitTodos } from "./confirmed-todos.js";
import {
  dueStatus,
  formatDueNote,
  formatDueSpoken,
  isPassed,
  todayLine,
} from "./due-dates.js";
import type { PresentInsights, WorkThread } from "./types.js";

export type { PresentInsights };

const STALL_DAYS = 7;
const MOVE_DAYS = 3;
// Undated tasks need a recent human confirmation before they can steer a brief.
const UNDATED_TODO_FRESH_DAYS = 21;
// A brief names at most this many live to-dos as workstreams.
const LIVE_TODO_LIMIT = 8;
// And at most this many passed ones, so history never crowds out the day.
const PAST_TODO_SPOKEN_LIMIT = 3;

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function displayNameForStream(name: string): string {
  return displayName(name);
}

function daysAgo(iso: string | undefined, now: Date): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - t) / (1000 * 60 * 60 * 24);
}

interface TodoRow {
  description: string;
  dueAt?: string;
  updatedAt?: string;
}

/**
 * Open to-dos split the way a brief reads them: live items (undated, due today
 * or ahead) that may steer the day, and passed items that are history. A passed
 * item is still open and still recorded — it just never leads.
 */
function openTodos(now: Date): { live: TodoRow[]; passed: Array<TodoRow & { dueAt: string }> } {
  const { live, passed } = splitTodos(listOpenConfirmedTodos(now), now);
  const row = (t: { description: string; dueAt?: string; updatedAt?: string }): TodoRow => ({
    description: t.description,
    dueAt: t.dueAt || undefined,
    updatedAt: t.updatedAt || undefined,
  });
  return {
    live: live.map(row).filter((r) => r.description).slice(0, LIVE_TODO_LIMIT),
    passed: passed
      .map(row)
      .filter((r): r is TodoRow & { dueAt: string } => Boolean(r.description && r.dueAt)),
  };
}

function isCurrentTodo(row: TodoRow, now: Date): boolean {
  if (row.dueAt) return !isPassed(row.dueAt, now);
  return daysAgo(row.updatedAt, now) <= UNDATED_TODO_FRESH_DAYS;
}

/** One spoken line for a live dated commitment. */
function formatCommitmentLine(name: string, dueAt: string, now: Date): string {
  const status = dueStatus(dueAt, now);
  if (status?.state === "today") return `${name} is due today.`;
  return `${name} is due ${formatDueSpoken(dueAt, now)}.`;
}

/** Concrete commit subject — not just a project name restatement. */
export function isConcreteMove(name: string, subject: string | undefined): boolean {
  if (!subject?.trim()) return false;
  const s = subject.trim();
  const n = name.trim().toLowerCase();
  if (s.toLowerCase() === n) return false;
  if (s.length < 8) return false;
  // Suppress generic restatements like "CleanX work" / "update CleanX"
  if (new RegExp(`^(?:update|wip|misc|chore)\\s+${n}$`, "i").test(s)) return false;
  return true;
}

export function derivePresentInsights(
  primary: WorkThread[],
  secondary: WorkThread[],
  options: {
    preferCoreHome?: boolean;
    now?: Date;
    extraWorkstreams?: string[];
    finishedProjects?: string[];
  } = {},
): PresentInsights {
  const now = options.now ?? new Date();
  const preferCoreHome = Boolean(options.preferCoreHome);
  const all = [...primary, ...secondary];
  const { live: todoRows, passed: passedRows } = openTodos(now);

  const fromRepos = all
    .filter((t) => !t.demoted && !/flyd/i.test(t.name))
    .map((t) => t.name);

  const fromMemory = [
    ...(options.extraWorkstreams ?? []),
    ...todoRows
      .filter((row) => isCurrentTodo(row, now))
      .map((row) => row.description)
      .filter((d) => hasDisplayAlias(d))
      .map((d) => displayNameForStream(d)),
  ];

  const workstreams = uniqueNames([...fromRepos, ...fromMemory]).filter((n) => !/flyd/i.test(n));

  const latestMoves = all
    .filter((t) => isConcreteMove(t.name, t.latestSubject))
    .filter((t) => daysAgo(t.lastCommitAt, now) <= MOVE_DAYS)
    .sort((a, b) => daysAgo(a.lastCommitAt, now) - daysAgo(b.lastCommitAt, now))
    .slice(0, 3)
    .map((t) => ({
      name: t.name,
      subject: t.latestSubject!.trim(),
      at: t.lastCommitAt,
    }));

  const tensions: string[] = [];
  if (preferCoreHome && workstreams.length >= 3) {
    tensions.push(
      `Attention split across ${workstreams.length} workstreams while Flyd is meant to drive the view.`,
    );
  }
  const dirtyStale = all.filter(
    (t) => t.isDirty && !t.demoted && daysAgo(t.lastCommitAt, now) > STALL_DAYS,
  );
  if (dirtyStale.length) {
    tensions.push(
      `Uncommitted work sitting on ${dirtyStale.map((t) => t.name).join(", ")} without recent commits.`,
    );
  }

  const stalledThreads = all
    .filter((t) => !t.demoted)
    .filter((t) => t.hasTasks || t.isDirty)
    .filter((t) => daysAgo(t.lastCommitAt, now) > STALL_DAYS)
    .map((t) => t.name)
    .filter((name, i, arr) => arr.indexOf(name) === i)
    .slice(0, 4);

  const finishedFromDemotions = all
    .filter((t) => t.demoted && !/flyd/i.test(t.name))
    .map((t) => t.name);
  const finishedProjects = uniqueNames([
    ...(options.finishedProjects ?? []),
    ...finishedFromDemotions,
  ]).filter((n) => !workstreams.some((w) => w.toLowerCase() === n.toLowerCase()));

  // A passed date never leads: the window it belonged to has closed, so the
  // earliest open item that is still live is the one worth naming.
  const nextRow = todoRows.find((r) => isCurrentTodo(r, now));
  const nextTodo = nextRow ? displayNameForStream(nextRow.description) : undefined;
  let nextLeverage: string | undefined;
  if (nextTodo && nextRow?.dueAt) {
    nextLeverage = `Next confirmed to-do: ${nextTodo} (${formatDueNote(nextRow.dueAt, now)}).`;
  } else if (nextTodo) {
    nextLeverage = `Next confirmed to-do: ${nextTodo}.`;
  } else if (stalledThreads.length) {
    nextLeverage = `Re-enter stalled thread: ${stalledThreads[0]}.`;
  } else if (latestMoves[0]) {
    nextLeverage = `Continue ${latestMoves[0].name}: ${latestMoves[0].subject}.`;
  } else if (workstreams[0]) {
    nextLeverage = `Re-enter ${workstreams[0]}.`;
  }

  const pastTodos = passedRows.map((r) => ({
    name: displayNameForStream(r.description),
    dueAt: r.dueAt,
  }));

  return {
    epistemicClass: "inference",
    workstreams,
    latestMoves,
    tensions,
    stalledThreads,
    finishedProjects,
    nextTodo,
    nextLeverage,
    nextDueAt: nextRow?.dueAt,
    pastTodos,
  };
}

function spokenName(name: string | undefined): string {
  return (name ?? "").replace(/\s*\([^)]+\)\s*$/, "").trim();
}

function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * Passed obligations, spoken last and marked as past. They are still open, so
 * George hears that they linger — but after the live work, never as today's.
 */
function formatPastTodosLine(pastTodos: PresentInsights["pastTodos"], now: Date): string | undefined {
  const items = (pastTodos ?? []).filter((p) => p.name && p.dueAt);
  if (!items.length) return undefined;
  const named = items
    .slice(0, PAST_TODO_SPOKEN_LIMIT)
    .map((p) => `${spokenName(p.name)} (${formatDueNote(p.dueAt, now)})`);
  const more = items.length - named.length;
  const tail = more > 0 ? `, and ${more} more` : "";
  return `Past and still open: ${joinNames(named)}${tail}.`;
}

/** Spoken morning brief — the day, then risk, then what's stuck, then forward deadline, then what has passed. No recaps. */
export function formatPresentModelText(
  insights: PresentInsights,
  _options: { preferCoreHome?: boolean; demotedNames?: string[]; now?: Date } = {},
): string {
  const now = _options.now ?? new Date();
  const parts: string[] = [];

  for (const tension of insights.tensions) {
    parts.push(tension);
  }

  const today = spokenName(insights.nextTodo);
  const stalled = uniqueNames(insights.stalledThreads.map((n) => spokenName(n))).filter(
    (n) => !today || n.toLowerCase() !== today.toLowerCase(),
  );
  if (stalled.length === 1) parts.push(`${stalled[0]} still hasn't moved.`);
  else if (stalled.length > 1) parts.push(`${joinNames(stalled)} still haven't moved.`);

  if (today && insights.nextDueAt && !isPassed(insights.nextDueAt, now)) {
    parts.push(formatCommitmentLine(today, insights.nextDueAt, now));
  } else if (today) {
    parts.push(`Next: ${today}.`);
  }

  const active = uniqueNames(insights.workstreams.map((n) => spokenName(n))).filter(Boolean);
  const body = parts.length
    ? parts.join(" ")
    : active.length === 0
      ? "Nothing urgent on the board."
      : active.length === 1
        ? `${active[0]} is in motion.`
        : `${joinNames(active)} are in motion.`;

  const past = formatPastTodosLine(insights.pastTodos, now);
  return `${todayLine(now)} ${body}${past ? ` ${past}` : ""}`;
}
