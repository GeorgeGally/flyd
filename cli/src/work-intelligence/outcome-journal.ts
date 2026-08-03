import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import { homedir } from 'node:os';
import type { FounderJournalEntry, FounderEventType } from './types.js';

const JOURNAL_DIR = join(homedir(), '.flyd', 'overlay', 'founder-journal');

function ensureJournalDir(): void {
  if (!existsSync(JOURNAL_DIR)) {
    mkdirSync(JOURNAL_DIR, { recursive: true });
  }
}

export function recordJournalEntry(entry: FounderJournalEntry): void {
  ensureJournalDir();
  validateJournalEntry(entry);
  const filePath = join(JOURNAL_DIR, `${entry.entryId}.json`);
  writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
}

export function readJournalEntry(entryId: string): FounderJournalEntry | null {
  const filePath = join(JOURNAL_DIR, `${entryId}.json`);
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as FounderJournalEntry;
}

export function listJournalEntries(params?: {
  since?: string;
  eventTypes?: FounderEventType[];
  workSessionId?: string;
  limit?: number;
}): FounderJournalEntry[] {
  ensureJournalDir();
  let files: string[];
  try {
    files = readdirSync(JOURNAL_DIR).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }
  const entries: FounderJournalEntry[] = [];

  for (const file of files) {
    try {
      const raw = readFileSync(join(JOURNAL_DIR, file), 'utf-8');
      const entry = JSON.parse(raw) as FounderJournalEntry;

      if (params?.since && entry.timestamp < params.since) continue;
      if (params?.eventTypes && !params.eventTypes.includes(entry.eventType)) continue;
      if (params?.workSessionId && entry.workSessionId !== params.workSessionId) continue;

      entries.push(entry);
    } catch {
      continue;
    }
  }

  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (params?.limit) {
    return entries.slice(0, params.limit);
  }

  return entries;
}

export function countJournalEntries(params?: {
  since?: string;
  eventTypes?: FounderEventType[];
}): number {
  const entries = listJournalEntries(params);
  return entries.length;
}

export function deleteJournalEntry(entryId: string): boolean {
  const filePath = join(JOURNAL_DIR, `${entryId}.json`);
  if (!existsSync(filePath)) return false;
  unlinkSync(filePath);
  return true;
}

const ALLOWED_EVENT_TYPES: Set<string> = new Set([
  'intervention_accepted', 'intervention_rejected',
  'artifact_improved', 'project_advanced',
  'issue_discovered', 'correction_applied',
  'standard_accepted', 'action_completed',
  'action_failed', 'action_partial',
  'closeout_recorded', 'learning_promoted',
  'context_accuracy_sample',
]);

function validateJournalEntry(entry: FounderJournalEntry): void {
  if (!entry.entryId || typeof entry.entryId !== 'string') {
    throw new Error('Missing entryId');
  }
  if (!entry.interactionId || typeof entry.interactionId !== 'string') {
    throw new Error('Missing interactionId');
  }
  if (!entry.workSessionId || typeof entry.workSessionId !== 'string') {
    throw new Error('Missing workSessionId');
  }
  if (!ALLOWED_EVENT_TYPES.has(entry.eventType)) {
    throw new Error(`Unknown event type: ${entry.eventType}`);
  }
  if (!entry.details || typeof entry.details !== 'object') {
    throw new Error('Missing details');
  }
}
