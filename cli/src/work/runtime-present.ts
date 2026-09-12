import type { Pool } from "pg";
import { OperationalDecisionStore } from "../runtime/operational-decision-store.js";
import { PostgresTaskStore } from "../runtime/task-store.js";
import { observeWorkerReality } from "../runtime/worker-supervisor.js";
import { reconcileWorker } from "../runtime/worker-reconciler.js";
import { attachRuntimeTasks } from "./present-runtime-tasks.js";
import { readRuntimeAwarePresent } from "./present-runtime-reader.js";
import { readPresentModel } from "./work-hypothesis/index.js";
import type { RuntimeAwarePresent } from "./runtime-present-types.js";

const ACTIVE_TASK_STATUSES = new Set(["awaiting_grant", "ready", "running", "blocked"]);

/**
 * Compose the persisted work hypothesis with canonical runtime facts and
 * read-only worker observations. This function never mutates runtime state.
 */
export async function readCanonicalPresent(pool: Pool): Promise<RuntimeAwarePresent | null> {
  const base = readPresentModel();
  if (!base) return null;

  const decisionStore = new OperationalDecisionStore(pool);
  const taskStore = new PostgresTaskStore(pool);
  const [decisionFacts, recentRuntimeTasks] = await Promise.all([
    decisionStore.listOpenDecisionFacts(),
    taskStore.listTasks(undefined, 50),
  ]);
  const activeRuntimeTasks = recentRuntimeTasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status));
  const decisionTaskIds = new Set(decisionFacts.map((fact) => fact.decision.taskId));

  const roots = [...new Set([
    ...base.primaryThreads.map((thread) => thread.root),
    ...base.secondaryThreads.map((thread) => thread.root),
    ...decisionFacts.map((fact) => fact.projectRoot),
    ...activeRuntimeTasks.map((task) => task.projectRoot),
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

  const runtimeAware = await readRuntimeAwarePresent({
    readBasePresent: () => base,
    listOpenDecisionFacts: async () => decisionFacts,
    listWorkerObservations: async () => workerObservations,
  });
  if (!runtimeAware) return null;

  return attachRuntimeTasks(runtimeAware, activeRuntimeTasks);
}
