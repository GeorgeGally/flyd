import { createHash, randomUUID } from 'node:crypto';
import { gateLearningCandidate } from '../../memory-gate.js';
import type { LearningCandidate } from '../types.js';
import type { SkillifyProposal, SkillifyProposalKind, SkillifyProposeInput } from './types.js';
import { createProposal } from './proposal-store.js';
import { recordJournalEntry } from '../outcome-journal.js';
import { canonicalizeSkillifyTargetPath } from './wiki-path.js';

export interface SkillifyOutcomeContext {
  workSessionId: string;
  interactionId: string;
  outcomeStatus: string;
  correction?: string | null;
  domain?: string;
  artifactKind?: string;
  projectName?: string;
  intent?: string;
}

function slugify(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .slice(0, 60)
    .replace(/^-+|-+$/g, '') || 'untitled';
}

function dedupeKey(kind: SkillifyProposalKind, targetPath: string, body: string): string {
  const digest = createHash('sha256').update(body.trim()).digest('hex').slice(0, 16);
  return `${kind}:${targetPath}:${digest}`;
}

function recordProposed(proposal: SkillifyProposal): void {
  recordJournalEntry({
    entryId: `skillify-proposed-${proposal.id}`,
    interactionId: proposal.interactionId ?? proposal.id,
    workSessionId: proposal.workSessionId ?? proposal.id,
    timestamp: proposal.createdAt,
    eventType: 'skillify_proposed',
    details: {
      domain: proposal.domain,
      artifactKind: proposal.kind,
      userCorrection: proposal.body.slice(0, 200),
    },
  });
}

function propose(input: SkillifyProposeInput & {
  workSessionId?: string;
  interactionId?: string;
}): SkillifyProposal | null {
  if (!canonicalizeSkillifyTargetPath(input.targetPath)) return null;
  const proposal = createProposal(input);
  if (proposal) recordProposed(proposal);
  return proposal;
}

function resolveDomain(ctx: SkillifyOutcomeContext): string {
  return (ctx.domain || ctx.artifactKind || 'strategy').toLowerCase();
}

export function proposeFromNaturalLanguage(params: {
  selection: string;
  domain?: string;
  workSessionId?: string;
  interactionId?: string;
}): SkillifyProposal | null {
  const content = params.selection.trim();
  if (content.length < 12) return null;

  const domain = (params.domain || 'strategy').toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'strategy';
  const targetPath = `standards/${slugify(domain)}.md`;
  const interactionId = params.interactionId ?? `nl-${randomUUID().slice(0, 8)}`;
  const workSessionId = params.workSessionId ?? interactionId;
  const body = `---
type: domain_standard
domain: ${domain}
source: skillify
provenance: natural_language:${interactionId}
---
${content}`;

  return propose({
    kind: 'domain_standard',
    targetPath,
    body,
    provenance: `natural_language:${interactionId}`,
    sourceOutcome: 'natural_language',
    domain,
    dedupeKey: dedupeKey('domain_standard', targetPath, body),
    workSessionId,
    interactionId,
  });
}

export function proposeFromOutcome(ctx: SkillifyOutcomeContext): SkillifyProposal[] {
  const proposals: SkillifyProposal[] = [];

  if (ctx.outcomeStatus === 'rejected') {
    if (!ctx.correction?.trim()) return proposals;

    const domain = resolveDomain(ctx);
    const targetPath = `constraints/${slugify(domain)}.md`;
    const body = `# ${domain}\n\n${ctx.correction.trim()}`;
    const created = propose({
      kind: 'constraint',
      targetPath,
      body,
      provenance: `outcome:${ctx.interactionId}`,
      sourceOutcome: ctx.outcomeStatus,
      domain,
      dedupeKey: dedupeKey('constraint', targetPath, body),
      workSessionId: ctx.workSessionId,
      interactionId: ctx.interactionId,
    });
    if (created) proposals.push(created);
    return proposals;
  }

  if (ctx.outcomeStatus === 'succeeded') {
    const domain = resolveDomain(ctx);
    const targetPath = `standards/${slugify(domain)}.md`;
    const content = ctx.correction?.trim() || ctx.intent?.trim();
    if (!content) return proposals;

    const body = `---
type: domain_standard
domain: ${domain}
source: skillify
provenance: outcome:${ctx.interactionId}
---
${content}`;
    const created = propose({
      kind: 'domain_standard',
      targetPath,
      body,
      provenance: `outcome:${ctx.interactionId}`,
      sourceOutcome: ctx.outcomeStatus,
      domain,
      dedupeKey: dedupeKey('domain_standard', targetPath, body),
      workSessionId: ctx.workSessionId,
      interactionId: ctx.interactionId,
    });
    if (created) proposals.push(created);
    return proposals;
  }

  return proposals;
}

export function proposeFromLearningCandidate(
  candidate: LearningCandidate,
  ctx: { workSessionId: string; interactionId: string },
): SkillifyProposal | null {
  const gate = gateLearningCandidate(candidate);
  if (!gate.shouldRemember) return null;

  let kind: SkillifyProposalKind;
  let targetPath: string;
  let body: string;

  switch (candidate.source) {
    case 'correction':
      kind = 'constraint';
      targetPath = `constraints/${slugify(candidate.domain)}.md`;
      body = `# ${candidate.domain}\n\n${candidate.content}`;
      break;
    case 'accepted_standard':
      kind = 'domain_standard';
      targetPath = `standards/${slugify(candidate.domain)}.md`;
      body = `---
type: domain_standard
domain: ${candidate.domain}
source: skillify
provenance: closeout:${ctx.workSessionId}
---
${candidate.content}`;
      break;
    case 'durable_decision':
      kind = 'decision';
      targetPath = `constraints/${slugify(candidate.domain)}-decision.md`;
      body = `# Decision: ${candidate.domain}\n\n${candidate.content}`;
      break;
    default:
      return null;
  }

  return propose({
    kind,
    targetPath,
    body,
    provenance: `closeout:${ctx.workSessionId}`,
    sourceOutcome: 'closeout',
    domain: candidate.domain,
    dedupeKey: dedupeKey(kind, targetPath, body),
    workSessionId: ctx.workSessionId,
    interactionId: ctx.interactionId,
  });
}

export function proposeFromCloseoutLearnings(
  candidates: LearningCandidate[],
  ctx: { workSessionId: string; interactionId: string },
): SkillifyProposal[] {
  const proposals: SkillifyProposal[] = [];
  for (const candidate of candidates) {
    const created = proposeFromLearningCandidate(candidate, ctx);
    if (created) proposals.push(created);
  }
  return proposals;
}

export function buildSkillifyAugmentOptions(proposals: SkillifyProposal[]): Array<{ id: string; label: string }> {
  const options = proposals.map((p) => ({
    id: p.id,
    label: `Accept ${p.kind} → ${p.targetPath}`,
  }));
  options.push({ id: '__accept_all__', label: 'Accept all' });
  options.push({ id: '__decline_all__', label: 'Decline all' });
  for (const p of proposals) {
    options.push({ id: `__decline__:${p.id}`, label: `Decline ${p.id.slice(0, 8)}` });
  }
  return options;
}
