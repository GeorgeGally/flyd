import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WorkSessionStore } from '../work-intelligence/work-session-store.js';
import { terminalizeRepositoryAction, type RepositoryTerminalOutcome } from '../work-intelligence/repository-action-terminal.js';
import type { ActionGrant } from '../work-intelligence/types.js';

describe('terminalizeRepositoryAction', () => {
  let store: WorkSessionStore;
  let session: any;
  let grant: ActionGrant;
  let now: number;

  beforeEach(() => {
    store = new WorkSessionStore();
    session = store.createSession('session-1');
    now = Date.now();
    session.revision = 1;
    grant = {
      grantId: 'grant-1', actionId: 'action-1', interactionId: 'interaction-1', diagnosedIssueId: 'issue-1',
      instruction: 'Fix it', allowedOperation: 'repository_work', finishCondition: 'Tests pass',
      status: 'executing', grantedAt: new Date(now - 2_000).toISOString(), expiresAt: new Date(now + 60_000).toISOString(),
      claimedAt: new Date(now - 1_000).toISOString(), workSessionRevision: 1,
      targetFingerprint: { repositoryRoot: '/src', branch: 'main', headDigest: 'head', statusDigest: 'status' },
    };
    store.addActionGrant(session.sessionId, grant, now);
  });

  it('records exactly one linked failed receipt when there is no diff', () => {
    const record = vi.fn();
    const outcome: RepositoryTerminalOutcome = {
      verified: false,
      diffPresent: false,
      error: 'Root does not exist: /missing',
      changedFiles: [],
      verificationResults: [{ executable: 'tsc', exitStatus: 1, outputDigest: 'digest' }],
    };

    const receipt = terminalizeRepositoryAction(store, session.sessionId, grant, outcome, record, now + 1);

    expect(record).toHaveBeenCalledTimes(1);
    expect(receipt.eventType).toBe('action_failed');
    expect(receipt.details.repositoryOutcome?.verdict).toBe('failed');
    expect(receipt.details.repositoryOutcome?.changedFileCount).toBe(0);
    expect(receipt.details.repositoryOutcome?.handoffAvailable).toBe(false);
    expect(receipt.details.repositoryOutcome?.verificationResults).toEqual(outcome.verificationResults);
    
    expect(store.getActionGrant(session.sessionId, grant.grantId)?.status).toBe('failed');
  });

  it('records a partial receipt when diff is present but verification fails', () => {
    const record = vi.fn();
    const outcome: RepositoryTerminalOutcome = {
      verified: false,
      diffPresent: true,
      error: 'Verification failed',
      changedFiles: ['src/file.ts'],
      handoffLocation: '/tmp/worktree',
      verificationResults: [{ executable: 'vitest', exitStatus: 1, outputDigest: 'digest' }],
    };

    const receipt = terminalizeRepositoryAction(store, session.sessionId, grant, outcome, record, now + 1);

    expect(record).toHaveBeenCalledTimes(1);
    expect(receipt.eventType).toBe('action_partial');
    expect(receipt.details.repositoryOutcome?.verdict).toBe('partial');
    expect(receipt.details.repositoryOutcome?.changedFileCount).toBe(1);
    expect(receipt.details.repositoryOutcome?.handoffAvailable).toBe(true);
    expect(receipt.details.repositoryOutcome?.verificationResults).toEqual(outcome.verificationResults);
    
    expect(store.getActionGrant(session.sessionId, grant.grantId)?.status).toBe('partial');
  });

  it('records a verified receipt when successful and redacts secrets', () => {
    const record = vi.fn();
    const outcome: RepositoryTerminalOutcome = {
      verified: true,
      diffPresent: true,
      changedFiles: ['src/index.ts', 'config/.env.local', 'auth/google-secret.json'],
      handoffLocation: '/tmp/worktree',
      beforeStateDigest: 'before-digest',
      afterStateDigest: 'after-digest',
      verificationResults: [{ executable: 'tsc', exitStatus: 0, outputDigest: 'digest' }],
    };

    const receipt = terminalizeRepositoryAction(store, session.sessionId, grant, outcome, record, now + 1);

    expect(record).toHaveBeenCalledTimes(1);
    expect(receipt.eventType).toBe('action_completed');
    expect(receipt.details.repositoryOutcome?.verdict).toBe('verified');
    expect(receipt.details.repositoryOutcome?.changedFileCount).toBe(3);
    expect(receipt.details.repositoryOutcome?.changedFiles).toEqual([
      'src/index.ts',
      'config/[REDACTED]',
      'auth/[REDACTED]'
    ]);
    expect(receipt.details.repositoryOutcome?.handoffAvailable).toBe(true);
    expect(receipt.details.repositoryOutcome?.beforeStateDigest).toBe('before-digest');
    expect(receipt.details.repositoryOutcome?.afterStateDigest).toBe('after-digest');
    expect(receipt.details.repositoryOutcome?.verificationResults).toEqual(outcome.verificationResults);
    
    expect(store.getActionGrant(session.sessionId, grant.grantId)?.status).toBe('verified');
  });
});
