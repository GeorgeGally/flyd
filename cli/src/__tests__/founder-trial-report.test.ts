import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { recordJournalEntry, deleteJournalEntry } from '../work-intelligence/outcome-journal.js';
import { generateFounderTrialReport } from '../work-intelligence/founder-trial-report.js';
import type { FounderJournalEntry } from '../work-intelligence/types.js';

const JOURNAL_DIR = join(homedir(), '.flyd', 'overlay', 'founder-journal');

let entryCounter = 0;

function cleanJournalDir(): void {
  if (existsSync(JOURNAL_DIR)) {
    try {
      const files = readdirSync(JOURNAL_DIR).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try { unlinkSync(join(JOURNAL_DIR, file)); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
  mkdirSync(JOURNAL_DIR, { recursive: true });
}

function makeEntry(overrides: Partial<FounderJournalEntry> = {}): FounderJournalEntry {
  let id = overrides.entryId;
  if (!id) {
    id = `tr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${++entryCounter}`;
  }
  return {
    entryId: id,
    interactionId: 'wi_test',
    workSessionId: 'ws_test',
    timestamp: new Date().toISOString(),
    eventType: 'intervention_accepted',
    details: {},
    ...overrides,
  };
}

describe('founder-trial-report', () => {
  beforeEach(() => {
    cleanJournalDir();
  });

  afterEach(() => {
    cleanJournalDir();
  });

  it('returns insufficient_evidence when no entries exist', () => {
    const report = generateFounderTrialReport('2026-08-01T00:00:00Z');
    expect(report.status).toBe('insufficient_evidence');
    expect(report.periodDays).toBe(7);
  });

  it('counts accepted interventions toward the gate', () => {
    const baseTime = new Date('2026-08-02').toISOString();
    const periodStart = '2026-08-01T00:00:00Z';

    for (let i = 0; i < 12; i++) {
      recordJournalEntry(makeEntry({ eventType: 'intervention_accepted', timestamp: baseTime }));
    }

    const report = generateFounderTrialReport(periodStart);
    expect(report.gateChecks.acceptedInterventions.actual).toBe(12);
    expect(report.gateChecks.acceptedInterventions.passed).toBe(true);
  });

  it('fails the gate when interventions are below threshold', () => {
    const periodStart = '2026-08-01T00:00:00Z';
    recordJournalEntry(makeEntry({ eventType: 'intervention_accepted', timestamp: '2026-08-02T10:00:00Z' }));

    const report = generateFounderTrialReport(periodStart);
    expect(report.gateChecks.acceptedInterventions.actual).toBe(1);
    expect(report.gateChecks.acceptedInterventions.passed).toBe(false);
    expect(report.status).toBe('failed');
  });

  it('computes voluntary use days from unique entry dates', () => {
    const periodStart = '2026-08-01T00:00:00Z';
    const days = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06'];
    for (const day of days) {
      recordJournalEntry(makeEntry({ timestamp: `${day}T10:00:00Z` }));
    }

    const report = generateFounderTrialReport(periodStart);
    expect(report.gateChecks.voluntaryUseDays.actual).toBe(6);
    expect(report.gateChecks.voluntaryUseDays.passed).toBe(true);
  });

  it('counts discovered issues', () => {
    const periodStart = '2026-08-01T00:00:00Z';
    for (let i = 0; i < 5; i++) {
      recordJournalEntry(makeEntry({ eventType: 'issue_discovered', timestamp: '2026-08-02T10:00:00Z' }));
    }

    const report = generateFounderTrialReport(periodStart);
    expect(report.gateChecks.discoveredIssues.actual).toBe(5);
    expect(report.gateChecks.discoveredIssues.passed).toBe(true);
  });

  it('computes context accuracy from samples', () => {
    const periodStart = '2026-08-01T00:00:00Z';
    for (let i = 0; i < 9; i++) {
      recordJournalEntry(makeEntry({
        eventType: 'context_accuracy_sample',
        timestamp: '2026-08-02T10:00:00Z',
        details: { correctProject: true },
      }));
    }
    recordJournalEntry(makeEntry({
      eventType: 'context_accuracy_sample',
      timestamp: '2026-08-02T10:00:00Z',
      details: { correctProject: false },
    }));

    const report = generateFounderTrialReport(periodStart);
    expect(report.gateChecks.contextAccuracyPercent.actual).toBe(90);
    expect(report.gateChecks.contextAccuracyPercent.passed).toBe(true);
    expect(report.gateChecks.staleProjectsPresented.actual).toBe(1);
    expect(report.gateChecks.staleProjectsPresented.passed).toBe(false);
  });

  it('checks later improvement from learning_promoted entries', () => {
    const periodStart = '2026-08-01T00:00:00Z';
    recordJournalEntry(makeEntry({
      eventType: 'learning_promoted',
      timestamp: '2026-08-05T10:00:00Z',
      details: { promoted: true },
    }));

    const report = generateFounderTrialReport(periodStart);
    expect(report.gateChecks.laterImprovement.passed).toBe(true);
  });

  it('fails all gates when all checks fail', () => {
    const periodStart = '2026-08-01T00:00:00Z';
    recordJournalEntry(makeEntry({ eventType: 'intervention_accepted', timestamp: '2026-08-02T10:00:00Z' }));
    recordJournalEntry(makeEntry({
      eventType: 'context_accuracy_sample',
      timestamp: '2026-08-02T10:00:00Z',
      details: { correctProject: false },
    }));

    const report = generateFounderTrialReport(periodStart);
    expect(report.status).toBe('failed');
  });

  it('passes when all gate checks pass', () => {
    const periodStart = '2026-08-01T00:00:00Z';
    const baseTime = new Date('2026-08-02T10:00:00Z').toISOString();

    for (let d = 1; d <= 6; d++) {
      recordJournalEntry(makeEntry({ timestamp: `2026-08-0${d}T10:00:00Z` }));
    }

    for (let i = 0; i < 10; i++) {
      recordJournalEntry(makeEntry({ eventType: 'intervention_accepted', timestamp: baseTime }));
    }
    for (let i = 0; i < 3; i++) {
      recordJournalEntry(makeEntry({ eventType: 'artifact_improved', timestamp: baseTime }));
    }
    for (let i = 0; i < 2; i++) {
      recordJournalEntry(makeEntry({ eventType: 'project_advanced', timestamp: baseTime }));
    }
    for (let i = 0; i < 3; i++) {
      recordJournalEntry(makeEntry({ eventType: 'issue_discovered', timestamp: baseTime }));
    }
    for (let i = 0; i < 10; i++) {
      recordJournalEntry(makeEntry({
        eventType: 'context_accuracy_sample',
        timestamp: baseTime,
        details: { correctProject: true },
      }));
    }
    recordJournalEntry(makeEntry({ eventType: 'learning_promoted', timestamp: baseTime }));

    const report = generateFounderTrialReport(periodStart);
    expect(report.status).toBe('passed');
    expect(report.gateChecks.voluntaryUseDays.actual).toBeGreaterThanOrEqual(5);
    expect(report.gateChecks.voluntaryUseDays.passed).toBe(true);
    expect(report.gateChecks.acceptedInterventions.actual).toBeGreaterThanOrEqual(10);
    expect(report.gateChecks.contextAccuracyPercent.actual).toBe(100);
    expect(report.gateChecks.staleProjectsPresented.actual).toBe(0);
    expect(report.gateChecks.laterImprovement.passed).toBe(true);
  });
});
