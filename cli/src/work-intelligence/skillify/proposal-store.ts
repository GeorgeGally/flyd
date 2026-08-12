import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { SkillifyProposal, SkillifyProposalStatus, SkillifyProposeInput } from './types.js';
import { SKILLIFY_MAX_PENDING, SKILLIFY_TTL_DAYS } from './types.js';
import { canonicalizeSkillifyTargetPath } from './wiki-path.js';

let proposalDirOverride: string | undefined;

export function configureSkillifyProposalDirectory(directory?: string): void {
  proposalDirOverride = directory;
}

function proposalDir(): string {
  if (proposalDirOverride) return proposalDirOverride;
  const flydDir = process.env.FLYD_DIR?.trim() || join(homedir(), '.flyd');
  return join(flydDir, 'overlay', 'skillify-proposals');
}

function ensureDir(): void {
  const dir = proposalDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function proposalPath(id: string): string {
  return join(proposalDir(), `${id}.json`);
}

function readProposalFile(id: string): SkillifyProposal | null {
  const path = proposalPath(id);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as SkillifyProposal;
  } catch {
    return null;
  }
}

function writeProposal(proposal: SkillifyProposal): void {
  ensureDir();
  writeFileSync(proposalPath(proposal.id), JSON.stringify(proposal, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

/** Expire pending proposals past TTL. Returns count expired. */
export function expireStaleProposals(now = new Date()): number {
  ensureDir();
  let expired = 0;
  for (const file of readdirSync(proposalDir()).filter((f) => f.endsWith('.json'))) {
    const id = file.replace(/\.json$/, '');
    const proposal = readProposalFile(id);
    if (!proposal || proposal.status !== 'proposed') continue;
    if (proposal.expiresAt <= now.toISOString()) {
      writeProposal({ ...proposal, status: 'expired' });
      expired += 1;
    }
  }
  return expired;
}

export function listPendingProposals(): SkillifyProposal[] {
  expireStaleProposals();
  ensureDir();
  const proposals: SkillifyProposal[] = [];
  for (const file of readdirSync(proposalDir()).filter((f) => f.endsWith('.json'))) {
    const proposal = readProposalFile(file.replace(/\.json$/, ''));
    if (proposal && proposal.status === 'proposed') proposals.push(proposal);
  }
  return proposals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listPendingForSession(workSessionId: string): SkillifyProposal[] {
  return listPendingProposals().filter((p) => p.workSessionId === workSessionId);
}

export function getProposal(id: string): SkillifyProposal | null {
  expireStaleProposals();
  return readProposalFile(id);
}

export function countPendingProposals(): number {
  return listPendingProposals().length;
}

export function findPendingByDedupeKey(dedupeKey: string): SkillifyProposal | null {
  return listPendingProposals().find((p) => p.dedupeKey === dedupeKey) ?? null;
}

/**
 * Overflow policy: reject new proposals when max pending reached.
 * DedupeKey coalesces to the existing pending proposal instead of creating a second.
 */
export function createProposal(
  input: SkillifyProposeInput & { workSessionId?: string; interactionId?: string },
): SkillifyProposal | null {
  expireStaleProposals();

  const existing = findPendingByDedupeKey(input.dedupeKey);
  if (existing) return existing;

  if (countPendingProposals() >= SKILLIFY_MAX_PENDING) {
    return null;
  }

  const canonicalTarget = canonicalizeSkillifyTargetPath(input.targetPath);
  if (!canonicalTarget) return null;

  const now = new Date();
  const expires = new Date(now.getTime() + SKILLIFY_TTL_DAYS * 24 * 60 * 60 * 1000);

  const proposal: SkillifyProposal = {
    id: randomUUID(),
    kind: input.kind,
    targetPath: canonicalTarget,
    body: input.body,
    provenance: input.provenance,
    sourceOutcome: input.sourceOutcome,
    domain: input.domain,
    workSessionId: input.workSessionId,
    interactionId: input.interactionId,
    status: 'proposed',
    dedupeKey: input.dedupeKey,
    revision: 1,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };

  writeProposal(proposal);
  return proposal;
}

export function updateProposalStatus(
  id: string,
  status: SkillifyProposalStatus,
  patch: Partial<SkillifyProposal> = {},
): SkillifyProposal | null {
  const proposal = getProposal(id);
  if (!proposal) return null;
  if (proposal.status === 'written' || proposal.status === 'expired') return null;

  const updated: SkillifyProposal = { ...proposal, ...patch, status };
  writeProposal(updated);
  return updated;
}

export function deleteProposal(id: string): boolean {
  const path = proposalPath(id);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}
