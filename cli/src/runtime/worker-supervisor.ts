import { existsSync } from "fs";
import { reconcileWorker, type WorkerRealityObservation, type WorkerReconciliation } from "./worker-reconciler.js";
import { processIsAlive, workerProcessIsAlive } from "./recovery.js";
import type { WorkerSession } from "./types.js";

export interface WorkerSupervisorStore {
  transitionWorker(workerKey: string, update: {
    status: "running" | "interrupted";
    processId?: number | null;
    processGroupId?: number | null;
    processIdentity?: string | null;
    error?: string;
    idempotencyKey: string;
  }): Promise<WorkerSession>;
  observeWorker?(workerKey: string): Promise<void>;
}

export interface SuperviseWorkerInput {
  worker: WorkerSession;
  store: WorkerSupervisorStore;
  openDecision?: boolean;
  externalWait?: boolean;
  verificationPending?: boolean;
  observeReality?: (worker: WorkerSession) => WorkerRealityObservation;
}

export interface SuperviseWorkerResult {
  reconciliation: WorkerReconciliation;
  mutated: boolean;
}

export interface SuperviseWorkersResult {
  mutated: number;
  results: Array<{ workerKey: string; result: SuperviseWorkerResult }>;
}

export function observeWorkerReality(worker: WorkerSession): WorkerRealityObservation {
  const rawProcessAlive = worker.processId ? processIsAlive(worker.processId) : false;
  const identityMatches = rawProcessAlive ? workerProcessIsAlive(worker) : false;

  return {
    observedAt: new Date().toISOString(),
    processAlive: rawProcessAlive,
    processIdentityMatches: rawProcessAlive ? identityMatches : false,
    worktreeExists: existsSync(worker.workingDirectory),
  };
}

/**
 * Execute only deterministic, authority-preserving reconciliation actions.
 * Judgment actions (ask_user / ask_flyd / verify) are surfaced to callers and
 * never silently converted into mutations here.
 */
export async function superviseWorker(input: SuperviseWorkerInput): Promise<SuperviseWorkerResult> {
  const observed = (input.observeReality ?? observeWorkerReality)(input.worker);
  const reality: WorkerRealityObservation = {
    ...observed,
    openDecision: input.openDecision ?? observed.openDecision,
    externalWait: input.externalWait ?? observed.externalWait,
    verificationPending: input.verificationPending ?? observed.verificationPending,
  };
  const reconciliation = reconcileWorker(input.worker, reality);

  if (reconciliation.action === "noop") {
    if (reconciliation.state === "healthy" && input.store.observeWorker) {
      await input.store.observeWorker(input.worker.workerKey);
    }
    return { reconciliation, mutated: false };
  }

  if (reconciliation.action === "reattach") {
    await input.store.transitionWorker(input.worker.workerKey, {
      status: "running",
      processId: input.worker.processId,
      processGroupId: input.worker.processGroupId ?? null,
      processIdentity: input.worker.processIdentity,
      idempotencyKey: `worker-reconcile:${input.worker.workerKey}:reattach:${input.worker.processIdentity ?? input.worker.processId ?? "unknown"}`,
    });
    return { reconciliation, mutated: true };
  }

  if (reconciliation.action === "mark_interrupted") {
    await input.store.transitionWorker(input.worker.workerKey, {
      status: "interrupted",
      error: reconciliation.reason,
      idempotencyKey: `worker-reconcile:${input.worker.workerKey}:interrupted:${input.worker.processIdentity ?? input.worker.processId ?? "unknown"}`,
    });
    return { reconciliation, mutated: true };
  }

  return { reconciliation, mutated: false };
}

export async function superviseWorkers(input: {
  workers: WorkerSession[];
  store: WorkerSupervisorStore;
  openDecisionTaskIds?: ReadonlySet<string>;
  observeReality?: (worker: WorkerSession) => WorkerRealityObservation;
}): Promise<SuperviseWorkersResult> {
  const results: SuperviseWorkersResult["results"] = [];
  let mutated = 0;

  for (const worker of input.workers) {
    const result = await superviseWorker({
      worker,
      store: input.store,
      openDecision: input.openDecisionTaskIds?.has(worker.agentTaskId) ?? false,
      observeReality: input.observeReality,
    });
    if (result.mutated) mutated += 1;
    results.push({ workerKey: worker.workerKey, result });
  }

  return { mutated, results };
}
