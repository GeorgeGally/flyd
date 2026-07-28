import { randomUUID } from "node:crypto";
import type { ArtifactCheckResult, HandoffReport } from "./verification-types.js";
import { validateHandoff } from "./handoff.js";

export interface DelegationEnvelope {
  delegationId: string;
  intent: string;
  worldState: Record<string, unknown>;
  observationRefs: string[];
  memory: {
    goals: Array<{ content: unknown }>;
    tensions: Array<{ content: unknown }>;
    profile: Array<{ content: unknown }>;
  };
  currentProject: string | null;
  availableCapabilities: string[];
  goal: string;
  /** What "done" means for this delegation — the runner verifies against this. */
  finishCondition: string;
  completionContract: {
    requiresHandoff: true;
    requiresVerifiedArtifacts: true;
  };
  grant: {
    repositories: string[];
    maxRuntimeMinutes: number;
    writeAllowed: boolean;
    networkAllowed: boolean;
  };
}

export function buildDelegationEnvelope(
  intent: string,
  worldState: Record<string, unknown>,
  observationRefs: string[],
  project: string | null
): DelegationEnvelope {
  const goals =
    (worldState.goals as Array<{ content: unknown }>)?.slice(0, 3) || [];
  const tensions =
    (worldState.tensions as Array<{ content: unknown }>)?.slice(0, 2) || [];
  const profile =
    (worldState.profile as Array<{ content: unknown }>)?.slice(0, 2) || [];

  return {
    delegationId: randomUUID(),
    intent,
    worldState,
    observationRefs,
    memory: { goals, tensions, profile },
    currentProject: project,
    availableCapabilities: [
      "code_generation",
      "code_review",
      "debugging",
      "research",
      "verification",
      "integration",
    ],
    goal: `Resolve intent: "${intent.slice(0, 100)}"`,
    finishCondition: `The intent "${intent.slice(0, 200)}" is resolved with a verified, user-facing outcome.`,
    completionContract: {
      requiresHandoff: true,
      requiresVerifiedArtifacts: true,
    },
    grant: {
      repositories: [],
      maxRuntimeMinutes: 10,
      writeAllowed: false,
      networkAllowed: true,
    },
  };
}

export function isDelegationIntent(intent: string): boolean {
  const delegationPatterns = [
    /delegate\s+/i,
    /spawn\s+(a|an)\s+agent\s+(to|for)\s+/i,
    /run\s+(a|an)\s+agent\s+(to|for)\s+/i,
    /create\s+(a|an)\s+agent\s+(to|for)\s+/i,
    /do\s+this\s+in\s+the\s+background/i,
  ];

  return delegationPatterns.some((p) => p.test(intent));
}

export type DelegationCompletionStatus = "completed" | "failed" | "blocked";

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
 * The completion rule: a delegated task reports an outcome, not activity.
 * "completed" is structurally impossible without a validated handoff and
 * verification evidence that predates the claim.
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
