import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { JobDef, JobRunAudit, JobBudgets, JobType } from './types.js';
import { DEFAULT_JOB_BUDGETS, SECRET_FIELD_PATTERN } from './types.js';

function flydRoot(): string {
  return process.env.FLYD_DIR?.trim() || join(homedir(), '.flyd');
}

export function jobsStoreDir(): string {
  return join(flydRoot(), 'work-jobs');
}

export function jobArtifactsDir(): string {
  return join(flydRoot(), 'overlay', 'job-artifacts');
}

export function jobAuditsDir(): string {
  return join(flydRoot(), 'overlay', 'job-audits');
}

function catchUpPath(): string {
  return join(jobsStoreDir(), 'catchup.json');
}

function ensureDirs(): void {
  for (const dir of [jobsStoreDir(), jobArtifactsDir(), jobAuditsDir()]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function jobPath(id: string): string {
  return join(jobsStoreDir(), `${id}.json`);
}

/** Reject JobDef JSON that embeds secret-like fields. */
export function assertNoSecretFields(raw: Record<string, unknown>, path = ''): void {
  for (const [key, value] of Object.entries(raw)) {
    const full = path ? `${path}.${key}` : key;
    if (SECRET_FIELD_PATTERN.test(key)) {
      throw new Error(`JobDef must not store secrets (field: ${full})`);
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      assertNoSecretFields(value as Record<string, unknown>, full);
    }
  }
}

export function scrubSensitiveText(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/gi, '[BASE64_REDACTED]')
    .replace(/\bAX[A-Za-z]+\b/g, '[AX_REDACTED]');
}

function validateSchedule(schedule: string): boolean {
  return /^\d{2}:\d{2}$/.test(schedule);
}

function validateSkillIds(skillIds: string[]): void {
  for (const id of skillIds) {
    if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
      throw new Error(`Invalid skillId: ${id}`);
    }
  }
}

export function createJobDef(
  input: Partial<JobDef> & { type: JobType; schedule: string },
): JobDef {
  assertNoSecretFields(input as Record<string, unknown>);
  if (!validateSchedule(input.schedule)) {
    throw new Error('schedule must be HH:MM');
  }
  const skillIds = input.skillIds ?? [];
  validateSkillIds(skillIds);
  if (input.writeMode && input.writeMode !== 'artifact') {
    throw new Error('V1 writeMode must be artifact');
  }

  const now = new Date().toISOString();
  const job: JobDef = {
    id: input.id ?? randomUUID(),
    type: input.type,
    enabled: input.enabled ?? true,
    schedule: input.schedule,
    skillIds,
    prompt: input.prompt,
    toolPolicy: input.toolPolicy ?? ['*'],
    budgets: { ...DEFAULT_JOB_BUDGETS, ...input.budgets },
    delivery: 'pull',
    writeMode: 'artifact',
    projectId: input.projectId,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };

  ensureDirs();
  writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  return job;
}

export function upsertJobDef(job: JobDef): JobDef {
  assertNoSecretFields(job as unknown as Record<string, unknown>);
  validateSkillIds(job.skillIds);
  if (!validateSchedule(job.schedule)) throw new Error('schedule must be HH:MM');
  if (job.writeMode !== 'artifact') throw new Error('V1 writeMode must be artifact');

  const updated = { ...job, updatedAt: new Date().toISOString() };
  ensureDirs();
  writeFileSync(jobPath(updated.id), JSON.stringify(updated, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  return updated;
}

export function getJob(id: string): JobDef | null {
  const path = jobPath(id);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as JobDef;
  } catch {
    return null;
  }
}

export function listJobs(): JobDef[] {
  ensureDirs();
  const jobs: JobDef[] = [];
  for (const file of readdirSync(jobsStoreDir()).filter((f) => f.endsWith('.json') && f !== 'catchup.json')) {
    try {
      jobs.push(JSON.parse(readFileSync(join(jobsStoreDir(), file), 'utf-8')) as JobDef);
    } catch {
      continue;
    }
  }
  return jobs.sort((a, b) => a.id.localeCompare(b.id));
}

export function findJobByType(type: JobType): JobDef | null {
  return listJobs().find((j) => j.type === type) ?? null;
}

export function setJobEnabled(id: string, enabled: boolean): JobDef | null {
  const job = getJob(id);
  if (!job) return null;
  return upsertJobDef({ ...job, enabled });
}

export function deleteJob(id: string): boolean {
  const path = jobPath(id);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function ensureDefaultMorningBriefingJob(projectId?: string): JobDef {
  const existing = findJobByType('morning_briefing');
  if (existing) return existing;
  return createJobDef({
    type: 'morning_briefing',
    schedule: '07:00',
    enabled: true,
    projectId,
    toolPolicy: ['*'],
    budgets: DEFAULT_JOB_BUDGETS,
  });
}

type CatchUpState = Record<string, string[]>;

function readCatchUp(): CatchUpState {
  const path = catchUpPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as CatchUpState;
  } catch {
    return {};
  }
}

function writeCatchUp(state: CatchUpState): void {
  ensureDirs();
  writeFileSync(catchUpPath(), JSON.stringify(state, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

export function hasCatchUpSlot(jobId: string, scheduleSlot: string): boolean {
  const state = readCatchUp();
  return (state[jobId] ?? []).includes(scheduleSlot);
}

export function markCatchUpSlot(jobId: string, scheduleSlot: string): void {
  const state = readCatchUp();
  const slots = new Set(state[jobId] ?? []);
  slots.add(scheduleSlot);
  state[jobId] = [...slots].sort().slice(-60);
  writeCatchUp(state);
}

export function writeJobArtifact(params: {
  jobId: string;
  runId: string;
  title: string;
  body: string;
  maxChars: number;
}): { path: string; truncated: boolean; relativePath: string } {
  ensureDirs();
  let body = scrubSensitiveText(params.body);
  let truncated = false;
  if (body.length > params.maxChars) {
    body = body.slice(0, params.maxChars - 20) + '\n\n[truncated]';
    truncated = true;
  }

  const fileName = `${params.jobId}-${params.runId}.md`;
  const absolute = join(jobArtifactsDir(), fileName);
  const content = `---
type: job_artifact
jobId: ${params.jobId}
runId: ${params.runId}
title: ${params.title}
generatedAt: ${new Date().toISOString()}
---

${body}
`;
  writeFileSync(absolute, content, { encoding: 'utf-8', mode: 0o600 });
  return {
    path: absolute,
    truncated,
    relativePath: `overlay/job-artifacts/${fileName}`,
  };
}

export function writeJobAudit(audit: JobRunAudit): void {
  ensureDirs();
  const scrubbed: JobRunAudit = {
    ...audit,
    notes: audit.notes ? scrubSensitiveText(audit.notes).slice(0, 500) : undefined,
  };
  writeFileSync(join(jobAuditsDir(), `${audit.runId}.json`), JSON.stringify(scrubbed, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

export function listJobAudits(limit = 20): JobRunAudit[] {
  ensureDirs();
  const files = readdirSync(jobAuditsDir()).filter((f) => f.endsWith('.json'));
  const audits: JobRunAudit[] = [];
  for (const file of files) {
    try {
      audits.push(JSON.parse(readFileSync(join(jobAuditsDir(), file), 'utf-8')) as JobRunAudit);
    } catch {
      continue;
    }
  }
  return audits.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
}

export function mergeBudgets(partial?: Partial<JobBudgets>): JobBudgets {
  return { ...DEFAULT_JOB_BUDGETS, ...partial };
}
