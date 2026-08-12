import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { WorkSessionCloseout, LearningCandidate } from './types.js';
import { workSessionStore } from './work-session-store.js';
import { recordJournalEntry } from './outcome-journal.js';
import { randomUUID } from 'node:crypto';

const CLOSEOUT_DIR = join(homedir(), '.flyd', 'overlay', 'session-closeouts');

function ensureCloseoutDir(): void {
  if (!existsSync(CLOSEOUT_DIR)) {
    mkdirSync(CLOSEOUT_DIR, { recursive: true });
  }
}

export function closeWorkSession(sessionId: string): WorkSessionCloseout | null {
  const session = workSessionStore.closeSession(sessionId);
  if (!session) return null;

  const closeout: WorkSessionCloseout = {
    workSessionId: session.sessionId,
    closedAt: new Date().toISOString(),
    project: session.currentWork?.project?.value || 'unknown',
    artifact: {
      kind: session.currentWork?.artifact?.kind || 'unknown',
      title: session.currentWork?.artifact?.title || 'unknown',
      path: session.currentWork?.artifact?.path,
    },
    lastVerifiedState: session.turns.length > 0
      ? 'session contained ' + session.turns.length + ' turns'
      : 'no turns',
    unresolvedIssues: [],
    nextAction: session.currentWork?.nextAction?.value?.description || 'unknown',
    corrections: [],
    acceptedStandards: [],
    retainedLearnings: promoteLearningsFromSession(session.turns),
  };

  ensureCloseoutDir();
  const filePath = join(CLOSEOUT_DIR, `${closeout.workSessionId}.json`);
  writeFileSync(filePath, JSON.stringify(closeout, null, 2), 'utf-8');

  recordJournalEntry({
    entryId: `closeout-${closeout.workSessionId}`,
    interactionId: closeout.workSessionId,
    workSessionId: closeout.workSessionId,
    timestamp: closeout.closedAt,
    eventType: 'closeout_recorded',
    details: {
      projectName: closeout.project,
      artifactKind: closeout.artifact.kind,
      artifactTitle: closeout.artifact.title,
    },
  });

  return closeout;
}

function promoteLearningsFromSession(turns: { intent: string; resolutionMode?: string }[]): LearningCandidate[] {
  const learnings: LearningCandidate[] = [];
  const intentSet = new Set<string>();

  for (const turn of turns) {
    if (!turn.intent || intentSet.has(turn.intent)) continue;
    intentSet.add(turn.intent);

    // Only promote intents that look like corrections or decisions
    if (turn.intent.startsWith('fix ') || turn.intent.startsWith('correct ') ||
        turn.intent.startsWith('decide ') || turn.intent.startsWith('set ')) {
      learnings.push({
        id: randomUUID(),
        source: 'correction',
        content: turn.intent,
        domain: turn.resolutionMode || 'strategy',
        outcomeRef: turn.intent.slice(0, 40),
        epistemicConfidence: 'medium',
        timestamp: new Date().toISOString(),
      });
    }
  }

  return learnings.slice(0, 5);
}

export function readCloseout(sessionId: string): WorkSessionCloseout | null {
  const filePath = join(CLOSEOUT_DIR, `${sessionId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function readLatestCloseoutForProject(projectName: string): WorkSessionCloseout | null {
  const normalized = projectName.trim().toLowerCase();
  const closeouts = listCloseouts(50);
  return (
    closeouts.find((c) => c.project.trim().toLowerCase() === normalized) ?? null
  );
}

export function listCloseouts(limit = 20): WorkSessionCloseout[] {
  ensureCloseoutDir();
  try {
    const files = readdirSync(CLOSEOUT_DIR).filter(f => f.endsWith('.json'));
    const closeouts: WorkSessionCloseout[] = [];
    for (const file of files.slice(-limit)) {
      try {
        const raw = readFileSync(join(CLOSEOUT_DIR, file), 'utf-8');
        closeouts.push(JSON.parse(raw));
      } catch { continue; }
    }
    return closeouts.sort((a, b) => b.closedAt.localeCompare(a.closedAt));
  } catch {
    return [];
  }
}
