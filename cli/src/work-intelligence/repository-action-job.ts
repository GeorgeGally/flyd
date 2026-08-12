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

export class RepositoryActionJobStore<T = unknown> {
  private readonly jobs = new Map<string, RepositoryActionJobSnapshot<T>>();
  private readonly maxRetainedJobs: number;
  private readonly deadlineMs: number;

  constructor(maxRetainedJobs = 100, deadlineMs = 3 * 60 * 60 * 1000) {
    this.maxRetainedJobs = maxRetainedJobs;
    this.deadlineMs = deadlineMs;
  }

  start(jobId: string, work: () => Promise<T>, now = Date.now()): StartedRepositoryActionJob<T> {
    if (this.jobs.has(jobId)) throw new Error(`Repository action job already exists: ${jobId}`);
    this.trimCompletedJobs();
    const deadlineAt = new Date(now + this.deadlineMs).toISOString();
    const running: RepositoryActionJobSnapshot<T> = { jobId, status: 'running', deadlineAt };
    this.jobs.set(jobId, running);
    const completion = work().then(
      result => { this.jobs.set(jobId, { jobId, status: 'completed', deadlineAt, result }); },
      error => { this.jobs.set(jobId, { jobId, status: 'failed', deadlineAt, error: error instanceof Error ? error.message : String(error) }); },
    );
    return { ...running, completion };
  }

  get(jobId: string): RepositoryActionJobSnapshot<T> | null {
    return this.jobs.get(jobId) ?? null;
  }

  private trimCompletedJobs(): void {
    while (this.jobs.size >= this.maxRetainedJobs) {
      const candidate = [...this.jobs.entries()].find(([, job]) => job.status !== 'running');
      if (!candidate) throw new Error('Too many repository actions are currently running');
      this.jobs.delete(candidate[0]);
    }
  }
}
