import { EventEmitter } from "node:events";
import type { DelegationCompletion, DelegationEnvelope } from "./delegation.js";

/**
 * In-process bridge between the delegation HTTP endpoints (server.ts) and
 * live voice sessions (realtime-session.ts). Both run in the same process,
 * so a plain event emitter is sufficient — no new transport, no polling.
 *
 * Three event kinds, kept separate so bookkeeping never double-counts:
 * - "pending"    — a job was registered (flyd_delegate call)
 * - "completion" — a real runner accepted-and-verified completion arrived
 *                  via POST /delegation/complete
 * - "timeout"    — the pending sweep gave up waiting for a runner and
 *                  synthesized a blocked completion. Kept distinct from
 *                  "completion" so server.ts can store+meter it without
 *                  double-recording real completions.
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
const GRACE_MS = 2 * 60 * 1000;

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
    invocationId: envelope.delegationId,
    status: "blocked",
    handoff: null,
    activity: [],
    verification: null,
    blocker: "runner_timeout: no runner reported completion within the grant window",
    claimedAt: now,
  };
}

let sweepInterval: ReturnType<typeof setInterval> | null = null;

/** Sweeps pending jobs older than grant.maxRuntimeMinutes + grace; emits a synthetic blocked completion for each. */
export function startPendingSweep(intervalMs = 30_000): void {
  if (sweepInterval) return;
  sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of pendingDelegations) {
      const deadline = entry.registeredAt + entry.envelope.grant.maxRuntimeMinutes * 60_000 + GRACE_MS;
      if (now >= deadline) {
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
