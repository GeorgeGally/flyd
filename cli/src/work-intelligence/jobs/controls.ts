import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function flydRoot(): string {
  return process.env.FLYD_DIR?.trim() || join(homedir(), '.flyd');
}

export function jobsControlDir(): string {
  return join(flydRoot(), 'work-jobs');
}

export function jobsPausePath(): string {
  return join(jobsControlDir(), 'PAUSE');
}

export function jobsKillPath(): string {
  return join(jobsControlDir(), 'KILL');
}

function ensureControlDir(): void {
  const dir = jobsControlDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function isJobsGloballyPaused(): boolean {
  return existsSync(jobsPausePath()) || existsSync(jobsKillPath());
}

export function pauseJobs(): void {
  ensureControlDir();
  writeFileSync(jobsPausePath(), new Date().toISOString(), { encoding: 'utf-8', mode: 0o600 });
}

export function resumeJobs(): void {
  const path = jobsPausePath();
  if (existsSync(path)) unlinkSync(path);
}

export function killJobs(): void {
  ensureControlDir();
  writeFileSync(jobsKillPath(), new Date().toISOString(), { encoding: 'utf-8', mode: 0o600 });
}

export function clearKillJobs(): void {
  const path = jobsKillPath();
  if (existsSync(path)) unlinkSync(path);
}

export function readPauseReason(): string | null {
  if (existsSync(jobsKillPath())) return 'global KILL file present';
  if (existsSync(jobsPausePath())) {
    try {
      return `paused since ${readFileSync(jobsPausePath(), 'utf-8').trim()}`;
    } catch {
      return 'paused';
    }
  }
  return null;
}
