import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FLYD_DIR } from '../lib/config.js';

export type PatternEpistemicStatus = 'correction' | 'inferred' | 'checkin' | 'external';

export interface CoachGoal {
  id: string;
  statement: string;
  status: 'active' | 'archived';
  adjustedAt: string;
  source: string;
}

export interface CoachPattern {
  id: string;
  observation: string;
  confidence: number;
  epistemicStatus: PatternEpistemicStatus;
  source: string;
}

let coachDir = join(FLYD_DIR, 'coach');

export function configureCoachMemoryDirectory(directory: string): void {
  coachDir = resolvePath(directory);
}

function ensureCoachDir(): void {
  if (!existsSync(coachDir)) {
    mkdirSync(coachDir, { recursive: true, mode: 0o700 });
  }
}

const goalsDir = () => join(coachDir, 'goals');
const patternsDir = () => join(coachDir, 'patterns');

function ensureGoalsDir(): void {
  ensureCoachDir();
  if (!existsSync(goalsDir())) mkdirSync(goalsDir(), { recursive: true, mode: 0o700 });
}

function ensurePatternsDir(): void {
  ensureCoachDir();
  if (!existsSync(patternsDir())) mkdirSync(patternsDir(), { recursive: true, mode: 0o700 });
}

export function addGoal(statement: string, source: string): CoachGoal {
  ensureGoalsDir();
  const goal: CoachGoal = {
    id: randomUUID(),
    statement,
    status: 'active',
    adjustedAt: new Date().toISOString(),
    source,
  };
  writeFileSync(join(goalsDir(), `${goal.id}.json`), JSON.stringify(goal, null, 2), { encoding: 'utf-8', mode: 0o600 });
  return goal;
}

export function listGoals(activeOnly = true): CoachGoal[] {
  ensureGoalsDir();
  let files: string[];
  try {
    files = readdirSync(goalsDir()).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const goals: CoachGoal[] = [];
  for (const file of files) {
    try {
      const goal = JSON.parse(readFileSync(join(goalsDir(), file), 'utf-8')) as CoachGoal;
      if (activeOnly && goal.status !== 'active') continue;
      goals.push(goal);
    } catch {
      continue;
    }
  }
  goals.sort((a, b) => a.adjustedAt.localeCompare(b.adjustedAt));
  return goals;
}

export function getGoal(id: string): CoachGoal | null {
  const path = join(goalsDir(), `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as CoachGoal;
  } catch {
    return null;
  }
}

export function adjustGoal(id: string, statement: string): CoachGoal | null {
  const existing = getGoal(id);
  if (!existing) return null;
  const updated: CoachGoal = {
    ...existing,
    statement,
    adjustedAt: new Date().toISOString(),
  };
  writeFileSync(join(goalsDir(), `${id}.json`), JSON.stringify(updated, null, 2), { encoding: 'utf-8', mode: 0o600 });
  return updated;
}

export function archiveGoal(id: string): CoachGoal | null {
  const existing = getGoal(id);
  if (!existing) return null;
  const updated: CoachGoal = { ...existing, status: 'archived' };
  writeFileSync(join(goalsDir(), `${id}.json`), JSON.stringify(updated, null, 2), { encoding: 'utf-8', mode: 0o600 });
  return updated;
}

export function addPattern(observation: string, epistemicStatus: PatternEpistemicStatus, source: string, confidence = 0.6): CoachPattern {
  ensurePatternsDir();
  const pattern: CoachPattern = {
    id: randomUUID(),
    observation,
    confidence,
    epistemicStatus,
    source,
  };
  writeFileSync(join(patternsDir(), `${pattern.id}.json`), JSON.stringify(pattern, null, 2), { encoding: 'utf-8', mode: 0o600 });
  return pattern;
}

export function listPatterns(): CoachPattern[] {
  ensurePatternsDir();
  let files: string[];
  try {
    files = readdirSync(patternsDir()).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const patterns: CoachPattern[] = [];
  for (const file of files) {
    try {
      patterns.push(JSON.parse(readFileSync(join(patternsDir(), file), 'utf-8')) as CoachPattern);
    } catch {
      continue;
    }
  }
  patterns.sort((a, b) => b.confidence - a.confidence);
  return patterns;
}

export function clearCoachMemory(): void {
  ensureCoachDir();
  for (const sub of ['goals', 'patterns']) {
    const dir = join(coachDir, sub);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}
