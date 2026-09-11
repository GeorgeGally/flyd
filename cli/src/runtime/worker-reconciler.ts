import type { WorkerSession } from "./types.js";

export type ReconciledWorkerState =
  | "healthy"
  | "waiting_external"
  | "waiting_decision"
  | "possibly_stale"
  | "interrupted"
  | "completed_unverified"
  | "failed"
  | "unknown";

export type ReconcilerAction =
  | "noop"
  | "recheck"
  | "reattach"
  | "verify"
  | "ask_flyd"
  | "ask_user"
  | "mark_interrupted";

export interface WorkerRealityObservation {
  observedAt: string;
  processAlive: boolean | null;
  processIdentityMatches: boolean | null;
  worktreeExists: boolean;
  worktreeChangedAt?: string | null;
  recentActivityAt?: string | null;
  completionReported?: boolean;
  verificationPending?: boolean;
  externalWait?: boolean;
  openDecision?: boolean;
}

export interface WorkerReconciliation {
  state: ReconciledWorkerState;
  action: ReconcilerAction;
  reason: string;
  consequential: boolean;
}

const ACTIVE_WORKER_STATUSES = new Set(["queued", "starting", "running", "stopping"]);

/**
 * Compare durable runtime expectation with independently observed reality.
 * This function is deliberately deterministic and model-free.
 */
export function reconcileWorker(
  worker: WorkerSession,
  reality: WorkerRealityObservation,
): WorkerReconciliation {
  if (reality.openDecision) {
    return {
      state: "waiting_decision",
      action: "ask_user",
      reason: "An explicit operational decision is open for this work.",
      consequential: true,
    };
  }

  if (reality.externalWait) {
    return {
      state: "waiting_external",
      action: "noop",
      reason: "Work is explicitly waiting on an external dependency.",
      consequential: false,
    };
  }

  if (worker.status === "completed") {
    return {
      state: "completed_unverified",
      action: reality.verificationPending === false ? "noop" : "verify",
      reason: "Worker completion is a claim until independent verification finishes.",
      consequential: reality.verificationPending !== false,
    };
  }

  if (worker.status === "failed" || worker.status === "cancelled") {
    return {
      state: "failed",
      action: "ask_flyd",
      reason: `Worker runtime is ${worker.status}.`,
      consequential: true,
    };
  }

  if (!ACTIVE_WORKER_STATUSES.has(worker.status)) {
    return {
      state: "unknown",
      action: "recheck",
      reason: `Worker status ${worker.status} has no active reconciliation rule.`,
      consequential: false,
    };
  }

  if (reality.processAlive === true && reality.processIdentityMatches === true) {
    return {
      state: "healthy",
      action: worker.status === "running" ? "noop" : "reattach",
      reason: "Recorded worker is backed by a live process with matching identity.",
      consequential: false,
    };
  }

  if (reality.processAlive === true && reality.processIdentityMatches !== true) {
    return {
      state: "unknown",
      action: "recheck",
      reason: "A live process exists but ownership cannot be proven.",
      consequential: false,
    };
  }

  if (reality.processAlive === null) {
    return {
      state: "possibly_stale",
      action: "recheck",
      reason: "Process liveness is currently unknown.",
      consequential: false,
    };
  }

  if (reality.processAlive === false && reality.worktreeExists) {
    return {
      state: "interrupted",
      action: "mark_interrupted",
      reason: "Worker process is gone, but its worktree survives and work can be recovered.",
      consequential: true,
    };
  }

  if (reality.processAlive === false && !reality.worktreeExists) {
    return {
      state: "interrupted",
      action: "ask_flyd",
      reason: "Worker process and worktree are both missing; recovery requires judgment.",
      consequential: true,
    };
  }

  return {
    state: "unknown",
    action: "recheck",
    reason: "Observed reality does not yet support a safe transition.",
    consequential: false,
  };
}
