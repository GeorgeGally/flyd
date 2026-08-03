import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  recordJournalEntry,
  readJournalEntry,
  listJournalEntries,
  countJournalEntries,
  deleteJournalEntry,
} from '../work-intelligence/outcome-journal.js';
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
    id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${++entryCounter}`;
  }
  return {
    entryId: id,
    interactionId: 'wi_test_001',
    workSessionId: 'ws_test_001',
    timestamp: new Date().toISOString(),
    eventType: 'intervention_accepted',
    details: { domain: 'code', artifactKind: 'code' },
    ...overrides,
  };
}

describe('outcome-journal', () => {
  beforeEach(() => {
    cleanJournalDir();
  });

  afterEach(() => {
    cleanJournalDir();
  });

  describe('recordJournalEntry', () => {
    it('records a valid journal entry', () => {
      const entry = makeEntry();
      expect(() => recordJournalEntry(entry)).not.toThrow();
      expect(existsSync(join(JOURNAL_DIR, `${entry.entryId}.json`))).toBe(true);
    });

    it('rejects entry with missing entryId', () => {
      const entry = makeEntry({ entryId: '' });
      expect(() => recordJournalEntry(entry)).toThrow('Missing entryId');
    });

    it('rejects entry with unknown event type', () => {
      const entry = makeEntry({ eventType: 'unknown_event_type' as FounderJournalEntry['eventType'] });
      expect(() => recordJournalEntry(entry)).toThrow('Unknown event type');
    });

    it('rejects entry with missing details', () => {
      const entry = makeEntry();
      (entry as unknown as Record<string, unknown>).details = null;
      expect(() => recordJournalEntry(entry)).toThrow('Missing details');
    });
  });

  describe('readJournalEntry', () => {
    it('reads a recorded entry back', () => {
      const entry = makeEntry();
      recordJournalEntry(entry);
      const read = readJournalEntry(entry.entryId);
      expect(read).not.toBeNull();
      expect(read!.entryId).toBe(entry.entryId);
      expect(read!.eventType).toBe(entry.eventType);
    });

    it('returns null for missing entry', () => {
      expect(readJournalEntry('nonexistent')).toBeNull();
    });
  });

  describe('listJournalEntries', () => {
    it('lists all entries sorted by timestamp desc', () => {
      const e1 = makeEntry({ timestamp: '2026-08-01T10:00:00Z' });
      const e2 = makeEntry({ timestamp: '2026-08-02T10:00:00Z' });
      recordJournalEntry(e1);
      recordJournalEntry(e2);
      const entries = listJournalEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].timestamp).toBe('2026-08-02T10:00:00Z');
      expect(entries[1].timestamp).toBe('2026-08-01T10:00:00Z');
    });

    it('filters by since timestamp', () => {
      const e1 = makeEntry({ timestamp: '2026-08-01T10:00:00Z' });
      const e2 = makeEntry({ timestamp: '2026-08-02T10:00:00Z' });
      recordJournalEntry(e1);
      recordJournalEntry(e2);
      const entries = listJournalEntries({ since: '2026-08-02T00:00:00Z' });
      expect(entries).toHaveLength(1);
      expect(entries[0].entryId).toBe(e2.entryId);
    });

    it('filters by event type', () => {
      const e1 = makeEntry({ eventType: 'intervention_accepted' });
      const e2 = makeEntry({ eventType: 'issue_discovered' });
      recordJournalEntry(e1);
      recordJournalEntry(e2);
      const entries = listJournalEntries({ eventTypes: ['issue_discovered'] });
      expect(entries).toHaveLength(1);
      expect(entries[0].eventType).toBe('issue_discovered');
    });

    it('filters by work session', () => {
      const e1 = makeEntry({ workSessionId: 'ws_a' });
      const e2 = makeEntry({ workSessionId: 'ws_b' });
      recordJournalEntry(e1);
      recordJournalEntry(e2);
      const entries = listJournalEntries({ workSessionId: 'ws_a' });
      expect(entries).toHaveLength(1);
      expect(entries[0].workSessionId).toBe('ws_a');
    });

    it('respects limit', () => {
      for (let i = 0; i < 5; i++) {
        recordJournalEntry(makeEntry({ timestamp: `2026-08-0${i + 1}T10:00:00Z` }));
      }
      const entries = listJournalEntries({ limit: 3 });
      expect(entries).toHaveLength(3);
    });
  });

  describe('countJournalEntries', () => {
    it('counts entries matching filter', () => {
      recordJournalEntry(makeEntry({ eventType: 'intervention_accepted' }));
      recordJournalEntry(makeEntry({ eventType: 'intervention_accepted' }));
      recordJournalEntry(makeEntry({ eventType: 'issue_discovered' }));
      expect(countJournalEntries({ eventTypes: ['intervention_accepted'] })).toBe(2);
    });
  });

  describe('deleteJournalEntry', () => {
    it('deletes an existing entry', () => {
      const entry = makeEntry();
      recordJournalEntry(entry);
      const filePath = join(JOURNAL_DIR, `${entry.entryId}.json`);
      expect(existsSync(filePath)).toBe(true);
      deleteJournalEntry(entry.entryId);
      expect(existsSync(filePath)).toBe(false);
    });

    it('returns false for missing entry', () => {
      expect(deleteJournalEntry('nonexistent')).toBe(false);
    });
  });
});
