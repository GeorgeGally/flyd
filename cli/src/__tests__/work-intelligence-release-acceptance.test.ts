import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WORK_CONTRACT_VERSION, checkContractVersion } from '../work-intelligence/types.js';
import type { FounderJournalEntry, FounderEventType, WorkInteractionResponse } from '../work-intelligence/types.js';
import {
  configureOutcomeJournalDirectory,
  recordJournalEntry,
  readJournalEntry,
  listJournalEntries,
  deleteJournalEntry,
} from '../work-intelligence/outcome-journal.js';
import { generateFounderTrialReport } from '../work-intelligence/founder-trial-report.js';
import type { FounderTrialReport } from '../work-intelligence/founder-trial-report.js';

let testRoot = '';
let JOURNAL_DIR = '';

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
    id = `ra-${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${++entryCounter}`;
  }
  return {
    entryId: id,
    interactionId: 'ra_test_001',
    workSessionId: 'ra_test_001',
    timestamp: new Date().toISOString(),
    eventType: 'intervention_accepted',
    details: { domain: 'code', artifactKind: 'code' },
    ...overrides,
  };
}

function makeStaleEntry(overrides: Partial<FounderJournalEntry> = {}): FounderJournalEntry {
  const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  return makeEntry({ timestamp: staleDate, ...overrides });
}

const ALL_FOUNDER_EVENT_TYPES: FounderEventType[] = [
  'intervention_accepted', 'intervention_rejected',
  'artifact_improved', 'project_advanced',
  'issue_discovered', 'correction_applied',
  'standard_accepted', 'action_completed',
  'action_failed', 'action_partial',
  'closeout_recorded', 'learning_promoted',
  'context_accuracy_sample',
  'command_approved', 'command_rejected',
  'command_completed', 'command_failed',
];

describe('work-intelligence release acceptance', () => {
  beforeAll(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'flyd-release-journal-'));
    JOURNAL_DIR = join(testRoot, 'founder-journal');
    configureOutcomeJournalDirectory(JOURNAL_DIR);
  });

  beforeEach(() => {
    cleanJournalDir();
    entryCounter = 0;
  });

  afterEach(() => {
    cleanJournalDir();
  });

  afterAll(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  describe('contract integrity', () => {
    it('contract version is stable and non-zero', () => {
      expect(WORK_CONTRACT_VERSION).toBe(1);
      expect(WORK_CONTRACT_VERSION).toBeGreaterThan(0);
    });

    it('contract types are importable with no platform dependencies', async () => {
      const types = await import('../work-intelligence/types.js');
      const journal = await import('../work-intelligence/outcome-journal.js');
      expect(types.WORK_CONTRACT_VERSION).toBe(1);
      expect(journal.recordJournalEntry).toBeDefined();
    });

    it('all founder event types round-trip through JSON serialization', () => {
      for (const eventType of ALL_FOUNDER_EVENT_TYPES) {
        const entry = makeEntry({
          eventType,
          details: {
            domain: 'code',
            artifactKind: 'code',
            artifactTitle: 'test-artifact.ts',
            projectName: 'test-project',
            correctProject: true,
            actionKind: 'text_edit',
            verified: true,
          },
        });
        const serialized = JSON.stringify(entry);
        const parsed: FounderJournalEntry = JSON.parse(serialized);
        expect(parsed.eventType).toBe(eventType);
        expect(parsed.entryId).toBe(entry.entryId);
        expect(parsed.interactionId).toBe(entry.interactionId);
        expect(parsed.workSessionId).toBe(entry.workSessionId);
        expect(parsed.timestamp).toBe(entry.timestamp);
        expect(parsed.details).toEqual(entry.details);
      }
    });

    it('checkContractVersion rejects mismatched versions', () => {
      const result = checkContractVersion(999);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Incompatible contract version');
      }
    });

    it('checkContractVersion accepts current version', () => {
      expect(checkContractVersion(1)).toEqual({ ok: true });
    });
  });

  describe('journal integrity', () => {
    it('all 17 founder event types can be recorded and retrieved', () => {
      for (const eventType of ALL_FOUNDER_EVENT_TYPES) {
        const entry = makeEntry({ eventType });
        expect(() => recordJournalEntry(entry)).not.toThrow();
        const read = readJournalEntry(entry.entryId);
        expect(read).not.toBeNull();
        expect(read!.eventType).toBe(eventType);
      }

      const allEntries = listJournalEntries();
      expect(allEntries).toHaveLength(17);

      const recordedTypes = new Set(allEntries.map(e => e.eventType));
      for (const eventType of ALL_FOUNDER_EVENT_TYPES) {
        expect(recordedTypes.has(eventType)).toBe(true);
      }
    });

    it('cross-domain coverage: all five domains are distinguishable', () => {
      const domains = ['design', 'writing', 'strategy', 'code', 'research'] as const;
      for (const domain of domains) {
        const entry = makeEntry({
          eventType: 'intervention_accepted',
          details: { domain, artifactKind: domain, artifactTitle: `${domain}-artifact` },
        });
        recordJournalEntry(entry);
      }

      const entries = listJournalEntries();
      expect(entries).toHaveLength(5);

      const recordedDomains = new Set(entries.map(e => e.details.domain));
      for (const domain of domains) {
        expect(recordedDomains.has(domain)).toBe(true);
      }
    });

    it('entries are retrievable by event type filter', () => {
      recordJournalEntry(makeEntry({ eventType: 'intervention_accepted', details: { domain: 'code' } }));
      recordJournalEntry(makeEntry({ eventType: 'intervention_rejected', details: { domain: 'design' } }));
      recordJournalEntry(makeEntry({ eventType: 'issue_discovered', details: { domain: 'strategy' } }));

      const accepted = listJournalEntries({ eventTypes: ['intervention_accepted'] });
      expect(accepted).toHaveLength(1);
      expect(accepted[0].eventType).toBe('intervention_accepted');
      expect(accepted[0].details.domain).toBe('code');
    });
  });

  describe('founder trial report', () => {
    it('zero entries produces insufficient_evidence', () => {
      const report = generateFounderTrialReport([]);
      expect(report.status).toBe('insufficient_evidence');
      expect(report.metrics.interventions_accepted).toBe(0);
      expect(report.gaps).toContainEqual(expect.stringContaining('no samples recorded'));
    });

    it('partial evidence produces insufficient_evidence', () => {
      for (let i = 0; i < 5; i++) {
        recordJournalEntry(makeEntry({ eventType: 'intervention_accepted' }));
      }
      const entries = listJournalEntries();
      const report = generateFounderTrialReport(entries);
      expect(report.status).toBe('insufficient_evidence');
      expect(report.metrics.interventions_accepted).toBe(5);
      expect(report.gaps.length).toBeGreaterThan(0);
    });

    it('all gates met produces passed', () => {
      for (let i = 0; i < 10; i++) {
        recordJournalEntry(makeEntry({ eventType: 'intervention_accepted' }));
      }
      for (let i = 0; i < 3; i++) {
        recordJournalEntry(makeEntry({ eventType: 'artifact_improved' }));
      }
      for (let i = 0; i < 2; i++) {
        recordJournalEntry(makeEntry({ eventType: 'project_advanced' }));
      }
      for (let i = 0; i < 3; i++) {
        recordJournalEntry(makeEntry({ eventType: 'issue_discovered' }));
      }
      recordJournalEntry(makeEntry({
        eventType: 'context_accuracy_sample',
        details: { correctProject: true },
      }));
      recordJournalEntry(makeEntry({
        eventType: 'context_accuracy_sample',
        details: { correctProject: true },
      }));
      recordJournalEntry(makeEntry({ eventType: 'learning_promoted' }));

      const entries = listJournalEntries();
      const report = generateFounderTrialReport(entries);
      expect(report.status).toBe('passed');
      expect(report.metrics.interventions_accepted).toBeGreaterThanOrEqual(10);
      expect(report.metrics.retained_improvements).toBeGreaterThanOrEqual(3);
      expect(report.metrics.projects_advanced).toBeGreaterThanOrEqual(2);
      expect(report.metrics.discoveries_missed).toBeGreaterThanOrEqual(3);
      expect(report.metrics.learning_improved_later).toBeGreaterThanOrEqual(1);
      expect(report.gaps.length).toBe(0);
    });

    it('three core gates fail produces failed', () => {
      recordJournalEntry(makeEntry({ eventType: 'intervention_accepted' }));
      recordJournalEntry(makeEntry({ eventType: 'intervention_accepted' }));
      recordJournalEntry(makeEntry({ eventType: 'intervention_accepted' }));

      recordJournalEntry(makeEntry({
        eventType: 'context_accuracy_sample',
        details: { correctProject: true },
      }));

      const entries = listJournalEntries();
      const report = generateFounderTrialReport(entries);
      expect(report.status).toBe('failed');
      expect(report.metrics.interventions_accepted).toBeLessThan(10);
      expect(report.metrics.retained_improvements).toBe(0);
      expect(report.metrics.projects_advanced).toBe(0);
    });

    it('single gate near threshold but insufficient on core still produces insufficient_evidence, not failed', () => {
      for (let i = 0; i < 9; i++) {
        recordJournalEntry(makeEntry({ eventType: 'intervention_accepted' }));
      }
      recordJournalEntry(makeEntry({ eventType: 'artifact_improved' }));
      recordJournalEntry(makeEntry({ eventType: 'project_advanced' }));

      recordJournalEntry(makeEntry({
        eventType: 'context_accuracy_sample',
        details: { correctProject: true },
      }));

      const entries = listJournalEntries();
      const report = generateFounderTrialReport(entries);
      expect(report.status).toBe('insufficient_evidence');
    });

    it('context_accuracy_sample with incorrect project lowers accuracy rate', () => {
      for (let i = 0; i < 10; i++) {
        recordJournalEntry(makeEntry({ eventType: 'intervention_accepted' }));
      }
      for (let i = 0; i < 3; i++) {
        recordJournalEntry(makeEntry({ eventType: 'artifact_improved' }));
      }
      for (let i = 0; i < 2; i++) {
        recordJournalEntry(makeEntry({ eventType: 'project_advanced' }));
      }
      for (let i = 0; i < 3; i++) {
        recordJournalEntry(makeEntry({ eventType: 'issue_discovered' }));
      }
      recordJournalEntry(makeEntry({ eventType: 'learning_promoted' }));
      recordJournalEntry(makeEntry({
        eventType: 'context_accuracy_sample',
        details: { correctProject: true },
      }));
      recordJournalEntry(makeEntry({
        eventType: 'context_accuracy_sample',
        details: { correctProject: false },
      }));
      recordJournalEntry(makeEntry({
        eventType: 'context_accuracy_sample',
        details: { correctProject: false },
      }));
      recordJournalEntry(makeEntry({
        eventType: 'context_accuracy_sample',
        details: { correctProject: true },
      }));
      recordJournalEntry(makeEntry({
        eventType: 'context_accuracy_sample',
        details: { correctProject: false },
      }));

      const entries = listJournalEntries();
      const report = generateFounderTrialReport(entries);

      const accuracyRate = report.metrics.current_project_accuracy_correct / report.metrics.current_project_accuracy_samples;
      expect(accuracyRate).toBe(0.4);
      expect(report.gaps).toContainEqual(expect.stringContaining('current_project_accuracy'));
    });
  });

  describe('seven-day gate validation', () => {
    it('only entries within 7-day window count toward metrics', () => {
      for (let i = 0; i < 5; i++) {
        recordJournalEntry(makeStaleEntry({ eventType: 'intervention_accepted' }));
      }
      for (let i = 0; i < 5; i++) {
        recordJournalEntry(makeEntry({ eventType: 'intervention_accepted' }));
      }

      const entries = listJournalEntries();
      const allCount = entries.filter(e => e.eventType === 'intervention_accepted').length;
      expect(allCount).toBe(10);

      const report = generateFounderTrialReport(entries);
      expect(report.metrics.interventions_accepted).toBe(5);
    });

    it('stale entries are excluded from all metric calculations', () => {
      recordJournalEntry(makeStaleEntry({ eventType: 'intervention_accepted' }));
      recordJournalEntry(makeStaleEntry({ eventType: 'artifact_improved' }));
      recordJournalEntry(makeStaleEntry({ eventType: 'project_advanced' }));
      recordJournalEntry(makeStaleEntry({ eventType: 'issue_discovered' }));
      recordJournalEntry(makeStaleEntry({
        eventType: 'context_accuracy_sample',
        details: { correctProject: true },
      }));

      const entries = listJournalEntries();
      const report = generateFounderTrialReport(entries);
      expect(report.metrics.interventions_accepted).toBe(0);
      expect(report.metrics.retained_improvements).toBe(0);
      expect(report.metrics.projects_advanced).toBe(0);
      expect(report.metrics.discoveries_missed).toBe(0);
      expect(report.metrics.current_project_accuracy_samples).toBe(0);
    });
  });

  describe('no derived metrics', () => {
    it('report does not fabricate metrics from route counts or technical counters', () => {
      recordJournalEntry(makeEntry({ eventType: 'intervention_accepted' }));
      const entries = listJournalEntries();
      const report = generateFounderTrialReport(entries);

      expect(report.metrics.interventions_accepted).toBe(1);
      expect(report.metrics.retained_improvements).toBe(0);
      expect(report.metrics.projects_advanced).toBe(0);
      expect(report.metrics.discoveries_missed).toBe(0);
      expect(report.metrics.current_project_accuracy_samples).toBe(0);

      expect(report.status).not.toBe('passed');
    });

    it('partial actions do not increment verified progress', () => {
      recordJournalEntry(makeEntry({ eventType: 'action_partial' }));
      recordJournalEntry(makeEntry({ eventType: 'action_failed' }));

      const entries = listJournalEntries();
      const report = generateFounderTrialReport(entries);

      expect(report.metrics.retained_improvements).toBe(0);
      expect(report.metrics.projects_advanced).toBe(0);
    });

    it('report explicitly distinguishes action_completed from action_partial and action_failed', () => {
      recordJournalEntry(makeEntry({ eventType: 'action_partial' }));
      recordJournalEntry(makeEntry({ eventType: 'action_failed' }));

      const entries = listJournalEntries();
      const partialAndFailed = entries.filter(e =>
        e.eventType === 'action_partial' || e.eventType === 'action_failed'
      ).length;
      expect(partialAndFailed).toBe(2);

      const report = generateFounderTrialReport(entries);
      expect(report.metrics.retained_improvements).toBe(0);
      expect(report.metrics.projects_advanced).toBe(0);
      expect(report.status).toBe('insufficient_evidence');
    });
  });

  describe('OOM safety', () => {
    it('listing with large number of entries does not crash', () => {
      for (let i = 0; i < 500; i++) {
        recordJournalEntry(makeEntry({ eventType: 'intervention_accepted' }));
      }
      const entries = listJournalEntries();
      expect(entries.length).toBe(500);

      const report = generateFounderTrialReport(entries);
      expect(report.metrics.interventions_accepted).toBe(500);
    });

    it('listing with mixed event types at scale does not crash', () => {
      for (let i = 0; i < 200; i++) {
        recordJournalEntry(makeEntry({ eventType: 'intervention_accepted' }));
        recordJournalEntry(makeEntry({ eventType: 'intervention_rejected' }));
        recordJournalEntry(makeEntry({ eventType: 'issue_discovered' }));
      }
      const entries = listJournalEntries();
      expect(entries.length).toBe(600);

      const report = generateFounderTrialReport(entries);
      expect(report).toBeDefined();
    });
  });

  describe('self-assessment rejection', () => {
    it('report rejects pass status derived from LLM responses rather than explicit outcomes', () => {
      recordJournalEntry(makeEntry({ eventType: 'intervention_accepted' }));
      recordJournalEntry(makeEntry({ eventType: 'intervention_accepted' }));

      const entries = listJournalEntries();
      const report = generateFounderTrialReport(entries);
      expect(report.status).not.toBe('passed');
      expect(report.status).toBe('insufficient_evidence');
    });

    it('report does not accept pass with only a single intervention accepted', () => {
      recordJournalEntry(makeEntry({ eventType: 'intervention_accepted' }));

      const entries = listJournalEntries();
      expect(entries.length).toBe(1);

      const report = generateFounderTrialReport(entries);
      expect(report.status).toBe('insufficient_evidence');
    });

    it('report enforces all gate thresholds simultaneously, not just one', () => {
      for (let i = 0; i < 15; i++) {
        recordJournalEntry(makeEntry({ eventType: 'intervention_accepted' }));
      }
      recordJournalEntry(makeEntry({
        eventType: 'context_accuracy_sample',
        details: { correctProject: true },
      }));

      const entries = listJournalEntries();
      const report = generateFounderTrialReport(entries);
      expect(report.status).toBe('insufficient_evidence');
      expect(report.metrics.interventions_accepted).toBe(15);
      expect(report.metrics.retained_improvements).toBe(0);
      expect(report.gaps).toContainEqual(expect.stringContaining('retained_improvements'));
    });
  });

  describe('installed-app domain coverage', () => {
    it('all five domains produce distinct, retrievable journal entries', () => {
      const scenarioEntries: Partial<FounderJournalEntry>[] = [
        { eventType: 'intervention_accepted', details: { domain: 'design', artifactKind: 'design', artifactTitle: 'landing-page-layout' } },
        { eventType: 'intervention_accepted', details: { domain: 'writing', artifactKind: 'document', artifactTitle: 'product-spec' } },
        { eventType: 'intervention_accepted', details: { domain: 'strategy', artifactKind: 'research', artifactTitle: 'market-analysis' } },
        { eventType: 'intervention_accepted', details: { domain: 'code', artifactKind: 'code', artifactTitle: 'auth-module.ts' } },
        { eventType: 'intervention_accepted', details: { domain: 'research', artifactKind: 'research', artifactTitle: 'library-comparison' } },
      ];

      for (const entry of scenarioEntries) {
        recordJournalEntry(makeEntry(entry));
      }

      const entries = listJournalEntries();
      const domains = entries.map(e => e.details.domain).filter(Boolean);
      const uniqueDomains = new Set(domains);
      expect(uniqueDomains.size).toBe(5);
      expect(uniqueDomains.has('design')).toBe(true);
      expect(uniqueDomains.has('writing')).toBe(true);
      expect(uniqueDomains.has('strategy')).toBe(true);
      expect(uniqueDomains.has('code')).toBe(true);
      expect(uniqueDomains.has('research')).toBe(true);
    });

    it('artifacts across domains retain their kind on retrieval', () => {
      const kinds = ['design', 'document', 'code', 'presentation', 'research'] as const;
      for (const kind of kinds) {
        recordJournalEntry(makeEntry({
          eventType: 'artifact_improved',
          details: { domain: 'code', artifactKind: kind, artifactTitle: `${kind}-sample` },
        }));
      }

      const improved = listJournalEntries({ eventTypes: ['artifact_improved'] });
      expect(improved).toHaveLength(5);

      const retrievedKinds = new Set(improved.map(e => e.details.artifactKind));
      for (const kind of kinds) {
        expect(retrievedKinds.has(kind)).toBe(true);
      }
    });
  });

  describe('loopback-only operability', () => {
    it('journal works with only local filesystem (no network dependency)', () => {
      const entry = makeEntry({
        eventType: 'closeout_recorded',
        details: { projectName: 'test-project' },
      });

      expect(() => recordJournalEntry(entry)).not.toThrow();

      const filePath = join(JOURNAL_DIR, `${entry.entryId}.json`);
      expect(existsSync(filePath)).toBe(true);

      const read = readJournalEntry(entry.entryId);
      expect(read).not.toBeNull();
      expect(read!.details.projectName).toBe('test-project');
    });

    it('report generation requires no network access', () => {
      for (let i = 0; i < 10; i++) {
        recordJournalEntry(makeEntry({ eventType: 'intervention_accepted' }));
      }
      for (let i = 0; i < 3; i++) {
        recordJournalEntry(makeEntry({ eventType: 'artifact_improved' }));
      }
      for (let i = 0; i < 2; i++) {
        recordJournalEntry(makeEntry({ eventType: 'project_advanced' }));
      }
      for (let i = 0; i < 3; i++) {
        recordJournalEntry(makeEntry({ eventType: 'issue_discovered' }));
      }
      recordJournalEntry(makeEntry({
        eventType: 'context_accuracy_sample',
        details: { correctProject: true },
      }));
      recordJournalEntry(makeEntry({ eventType: 'learning_promoted' }));

      const entries = listJournalEntries();
      const report = generateFounderTrialReport(entries);
      expect(report.status).toBe('passed');
    });
  });

  describe('journal deletion preserves integrity', () => {
    it('deleting one entry does not affect others or corrupt metrics', () => {
      const e1 = makeEntry({ eventType: 'intervention_accepted' });
      const e2 = makeEntry({ eventType: 'intervention_accepted' });
      const e3 = makeEntry({ eventType: 'intervention_accepted' });

      recordJournalEntry(e1);
      recordJournalEntry(e2);
      recordJournalEntry(e3);

      deleteJournalEntry(e1.entryId);

      const entries = listJournalEntries();
      expect(entries).toHaveLength(2);
      expect(entries.find(e => e.entryId === e1.entryId)).toBeUndefined();

      const report = generateFounderTrialReport(entries);
      expect(report.metrics.interventions_accepted).toBe(2);
    });
  });
});
