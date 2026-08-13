import { getDb } from "../database.js";
import { displayName, hasDisplayAlias } from "./candidates.js";
import type { PresentInsights, WorkThread } from "./types.js";

export type { PresentInsights };

const STALL_DAYS = 7;
const MOVE_DAYS = 3;

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

function openTodoRows(): Array<{ description: string; dueAt?: string }> {
  try {
    const rows = getDb()
      .prepare(
        `SELECT description, due_at FROM confirmed_todos WHERE status = 'open'
         ORDER BY CASE WHEN due_at IS NULL OR due_at = '' THEN 1 ELSE 0 END ASC,
                  due_at ASC, sort_order ASC, created_at ASC LIMIT 8`,
      )
      .all() as Array<{ description: string; due_at?: string }>;
    return rows
      .map((r) => ({ description: r.description, dueAt: r.due_at || undefined }))
      .filter((r) => r.description);
  } catch {
    return [];
  }
}

function openTodoDescriptions(): string[] {
  return openTodoRows().map((r) => r.description);
}

function formatDueSpoken(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${d} ${months[m - 1]}`;
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

  const fromRepos = all
    .filter((t) => !t.demoted && !/flyd/i.test(t.name))
    .map((t) => t.name);

  const fromMemory = [
    ...(options.extraWorkstreams ?? []),
    ...openTodoDescriptions()
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

  const todoRows = openTodoRows();
  const nextRow = todoRows[0];
  const nextTodo = nextRow ? displayNameForStream(nextRow.description) : undefined;
  let nextLeverage: string | undefined;
  if (nextTodo && nextRow?.dueAt) {
    nextLeverage = `Next confirmed to-do: ${nextTodo} (due ${formatDueSpoken(nextRow.dueAt)}).`;
  } else if (nextTodo) {
    nextLeverage = `Next confirmed to-do: ${nextTodo}.`;
  } else if (stalledThreads.length) {
    nextLeverage = `Re-enter stalled thread: ${stalledThreads[0]}.`;
  } else if (latestMoves[0]) {
    nextLeverage = `Continue ${latestMoves[0].name}: ${latestMoves[0].subject}.`;
  } else if (workstreams[0]) {
    nextLeverage = `Re-enter ${workstreams[0]}.`;
  }

  return {
    workstreams,
    latestMoves,
    tensions,
    stalledThreads,
    finishedProjects,
    nextTodo,
    nextLeverage,
    nextDueAt: nextRow?.dueAt,
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

/** Spoken morning brief — priority, what moved, what's stuck. No catalogs. */
export function formatPresentModelText(
  insights: PresentInsights,
  _options: { preferCoreHome?: boolean; demotedNames?: string[] } = {},
): string {
  const parts: string[] = [];
  const today = spokenName(insights.nextTodo);
  if (today && insights.nextDueAt) {
    parts.push(`${today} is first — due ${formatDueSpoken(insights.nextDueAt)}.`);
  } else if (today) {
    parts.push(`${today} is first today.`);
  }

  const movers = uniqueNames(
    insights.latestMoves
      .filter((m) => !/flyd/i.test(m.name))
      .map((m) => spokenName(m.name)),
  ).filter((n) => !today || n.toLowerCase() !== today.toLowerCase());

  if (movers.length === 1) parts.push(`${movers[0]} moved.`);
  else if (movers.length === 2) parts.push(`${movers[0]} and ${movers[1]} both moved.`);
  else if (movers.length > 2) parts.push(`${joinNames(movers)} all moved.`);

  const stalled = uniqueNames(insights.stalledThreads.map((n) => spokenName(n))).filter(
    (n) => !today || n.toLowerCase() !== today.toLowerCase(),
  );
  if (stalled.length === 1) parts.push(`${stalled[0]} still hasn't.`);
  else if (stalled.length > 1) parts.push(`${joinNames(stalled)} still haven't.`);

  if (parts.length) return parts.join(" ");

  const active = uniqueNames(insights.workstreams.map((n) => spokenName(n))).filter(Boolean);
  if (active.length === 1) return `${active[0]} is in motion.`;
  if (active.length > 1) return `${joinNames(active)} are in motion.`;
  return "Nothing urgent on the board.";
}
