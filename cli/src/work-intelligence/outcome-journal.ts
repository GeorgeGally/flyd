import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import type { FounderJournalEntry, FounderEventType } from './types.js';
import { FLYD_DIR } from '../lib/config.js';

let journalDir = join(FLYD_DIR, 'overlay', 'founder-journal');

export function configureOutcomeJournalDirectory(directory: string): void {
  journalDir = resolvePath(directory);
}

function ensureJournalDir(): void {
  if (!existsSync(journalDir)) {
    mkdirSync(journalDir, { recursive: true, mode: 0o700 });
  }
}

export function recordJournalEntry(entry: FounderJournalEntry): void {
  ensureJournalDir();
  validateJournalEntry(entry);
  const filePath = join(journalDir, `${entry.entryId}.json`);
  try {
    writeFileSync(filePath, JSON.stringify(entry, null, 2), { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Journal entry already exists: ${entry.entryId}`);
    }
    throw error;
  }
}

export function readJournalEntry(entryId: string): FounderJournalEntry | null {
  const filePath = join(journalDir, `${entryId}.json`);
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
    files = readdirSync(journalDir).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }
  const entries: FounderJournalEntry[] = [];

  for (const file of files) {
    try {
      const raw = readFileSync(join(journalDir, file), 'utf-8');
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
  const filePath = join(journalDir, `${entryId}.json`);
  if (!existsSync(filePath)) return false;
  unlinkSync(filePath);
  return true;
}

const ALLOWED_EVENT_TYPES: Set<string> = new Set([
  'intervention_accepted', 'intervention_rejected',
  'artifact_improved', 'project_advanced',
  'issue_discovered', 'correction_applied',
  'standard_accepted', 'action_completed',
  'action_approved', 'action_failed', 'action_partial',
  'closeout_recorded', 'learning_promoted',
  'context_accuracy_sample',
  'command_approved', 'command_rejected',
  'command_completed', 'command_failed',
]);

function validateJournalEntry(entry: FounderJournalEntry): void {
  if (!entry.entryId || typeof entry.entryId !== 'string') {
    throw new Error('Missing entryId');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(entry.entryId)) {
    throw new Error('Invalid entryId: must be alphanumeric, dash, or underscore');
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
