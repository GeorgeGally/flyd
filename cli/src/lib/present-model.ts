import type { RepositorySnapshot } from "../runtime/types.js";
import type { RecentCommit } from "./recent-commits.js";

export interface PresentModelActiveTask {
  taskKey: string;
  projectName: string;
  status: string;
  intendedOutcome: string;
  updatedAt: string;
}

export interface PresentModel {
  generatedAt: string;
  repository: RepositorySnapshot | null;
  activeTask: PresentModelActiveTask | null;
  recentCommits: RecentCommit[];
  gaps: string[];
}

export interface PresentModelDependencies {
  inspectRepository: (cwd: string) => Promise<RepositorySnapshot>;
  findActiveTask: (projectRoot: string | null) => Promise<PresentModelActiveTask | null>;
  getRecentCommits: (root: string, limit: number) => Promise<RecentCommit[]>;
  now: () => Date;
}

const PRESENT_MODEL_TIMEOUT_MS = 1500;

async function defaultFindActiveTask(projectRoot: string | null): Promise<PresentModelActiveTask | null> {
  const { createRuntimePool } = await import("../runtime/database.js");
  const { PostgresTaskStore } = await import("../runtime/task-store.js");

  const pool = createRuntimePool(undefined, { connectionTimeoutMillis: 1000 });
  try {
    const store = new PostgresTaskStore(pool);
    const task = projectRoot
      ? await store.findResumableTask(projectRoot)
      : (await store.listTasks(undefined, 1))[0] ?? null;
    if (!task) return null;
    return {
      taskKey: task.taskKey,
      projectName: task.projectName,
      status: task.status,
      intendedOutcome: task.intendedOutcome,
      updatedAt: task.updatedAt,
    };
  } finally {
    // Callers (ask.ts, and every bridge invocation) are short-lived,
    // per-invocation processes — a leaked pool connection here would stall
    // every subsequent query, not just this one.
    await pool.end().catch(() => {});
  }
}

const defaultDependencies: PresentModelDependencies = {
  inspectRepository: async (cwd) => {
    const { inspectRepository } = await import("../runtime/repository-inspector.js");
    return inspectRepository(cwd);
  },
  findActiveTask: defaultFindActiveTask,
  getRecentCommits: async (root, limit) => {
    const { getRecentCommits } = await import("./recent-commits.js");
    return getRecentCommits(root, limit);
  },
  now: () => new Date(),
};

export async function buildPresentModel(
  cwd: string = process.cwd(),
  deps: PresentModelDependencies = defaultDependencies,
  commitLimit = 5,
  projectRoot?: string,
): Promise<PresentModel> {
  const workingDir = projectRoot ?? cwd;
  const gaps: string[] = [];

  let repository: RepositorySnapshot | null = null;
  try {
    repository = await deps.inspectRepository(workingDir);
  } catch {
    gaps.push("repository_state_unavailable");
  }

  // A legitimate "no active task" result is not a gap — only failure/timeout is.
  let activeTask: PresentModelActiveTask | null = null;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("present_model_task_timeout")), PRESENT_MODEL_TIMEOUT_MS);
      timer.unref?.();
    });
    activeTask = await Promise.race([deps.findActiveTask(repository?.root ?? null), timeout]);
  } catch {
    gaps.push("task_state_unavailable");
  }

  let recentCommits: RecentCommit[] = [];
  if (repository) {
    try {
      recentCommits = await deps.getRecentCommits(repository.root, commitLimit);
    } catch {
      gaps.push("recent_commits_unavailable");
    }
  }

  return {
    generatedAt: deps.now().toISOString(),
    repository,
    activeTask,
    recentCommits,
    gaps,
  };
}
