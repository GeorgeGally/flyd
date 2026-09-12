import type { Pool } from "pg";
import { OperationalDecisionStore } from "../runtime/operational-decision-store.js";
import { PostgresTaskStore } from "../runtime/task-store.js";
import { observeWorkerReality } from "../runtime/worker-supervisor.js";
import { reconcileWorker } from "../runtime/worker-reconciler.js";
import { readRuntimeAwarePresent } from "./present-runtime-reader.js";
import { readPresentModel } from "./work-hypothesis/index.js";
import type { WorkHypothesis } from "./work-hypothesis/types.js";

/**
 * Compose the persisted work hypothesis with canonical runtime facts and
 * read-only worker observations. This function never mutates runtime state.
 */
export async function readCanonicalPresent(pool: Pool): Promise<WorkHypothesis | null> {
  const base = readPresentModel();
  if (!base) return null;

  const decisionStore = new OperationalDecisionStore(pool);
  const taskStore = new PostgresTaskStore(pool);
  const decisionFacts = await decisionStore.listOpenDecisionFacts();
  const decisionTaskIds = new Set(decisionFacts.map((fact) => fact.decision.taskId));

  const roots = [...new Set([
    ...base.primaryThreads.map((thread) => thread.root),
    ...base.secondaryThreads.map((thread) => thread.root),
    ...decisionFacts.map((fact) => fact.projectRoot),
  ].filter(Boolean))];

  const workerGroups = await Promise.all(roots.map(async (root) => ({
    root,
    workers: await taskStore.liveWorkers(root),
  })));

  const workerObservations = workerGroups.flatMap(({ root, workers }) => workers.map((worker) => {
    const observed = observeWorkerReality(worker);
    const reconciliation = reconcileWorker(worker, {
      ...observed,
      openDecision: decisionTaskIds.has(worker.agentTaskId),
    });
    return {
      workerKey: worker.workerKey,
      taskId: worker.agentTaskId,
      projectRoot: root,
      observedAt: observed.observedAt,
      reconciliation,
    };
  }));

  return readRuntimeAwarePresent({
    readBasePresent: () => base,
    listOpenDecisionFacts: async () => decisionFacts,
    listWorkerObservations: async () => workerObservations,
  });
}
