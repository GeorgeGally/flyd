import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SkillifyProposal } from './types.js';
import {
  getProposal,
  listPendingProposals,
  updateProposalStatus,
} from './proposal-store.js';
import { canonicalizeSkillifyTargetPath, skillifyWikiAbsolutePath } from './wiki-path.js';
import { recordJournalEntry } from '../outcome-journal.js';
import { parse, serialize } from '../../lib/frontmatter.js';

export interface SkillifyConfirmResult {
  ok: boolean;
  proposal?: SkillifyProposal;
  writtenPath?: string;
  error?: string;
}

function mergeWikiBody(existing: string, incoming: string, kind: string): string {
  const parsed = parse(existing);
  const incomingParsed = parse(incoming);
  const mergedBody = `${parsed.body.trim()}\n\n## Skillify update (${new Date().toISOString()})\n${incomingParsed.body.trim()}\n`;
  const metadata = {
    ...parsed.metadata,
    ...incomingParsed.metadata,
    type: incomingParsed.metadata.type ?? parsed.metadata.type ?? kind,
    updatedAt: new Date().toISOString(),
    source: 'skillify',
  };
  return serialize(metadata, mergedBody);
}

function writeWikiFile(proposal: SkillifyProposal, absolutePath: string): void {
  mkdirSync(dirname(absolutePath), { recursive: true });
  const content = existsSync(absolutePath)
    ? mergeWikiBody(readFileSync(absolutePath, 'utf-8'), proposal.body, proposal.kind)
    : proposal.body;
  writeFileSync(absolutePath, content, 'utf-8');
}

function recordWritten(proposal: SkillifyProposal, writtenPath: string): void {
  recordJournalEntry({
    entryId: `skillify-written-${proposal.id}`,
    interactionId: proposal.interactionId ?? proposal.id,
    workSessionId: proposal.workSessionId ?? proposal.id,
    timestamp: new Date().toISOString(),
    eventType: 'skillify_written',
    details: {
      domain: proposal.domain,
      artifactKind: proposal.kind,
      projectName: writtenPath,
    },
  });
}

export function confirmProposal(proposalId: string, revision: number): SkillifyConfirmResult {
  const proposal = getProposal(proposalId);
  if (!proposal) return { ok: false, error: 'Proposal not found' };
  if (proposal.status !== 'proposed') return { ok: false, error: `Proposal status is ${proposal.status}` };
  if (proposal.revision !== revision) return { ok: false, error: 'Proposal revision mismatch' };

  const canonical = canonicalizeSkillifyTargetPath(proposal.targetPath);
  if (!canonical) {
    return { ok: false, error: 'Target path outside skillify wiki allowlist' };
  }

  const absolutePath = skillifyWikiAbsolutePath(canonical);
  if (!absolutePath) {
    return { ok: false, error: 'Could not resolve wiki path' };
  }

  updateProposalStatus(proposalId, 'confirmed', { confirmedAt: new Date().toISOString() });

  try {
    writeWikiFile(proposal, absolutePath);
    if (!existsSync(absolutePath)) {
      throw new Error('Wiki file missing after write');
    }
    const written = updateProposalStatus(proposalId, 'written', {
      writtenAt: new Date().toISOString(),
      targetPath: canonical,
    });
    if (written) recordWritten(written, canonical);
    return { ok: true, proposal: written ?? undefined, writtenPath: canonical };
  } catch (error) {
    updateProposalStatus(proposalId, 'proposed', {
      confirmedAt: undefined,
    });
    return { ok: false, error: (error as Error).message };
  }
}

export function declineProposal(proposalId: string, revision: number): SkillifyConfirmResult {
  const proposal = getProposal(proposalId);
  if (!proposal) return { ok: false, error: 'Proposal not found' };
  if (proposal.status !== 'proposed') return { ok: false, error: `Proposal status is ${proposal.status}` };
  if (proposal.revision !== revision) return { ok: false, error: 'Proposal revision mismatch' };

  const declined = updateProposalStatus(proposalId, 'declined');
  return { ok: true, proposal: declined ?? undefined };
}

export function confirmAllPending(): SkillifyConfirmResult[] {
  return listPendingProposals().map((p) => confirmProposal(p.id, p.revision));
}

export function declineAllPending(): SkillifyConfirmResult[] {
  return listPendingProposals().map((p) => declineProposal(p.id, p.revision));
}
