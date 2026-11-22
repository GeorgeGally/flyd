import { createHash } from "node:crypto";
import type { Episode } from "../../../intelligence/evaluation/episode-replay.js";
import { RECOVERY_WORKFLOW_POLICY, recoveryWorkflowDigest } from "./recovery-workflow.js";

/**
 * A *non-executable* candidate for the existing governed learning system.
 * No workflow code, tools, prompts, permissions, model changes or activation
 * can be generated from a successful outcome by this module.
 */
export interface RecoveryPlaybookCandidate {
  id: string;
  kind: "review_candidate";
  workflowDigest: string;
  policyVersion: string;
  verifiedEpisodeIds: string[];
  evidenceCount: number;
  disposition: "submit_to_existing_policy_review";
}

/**
 * Success alone cannot prove efficacy: require distinct matured episodes with
 * independent, positive measurements. Negative/user-rejected evidence vetoes
 * proposing a broader policy. Unknown/unverified outcomes never vote.
 */
export function proposeRecoveryPlaybooks(
  episodes: readonly Episode[],
  options: { minimumDistinct?: number } = {},
): RecoveryPlaybookCandidate[] {
  const required = Math.max(3, options.minimumDistinct ?? 3);
  const related = episodes.filter((e) =>
    e.intervention.policyVersion === RECOVERY_WORKFLOW_POLICY &&
    e.intervention.metricName === "verified_recovery_success");
  const hasVeto = related.some((e) =>
    e.outcome?.attribution === "user_rejected" || e.outcome?.attribution === "not_helpful" ||
    e.outcome?.review?.verdict === "not_helpful");
  if (hasVeto) return [];

  const passed = related.filter((e) =>
    e.matured &&
    (e.outcome?.attribution === "direct_verified" || e.outcome?.attribution === "observed_impact") &&
    e.metricDelta !== undefined && Number.isFinite(e.metricDelta) && e.metricDelta > 0 &&
    e.outcome.metric?.evidenceRef);
  const unique = new Map(passed.map((e) => [e.intervention.interventionId, e]));
  if (unique.size < required) return [];
  const ids = [...unique.values()].map((e) => e.episodeId).sort();
  const digest = recoveryWorkflowDigest();
  return [{
    id: "cos-playbook-candidate:" + createHash("sha256").update(JSON.stringify([digest, ids])).digest("hex").slice(0, 20),
    kind: "review_candidate", workflowDigest: digest,
    policyVersion: RECOVERY_WORKFLOW_POLICY, verifiedEpisodeIds: ids,
    evidenceCount: unique.size, disposition: "submit_to_existing_policy_review",
  }];
}
