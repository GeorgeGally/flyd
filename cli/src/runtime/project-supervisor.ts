import type { OperationalDecisionStore } from "./operational-decision-store.js";
import type { PostgresTaskStore } from "./task-store.js";
import { superviseWorkers, type SuperviseWorkersResult } from "./worker-supervisor.js";
import type { WorkerRealityObservation } from "./worker-reconciler.js";
import type { WorkerSession } from "./types.js";

export interface ProjectSupervisorDependencies {
  taskStore: Pick<PostgresTaskStore, "liveWorkers" | "transitionWorker" | "observeWorker">;
  decisionStore: Pick<OperationalDecisionStore, "listOpenDecisionRecords">;
  observeReality?: (worker: WorkerSession) => WorkerRealityObservation;
}

/**
 * Reconcile one project's durable execution state with current observable reality.
 * Open decisions are facts from the runtime event stream and take precedence over
 * routine worker health. The pass is deterministic and does not invoke a model.
 */
export async function superviseProject(
  projectRoot: string,
  deps: ProjectSupervisorDependencies,
): Promise<SuperviseWorkersResult> {
  const [workers, decisions] = await Promise.all([
    deps.taskStore.liveWorkers(projectRoot),
    deps.decisionStore.listOpenDecisionRecords(projectRoot),
  ]);

  const openDecisionTaskIds = new Set(decisions.map((decision) => decision.taskId));
  return superviseWorkers({
    workers,
    store: deps.taskStore,
    openDecisionTaskIds,
    observeReality: deps.observeReality,
  });
}
