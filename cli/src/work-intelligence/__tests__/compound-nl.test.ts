import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  detectCompoundNlKind,
  handleCompoundNl,
  isCompoundNlUtterance,
} from '../compound-nl.js';
import { configureSkillifyProposalDirectory, createProposal, listPendingProposals } from '../skillify/proposal-store.js';
import { configureOutcomeJournalDirectory } from '../outcome-journal.js';
import { createJobDef } from '../jobs/store.js';

describe('compound-nl', () => {
  let testRoot: string;
  let previousFlydDir: string | undefined;
  let previousJobsDir: string | undefined;

  beforeEach(() => {
    testRoot = join(tmpdir(), `flyd-compound-nl-${randomUUID()}`);
    previousFlydDir = process.env.FLYD_DIR;
    process.env.FLYD_DIR = testRoot;
    previousJobsDir = process.env.FLYD_JOBS_DIR;
    process.env.FLYD_JOBS_DIR = join(testRoot, 'jobs');
    mkdirSync(join(testRoot, 'wiki', 'standards'), { recursive: true });
    mkdirSync(join(testRoot, 'wiki', 'skills'), { recursive: true });
    mkdirSync(join(testRoot, 'wiki', 'constraints'), { recursive: true });
    mkdirSync(join(testRoot, 'wiki', 'projects'), { recursive: true });
    mkdirSync(join(testRoot, 'overlay', 'skillify-proposals'), { recursive: true });
    mkdirSync(join(testRoot, 'overlay', 'founder-journal'), { recursive: true });
    mkdirSync(join(testRoot, 'overlay', 'job-artifacts'), { recursive: true });
    mkdirSync(join(testRoot, 'overlay', 'job-audits'), { recursive: true });
    mkdirSync(join(testRoot, 'work-jobs'), { recursive: true });
    configureSkillifyProposalDirectory(undefined);
    configureOutcomeJournalDirectory(join(testRoot, 'overlay', 'founder-journal'));
  });

  afterEach(() => {
    configureSkillifyProposalDirectory(undefined);
    if (previousFlydDir === undefined) delete process.env.FLYD_DIR;
    else process.env.FLYD_DIR = previousFlydDir;
    if (previousJobsDir === undefined) delete process.env.FLYD_JOBS_DIR;
    else process.env.FLYD_JOBS_DIR = previousJobsDir;
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  });

  it('detects skill inventory, skillify propose, jobs, and job hunt', () => {
    expect(detectCompoundNlKind('what skills do i have')).toBe('skills_inventory');
    expect(detectCompoundNlKind('can i make this into a skill')).toBe('skillify_propose');
    expect(detectCompoundNlKind('list my overnight jobs')).toBe('jobs_status');
    expect(detectCompoundNlKind('run morning briefing')).toBe('jobs_run_briefing');
    expect(detectCompoundNlKind('how is my job hunt going')).toBe('job_hunt_status');
    expect(isCompoundNlUtterance('how is the weather')).toBe(false);
  });

  it('lists wiki skills and pending skillify proposals', () => {
    writeFileSync(
      join(testRoot, 'wiki', 'standards', 'design.md'),
      '---\ntype: domain_standard\ndomain: design\n---\nLead with outcomes.\n',
      'utf8',
    );
    createProposal({
      kind: 'constraint',
      targetPath: 'constraints/writing.md',
      body: '# writing\n\nKeep short',
      provenance: 'test',
      sourceOutcome: 'rejected',
      dedupeKey: 'nl-test-1',
    });

    const match = handleCompoundNl('what skills do i have');
    expect(match?.kind).toBe('skills_inventory');
    expect(match?.reply).toContain('design');
    expect(match?.reply).toContain('Pending Skillify');
    expect(match?.reply).toContain('constraints/writing.md');
  });

  it('skillify propose creates a pending proposal from selection', () => {
    const match = handleCompoundNl('can I make this into a skill?', {
      selection: 'Always prefer artifact-first overnight delivery',
    });
    expect(match?.kind).toBe('skillify_propose');
    expect(match?.reply).toContain('Created a pending Skillify proposal');
    expect(match?.reply).toContain('flyd skillify confirm');
    expect(listPendingProposals().length).toBe(1);
  });

  it('jobs run morning briefing writes an artifact', () => {
    const match = handleCompoundNl('run morning briefing for flyd');
    expect(match?.kind).toBe('jobs_run_briefing');
    expect(match?.reply).toMatch(/Status: (completed|incomplete|failed)/);
    expect(match?.reply).toMatch(/Artifact:|Note:/);
  });

  it('jobs status lists configured jobs', () => {
    createJobDef({
      type: 'morning_briefing',
      schedule: '07:00',
      enabled: true,
      projectId: 'flyd',
    });
    const match = handleCompoundNl('show my overnight jobs');
    expect(match?.kind).toBe('jobs_status');
    expect(match?.reply).toContain('morning_briefing');
    expect(match?.reply).toContain('flyd');
  });

  it('job hunt uses wiki project when present and does not invent', () => {
    writeFileSync(
      join(testRoot, 'wiki', 'projects', 'job-hunt.md'),
      '---\ntype: project\n---\nApplied to three roles this week.\n',
      'utf8',
    );
    const match = handleCompoundNl('how is my job hunt going');
    expect(match?.kind).toBe('job_hunt_status');
    expect(match?.reply).toContain('Applied to three roles');
  });

  it('job hunt fails closed when no evidence', () => {
    const match = handleCompoundNl('how is my job hunt going', { presentHypothesis: null });
    expect(match?.reply).toContain('not available');
    expect(match?.reply).not.toContain('Job search evidence');
  });
});
