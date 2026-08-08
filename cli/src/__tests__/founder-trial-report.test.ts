import { describe, it, expect } from 'vitest';
import { generateFounderTrialReport } from '../work-intelligence/founder-trial-report.js';
import type { FounderJournalEntry } from '../work-intelligence/types.js';

function entry(overrides: Partial<FounderJournalEntry> = {}): FounderJournalEntry {
  return {
    entryId: `fe-${Math.random().toString(36).slice(2, 10)}`,
    interactionId: 'wi_test_001',
    workSessionId: 'ws_test_001',
    timestamp: new Date().toISOString(),
    eventType: 'intervention_accepted',
    details: { domain: 'code', artifactKind: 'code', artifactTitle: 'test.ts' },
    ...overrides,
  };
}

describe('founder-trial-report', () => {
  describe('generateFounderTrialReport', () => {
    it('returns insufficient_evidence for zero entries', () => {
      const report = generateFounderTrialReport([]);
      expect(report.status).toBe('insufficient_evidence');
      expect(report.gaps.length).toBeGreaterThan(0);
    });

    it('returns insufficient_evidence for partial progress', () => {
      const entries: FounderJournalEntry[] = [];
      for (let i = 0; i < 10; i++) {
        entries.push(entry({ entryId: `fe-acc-${i}`, eventType: 'intervention_accepted' }));
      }
      entries.push(entry({ entryId: 'fe-imp-1', eventType: 'artifact_improved' }));
      entries.push(entry({ entryId: 'fe-adv-1', eventType: 'project_advanced' }));
      entries.push(entry({ entryId: 'fe-disc-1', eventType: 'issue_discovered' }));

      const report = generateFounderTrialReport(entries);
      expect(report.status).toBe('insufficient_evidence');
      expect(report.metrics.interventions_accepted).toBe(10);
      expect(report.metrics.retained_improvements).toBe(1);
    });

    it('returns passed when all gates are met', () => {
      const entries: FounderJournalEntry[] = [];
      for (let i = 0; i < 10; i++) {
        entries.push(entry({ entryId: `fe-acc-${i}`, eventType: 'intervention_accepted' }));
      }
      for (let i = 0; i < 3; i++) {
        entries.push(entry({ entryId: `fe-imp-${i}`, eventType: 'artifact_improved' }));
      }
      for (let i = 0; i < 2; i++) {
        entries.push(entry({ entryId: `fe-adv-${i}`, eventType: 'project_advanced' }));
      }
      for (let i = 0; i < 3; i++) {
        entries.push(entry({ entryId: `fe-disc-${i}`, eventType: 'issue_discovered' }));
      }
      entries.push(entry({ entryId: 'fe-learn-1', eventType: 'learning_promoted' }));
      for (let i = 0; i < 10; i++) {
        entries.push(entry({
          entryId: `fe-acc-sample-${i}`,
          eventType: 'context_accuracy_sample',
          details: { correctProject: true },
        }));
      }

      const report = generateFounderTrialReport(entries);
      expect(report.status).toBe('passed');
      expect(report.gaps).toHaveLength(0);
      expect(report.metrics.learning_improved_later).toBe(1);
    });

    it('returns failed when three core gates are all unmet', () => {
      const entries: FounderJournalEntry[] = [];
      entries.push(entry({ entryId: 'fe-1', eventType: 'intervention_accepted' }));
      entries.push(entry({ entryId: 'fe-2', eventType: 'intervention_accepted' }));
      entries.push(entry({ entryId: 'fe-3', eventType: 'issue_discovered' }));

      const report = generateFounderTrialReport(entries);
      expect(report.status).toBe('failed');
      expect(report.metrics.retained_improvements).toBe(0);
      expect(report.metrics.projects_advanced).toBe(0);
    });

    it('counts partial actions but they do not increment verified progress', () => {
      const entries: FounderJournalEntry[] = [];
      for (let i = 0; i < 10; i++) {
        entries.push(entry({ entryId: `fe-acc-${i}`, eventType: 'intervention_accepted' }));
      }
      for (let i = 0; i < 3; i++) {
        entries.push(entry({ entryId: `fe-imp-${i}`, eventType: 'artifact_improved' }));
      }
      for (let i = 0; i < 2; i++) {
        entries.push(entry({ entryId: `fe-adv-${i}`, eventType: 'project_advanced' }));
      }
      for (let i = 0; i < 3; i++) {
        entries.push(entry({ entryId: `fe-disc-${i}`, eventType: 'issue_discovered' }));
      }
      entries.push(entry({ entryId: 'fe-learn-1', eventType: 'learning_promoted' }));
      entries.push(entry({ entryId: 'fe-partial-1', eventType: 'action_partial', details: { verified: false } }));
      entries.push(entry({ entryId: 'fe-failed-1', eventType: 'action_failed', details: { verified: false } }));
      for (let i = 0; i < 10; i++) {
        entries.push(entry({
          entryId: `fe-acc-sample-${i}`,
          eventType: 'context_accuracy_sample',
          details: { correctProject: true },
        }));
      }

      const report = generateFounderTrialReport(entries);
      expect(report.status).toBe('passed');
      expect(report.metrics.retained_improvements).toBe(3);
    });

    it('fails accuracy gate when below 90% accuracy', () => {
      const entries: FounderJournalEntry[] = [];
      for (let i = 0; i < 10; i++) {
        entries.push(entry({ entryId: `fe-acc-${i}`, eventType: 'intervention_accepted' }));
      }
      for (let i = 0; i < 3; i++) {
        entries.push(entry({ entryId: `fe-imp-${i}`, eventType: 'artifact_improved' }));
      }
      for (let i = 0; i < 2; i++) {
        entries.push(entry({ entryId: `fe-adv-${i}`, eventType: 'project_advanced' }));
      }
      for (let i = 0; i < 3; i++) {
        entries.push(entry({ entryId: `fe-disc-${i}`, eventType: 'issue_discovered' }));
      }
      entries.push(entry({ entryId: 'fe-learn-1', eventType: 'learning_promoted' }));

      for (let i = 0; i < 8; i++) {
        entries.push(entry({
          entryId: `fe-acc-sample-correct-${i}`,
          eventType: 'context_accuracy_sample',
          details: { correctProject: true },
        }));
      }
      for (let i = 0; i < 2; i++) {
        entries.push(entry({
          entryId: `fe-acc-sample-wrong-${i}`,
          eventType: 'context_accuracy_sample',
          details: { correctProject: false },
        }));
      }

      const report = generateFounderTrialReport(entries);
      expect(report.metrics.current_project_accuracy_correct).toBe(8);
      expect(report.metrics.current_project_accuracy_samples).toBe(10);
      expect(report.gaps.some(g => g.includes('current_project_accuracy'))).toBe(true);
      expect(report.status).toBe('insufficient_evidence');
    });

    it('only counts entries within the 7-day window', () => {
      const staleEntries: FounderJournalEntry[] = [];
      for (let i = 0; i < 10; i++) {
        staleEntries.push(entry({
          entryId: `fe-old-acc-${i}`,
          eventType: 'intervention_accepted',
          timestamp: '2025-01-01T00:00:00Z',
        }));
      }

      const report = generateFounderTrialReport(staleEntries);
      expect(report.metrics.interventions_accepted).toBe(0);
      expect(report.status).toBe('insufficient_evidence');
    });

    it('records missing evidence as missing', () => {
      const report = generateFounderTrialReport([]);
      expect(report.gaps).toContain('current_project_accuracy: no samples recorded');
      expect(report.metrics.current_project_accuracy_samples).toBe(0);
    });

    it('does not derive outcomes from technical counters', () => {
      const entries: FounderJournalEntry[] = [];
      entries.push(entry({ entryId: 'fe-1', eventType: 'intervention_accepted' }));
      entries.push(entry({ entryId: 'fe-2', eventType: 'intervention_accepted' }));
      entries.push(entry({ entryId: 'fe-3', eventType: 'intervention_accepted' }));

      const report = generateFounderTrialReport(entries);
      expect(report.status).toBe('failed');
      expect(report.metrics.interventions_accepted).toBe(3);
    });
  });
});
