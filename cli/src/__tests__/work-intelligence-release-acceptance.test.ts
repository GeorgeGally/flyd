import { describe, it, expect } from 'vitest';
import { WORK_CONTRACT_VERSION } from '../work-intelligence/types.js';
import { generateFounderTrialReport } from '../work-intelligence/founder-trial-report.js';

describe('work-intelligence release acceptance', () => {
  it('contract version is stable and non-zero', () => {
    expect(WORK_CONTRACT_VERSION).toBe(1);
    expect(WORK_CONTRACT_VERSION).toBeGreaterThan(0);
  });

  it('trial report structure has required gate checks', () => {
    const report = generateFounderTrialReport('2026-08-01T00:00:00Z');
    expect(report.periodDays).toBe(7);
    expect(report.gateChecks).toBeDefined();
    expect(report.gateChecks.acceptedInterventions).toBeDefined();
    expect(report.gateChecks.voluntaryUseDays).toBeDefined();
    expect(report.gateChecks.improvedArtifacts).toBeDefined();
    expect(report.gateChecks.advancedProjects).toBeDefined();
    expect(report.gateChecks.discoveredIssues).toBeDefined();
    expect(report.gateChecks.contextAccuracyPercent).toBeDefined();
    expect(report.gateChecks.staleProjectsPresented).toBeDefined();
    expect(report.gateChecks.laterImprovement).toBeDefined();
    expect(['passed', 'failed', 'insufficient_evidence']).toContain(report.status);
  });

  it('contract types are importable with no platform dependencies', async () => {
    const types = await import('../work-intelligence/types.js');
    const journal = await import('../work-intelligence/outcome-journal.js');
    expect(types.WORK_CONTRACT_VERSION).toBe(1);
    expect(journal.recordJournalEntry).toBeDefined();
  });
});
