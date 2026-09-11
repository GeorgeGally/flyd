import { EventEmitter } from "node:events";
import type { DelegationCompletion, DelegationEnvelope } from "./delegation.js";

/**
 * Legacy in-process bridge for the dormant delegation HTTP path.
 *
 * This bridge is compatibility-only. It does not own execution authority,
 * grants, worker deadlines, verification, or completion state. Those belong to
 * the canonical runtime task system.
 */

type Listener<T> = (payload: T) => void;

class TypedDelegationEmitter {
  private readonly emitter = new EventEmitter();

  onPending(listener: Listener<DelegationEnvelope>): void {
    this.emitter.on("pending", listener);
  }
  offPending(listener: Listener<DelegationEnvelope>): void {
    this.emitter.off("pending", listener);
  }
  emitPending(envelope: DelegationEnvelope): void {
    this.emitter.emit("pending", envelope);
  }

  onCompletion(listener: Listener<DelegationCompletion>): void {
    this.emitter.on("completion", listener);
  }
  offCompletion(listener: Listener<DelegationCompletion>): void {
    this.emitter.off("completion", listener);
  }
  emitCompletion(completion: DelegationCompletion): void {
    this.emitter.emit("completion", completion);
  }

  onTimeout(listener: Listener<DelegationCompletion>): void {
    this.emitter.on("timeout", listener);
  }
  offTimeout(listener: Listener<DelegationCompletion>): void {
    this.emitter.off("timeout", listener);
  }
  emitTimeout(completion: DelegationCompletion): void {
    this.emitter.emit("timeout", completion);
  }

  listenerCount(event: "pending" | "completion" | "timeout"): number {
    return this.emitter.listenerCount(event);
  }
}

export const delegationEvents = new TypedDelegationEmitter();

const pendingDelegations = new Map<string, { envelope: DelegationEnvelope; registeredAt: number }>();

/**
 * Fixed compatibility timeout for a path that has no execution authority.
 * Canonical worker/runtime deadlines must come from TaskGrant instead.
 */
export const LEGACY_PENDING_TIMEOUT_MS = 12 * 60 * 1000;

export function registerPendingDelegation(envelope: DelegationEnvelope): void {
  pendingDelegations.set(envelope.delegationId, { envelope, registeredAt: Date.now() });
  delegationEvents.emitPending(envelope);
}

export function listPendingDelegations(): DelegationEnvelope[] {
  return [...pendingDelegations.values()].map((entry) => entry.envelope);
}

export function clearPendingDelegation(delegationId: string): void {
  pendingDelegations.delete(delegationId);
}

function synthesizeTimeoutCompletion(envelope: DelegationEnvelope): DelegationCompletion {
  const now = new Date().toISOString();
  return {
    delegationId: envelope.delegationId,
    invocationId: envelope.invocationId ?? envelope.delegationId,
    status: "blocked",
    handoff: null,
    activity: [],
    verification: null,
    blocker: "legacy_runner_timeout: compatibility runner did not report completion",
    claimedAt: now,
  };
}

let sweepInterval: ReturnType<typeof setInterval> | null = null;

/** Sweep only the legacy pending bridge; this is not a worker/runtime deadline. */
export function startPendingSweep(intervalMs = 30_000): void {
  if (sweepInterval) return;
  sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of pendingDelegations) {
      if (now - entry.registeredAt >= LEGACY_PENDING_TIMEOUT_MS) {
        pendingDelegations.delete(id);
        delegationEvents.emitTimeout(synthesizeTimeoutCompletion(entry.envelope));
      }
    }
  }, intervalMs);
  sweepInterval.unref?.();
}

export function stopPendingSweep(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
}

/** Test-only: clears all pending state so suites don't leak across files. */
export function resetDelegationEventsForTests(): void {
  pendingDelegations.clear();
  stopPendingSweep();
}
