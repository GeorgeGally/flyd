import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type FounderJournalEntry,
  type WorkInteractionRequest,
  type WorkInteractionResponse,
  WORK_CONTRACT_VERSION,
  checkContractVersion,
} from '../work-intelligence/types.js';
import { recordJournalEntry, listJournalEntries, readJournalEntry, deleteJournalEntry } from '../work-intelligence/outcome-journal.js';

export async function handleJournalPost(req: IncomingMessage, res: ServerResponse, body: string): Promise<void> {
  let entry: FounderJournalEntry;
  try {
    entry = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON' });
    return;
  }

  try {
    recordJournalEntry(entry);
    sendJson(res, 201, { entryId: entry.entryId });
  } catch (err) {
    sendJson(res, 422, { error: (err as Error).message });
  }
}

export async function handleJournalList(req: IncomingMessage, res: ServerResponse, params: URLSearchParams): Promise<void> {
  const eventTypeFilter = params.get('event_type') || undefined;
  const workSessionIdFilter = params.get('work_session_id') || undefined;
  const since = params.get('since') || undefined;
  const limit = params.has('limit') ? parseInt(params.get('limit')!, 10) : 100;

  const entries = listJournalEntries({
    since,
    workSessionId: workSessionIdFilter,
  });

  const filtered = eventTypeFilter
    ? entries.filter(e => e.eventType === eventTypeFilter).slice(0, limit)
    : entries.slice(0, limit);

  sendJson(res, 200, { entries: filtered, total: filtered.length });
}

export async function handleJournalEntry(req: IncomingMessage, res: ServerResponse, entryId: string): Promise<void> {
  if (req.method === 'GET') {
    const entry = readJournalEntry(entryId);
    if (!entry) {
      sendJson(res, 404, { error: 'Entry not found' });
      return;
    }
    sendJson(res, 200, entry);
    return;
  }

  if (req.method === 'DELETE') {
    const deleted = deleteJournalEntry(entryId);
    if (!deleted) {
      sendJson(res, 404, { error: 'Entry not found' });
      return;
    }
    sendJson(res, 200, { deleted: entryId });
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}

export async function handleWorkInteractionContractNegotiation(req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJson(res, 200, {
    contract_version: WORK_CONTRACT_VERSION,
    supported: true,
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
