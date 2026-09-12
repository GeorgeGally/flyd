import type { WorkerReconciliation } from "../runtime/worker-reconciler.js";
import type { PresentWorkerObservation, WorkHypothesis } from "./work-hypothesis/types.js";

export interface RuntimeWorkerObservationFact {
  workerKey: string;
  taskId: string;
  projectRoot: string;
  observedAt: string;
  reconciliation: WorkerReconciliation;
}

/**
 * Attach read-only worker observations to Present. These are observations of
 * runtime reality, not durable facts or inferred beliefs.
 */
export function attachWorkerObservations(
  present: WorkHypothesis,
  observations: RuntimeWorkerObservationFact[],
): WorkHypothesis {
  const workerObservations: PresentWorkerObservation[] = observations.map((observation) => ({
    epistemicClass: "observation",
    workerKey: observation.workerKey,
    taskId: observation.taskId,
    projectRoot: observation.projectRoot,
    state: observation.reconciliation.state,
    action: observation.reconciliation.action,
    reason: observation.reconciliation.reason,
    observedAt: observation.observedAt,
    consequential: observation.reconciliation.consequential,
  }));

  return {
    ...present,
    workerObservations,
    evidenceRefs: [
      ...present.evidenceRefs,
      ...workerObservations.map((worker) => `worker-observation:${worker.workerKey}:${worker.observedAt}`),
    ],
  };
}
