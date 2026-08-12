import { resolve } from "path";
import type { CandidateRepoInput, WorkThread } from "./types.js";
import { RECENT_COMMIT_DAYS } from "./types.js";
import { isEphemeralRepoRoot } from "./ephemeral.js";

export interface AssembleCandidatesOptions {
  repos: CandidateRepoInput[];
  now?: Date;
  /** Core cwd — never sufficient alone for primary work. */
  coreCwd?: string;
  demotions?: string[];
  recentDays?: number;
}

function daysBetween(iso: string, now: Date): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - t) / (1000 * 60 * 60 * 24);
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Admit work threads from integrity signals only.
 * Dirty alone never admits. Observation time is not consulted.
 * Ephemeral/test roots never admit.
 */
export function assembleCandidates(options: AssembleCandidatesOptions): WorkThread[] {
  const now = options.now ?? new Date();
  const recentDays = options.recentDays ?? RECENT_COMMIT_DAYS;
  const demotions = new Set((options.demotions ?? []).map(normalizeName));
  const coreCwd = options.coreCwd ? resolve(options.coreCwd) : undefined;

  const byCommon = new Map<string, CandidateRepoInput>();
  for (const repo of options.repos) {
    if (isEphemeralRepoRoot(repo.root, repo.name)) continue;

    const key = repo.gitCommonDir ? resolve(repo.gitCommonDir) : resolve(repo.root);
    const existing = byCommon.get(key);
    if (!existing) {
      byCommon.set(key, repo);
      continue;
    }
    const a = existing.lastCommitAt ? Date.parse(existing.lastCommitAt) : 0;
    const b = repo.lastCommitAt ? Date.parse(repo.lastCommitAt) : 0;
    if (b > a || (b === a && repo.root.length < existing.root.length)) {
      byCommon.set(key, {
        ...repo,
        isDirty: repo.isDirty || existing.isDirty,
        hasTasks: repo.hasTasks || existing.hasTasks,
        isForeground: repo.isForeground || existing.isForeground,
        latestSubject: repo.latestSubject ?? existing.latestSubject,
      });
    } else {
      byCommon.set(key, {
        ...existing,
        isDirty: existing.isDirty || repo.isDirty,
        hasTasks: existing.hasTasks || repo.hasTasks,
        isForeground: existing.isForeground || repo.isForeground,
        latestSubject: existing.latestSubject ?? repo.latestSubject,
      });
    }
  }

  const threads: WorkThread[] = [];

  for (const repo of byCommon.values()) {
    const signals: string[] = [];
    const commitAge = repo.lastCommitAt ? daysBetween(repo.lastCommitAt, now) : Number.POSITIVE_INFINITY;
    const recentCommit = Number.isFinite(commitAge) && commitAge <= recentDays;
    const demoted = demotions.has(normalizeName(repo.name));

    if (recentCommit && repo.lastCommitAt) {
      signals.push(`commit:${repo.lastCommitAt}`);
    }
    if (repo.latestSubject) signals.push(`subject:${repo.latestSubject}`);
    if (repo.isDirty && recentCommit) {
      signals.push("dirty:supported_by_recent_commit");
    }
    if (repo.hasTasks) signals.push("open_tasks");
    if (repo.isForeground) signals.push("foreground:supporting");

    const admitted = recentCommit || repo.hasTasks;
    if (!admitted) continue;

    if (coreCwd && resolve(repo.root) === coreCwd && !recentCommit && !repo.hasTasks) {
      continue;
    }

    threads.push({
      root: repo.root,
      name: displayName(repo.name),
      repositoryId: repo.id,
      lastCommitAt: repo.lastCommitAt,
      latestSubject: repo.latestSubject,
      isDirty: repo.isDirty,
      hasTasks: repo.hasTasks,
      isForeground: repo.isForeground,
      signals,
      demoted,
    });
  }

  threads.sort((a, b) => {
    const at = a.lastCommitAt ? Date.parse(a.lastCommitAt) : 0;
    const bt = b.lastCommitAt ? Date.parse(b.lastCommitAt) : 0;
    return bt - at;
  });

  return threads;
}

/** cleanx → CleanX, good_neighbours → Good Neighbours */
export function displayName(name: string): string {
  const known: Record<string, string> = {
    cleanx: "CleanX",
    flyd: "Flyd",
    good_neighbours: "Good Neighbours",
    aigc: "aigc",
  };
  const key = name.trim().toLowerCase();
  if (known[key]) return known[key];
  if (name.includes(" ") || /[A-Z]/.test(name.slice(1))) return name;
  return name
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function isDirtyOnlyStale(repo: CandidateRepoInput, now = new Date(), recentDays = RECENT_COMMIT_DAYS): boolean {
  if (!repo.isDirty) return false;
  if (!repo.lastCommitAt) return true;
  return daysBetween(repo.lastCommitAt, now) > recentDays;
}
