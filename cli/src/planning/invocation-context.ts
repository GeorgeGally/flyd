import { resolve } from "node:path";
import type { PresentModel } from "../lib/present-model.js";
import type { StateFact, WorldStateSnapshot } from "../intelligence/world/types.js";
import type { WorkHypothesis } from "../work/work-hypothesis/types.js";
import type { ManagedRepository } from "../work/repository-registry.js";

const MAX_REPOSITORIES = 8;
const MAX_OBSERVATION_AGE_MS = 48 * 60 * 60 * 1000;

type RepositoryState = WorldStateSnapshot["repoStates"]["value"][number];

export interface InvocationContextProjection {
  repoStates: StateFact<RepositoryState[]>;
  blockers: StateFact<string[]>;
}

function canonicalRoot(root: string): string {
  return resolve(root);
}

function freshObservation(repo: ManagedRepository, now: Date): boolean {
  if (!repo.observedAt || typeof repo.observedDirty !== "boolean") return false;
  const observedAt = Date.parse(repo.observedAt);
  return Number.isFinite(observedAt)
    && observedAt <= now.getTime()
    && now.getTime() - observedAt <= MAX_OBSERVATION_AGE_MS;
}

function currentRepositoryState(present: PresentModel): RepositoryState | null {
  const repo = present.repository;
  if (!repo) return null;
  return {
    root: canonicalRoot(repo.root),
    branch: repo.branch,
    dirty: repo.dirty,
    head: repo.head,
  };
}

function candidateRoots(work: WorkHypothesis | null | undefined): string[] {
  if (!work) return [];
  return [...work.primaryThreads, ...work.secondaryThreads]
    .filter((thread) => !thread.demoted)
    .map((thread) => canonicalRoot(thread.root));
}

/**
 * Project the already-observed work index into an INVOKED planning snapshot.
 * This never scans repositories. The foreground repository is live PRESENT;
 * secondary repositories come only from fresh canonical registry observations.
 */
export function projectInvocationContext(input: {
  present: PresentModel;
  work?: WorkHypothesis | null;
  repositories: ManagedRepository[];
  now?: Date;
}): InvocationContextProjection {
  const now = input.now ?? new Date();
  const foreground = currentRepositoryState(input.present);
  const foregroundRoot = foreground?.root;
  const byRoot = new Map(
    input.repositories
      .filter((repo) => repo.enabled)
      .map((repo) => [canonicalRoot(repo.root), repo]),
  );

  const orderedRoots = [
    ...(foregroundRoot ? [foregroundRoot] : []),
    ...candidateRoots(input.work),
    ...input.repositories
      .filter((repo) => repo.enabled && freshObservation(repo, now))
      .map((repo) => canonicalRoot(repo.root)),
  ];

  const seen = new Set<string>();
  const states: RepositoryState[] = [];
  let registryFreshness: string | undefined;

  for (const root of orderedRoots) {
    if (seen.has(root) || states.length >= MAX_REPOSITORIES) continue;
    seen.add(root);

    if (foreground && root === foregroundRoot) {
      states.push(foreground);
      continue;
    }

    const repo = byRoot.get(root);
    if (!repo || !freshObservation(repo, now)) continue;
    states.push({
      root,
      ...(repo.observedBranch ? { branch: repo.observedBranch } : {}),
      dirty: Boolean(repo.observedDirty),
      ...(repo.lastSeenHead ? { head: repo.lastSeenHead } : {}),
    });
    if (!registryFreshness || (repo.observedAt && repo.observedAt > registryFreshness)) {
      registryFreshness = repo.observedAt;
    }
  }

  const blockerReasons = (input.work?.workerObservations ?? [])
    .filter((observation) => observation.state === "blocked")
    .map((observation) => observation.reason.trim())
    .filter(Boolean);
  const blockers = [...new Set(blockerReasons)];
  if (input.present.activeTask?.status === "blocked" && blockers.length === 0) {
    blockers.push(`Blocked task: ${input.present.activeTask.intendedOutcome}`);
  }

  const repoProvenance = [
    ...(foreground ? ["present-model:repository"] : []),
    ...(states.some((state) => state.root !== foregroundRoot) ? ["work-index:repository-registry"] : []),
  ];
  const blockerProvenance = blockerReasons.length > 0
    ? ["work-hypothesis:worker-observations"]
    : blockers.length > 0
      ? ["present-model:activeTask"]
      : ["work-hypothesis:worker-observations"];

  return {
    repoStates: {
      value: states,
      confidence: foreground
        ? (states.length > 1 ? "medium" : input.present.gaps.length === 0 ? "high" : "medium")
        : states.length > 0 ? "medium" : "unknown",
      provenance: repoProvenance,
      ...(registryFreshness ? { freshness: registryFreshness } : { freshness: input.present.generatedAt }),
    },
    blockers: {
      value: blockers,
      confidence: blockerReasons.length > 0 ? "high" : blockers.length > 0 ? "medium" : "unknown",
      provenance: blockerProvenance,
      ...(input.work?.generatedAt ? { freshness: input.work.generatedAt } : {}),
    },
  };
}
