import type { Pool } from "pg";
import { OperationalDecisionStore } from "./operational-decision-store.js";
import { PostgresTaskStore } from "./task-store.js";
import { superviseProject } from "./project-supervisor.js";
import { finalizeDetachedProject } from "./detached-finalizer.js";
import type { AgentTask } from "./types.js";

const ACTIVE_TASK_STATUSES = new Set(["awaiting_grant", "ready", "running", "blocked"]);
const DEFAULT_INTERVAL_MS = 15_000;

export interface ContinuousSupervisorOptions {
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

export interface ContinuousSupervisor {
  runOnce(): Promise<void>;
  stop(): void;
}

export interface SupervisorSweepDependencies {
  listTasks(): Promise<AgentTask[]>;
  superviseProject(projectRoot: string): Promise<unknown>;
  finalizeProject?(projectRoot: string): Promise<unknown>;
}

export async function runSupervisorSweep(deps: SupervisorSweepDependencies): Promise<string[]> {
  const tasks = await deps.listTasks();
  const roots = [...new Set(tasks
    .filter((task) => ACTIVE_TASK_STATUSES.has(task.status))
    .map((task) => task.projectRoot)
    .filter(Boolean))];

  for (const root of roots) {
    await deps.superviseProject(root);
    if (deps.finalizeProject) await deps.finalizeProject(root);
  }
  return roots;
}

/**
 * Continuously reconcile durable execution state with process/worktree reality,
 * then recover detached completions through the normal verification/integration
 * machinery. The loop is deterministic and model-free and never overlaps sweeps.
 */
export function startContinuousSupervisor(
  pool: Pool,
  options: ContinuousSupervisorOptions = {},
): ContinuousSupervisor {
  const taskStore = new PostgresTaskStore(pool);
  const decisionStore = new OperationalDecisionStore(pool);
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let stopped = false;
  let running = false;

  const runOnce = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      await runSupervisorSweep({
        listTasks: () => taskStore.listTasks(undefined, 200),
        superviseProject: (projectRoot) => superviseProject(projectRoot, { taskStore, decisionStore }),
        finalizeProject: (projectRoot) => finalizeDetachedProject(pool, projectRoot),
      });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void runOnce().catch((error) => options.onError?.(error));
  }, intervalMs);
  timer.unref?.();

  void runOnce().catch((error) => options.onError?.(error));

  return {
    runOnce,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
