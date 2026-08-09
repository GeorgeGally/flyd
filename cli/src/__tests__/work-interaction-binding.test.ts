import { describe, expect, it } from 'vitest';
import { bindProposedAction } from '../work-intelligence/work-interaction-service.js';
import type { ActionProposal, CurrentWork } from '../work-intelligence/types.js';

const proposal: ActionProposal = {
  actionId: 'action-1',
  kind: 'repository_action',
  description: 'Fix the regression',
  targetFingerprint: {},
  workSessionRevision: 0,
  diagnosedIssueId: '',
  finishCondition: 'Tests pass',
  expiryMs: 60_000,
  allowedOperation: 'repository_work',
};

function currentWork(repository = true): CurrentWork {
  return {
    evidenceSummary: {
      sources: ['repository'],
      snapshotTimestamp: new Date().toISOString(),
      foregroundApp: 'Terminal',
      activeWindowTitle: 'flyd',
      ...(repository ? {
        repositoryRoot: '/tmp/flyd',
        branch: 'main',
        headDigest: 'head-1',
        statusDigest: 'status-1',
      } : {}),
    },
  } as CurrentWork;
}

describe('repository proposal binding', () => {
  it('replaces model authority fields with captured Work Session evidence', () => {
    expect(bindProposedAction(proposal, currentWork(), 4, 'diagnosis-1')).toMatchObject({
      workSessionRevision: 4,
      diagnosedIssueId: 'diagnosis-1',
      allowedOperation: 'repository_work',
      targetFingerprint: {
        repositoryRoot: '/tmp/flyd',
        branch: 'main',
        headDigest: 'head-1',
        statusDigest: 'status-1',
      },
    });
  });

  it('downgrades repository work to advisory when repository evidence is incomplete', () => {
    expect(bindProposedAction(proposal, currentWork(false), 4, 'diagnosis-1')).toBeUndefined();
  });
});
