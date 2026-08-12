import { randomUUID } from "crypto";
import { resolve } from "path";
import { execFileSync } from "child_process";
import { listRepositories } from "../repository-registry.js";
import { listOpenTasks } from "../task-store.js";
import { getRecentCommits } from "../../lib/recent-commits.js";
import { assembleCandidates } from "./candidates.js";
import {
  activeDemotions,
  evidenceFingerprint,
  readPresentModel,
  writePresentModel,
} from "./store.js";
import type { CandidateRepoInput, WorkHypothesis, WorkThread } from "./types.js";

const MAX_PRIMARY = 3;

export interface BuildPresentModelOptions {
  foregroundRoot?: string;
  coreCwd?: string;
  now?: Date;
  /** Injected repos for tests — skips live git. */
  repos?: CandidateRepoInput[];
  modelConfig?: { model: string; apiKey: string; baseURL?: string };
}

async function loadLiveRepos(foregroundRoot?: string): Promise<CandidateRepoInput[]> {
  const repos = listRepositories().filter((r) => r.enabled);
  const foreground = foregroundRoot ? resolve(foregroundRoot) : undefined;
  const results: CandidateRepoInput[] = [];

  for (const repo of repos) {
    let lastCommitAt: string | undefined;
    try {
      const commits = await getRecentCommits(repo.root, 1);
      lastCommitAt = commits[0]?.committedAt;
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
      isDirty,
      hasTasks: tasks.length > 0,
      isForeground: foreground ? resolve(repo.root) === foreground : false,
      gitCommonDir,
    });
  }

  return results;
}

function applyClaimChecks(threads: WorkThread[], coreCwd?: string): {
  primary: WorkThread[];
  secondary: WorkThread[];
  uncertainty: { field: string; reason: string }[];
} {
  const uncertainty: { field: string; reason: string }[] = [];
  const cwd = coreCwd ? resolve(coreCwd) : undefined;

  const eligible = threads.filter((t) => !t.demoted);
  const demoted = threads.filter((t) => t.demoted);

  // Reject primary when only dirty/cwd with no recent commit signal
  const primaryEligible = eligible.filter((t) => {
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

  const primary = primaryEligible.slice(0, MAX_PRIMARY);
  const secondary = [
    ...primaryEligible.slice(MAX_PRIMARY),
    ...demoted,
    ...eligible.filter((t) => !primary.includes(t) && !primaryEligible.slice(MAX_PRIMARY).includes(t)),
  ].filter((t, i, arr) => arr.findIndex((x) => x.root === t.root) === i);

  if (!primary.length) {
    uncertainty.push({ field: "primary", reason: "No integrity-admitted primary threads" });
  }

  return { primary, secondary, uncertainty };
}

function integrityHypothesisText(primary: WorkThread[], secondary: WorkThread[]): string {
  if (!primary.length) {
    return "Current work: gap — no integrity-admitted activity threads.";
  }
  const names = primary.map((t) => t.name).join(" · ");
  const confNote = primary.length === 1 ? "active thread" : "active threads";
  let line = `${names} look like tonight's ${confNote}.`;
  if (secondary.some((t) => t.demoted)) {
    const demoted = secondary.filter((t) => t.demoted).map((t) => t.name).join(", ");
    line += ` Demoted: ${demoted}.`;
  } else if (secondary.length) {
    const sec = secondary.slice(0, 2).map((t) => t.name).join(", ");
    line += ` Secondary: ${sec}.`;
  }
  return line;
}

function confidenceFor(primary: WorkThread[]): "high" | "medium" | "low" {
  if (!primary.length) return "low";
  if (primary.length >= 2 && primary.every((t) => t.signals.some((s) => s.startsWith("commit:")))) {
    return "medium";
  }
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
  const repos = options.repos ?? (await loadLiveRepos(options.foregroundRoot));
  const candidates = assembleCandidates({
    repos,
    now,
    coreCwd: options.coreCwd ?? process.cwd(),
    demotions,
  });

  const prior = readPresentModel();
  const fp = evidenceFingerprint(candidates, demotions);
  const priorFp = prior
    ? evidenceFingerprint([...prior.primaryThreads, ...prior.secondaryThreads], prior.demotions)
    : "";

  if (prior && fp === priorFp) {
    return writePresentModel({
      ...prior,
      fromCache: true,
      revisedAt: prior.revisedAt,
      generatedAt: now.toISOString(),
    });
  }

  const { primary, secondary, uncertainty } = applyClaimChecks(
    candidates,
    options.coreCwd ?? process.cwd(),
  );

  let hypothesisText = integrityHypothesisText(primary, secondary);
  let objective = prior?.objective;

  // Optional LLM enrichment — never overrides integrity naming
  if (options.modelConfig?.apiKey && primary.length) {
    // Keep V1 deterministic: model path reserved; integrity text is authoritative for R12
    objective = {
      value: `Re-enter ${primary[0].name}`,
      source: "repository",
      confidence: "low",
      provenance: "integrity_fallback_objective",
      sourceTimestamp: primary[0].lastCommitAt ?? now.toISOString(),
      isHypothesis: true,
    };
    hypothesisText = `${hypothesisText} Confidence: ${confidenceFor(primary)}.`;
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
    revisedAt: now.toISOString(),
    generatedAt: now.toISOString(),
    fromCache: false,
  };

  return writePresentModel(belief);
}

export function getOrBuildPresentModelSyncFallback(): WorkHypothesis | null {
  return readPresentModel();
}
