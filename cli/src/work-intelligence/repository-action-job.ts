import { createRuntimePool, runtimeDatabaseUrl } from "../runtime/database.js";
import {
  PostgresRunStore,
  type AgentRun,
} from "../runtime/run-store.js";

export type RepositoryActionJobStatus = 'running' | 'completed' | 'failed';

export interface RepositoryActionJobSnapshot<T> {
  jobId: string;
  status: RepositoryActionJobStatus;
  deadlineAt: string;
  result?: T;
  error?: string;
}

export interface StartedRepositoryActionJob<T> extends RepositoryActionJobSnapshot<T> {
  completion: Promise<void>;
}

const RUN_KIND = "repository_action";
const PRINCIPAL = { kind: "system" as const, id: "core" };

/**
 * Repository-action jobs as durable runs. Status and terminal results
 * survive Core restarts; a job interrupted by process death is failed at
 * the next boot instead of vanishing. Execution itself stays in-process:
 * park/resume for approvals is layered on agent_runs by consumers.
 *
 * Durable mode is opt-in ({ durable: true }) because GUI-launched Core may
 * run without Postgres; every persistence failure degrades to plain
 * in-memory behavior rather than breaking job execution.
 */
export class RepositoryActionJobStore<T = unknown> {
  private readonly jobs = new Map<string, RepositoryActionJobSnapshot<T>>();
  private readonly maxRetainedJobs: number;
  private readonly deadlineMs: number;
  private readonly durable: boolean;
  private readonly databaseUrl: string;
  private runStorePromise: Promise<PostgresRunStore | null> | null = null;

  constructor(options: { maxRetainedJobs?: number; deadlineMs?: number; durable?: boolean; databaseUrl?: string } = {}) {
    this.maxRetainedJobs = options.maxRetainedJobs ?? 100;
    this.deadlineMs = options.deadlineMs ?? 3 * 60 * 60 * 1000;
    this.durable = options.durable ?? false;
    this.databaseUrl = options.databaseUrl ?? runtimeDatabaseUrl();
  }

  /** Lazily connect; an unreachable database disables durability for good. */
  private ensureRunStore(): Promise<PostgresRunStore | null> {
    if (!this.durable) return Promise.resolve(null);
    if (!this.runStorePromise) {
      const pool = createRuntimePool(this.databaseUrl, { connectionTimeoutMillis: 1_500 });
      const store = new PostgresRunStore(pool);
      this.runStorePromise = store.ensureSchema().then(() => store).catch(() => {
        void pool.end().catch(() => undefined);
        return null;
      });
    }
    return this.runStorePromise;
  }

  async start(jobId: string, work: () => Promise<T>, now = Date.now()): Promise<StartedRepositoryActionJob<T>> {
    if (this.jobs.has(jobId)) throw new Error(`Repository action job already exists: ${jobId}`);
    this.trimCompletedJobs();
    const deadlineAt = new Date(now + this.deadlineMs).toISOString();
    const running: RepositoryActionJobSnapshot<T> = { jobId, status: 'running', deadlineAt };
    this.jobs.set(jobId, running);

    let runKey: string | null = null;
    const store = await this.ensureRunStore();
    if (store) {
      try {
        const run = await store.createRun({
          principal: PRINCIPAL,
          kind: RUN_KIND,
          checkpoint: { jobId, deadlineAt },
          runKey: jobId,
        });
        runKey = run.runKey;
      } catch {
        // duplicate or unreachable — keep executing, stay memory-only
        runKey = null;
      }
    }

    const completion = work().then(
      async result => {
        this.jobs.set(jobId, { jobId, status: 'completed', deadlineAt, result });
        if (runKey && store) {
          await this.finishRun(store, jobId, "completed", { result });
        }
      },
      async error => {
        const message = error instanceof Error ? error.message : String(error);
        this.jobs.set(jobId, { jobId, status: 'failed', deadlineAt, error: message });
        if (runKey && store) {
          await this.finishRun(store, jobId, "failed", null, message);
        }
      },
    );
    return { ...running, completion };
  }

  /**
   * Job status after this process may have restarted: reads through to the
   * durable run when the in-memory retention window no longer has it.
   */
  async get(jobId: string): Promise<RepositoryActionJobSnapshot<T> | null> {
    const local = this.jobs.get(jobId);
    if (local) return local;
    const store = await this.ensureRunStore();
    if (!store) return null;
    try {
      const run = await store.getRun(jobId);
      if (!run || run.kind !== RUN_KIND) return null;
      return this.snapshotFromRun<T>(run);
    } catch {
      return null;
    }
  }

  /**
   * Boot-time recovery: runs still 'running' belong to a dead process.
   * Parked runs are untouched — waiting is what survives restarts.
   * Returns how many interrupted runs were failed.
   */
  async recoverInterrupted(): Promise<number> {
    const store = await this.ensureRunStore();
    if (!store) return 0;
    try {
      return await store.failRunningByKind(RUN_KIND, "Interrupted by Core restart");
    } catch {
      return 0;
    }
  }

  private async finishRun(
    store: PostgresRunStore,
    jobId: string,
    status: "completed" | "failed",
    result: Record<string, unknown> | null,
    error?: string
  ): Promise<void> {
    try {
      const run = await store.getRun(jobId);
      if (!run || run.status !== "running") return;
      if (status === "completed") await store.complete(jobId, run.revision, result ?? {});
      else await store.fail(jobId, run.revision, error ?? "failed");
    } catch {
      // durability is best-effort around execution — never throw into work()
    }
  }

  private snapshotFromRun<U>(run: AgentRun): RepositoryActionJobSnapshot<U> | null {
    const deadlineAt = (run.checkpoint?.deadlineAt as string) ?? "";
    if (run.status === "running") {
      // A durable row still 'running' past its deadline never finished — its
      // terminal write was lost (mid-flight DB failure). Fail it honestly.
      if (deadlineAt && Date.parse(deadlineAt) < Date.now()) {
        return { jobId: run.runKey, status: "failed", deadlineAt, error: "Job deadline passed without a terminal record" };
      }
      return { jobId: run.runKey, status: "running", deadlineAt };
    }
    if (run.status === "completed" || run.status === "failed") {
      return {
        jobId: run.runKey,
        status: run.status,
        deadlineAt,
        ...(run.status === "completed"
          ? { result: (run.result?.result as U) ?? undefined }
          : { error: run.error ?? undefined }),
      };
    }
    return null;
  }

  private trimCompletedJobs(): void {
    while (this.jobs.size >= this.maxRetainedJobs) {
      const candidate = [...this.jobs.entries()].find(([, job]) => job.status !== 'running');
      if (!candidate) throw new Error('Too many repository actions are currently running');
      this.jobs.delete(candidate[0]);
    }
  }
}
