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
