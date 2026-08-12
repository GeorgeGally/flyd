import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  createJobDef,
  assertNoSecretFields,
  listJobAudits,
  hasCatchUpSlot,
} from '../store.js';
import { pauseJobs, resumeJobs } from '../controls.js';
import { resolveEffectiveTools } from '../tool-policy.js';
import { runJob, runDueJobs } from '../runner.js';
import type { WorkHypothesis } from '../../../work/work-hypothesis/types.js';
import { DEFAULT_JOB_BUDGETS } from '../types.js';

describe('jobs runner', () => {
  let testRoot: string;
  let previousFlydDir: string | undefined;

  beforeEach(() => {
    testRoot = join(tmpdir(), `flyd-jobs-runner-${randomUUID()}`);
    previousFlydDir = process.env.FLYD_DIR;
    process.env.FLYD_DIR = testRoot;
    mkdirSync(join(testRoot, 'wiki', 'projects'), { recursive: true });
    mkdirSync(join(testRoot, 'wiki', 'standards'), { recursive: true });
    mkdirSync(join(testRoot, 'work-jobs'), { recursive: true });
    mkdirSync(join(testRoot, 'overlay', 'job-artifacts'), { recursive: true });
    mkdirSync(join(testRoot, 'overlay', 'job-audits'), { recursive: true });
  });

  afterEach(() => {
    resumeJobs();
    if (previousFlydDir === undefined) delete process.env.FLYD_DIR;
    else process.env.FLYD_DIR = previousFlydDir;
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  });

  function freshPm(name = 'flyd'): WorkHypothesis {
    return {
      id: 'wh-1',
      hypothesisText: `Working on ${name}`,
      primaryThreads: [{
        root: '/tmp/flyd',
        name,
        isDirty: false,
        hasTasks: false,
        isForeground: false,
        signals: [],
        demoted: false,
      }],
      secondaryThreads: [],
      confidence: 'medium',
      uncertainty: [],
      evidenceRefs: [],
      demotions: [],
      revisedAt: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      fromCache: false,
    };
  }

  it('disabled job never runs', () => {
    const job = createJobDef({
      type: 'morning_briefing',
      schedule: '07:00',
      enabled: false,
      projectId: 'flyd',
    });
    const result = runJob(job, {
      now: new Date('2026-08-12T10:00:00'),
      deps: {
        readPresentModel: () => freshPm(),
        readLatestCloseoutForProject: () => null,
      },
    });
    expect(result.status).toBe('skipped');
    expect(result.error).toContain('disabled');
  });

  it('manual run writes artifact and audit', () => {
    const job = createJobDef({
      type: 'morning_briefing',
      schedule: '07:00',
      enabled: true,
      projectId: 'flyd',
    });
    const result = runJob(job, {
      force: true,
      skipCatchUpGuard: true,
      deps: {
        readPresentModel: () => freshPm(),
        readLatestCloseoutForProject: () => null,
      },
    });
    expect(result.status).toBe('completed');
    expect(result.artifactPath).toBeTruthy();
    const audits = listJobAudits();
    expect(audits.length).toBeGreaterThan(0);
    expect(audits[0].status).toBe('completed');
  });

  it('budget truncate yields incomplete artifact', () => {
    const job = createJobDef({
      type: 'morning_briefing',
      schedule: '07:00',
      enabled: true,
      projectId: 'flyd',
      budgets: { ...DEFAULT_JOB_BUDGETS, maxArtifactChars: 80, maxPackChars: 6_000 },
    });
    const result = runJob(job, {
      force: true,
      skipCatchUpGuard: true,
      deps: {
        readPresentModel: () => freshPm(),
        readLatestCloseoutForProject: () => null,
      },
    });
    expect(result.status).toBe('incomplete');
    expect(result.artifactPath).toBeTruthy();
  });

  it('toolPolicy * cannot exceed morning-briefing allowlist', () => {
    const job = createJobDef({
      type: 'morning_briefing',
      schedule: '07:00',
      toolPolicy: ['*'],
      projectId: 'flyd',
    });
    const effective = resolveEffectiveTools(job);
    expect(effective).not.toContain('evidence_network');
    expect(effective).not.toContain('wiki_write');
    expect(effective).not.toContain('schedule_mutation');
    expect(effective).toContain('wiki_read');
  });

  it('schedule-mutation and wiki-write stay denied even if listed', () => {
    const job = createJobDef({
      type: 'morning_briefing',
      schedule: '07:00',
      toolPolicy: ['wiki_read', 'wiki_write', 'schedule_mutation', 'local_compose'] as never,
      projectId: 'flyd',
    });
    const effective = resolveEffectiveTools(job);
    expect(effective).toEqual(['wiki_read', 'local_compose']);
  });

  it('catch-up fires once per schedule slot', () => {
    const job = createJobDef({
      type: 'morning_briefing',
      schedule: '07:00',
      enabled: true,
      projectId: 'flyd',
    });
    const now = new Date('2026-08-12T10:00:00');
    const deps = {
      readPresentModel: () => freshPm(),
      readLatestCloseoutForProject: () => null,
    };
    const first = runJob(job, { now, deps });
    expect(first.status).toBe('completed');
    expect(hasCatchUpSlot(job.id, '2026-08-12T07:00')).toBe(true);
    const second = runJob(job, { now, deps });
    expect(second.status).toBe('skipped');
    expect(second.error).toContain('catch-up');
  });

  it('global pause skips runs', () => {
    pauseJobs();
    const job = createJobDef({
      type: 'morning_briefing',
      schedule: '07:00',
      enabled: true,
      projectId: 'flyd',
    });
    const result = runJob(job, {
      force: true,
      skipCatchUpGuard: true,
      deps: {
        readPresentModel: () => freshPm(),
        readLatestCloseoutForProject: () => null,
      },
    });
    expect(result.status).toBe('skipped');
  });

  it('rejects JobDef with embedded API key', () => {
    expect(() =>
      assertNoSecretFields({ type: 'morning_briefing', apiKey: 'sk-secret' }),
    ).toThrow(/secrets/);
  });

  it('audit omits base64 and long secrets', () => {
    const job = createJobDef({
      type: 'morning_briefing',
      schedule: '07:00',
      enabled: true,
      projectId: 'flyd',
      prompt: 'Bearer sk-live-abcdef data:image/png;base64,AAAA AXButton',
    });
    const result = runJob(job, {
      force: true,
      skipCatchUpGuard: true,
      deps: {
        readPresentModel: () => freshPm(),
        readLatestCloseoutForProject: () => null,
      },
    });
    expect(result.artifactPath).toBeTruthy();
    const artifactFiles = readdirSync(join(testRoot, 'overlay', 'job-artifacts'));
    const body = readFileSync(join(testRoot, 'overlay', 'job-artifacts', artifactFiles[0]), 'utf-8');
    expect(body).not.toContain('sk-live-abcdef');
    expect(body).not.toContain('data:image/png;base64,AAAA');
    expect(body).toContain('[REDACTED]');
  });

  it('run-due only runs enabled due jobs', () => {
    createJobDef({
      type: 'morning_briefing',
      schedule: '23:00',
      enabled: true,
      projectId: 'flyd',
    });
    const results = runDueJobs({
      now: new Date('2026-08-12T10:00:00'),
      deps: {
        readPresentModel: () => freshPm(),
        readLatestCloseoutForProject: () => null,
      },
    });
    expect(results).toHaveLength(0);
  });
});
