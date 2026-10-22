import type { AttributionState } from "../intelligence/outcomes/outcomes.js";

export function assessDelivery(
  pullRequest: { merged: boolean; mergeCommitSha: string | null },
  runningHealth: { buildCommit: string | null },
): { attribution: AttributionState; completed: boolean } {
  const completed = pullRequest.merged
    && pullRequest.mergeCommitSha !== null
    && runningHealth.buildCommit !== null
    && runningHealth.buildCommit === pullRequest.mergeCommitSha;
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
  pullRequest: { merged: boolean; mergeCommitSha: string | null },
  coreUrl: string,
): Promise<{ attribution: AttributionState; completed: boolean }> {
  return assessDelivery(pullRequest, await observeRunningBuild(coreUrl));
}
