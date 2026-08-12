import type { ActionGrant, FounderJournalEntry } from './types.js';
import type { WorkSessionStore } from './work-session-store.js';

export interface RepositoryTerminalOutcome {
  verified: boolean;
  diffPresent: boolean;
  error?: string;
  changedFiles: string[];
  diffDigest?: string;
  beforeStateDigest?: string;
  afterStateDigest?: string;
  approvedSourceFingerprintDigest?: string;
  postRunSourceFingerprintDigest?: string;
  handoffLocation?: string;
  verificationResults?: { executable: string; exitStatus: number; outputDigest: string }[];
}

export function terminalizeRepositoryAction(
  store: WorkSessionStore,
  sessionId: string,
  grant: ActionGrant,
  outcome: RepositoryTerminalOutcome,
  record: (entry: FounderJournalEntry) => void,
  now = Date.now(),
): FounderJournalEntry {
  const status = outcome.verified ? 'verified' : outcome.diffPresent ? 'partial' : 'failed';
  const verificationResults = outcome.verificationResults ?? [];
  const checksPerformed = verificationResults.map(check => check.executable);
  const entry: FounderJournalEntry = {
    entryId: `repository-${grant.grantId}`,
    interactionId: grant.interactionId,
    workSessionId: sessionId,
    timestamp: new Date(now).toISOString(),
    eventType: outcome.verified ? 'action_completed' : outcome.diffPresent ? 'action_partial' : 'action_failed',
    details: {
      actionKind: 'repository_action',
      verified: outcome.verified,
      repositoryOutcome: {
        actionId: grant.actionId,
        actionGrantId: grant.grantId,
        diagnosedIssueId: grant.diagnosedIssueId,
        approval: 'approved',
        beforeStateDigest: outcome.beforeStateDigest,
        afterStateDigest: outcome.afterStateDigest,
        approvedSourceFingerprintDigest: outcome.approvedSourceFingerprintDigest,
        postRunSourceFingerprintDigest: outcome.postRunSourceFingerprintDigest,
        diffDigest: outcome.diffDigest,
        changedFiles: outcome.changedFiles.map(path => path.replace(/(?:^|\/)(?:\.env[^/]*|[^/]*(?:secret|token|credential)[^/]*)/gi, '/[REDACTED]')),
        changedFileCount: outcome.changedFiles.length,
        checksPerformed,
        verificationResults,
        verdict: status,
        handoffAvailable: Boolean(outcome.handoffLocation),
      },
    },
  };

  record(entry);
  store.updateActionGrant(sessionId, {
    ...grant,
    status,
    invalidationReason: outcome.error,
    result: {
      verified: outcome.verified,
      diffDigest: outcome.diffDigest,
      checksPerformed,
      unresolvedIssues: outcome.error ? [outcome.error] : undefined,
    },
  }, now);
  return entry;
}
