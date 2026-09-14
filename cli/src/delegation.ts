import type { ArtifactCheckResult, HandoffReport } from "./verification-types.js";
import { validateHandoff } from "./handoff.js";
import {
  buildRuntimeTaskRequest,
  type RuntimeTaskRequest,
} from "./runtime/delegation-request.js";

/**
 * Deprecated compatibility alias retained only so old serialized callers and
 * tests can be read during migration. It is not an execution contract.
 * Canonical delegated work is RuntimeTaskRequest -> AgentTask -> TaskGrant ->
 * WorkerSession.
 */
export type DelegationEnvelope = RuntimeTaskRequest;

/** @deprecated New code must call buildRuntimeTaskRequest directly. */
export function buildDelegationEnvelope(
  intent: string,
  worldState: Record<string, unknown>,
  observationRefs: string[],
  foregroundAppBundleId: string | null,
): DelegationEnvelope {
  return buildRuntimeTaskRequest({
    intent,
    contextSnapshot: {
      ...worldState,
      ...(foregroundAppBundleId ? { foregroundAppBundleId } : {}),
    },
    observationRefs,
    projectRoot: null,
    source: "manifest",
    taskIntent: "ship",
  });
}

/**
 * The legacy /manifest magic-phrase delegation router is retired. Delegation
 * is now chosen by normal intent/policy and materialized into the canonical
 * runtime task model. Keeping this function false makes old server code inert
 * without creating a second execution authority.
 */
export function isDelegationIntent(_intent: string): boolean {
  return false;
}

export type DelegationCompletionStatus = "completed" | "failed" | "blocked";

/**
 * Deprecated compatibility receipt for the disabled legacy completion API.
 * Validation cannot mutate/promote canonical runtime state.
 */
export interface DelegationCompletion {
  delegationId: string;
  invocationId: string;
  status: DelegationCompletionStatus;
  handoff: HandoffReport | null;
  activity: string[];
  verification: {
    artifactChecks: ArtifactCheckResult[];
    commands?: Array<{ command: string; exitStatus: number; outputDigest: string }>;
    verifiedAt: string;
  } | null;
  blocker?: string;
  claimedAt: string;
}

export function validateDelegationCompletion(c: DelegationCompletion): string | null {
  if (!c.delegationId || !c.invocationId) return "Missing delegationId or invocationId";
  if (!["completed", "failed", "blocked"].includes(c.status)) return `Invalid status: ${c.status}`;
  if (!c.claimedAt || Number.isNaN(Date.parse(c.claimedAt))) return "Missing or invalid claimedAt timestamp";

  if (c.status === "blocked" && (!c.blocker || !c.blocker.trim())) {
    return "Blocked completion requires a blocker description";
  }
  if (c.status !== "completed") return null;

  if (!c.handoff) return "activity_is_not_completion: completed status requires a handoff report";
  const handoffError = validateHandoff(c.handoff);
  if (handoffError) return `Invalid handoff: ${handoffError}`;

  if (!c.verification) return "activity_is_not_completion: completed status requires verification evidence";
  const hasArtifactEvidence = c.verification.artifactChecks.length > 0;
  const hasCommandEvidence = (c.verification.commands?.length ?? 0) > 0;
  if (!hasArtifactEvidence && !hasCommandEvidence) {
    return "activity_is_not_completion: verification has no artifact checks or command results";
  }
  const failedCheck = c.verification.artifactChecks.find((check) => !check.passed);
  if (failedCheck) {
    const detail = failedCheck.failures.map((f) => f.check).join(", ") || "unknown";
    return `Completion claimed with failing artifact check (${detail})`;
  }
  if (Number.isNaN(Date.parse(c.verification.verifiedAt))) return "Missing or invalid verifiedAt timestamp";
  if (Date.parse(c.verification.verifiedAt) > Date.parse(c.claimedAt)) {
    return "Verification must precede the completion claim";
  }
  return null;
}
