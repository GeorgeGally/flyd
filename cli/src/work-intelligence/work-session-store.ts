import { randomUUID } from 'node:crypto';
import type { ActionGrant, ActionProposal, CurrentWork, EvidenceSummary } from './types.js';

export interface WorkSessionTurn {
  turnId: string;
  interactionId: string;
  intent: string;
  assistant: string;
  timestamp: string;
  resolutionMode?: string;
  currentWork?: CurrentWork;
  actionGrants?: ActionGrant[];
  proposedAction?: ActionProposal;
}

type GrantResult =
  | { ok: true; grant: ActionGrant }
  | { ok: false; error: string };

type AuthorizedSessionResult =
  | { ok: true; session: WorkSession }
  | { ok: false; error: string };

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

  createSession(sessionId: string = randomUUID()): WorkSession {
    const session: WorkSession = {
      sessionId,
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
    const session = this.bump(sessionId, now);
    if (!session) throw new Error('Work Session was not found');
    session.activeActionGrants.set(grant.grantId, grant);
  }

  updateActionGrant(sessionId: string, grant: ActionGrant, now = Date.now()): void {
    const session = this.bump(sessionId, now);
    if (!session) throw new Error('Work Session was not found');
    session.activeActionGrants.set(grant.grantId, grant);
  }

  getActionGrant(sessionId: string, grantId: string): ActionGrant | undefined {
    const session = this.get(sessionId);
    return session?.activeActionGrants.get(grantId);
  }

  approveActionProposal(
    sessionId: string,
    actionId: string,
    workSessionRevision: number,
    now = Date.now()
  ): GrantResult {
    const authorized = this.authorizedSession(sessionId, workSessionRevision, now);
    if (!authorized.ok) return authorized;
    const session = authorized.session;

    const turn = [...session.turns].reverse().find(candidate => candidate.proposedAction?.actionId === actionId);
    const proposal = turn?.proposedAction;
    if (!turn || !proposal) return { ok: false, error: 'Action proposal was not found' };
    if (proposal.workSessionRevision !== workSessionRevision) {
      return { ok: false, error: 'Action proposal revision is stale' };
    }
    if (
      proposal.kind !== 'repository_action'
      || proposal.allowedOperation !== 'repository_work'
      || !proposal.diagnosedIssueId.trim()
      || !proposal.finishCondition.trim()
      || proposal.expiryMs <= 0
      || !proposal.targetFingerprint.repositoryRoot
      || !proposal.targetFingerprint.branch
      || !proposal.targetFingerprint.headDigest
      || !proposal.targetFingerprint.statusDigest
    ) {
      return { ok: false, error: 'Action proposal is not executable' };
    }

    const existing = [...session.activeActionGrants.values()].find(grant =>
      grant.actionId === actionId && (grant.status === 'approved' || grant.status === 'executing')
    );
    if (existing) return { ok: false, error: 'Action proposal already has an active grant' };

    const grant: ActionGrant = {
      grantId: randomUUID(),
      actionId: proposal.actionId,
      interactionId: turn.interactionId,
      diagnosedIssueId: proposal.diagnosedIssueId,
      instruction: proposal.description,
      allowedOperation: proposal.allowedOperation,
      finishCondition: proposal.finishCondition,
      status: 'approved',
      grantedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + proposal.expiryMs).toISOString(),
      workSessionRevision,
      targetFingerprint: { ...proposal.targetFingerprint },
    };
    session.activeActionGrants.set(grant.grantId, grant);
    session.lastActiveAt = now.toString();
    return { ok: true, grant };
  }

  claimActionGrant(
    sessionId: string,
    grantId: string,
    workSessionRevision: number,
    now = Date.now()
  ): GrantResult {
    const authorized = this.authorizedSession(sessionId, workSessionRevision, now);
    if (!authorized.ok) return authorized;
    const session = authorized.session;

    const grant = session.activeActionGrants.get(grantId);
    if (!grant) return { ok: false, error: 'Action grant was not found' };
    if (grant.workSessionRevision !== workSessionRevision) {
      return { ok: false, error: 'Action grant revision is stale' };
    }
    if (grant.status === 'executing') {
      return { ok: false, error: 'Action grant is already executing' };
    }
    if (grant.status !== 'approved') {
      return { ok: false, error: 'Action grant is not executable' };
    }
    if (Date.parse(grant.expiresAt) <= now) {
      grant.status = 'invalidated';
      grant.invalidationReason = 'expired';
      return { ok: false, error: 'Action grant has expired' };
    }

    grant.status = 'executing';
    grant.claimedAt = new Date(now).toISOString();
    session.lastActiveAt = now.toString();
    return { ok: true, grant };
  }

  private authorizedSession(
    sessionId: string,
    workSessionRevision: number,
    now: number,
  ): AuthorizedSessionResult {
    const session = this.get(sessionId, now);
    if (!session) return { ok: false, error: 'Work Session was not found' };
    if (session.revision !== workSessionRevision) {
      return { ok: false, error: 'Work Session revision is stale' };
    }
    return { ok: true, session };
  }

  invalidateActionGrants(sessionId: string, reason: string, now = Date.now()): void {
    const session = this.bump(sessionId, now);
    if (!session) return;
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
