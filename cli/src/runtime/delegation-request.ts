import { randomUUID } from "node:crypto";

/**
 * Canonical handoff from Flyd intent resolution into the execution runtime.
 *
 * This is deliberately a task request, not a second task/delegation model.
 * The runtime remains authoritative for AgentTask, TaskGrant, assignments,
 * workers, verification, integration, and completion.
 */
export interface RuntimeTaskRequest {
  requestId: string;
  /** Temporary alias used by the legacy /delegation/complete receipt path. */
  delegationId: string;
  invocationId?: string;
  intendedOutcome: string;
  taskIntent: "scout" | "ship";
  projectRoot: string | null;
  observationRefs: string[];
  contextSnapshot: Record<string, unknown>;
  requestedCapabilities: string[];
  confirmationRequired: true;
  source: "manifest" | "cli" | "voice" | "system";
}

export function buildRuntimeTaskRequest(input: {
  intent: string;
  contextSnapshot?: Record<string, unknown>;
  observationRefs?: string[];
  projectRoot?: string | null;
  invocationId?: string;
  source?: RuntimeTaskRequest["source"];
  taskIntent?: RuntimeTaskRequest["taskIntent"];
}): RuntimeTaskRequest {
  const intendedOutcome = input.intent.trim();
  if (!intendedOutcome) throw new Error("Runtime task request requires an intended outcome");

  const requestId = `task-request-${randomUUID()}`;
  return {
    requestId,
    delegationId: requestId,
    invocationId: input.invocationId,
    intendedOutcome,
    taskIntent: input.taskIntent ?? "ship",
    projectRoot: input.projectRoot ?? null,
    observationRefs: [...new Set(input.observationRefs ?? [])],
    contextSnapshot: input.contextSnapshot ?? {},
    requestedCapabilities: input.taskIntent === "scout"
      ? ["analysis", "review"]
      : ["analysis", "implementation", "testing"],
    confirmationRequired: true,
    source: input.source ?? "manifest",
  };
}

/**
 * Temporary compatibility classifier for the dormant manifest delegation path.
 * Product routing should eventually decide scout/ship from resolved intent rather
 * than requiring delegation-specific phrasing.
 */
export function isExplicitDelegationRequest(intent: string): boolean {
  return [
    /delegate\s+/i,
    /spawn\s+(a|an)\s+agent\s+(to|for)\s+/i,
    /run\s+(a|an)\s+agent\s+(to|for)\s+/i,
    /create\s+(a|an)\s+agent\s+(to|for)\s+/i,
    /do\s+this\s+in\s+the\s+background/i,
  ].some((pattern) => pattern.test(intent));
}
