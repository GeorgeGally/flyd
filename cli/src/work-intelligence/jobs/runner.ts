import { randomUUID } from 'node:crypto';
import type { JobDef, JobRunResult, JobTool } from './types.js';
import { isJobsGloballyPaused, readPauseReason } from './controls.js';
import {
  getJob,
  findJobByType,
  listJobs,
  writeJobArtifact,
  writeJobAudit,
  hasCatchUpSlot,
  markCatchUpSlot,
  ensureDefaultMorningBriefingJob,
} from './store.js';
import { resolveEffectiveTools, isToolDeniedEvenIfListed } from './tool-policy.js';
import { composeMorningBriefing, type MorningBriefingDeps } from './jobs/morning-briefing.js';
import { readPresentModel } from '../../work/work-hypothesis/index.js';
import { readLatestCloseoutForProject } from '../work-session-closeout-store.js';

export interface RunJobOptions {
  now?: Date;
  force?: boolean;
  deps?: Partial<MorningBriefingDeps>;
  /** When true, skip catch-up slot reservation (manual force rerun). */
  skipCatchUpGuard?: boolean;
}

function localScheduleSlot(now: Date, schedule: string): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T${schedule}`;
}

function isScheduleDue(now: Date, schedule: string): boolean {
  const [hh, mm] = schedule.split(':').map(Number);
  const scheduled = new Date(now);
  scheduled.setHours(hh, mm, 0, 0);
  return now.getTime() >= scheduled.getTime();
}

function buildDeps(partial?: Partial<MorningBriefingDeps>): MorningBriefingDeps {
  return {
    readPresentModel: partial?.readPresentModel ?? (() => readPresentModel()),
    readLatestCloseoutForProject:
      partial?.readLatestCloseoutForProject ?? ((name) => readLatestCloseoutForProject(name)),
    nowMs: partial?.nowMs,
  };
}

function finish(
  result: Omit<JobRunResult, 'audit'> & { audit: JobRunResult['audit'] },
): JobRunResult {
  writeJobAudit(result.audit);
  return result;
}

export function runJob(job: JobDef, opts: RunJobOptions = {}): JobRunResult {
  const now = opts.now ?? new Date();
  const runId = randomUUID();
  const scheduleSlot = localScheduleSlot(now, job.schedule);
  const startedAt = now.toISOString();
  const toolsUsed: JobTool[] = [];

  const baseAudit = {
    runId,
    jobId: job.id,
    scheduleSlot,
    startedAt,
    finishedAt: startedAt,
    status: 'failed' as const,
    toolsUsed,
  };

  if (isJobsGloballyPaused()) {
    return finish({
      ok: false,
      status: 'skipped',
      error: readPauseReason() ?? 'jobs paused',
      audit: {
        ...baseAudit,
        finishedAt: new Date().toISOString(),
        status: 'skipped',
        reason: readPauseReason() ?? 'jobs paused',
      },
    });
  }

  if (!job.enabled && !opts.force) {
    return finish({
      ok: false,
      status: 'skipped',
      error: 'job disabled',
      audit: {
        ...baseAudit,
        finishedAt: new Date().toISOString(),
        status: 'skipped',
        reason: 'job disabled',
      },
    });
  }

  if (!opts.force && !opts.skipCatchUpGuard && hasCatchUpSlot(job.id, scheduleSlot)) {
    return finish({
      ok: false,
      status: 'skipped',
      error: 'catch-up already recorded for schedule slot',
      audit: {
        ...baseAudit,
        finishedAt: new Date().toISOString(),
        status: 'skipped',
        reason: 'catch-up already recorded for schedule slot',
      },
    });
  }

  // Fail closed if JobDef lists denied tools as if they were available — still refuse them.
  for (const tool of job.toolPolicy) {
    if (tool !== '*' && isToolDeniedEvenIfListed(tool as JobTool)) {
      // listed but denied — runner continues with effective intersection only
    }
  }

  const wallStart = Date.now();
  const deps = buildDeps({ ...opts.deps, nowMs: opts.deps?.nowMs ?? now.getTime() });

  if (job.type !== 'morning_briefing') {
    return finish({
      ok: false,
      status: 'failed',
      error: `Unsupported job type: ${job.type}`,
      audit: {
        ...baseAudit,
        finishedAt: new Date().toISOString(),
        status: 'failed',
        reason: `Unsupported job type: ${job.type}`,
      },
    });
  }

  const composed = composeMorningBriefing(job, deps);
  toolsUsed.push(...composed.toolsUsed);

  if (Date.now() - wallStart > job.budgets.maxWallClockMs) {
    const artifact = writeJobArtifact({
      jobId: job.id,
      runId,
      title: 'Morning briefing (incomplete)',
      body: `Budget exceeded (wall clock).\n\nPartial error: ${composed.error ?? 'n/a'}`,
      maxChars: job.budgets.maxArtifactChars,
    });
    if (!opts.skipCatchUpGuard) markCatchUpSlot(job.id, scheduleSlot);
    return finish({
      ok: false,
      status: 'incomplete',
      artifactPath: artifact.relativePath,
      error: 'maxWallClockMs exceeded',
      audit: {
        ...baseAudit,
        finishedAt: new Date().toISOString(),
        status: 'incomplete',
        reason: 'maxWallClockMs exceeded',
        artifactPath: artifact.relativePath,
        toolsUsed,
      },
    });
  }

  if (!composed.ok || !composed.markdown) {
    const artifact = writeJobArtifact({
      jobId: job.id,
      runId,
      title: 'Morning briefing (failed)',
      body: `Fail-closed: ${composed.error ?? 'compose failed'}`,
      maxChars: job.budgets.maxArtifactChars,
    });
    if (!opts.skipCatchUpGuard) markCatchUpSlot(job.id, scheduleSlot);
    return finish({
      ok: false,
      status: 'failed',
      artifactPath: artifact.relativePath,
      error: composed.error,
      audit: {
        ...baseAudit,
        finishedAt: new Date().toISOString(),
        status: 'failed',
        reason: composed.error,
        artifactPath: artifact.relativePath,
        toolsUsed,
      },
    });
  }

  const artifact = writeJobArtifact({
    jobId: job.id,
    runId,
    title: `Morning briefing — ${composed.projectName}`,
    body: composed.markdown,
    maxChars: job.budgets.maxArtifactChars,
  });

  if (!opts.skipCatchUpGuard) markCatchUpSlot(job.id, scheduleSlot);

  const status = artifact.truncated ? 'incomplete' : 'completed';
  return finish({
    ok: status === 'completed',
    status,
    artifactPath: artifact.relativePath,
    error: artifact.truncated ? 'artifact truncated to budget' : undefined,
    audit: {
      ...baseAudit,
      finishedAt: new Date().toISOString(),
      status,
      reason: artifact.truncated ? 'artifact truncated to budget' : undefined,
      artifactPath: artifact.relativePath,
      toolsUsed: resolveEffectiveTools(job).filter((t) => toolsUsed.includes(t)),
      notes: `effectiveTools=${resolveEffectiveTools(job).join(',')}`,
    },
  });
}

export function runJobById(id: string, opts: RunJobOptions = {}): JobRunResult {
  const job = getJob(id);
  if (!job) {
    const runId = randomUUID();
    const audit = {
      runId,
      jobId: id,
      scheduleSlot: 'n/a',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'failed' as const,
      reason: 'job not found',
      toolsUsed: [] as JobTool[],
    };
    writeJobAudit(audit);
    return { ok: false, status: 'failed', error: 'job not found', audit };
  }
  return runJob(job, { ...opts, force: true, skipCatchUpGuard: true });
}

export function runMorningBriefing(opts: RunJobOptions & { projectId?: string } = {}): JobRunResult {
  const job = ensureDefaultMorningBriefingJob(opts.projectId);
  const withProject =
    opts.projectId && !job.projectId
      ? { ...job, projectId: opts.projectId }
      : job;
  return runJob(withProject, { ...opts, force: true, skipCatchUpGuard: true });
}

export function runDueJobs(opts: RunJobOptions = {}): JobRunResult[] {
  const now = opts.now ?? new Date();
  const results: JobRunResult[] = [];
  for (const job of listJobs()) {
    if (!job.enabled) continue;
    if (!isScheduleDue(now, job.schedule)) continue;
    results.push(runJob(job, { ...opts, now }));
  }
  return results;
}

export function getMorningBriefingJob(): JobDef | null {
  return findJobByType('morning_briefing');
}
