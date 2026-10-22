import { execFileSync } from "node:child_process";
import type { AttributionState } from "../intelligence/outcomes/outcomes.js";

export type ContainsCommit = (ancestor: string, descendant: string) => boolean;

function git(repoDir: string, args: string[]): string {
  return execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 });
}

export function resolveBuildCommit(sourceDir: string): string | null {
  try {
    if (git(sourceDir, ["status", "--porcelain", "--untracked-files=no", "--", "."]).trim() !== "") return null;
    return git(sourceDir, ["rev-parse", "HEAD"]).trim() || null;
  } catch {
    return null;
  }
}

export function gitContainsCommit(repoDir: string): ContainsCommit {
  return (ancestor, descendant) => {
    try {
      git(repoDir, ["merge-base", "--is-ancestor", ancestor, descendant]);
      return true;
    } catch {
      return false;
    }
  };
}

export type MergedPullRequest = { merged: boolean; mergeCommitSha: string | null; changedPaths: string[] };

export function assessDelivery(
  pullRequest: MergedPullRequest,
  runningHealth: { buildCommit: string | null },
  contains: ContainsCommit,
): { attribution: AttributionState; completed: boolean } {
  const completed = pullRequest.merged
    && pullRequest.mergeCommitSha !== null
    && !pullRequest.changedPaths.some((path) => path.startsWith("mac-adapter/"))
    && runningHealth.buildCommit !== null
    && contains(pullRequest.mergeCommitSha, runningHealth.buildCommit);
  return { attribution: completed ? "direct_verified" : "unknown", completed };
}

export async function observeRunningBuild(coreUrl: string): Promise<{ buildCommit: string | null }> {
  try {
    const body = await (await fetch(`${coreUrl}/health`)).json() as { buildCommit?: unknown };
    return { buildCommit: typeof body.buildCommit === "string" ? body.buildCommit : null };
  } catch {
    return { buildCommit: null };
  }
}

export async function assessLiveDelivery(
  pullRequest: MergedPullRequest,
  coreUrl: string,
  contains: ContainsCommit,
): Promise<{ attribution: AttributionState; completed: boolean }> {
  return assessDelivery(pullRequest, await observeRunningBuild(coreUrl), contains);
}
