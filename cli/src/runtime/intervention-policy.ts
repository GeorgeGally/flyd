export type InterventionTrigger =
  | "verification_failed"
  | "worker_failed"
  | "inactive"
  | "repository_changed"
  | "scope_expansion";

export interface InterventionDecision {
  action: "retry" | "replace" | "stop" | "escalate" | "none";
  automatic: boolean;
  reason: string;
  evidenceDigest: string;
}

export function chooseIntervention(input: {
  trigger: InterventionTrigger;
  evidenceDigest: string;
  priorEvidenceDigests: string[];
  remainingRuns: number;
  replacementAvailable: boolean;
}): InterventionDecision {
  if (input.priorEvidenceDigests.includes(input.evidenceDigest)) {
    return {
      action: "none",
      automatic: false,
      reason: "Flyd already intervened on this exact evidence",
      evidenceDigest: input.evidenceDigest,
    };
  }
  if ([ "repository_changed", "scope_expansion" ].includes(input.trigger)) {
    return {
      action: "escalate",
      automatic: false,
      reason: input.trigger === "repository_changed"
        ? "Current repository evidence invalidated the assignment base"
        : "The required action exceeds the approved task grant",
      evidenceDigest: input.evidenceDigest,
    };
  }
  if (input.trigger === "inactive") {
    return {
      action: "stop",
      automatic: true,
      reason: "The worker exceeded the approved inactivity threshold",
      evidenceDigest: input.evidenceDigest,
    };
  }
  if (input.remainingRuns <= 0) {
    return {
      action: "escalate",
      automatic: false,
      reason: "The task grant worker-run budget is exhausted",
      evidenceDigest: input.evidenceDigest,
    };
  }
  if (input.trigger === "worker_failed" && input.replacementAvailable) {
    return {
      action: "replace",
      automatic: true,
      reason: "A capable healthy adapter can replace the failed worker",
      evidenceDigest: input.evidenceDigest,
    };
  }
  return {
    action: "retry",
    automatic: true,
    reason: "Retry the bounded assignment with focused verification evidence",
    evidenceDigest: input.evidenceDigest,
  };
}
