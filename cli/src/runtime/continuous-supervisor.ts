import type { Pool } from "pg";
import { OperationalDecisionStore } from "./operational-decision-store.js";
import { PostgresTaskStore } from "./task-store.js";
import { superviseProject } from "./project-supervisor.js";

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

/**
 * Continuously reconcile durable execution state with process/worktree reality.
 * The loop is deterministic and model-free. It only visits repositories that
 * currently own active runtime tasks, and it never overlaps sweeps.
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
      const tasks = await taskStore.listTasks(undefined, 200);
      const roots = [...new Set(tasks
        .filter((task) => ACTIVE_TASK_STATUSES.has(task.status))
        .map((task) => task.projectRoot)
        .filter(Boolean))];

      for (const root of roots) {
        await superviseProject(root, { taskStore, decisionStore });
      }
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
