import { describe, it, expect, beforeEach } from 'vitest';
import { WorkSessionStore, workSessionStore, type WorkSession } from '../work-intelligence/work-session-store.js';
import type { CurrentWork, EvidenceSummary, ActionGrant } from '../work-intelligence/types.js';

function makeEvidenceSummary(overrides: Partial<EvidenceSummary> = {}): EvidenceSummary {
  return {
    sources: ['foreground_element'],
    snapshotTimestamp: new Date().toISOString(),
    foregroundApp: 'Xcode',
    activeWindowTitle: 'AuthService.swift',
    ...overrides,
  };
}

function makeCurrentWork(overrides: Partial<CurrentWork> = {}): CurrentWork {
  return {
    project: { value: 'CleanX', source: 'foreground', confidence: 'high', provenance: 'test', sourceTimestamp: new Date().toISOString(), isHypothesis: false },
    objective: { value: 'Fix auth', source: 'foreground', confidence: 'medium', provenance: 'test', sourceTimestamp: new Date().toISOString(), isHypothesis: false },
    artifact: { kind: 'code', title: 'AuthService.swift', contentDigest: 'test' },
    stage: { value: 'execution', source: 'foreground', confidence: 'medium', provenance: 'test', sourceTimestamp: new Date().toISOString(), isHypothesis: false },
    constraints: { value: [], source: 'foreground', confidence: 'low', provenance: 'test', sourceTimestamp: new Date().toISOString(), isHypothesis: true },
    openLoops: [],
    nextAction: { value: { description: 'Review', readiness: 'ready' }, source: 'foreground', confidence: 'high', provenance: 'test', sourceTimestamp: new Date().toISOString(), isHypothesis: false },
    evidenceSummary: makeEvidenceSummary(),
    uncertainty: [],
    confidence: [],
    ...overrides,
  };
}

describe('work-session-store', () => {
  beforeEach(() => {
    // Reset singleton state between tests by closing all sessions
    const sessions = workSessionStore as unknown as { sessions: Map<string, WorkSession> };
    sessions.sessions.clear();
  });

  describe('repository action grants', () => {
    it('mints a bound grant from a stored proposal and claims it once', () => {
      const store = new WorkSessionStore();
      const session = store.createSession();
      session.revision = 3;
      session.turns.push({
        turnId: 'turn-1',
        interactionId: 'interaction-1',
        intent: 'Fix the regression',
        assistant: 'The validation boundary is missing.',
        timestamp: new Date().toISOString(),
        proposedAction: {
          actionId: 'action-1',
          kind: 'repository_action',
          description: 'Add the missing validation',
          targetFingerprint: {
            repositoryRoot: '/tmp/project',
            branch: 'main',
            headDigest: 'head-1',
            statusDigest: 'status-1',
          },
          workSessionRevision: 3,
          diagnosedIssueId: 'diagnosis-1',
          finishCondition: 'The regression test passes',
          expiryMs: 60_000,
          allowedOperation: 'repository_work',
        },
      });

      const approval = store.approveActionProposal(session.sessionId, 'action-1', 3, 1_000);
      expect(approval.ok).toBe(true);
      if (!approval.ok) return;
      expect(approval.grant).toMatchObject({
        actionId: 'action-1',
        interactionId: 'interaction-1',
        diagnosedIssueId: 'diagnosis-1',
        instruction: 'Add the missing validation',
        allowedOperation: 'repository_work',
        finishCondition: 'The regression test passes',
        status: 'approved',
      });

      const firstClaim = store.claimActionGrant(session.sessionId, approval.grant.grantId, 3, 2_000);
      expect(firstClaim.ok).toBe(true);
      const replay = store.claimActionGrant(session.sessionId, approval.grant.grantId, 3, 2_001);
      expect(replay).toEqual({ ok: false, error: 'Action grant is already executing' });
    });

    it('rejects stale and expired proposal authority', () => {
      const store = new WorkSessionStore();
      const session = store.createSession();
      session.revision = 2;
      session.turns.push({
        turnId: 'turn-1', interactionId: 'interaction-1', intent: 'Fix it', assistant: 'Proposed', timestamp: new Date().toISOString(),
        proposedAction: {
          actionId: 'action-1', kind: 'repository_action', description: 'Fix it',
          targetFingerprint: { repositoryRoot: '/tmp/project', branch: 'main', headDigest: 'head-1', statusDigest: 'status-1' },
          workSessionRevision: 2, diagnosedIssueId: 'diagnosis-1', finishCondition: 'Tests pass', expiryMs: 10,
          allowedOperation: 'repository_work',
        },
      });

      expect(store.approveActionProposal(session.sessionId, 'action-1', 1, 1_000)).toEqual({
        ok: false,
        error: 'Work Session revision is stale',
      });
      const approval = store.approveActionProposal(session.sessionId, 'action-1', 2, 1_000);
      expect(approval.ok).toBe(true);
      if (!approval.ok) return;
      expect(store.claimActionGrant(session.sessionId, approval.grant.grantId, 2, 1_011)).toEqual({
        ok: false,
        error: 'Action grant has expired',
      });
    });
  });

  it('creates a session with unique ID and revision 0', () => {
    const session = workSessionStore.createSession();
    expect(session.sessionId).toBeDefined();
    expect(session.revision).toBe(0);
    expect(session.turns).toHaveLength(0);
  });

  it('retrieves a session by ID', () => {
    const created = workSessionStore.createSession();
    const retrieved = workSessionStore.get(created.sessionId);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.sessionId).toBe(created.sessionId);
  });

  it('returns null for expired session', () => {
    const created = workSessionStore.createSession();
    const farFuture = Date.now() + 40 * 60 * 1000;
    const expired = workSessionStore.get(created.sessionId, farFuture);
    expect(expired).toBeNull();
  });

  it('bump returns null for expired ID', () => {
    const created = workSessionStore.createSession();
    const farFuture = Date.now() + 40 * 60 * 1000;
    const bumped = workSessionStore.bump(created.sessionId, farFuture);
    expect(bumped).toBeNull();
  });

  it('adds turns and increments revision', () => {
    const session = workSessionStore.createSession();
    workSessionStore.addTurn(session.sessionId, 'Review this', 'Found issue', 'augment', makeCurrentWork());
    const retrieved = workSessionStore.get(session.sessionId);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.revision).toBe(1);
    expect(retrieved!.turns).toHaveLength(1);
    expect(retrieved!.turns[0].intent).toBe('Review this');
    expect(retrieved!.currentWork).toBeDefined();
    expect(retrieved!.currentWork!.project.value).toBe('CleanX');
  });

  it('gets active conversation turns', () => {
    const session = workSessionStore.createSession();
    workSessionStore.addTurn(session.sessionId, 'Hello', 'Hi there');
    workSessionStore.addTurn(session.sessionId, 'Review this', 'Found bug');
    const turns = workSessionStore.getActiveConversationTurns(session.sessionId);
    expect(turns).toHaveLength(2);
    expect(turns[0].user).toBe('Hello');
    expect(turns[1].user).toBe('Review this');
  });

  it('updates evidence summary', () => {
    const session = workSessionStore.createSession();
    const summary = makeEvidenceSummary({ repositoryRoot: '/Users/george/Projects/CleanX' });
    workSessionStore.updateEvidenceSummary(session.sessionId, summary);
    const retrieved = workSessionStore.get(session.sessionId);
    expect(retrieved!.evidenceSummary.repositoryRoot).toBe('/Users/george/Projects/CleanX');
  });

  it('manages action grants', () => {
    const session = workSessionStore.createSession();
    const grant: ActionGrant = {
      grantId: 'ag_001',
      actionId: 'act_001',
      interactionId: 'interaction-001',
      diagnosedIssueId: 'diagnosis-001',
      instruction: 'Replace the text',
      allowedOperation: 'replace_text',
      finishCondition: 'The replacement is present',
      status: 'approved',
      grantedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      workSessionRevision: 1,
      targetFingerprint: { elementRef: 'el_01' },
    };
    workSessionStore.addActionGrant(session.sessionId, grant);
    expect(workSessionStore.getActionGrant(session.sessionId, 'ag_001')?.status).toBe('approved');

    workSessionStore.updateActionGrant(session.sessionId, { ...grant, status: 'verified' });
    expect(workSessionStore.getActionGrant(session.sessionId, 'ag_001')?.status).toBe('verified');
  });

  it('invalidates all action grants on demand', () => {
    const session = workSessionStore.createSession();
    const grant: ActionGrant = {
      grantId: 'ag_001',
      actionId: 'act_001',
      interactionId: 'interaction-001',
      diagnosedIssueId: 'diagnosis-001',
      instruction: 'Replace the text',
      allowedOperation: 'replace_text',
      finishCondition: 'The replacement is present',
      status: 'approved',
      grantedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      workSessionRevision: 1,
      targetFingerprint: { elementRef: 'el_01' },
    };
    workSessionStore.addActionGrant(session.sessionId, grant);
    workSessionStore.invalidateActionGrants(session.sessionId, 'context changed');

    const retrieved = workSessionStore.getActionGrant(session.sessionId, 'ag_001');
    expect(retrieved).toBeUndefined();
  });

  it('closes a session and removes it', () => {
    const session = workSessionStore.createSession();
    const closed = workSessionStore.closeSession(session.sessionId);
    expect(closed).not.toBeNull();
    expect(workSessionStore.get(session.sessionId)).toBeNull();
  });

  it('caps turns at maxTurns', () => {
    const session = workSessionStore.createSession();
    for (let i = 0; i < 25; i++) {
      workSessionStore.addTurn(session.sessionId, `Intent ${i}`, `Response ${i}`);
    }
    const retrieved = workSessionStore.get(session.sessionId);
    expect(retrieved!.turns.length).toBeLessThanOrEqual(20);
  });
});
