import { randomUUID } from 'node:crypto';
import type { ActionGrant, CurrentWork, EvidenceSummary } from './types.js';

export interface WorkSessionTurn {
  turnId: string;
  interactionId: string;
  intent: string;
  assistant: string;
  timestamp: string;
  resolutionMode?: string;
  currentWork?: CurrentWork;
  actionGrants?: ActionGrant[];
}

export interface WorkSession {
  sessionId: string;
  createdAt: string;
  lastActiveAt: string;
  revision: number;
  evidenceSummary: EvidenceSummary;
  turns: WorkSessionTurn[];
  currentWork?: CurrentWork;
  activeActionGrants: Map<string, ActionGrant>;
}

export class WorkSessionStore {
  private readonly sessions = new Map<string, WorkSession>();
  private readonly maxTurns = 20;
  private readonly ttlMs = 30 * 60 * 1000;

  createSession(): WorkSession {
    const session: WorkSession = {
      sessionId: randomUUID(),
      createdAt: new Date().toISOString(),
      lastActiveAt: Date.now().toString(),
      revision: 0,
      evidenceSummary: {
        sources: [],
        snapshotTimestamp: new Date().toISOString(),
        foregroundApp: 'unknown',
        activeWindowTitle: 'unknown',
      },
      turns: [],
      activeActionGrants: new Map(),
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  get(sessionId: string, now = Date.now()): WorkSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (now - parseInt(session.lastActiveAt) > this.ttlMs) {
      session.lastActiveAt = now.toString();
      return null;
    }

    return session;
  }

  bump(sessionId: string, now = Date.now()): WorkSession | null {
    const session = this.get(sessionId, now);
    if (session) {
      session.lastActiveAt = now.toString();
      return session;
    }
    return null;
  }

  addTurn(
    sessionId: string,
    intent: string,
    assistant: string,
    resolutionMode?: string,
    currentWork?: CurrentWork,
    actionGrants?: ActionGrant[],
    now = Date.now()
  ): void {
    const session = this.bump(sessionId, now) ?? this.createSession();
    session.revision += 1;

    const turn: WorkSessionTurn = {
      turnId: randomUUID(),
      interactionId: randomUUID(),
      intent,
      assistant,
      timestamp: new Date().toISOString(),
      resolutionMode,
      currentWork,
      actionGrants,
    };

    session.turns.push(turn);
    session.currentWork = currentWork || session.currentWork;

    while (session.turns.length > this.maxTurns) {
      session.turns.shift();
    }
  }

  updateEvidenceSummary(sessionId: string, summary: EvidenceSummary, now = Date.now()): void {
    const session = this.bump(sessionId, now) ?? this.createSession();
    session.evidenceSummary = summary;
    session.revision += 1;
    session.currentWork = session.currentWork
      ? { ...session.currentWork, evidenceSummary: summary }
      : undefined;
  }

  updateCurrentWork(sessionId: string, currentWork: CurrentWork, now = Date.now()): void {
    const session = this.bump(sessionId, now) ?? this.createSession();
    session.currentWork = currentWork;
    session.revision += 1;
  }

  getCurrentWork(sessionId: string): CurrentWork | undefined {
    const session = this.get(sessionId);
    return session?.currentWork;
  }

  getRevision(sessionId: string): number {
    const session = this.get(sessionId);
    return session?.revision ?? 0;
  }

  addActionGrant(sessionId: string, grant: ActionGrant, now = Date.now()): void {
    const session = this.bump(sessionId, now) ?? this.createSession();
    session.activeActionGrants.set(grant.grantId, grant);
  }

  updateActionGrant(sessionId: string, grant: ActionGrant, now = Date.now()): void {
    const session = this.bump(sessionId, now) ?? this.createSession();
    session.activeActionGrants.set(grant.grantId, grant);
  }

  getActionGrant(sessionId: string, grantId: string): ActionGrant | undefined {
    const session = this.get(sessionId);
    return session?.activeActionGrants.get(grantId);
  }

  invalidateActionGrants(sessionId: string, reason: string, now = Date.now()): void {
    const session = this.bump(sessionId, now) ?? this.createSession();
    for (const [id, grant] of session.activeActionGrants) {
      grant.status = 'invalidated';
      grant.invalidationReason = reason;
    }
    session.activeActionGrants.clear();
  }

  getActiveConversationTurns(sessionId: string): { user: string; assistant: string }[] {
    const session = this.get(sessionId);
    if (!session) return [];

    return session.turns.slice(-10).map(t => ({
      user: t.intent,
      assistant: t.assistant,
    }));
  }

  closeSession(sessionId: string): WorkSession | null {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
    }
    return session || null;
  }

  sessionCount(): number {
    return this.sessions.size;
  }
}

export const workSessionStore = new WorkSessionStore();
