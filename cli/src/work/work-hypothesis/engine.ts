import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { resolve } from "path";
import { execFileSync } from "child_process";
import {
  listRepositories,
  registerDiscoveredRepos,
  purgeEphemeralRepositories,
} from "../repository-registry.js";
import { listOpenTasks } from "../task-store.js";
import { getRecentCommits } from "../../lib/recent-commits.js";
import { assembleCandidates, displayName } from "./candidates.js";
import { isEphemeralRepoRoot } from "./ephemeral.js";
import {
  activeDemotions,
  activePromotions,
  isProjectPromoted,
  evidenceFingerprint,
  readPresentModel,
  writePresentModel,
} from "./store.js";
import { derivePresentInsights, formatPresentModelText } from "./insights.js";
import type { CandidateRepoInput, WorkHypothesis, WorkThread } from "./types.js";

const MAX_PRIMARY = 3;

export interface BuildPresentModelOptions {
  foregroundRoot?: string;
  coreCwd?: string;
  now?: Date;
  /** Injected repos for tests — skips live git / discovery. */
  repos?: CandidateRepoInput[];
  modelConfig?: { model: string; apiKey: string; baseURL?: string };
  skipDiscovery?: boolean;
}

async function loadLiveRepos(foregroundRoot?: string): Promise<CandidateRepoInput[]> {
  purgeEphemeralRepositories(isEphemeralRepoRoot);
  try {
    registerDiscoveredRepos();
  } catch {
    // discovery is best-effort
  }

  const repos = listRepositories().filter(
    (r) => r.enabled && existsSync(r.root) && !isEphemeralRepoRoot(r.root, r.name),
  );
  const foreground = foregroundRoot ? resolve(foregroundRoot) : undefined;
  const results: CandidateRepoInput[] = [];

  for (const repo of repos) {
    let lastCommitAt: string | undefined;
    let latestSubject: string | undefined;
    try {
      const commits = await getRecentCommits(repo.root, 1);
      lastCommitAt = commits[0]?.committedAt;
      latestSubject = commits[0]?.subject;
    } catch {
      lastCommitAt = repo.lastActivityAt;
    }

    let isDirty = false;
    try {
      const status = execFileSync("git", ["-C", repo.root, "status", "--porcelain"], {
        encoding: "utf8",
        timeout: 5000,
      }).trim();
      isDirty = status.length > 0;
    } catch {
      isDirty = false;
    }

    let gitCommonDir: string | undefined;
    try {
      const common = execFileSync("git", ["-C", repo.root, "rev-parse", "--git-common-dir"], {
        encoding: "utf8",
        timeout: 3000,
      }).trim();
      gitCommonDir = resolve(repo.root, common);
    } catch {
      gitCommonDir = undefined;
    }

    const tasks = listOpenTasks(repo.id);
    results.push({
      id: repo.id,
      name: repo.name,
      root: repo.root,
      lastCommitAt,
      latestSubject,
      isDirty,
      hasTasks: tasks.length > 0,
      isForeground: foreground ? resolve(repo.root) === foreground : false,
      gitCommonDir,
    });
  }

  return results;
}

function isCoreHomeThread(thread: WorkThread, coreCwd?: string): boolean {
  if (!coreCwd) return false;
  const cwd = resolve(coreCwd);
  const root = resolve(thread.root);
  return cwd === root || cwd.startsWith(root + "/");
}

function applyClaimChecks(
  threads: WorkThread[],
  coreCwd?: string,
  options: { preferCoreHome?: boolean } = {},
): {
  primary: WorkThread[];
  secondary: WorkThread[];
  uncertainty: { field: string; reason: string }[];
} {
  const uncertainty: { field: string; reason: string }[] = [];
  const cwd = coreCwd ? resolve(coreCwd) : undefined;
  const preferCoreHome = Boolean(options.preferCoreHome);

  const eligible = threads.filter((t) => !t.demoted);
  const demoted = threads.filter((t) => t.demoted);

  let primaryEligible = eligible.filter((t) => {
    const cwdOnly = cwd && resolve(t.root) === cwd && !t.signals.some((s) => s.startsWith("commit:"));
    if (cwdOnly) {
      uncertainty.push({
        field: "primary",
        reason: `${t.name} is Core cwd without recent commit evidence`,
      });
      return false;
    }
    const dirtyOnly = t.isDirty && !t.signals.some((s) => s.startsWith("commit:")) && !t.hasTasks;
    if (dirtyOnly) return false;
    return t.signals.some((s) => s.startsWith("commit:")) || t.hasTasks;
  });

  // Default: Core home is supporting while other product threads are active.
  // User reaffirm ("Flyd not secondary / drives everything") overrides that.
  const nonCore = primaryEligible.filter((t) => !isCoreHomeThread(t, coreCwd));
  const coreOnes = primaryEligible.filter((t) => isCoreHomeThread(t, coreCwd));
  if (!preferCoreHome && nonCore.length > 0 && coreOnes.length > 0) {
    primaryEligible = nonCore;
    for (const t of coreOnes) {
      demoted.push({ ...t, demoted: false });
      uncertainty.push({
        field: "primary",
        reason: `${t.name} is the Core home repo — treated as secondary while other threads have activity`,
      });
    }
  } else if (preferCoreHome && coreOnes.length > 0) {
    primaryEligible = [...coreOnes, ...nonCore];
    uncertainty.push({
      field: "primary",
      reason: "User reaffirmed Flyd as primary — Core home drives the view across workstreams",
    });
  }

  const primary = primaryEligible.slice(0, MAX_PRIMARY);
  const secondaryPool = [
    ...primaryEligible.slice(MAX_PRIMARY),
    ...demoted,
    ...eligible.filter((t) => !primary.includes(t) && isCoreHomeThread(t, coreCwd)),
  ];
  const secondary = secondaryPool.filter(
    (t, i, arr) => arr.findIndex((x) => resolve(x.root) === resolve(t.root)) === i,
  );

  if (!primary.length) {
    uncertainty.push({ field: "primary", reason: "No integrity-admitted primary threads" });
  }

  return { primary, secondary, uncertainty };
}

function integrityHypothesisText(
  primary: WorkThread[],
  secondary: WorkThread[],
  options: {
    preferCoreHome?: boolean;
    now?: Date;
    extraWorkstreams?: string[];
    finishedProjects?: string[];
  } = {},
): { text: string; insights: import("./types.js").PresentInsights } {
  const insights = derivePresentInsights(primary, secondary, {
    preferCoreHome: options.preferCoreHome,
    now: options.now,
    extraWorkstreams: options.extraWorkstreams,
    finishedProjects: options.finishedProjects,
  });
  const demotedNames = [...primary, ...secondary]
    .filter((t) => t.demoted)
    .map((t) => t.name)
    .filter((name, i, arr) => arr.indexOf(name) === i);
  const text = formatPresentModelText(insights, {
    preferCoreHome: options.preferCoreHome,
    demotedNames,
  });
  return { text, insights };
}

function finishedProjectNames(
  repos: CandidateRepoInput[],
  admitted: WorkThread[],
  now: Date,
): string[] {
  const admittedRoots = new Set(admitted.map((t) => resolve(t.root)));
  const names: string[] = [];
  for (const repo of repos) {
    if (admittedRoots.has(resolve(repo.root))) continue;
    if (/flyd/i.test(repo.name)) continue;
    if (repo.isDirty) continue;
    if (!repo.lastCommitAt) continue;
    const age = (now.getTime() - Date.parse(repo.lastCommitAt)) / (1000 * 60 * 60 * 24);
    if (!Number.isFinite(age) || age <= 30) continue;
    names.push(displayName(repo.name));
  }
  return names;
}

function confidenceFor(primary: WorkThread[]): "high" | "medium" | "low" {
  if (!primary.length) return "low";
  if (primary.length >= 2 && primary.every((t) => t.latestSubject)) return "medium";
  if (primary[0]?.signals.some((s) => s.startsWith("commit:"))) return "medium";
  return "low";
}

/**
 * Build and persist the Present Model (WorkHypothesis).
 * Integrity-only path is the spine; model narrative is optional enrichment.
 */
export async function buildPresentModelBelief(
  options: BuildPresentModelOptions = {},
): Promise<WorkHypothesis> {
  const now = options.now ?? new Date();
  const demotions = activeDemotions();
  const promotions = activePromotions();
  const preferCoreHome =
    isProjectPromoted("flyd") ||
    isProjectPromoted("Flyd") ||
    promotions.some((p) => /flyd/i.test(p));
  const repos =
    options.repos ??
    (await loadLiveRepos(options.foregroundRoot));
  const candidates = assembleCandidates({
    repos,
    now,
    coreCwd: options.coreCwd ?? process.cwd(),
    demotions,
  });

  const extraWorkstreams = promotions.filter((p) => !/flyd/i.test(p)).map((p) => displayName(p));
  const insightOpts = (primary: WorkThread[], secondary: WorkThread[]) => ({
    preferCoreHome,
    now,
    extraWorkstreams,
    finishedProjects: finishedProjectNames(repos, [...primary, ...secondary], now),
  });

  const prior = readPresentModel();
  const fp = evidenceFingerprint(candidates, demotions, promotions);
  const priorFp = prior
    ? evidenceFingerprint(
        [...prior.primaryThreads, ...prior.secondaryThreads],
        prior.demotions,
        promotions,
      )
    : "";

  if (prior && fp === priorFp) {
    const { text, insights } = integrityHypothesisText(
      prior.primaryThreads,
      prior.secondaryThreads,
      insightOpts(prior.primaryThreads, prior.secondaryThreads),
    );
    return writePresentModel({
      ...prior,
      hypothesisText: text,
      insights,
      fromCache: true,
      revisedAt: prior.revisedAt,
      generatedAt: now.toISOString(),
    });
  }

  const { primary, secondary, uncertainty } = applyClaimChecks(
    candidates,
    options.coreCwd ?? process.cwd(),
    { preferCoreHome },
  );

  const { text: hypothesisText, insights } = integrityHypothesisText(
    primary,
    secondary,
    insightOpts(primary, secondary),
  );
  let objective = prior?.objective;

  if (options.modelConfig?.apiKey && primary.length) {
    const tip = insights.nextLeverage
      ?? (primary[0].latestSubject
        ? `Continue: ${primary[0].latestSubject}`
        : `Re-enter ${primary[0].name}`);
    objective = {
      value: tip,
      source: "repository",
      confidence: "low",
      provenance: "integrity_reentry_from_latest_commit",
      sourceTimestamp: primary[0].lastCommitAt ?? now.toISOString(),
      isHypothesis: true,
    };
  }

  const belief: WorkHypothesis = {
    id: prior?.id ?? `wh-${randomUUID().slice(0, 8)}`,
    hypothesisText,
    primaryThreads: primary,
    secondaryThreads: secondary,
    objective,
    confidence: confidenceFor(primary),
    uncertainty,
    evidenceRefs: primary.flatMap((t) => t.signals),
    demotions,
    insights,
    revisedAt: now.toISOString(),
    generatedAt: now.toISOString(),
    fromCache: false,
  };

  return writePresentModel(belief);
}

export function getOrBuildPresentModelSyncFallback(): WorkHypothesis | null {
  return readPresentModel();
}
