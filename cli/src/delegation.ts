import type { ArtifactCheckResult, HandoffReport } from "./verification-types.js";
import { validateHandoff } from "./handoff.js";
import {
  buildRuntimeTaskRequest,
  isExplicitDelegationRequest,
  type RuntimeTaskRequest,
} from "./runtime/delegation-request.js";

/**
 * Compatibility alias for the dormant /manifest delegation field.
 *
 * Delegation is no longer a parallel execution model: the payload is now a
 * RuntimeTaskRequest that must be materialized into the canonical AgentTask /
 * TaskGrant / WorkerSession runtime before any work starts.
 */
export type DelegationEnvelope = RuntimeTaskRequest;

export function buildDelegationEnvelope(
  intent: string,
  worldState: Record<string, unknown>,
  observationRefs: string[],
  project: string | null,
): DelegationEnvelope {
  return buildRuntimeTaskRequest({
    intent,
    contextSnapshot: worldState,
    observationRefs,
    projectRoot: project,
    source: "manifest",
    taskIntent: "ship",
  });
}

/**
 * Compatibility export for the dormant manifest path. New product routing
 * should choose Scout/Ship from resolved intent instead of magic phrases.
 */
export function isDelegationIntent(intent: string): boolean {
  return isExplicitDelegationRequest(intent);
}

export type DelegationCompletionStatus = "completed" | "failed" | "blocked";

/**
 * Legacy completion receipt accepted by the dormant /delegation/complete
 * endpoint. It remains validation-only while callers migrate to canonical
 * runtime verification/artifact/task state.
 */
export interface DelegationCompletion {
  delegationId: string;
  invocationId: string;
  status: DelegationCompletionStatus;
  /** Required when status === "completed". */
  handoff: HandoffReport | null;
  /** Progress notes — explicitly NOT completion evidence. */
  activity: string[];
  verification: {
    artifactChecks: ArtifactCheckResult[];
    commands?: Array<{ command: string; exitStatus: number; outputDigest: string }>;
    verifiedAt: string;
  } | null;
  /** Required when status === "blocked". */
  blocker?: string;
  claimedAt: string;
}

/**
 * Legacy receipt validation only. Canonical runtime completion remains owned by
 * task verification/integration; this validator must never promote a task.
 */
export function validateDelegationCompletion(c: DelegationCompletion): string | null {
  if (!c.delegationId || !c.invocationId) {
    return "Missing delegationId or invocationId";
  }
  if (!["completed", "failed", "blocked"].includes(c.status)) {
    return `Invalid status: ${c.status}`;
  }
  if (!c.claimedAt || Number.isNaN(Date.parse(c.claimedAt))) {
    return "Missing or invalid claimedAt timestamp";
  }

  if (c.status === "blocked" && (!c.blocker || !c.blocker.trim())) {
    return "Blocked completion requires a blocker description";
  }

  if (c.status !== "completed") return null;

  if (!c.handoff) {
    return "activity_is_not_completion: completed status requires a handoff report";
  }
  const handoffError = validateHandoff(c.handoff);
  if (handoffError) return `Invalid handoff: ${handoffError}`;

  if (!c.verification) {
    return "activity_is_not_completion: completed status requires verification evidence";
  }
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
  if (Number.isNaN(Date.parse(c.verification.verifiedAt))) {
    return "Missing or invalid verifiedAt timestamp";
  }
  if (Date.parse(c.verification.verifiedAt) > Date.parse(c.claimedAt)) {
    return "Verification must precede the completion claim";
  }

  return null;
}
