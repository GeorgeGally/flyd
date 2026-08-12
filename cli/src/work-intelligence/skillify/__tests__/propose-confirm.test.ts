import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { configureSkillifyProposalDirectory, createProposal } from '../proposal-store.js';
import { configureOutcomeJournalDirectory } from '../../outcome-journal.js';
import { proposeFromOutcome } from '../propose.js';
import { confirmProposal, declineProposal } from '../confirm.js';
import { listJournalEntries } from '../../outcome-journal.js';

describe('skillify propose + confirm', () => {
  let testRoot: string;
  let previousFlydDir: string | undefined;

  beforeEach(() => {
    testRoot = join(tmpdir(), `flyd-skillify-pc-${randomUUID()}`);
    previousFlydDir = process.env.FLYD_DIR;
    process.env.FLYD_DIR = testRoot;
    mkdirSync(join(testRoot, 'wiki', 'standards'), { recursive: true });
    mkdirSync(join(testRoot, 'wiki', 'constraints'), { recursive: true });
    mkdirSync(join(testRoot, 'overlay', 'skillify-proposals'), { recursive: true });
    mkdirSync(join(testRoot, 'overlay', 'founder-journal'), { recursive: true });
    configureSkillifyProposalDirectory(undefined);
    configureOutcomeJournalDirectory(join(testRoot, 'overlay', 'founder-journal'));
  });

  afterEach(() => {
    configureSkillifyProposalDirectory(undefined);
    if (previousFlydDir === undefined) delete process.env.FLYD_DIR;
    else process.env.FLYD_DIR = previousFlydDir;
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  });

  it('reject alone creates no proposal', () => {
    const proposals = proposeFromOutcome({
      workSessionId: 'ws-1',
      interactionId: 'int-1',
      outcomeStatus: 'rejected',
    });
    expect(proposals).toHaveLength(0);
  });

  it('reject+correction creates constraint proposal', () => {
    const proposals = proposeFromOutcome({
      workSessionId: 'ws-1',
      interactionId: 'int-1',
      outcomeStatus: 'rejected',
      correction: 'Always use dark mode',
      domain: 'design',
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0].kind).toBe('constraint');
    expect(proposals[0].targetPath).toBe('constraints/design.md');
  });

  it('confirm writes wiki and records skillify_written', () => {
    const [proposal] = proposeFromOutcome({
      workSessionId: 'ws-1',
      interactionId: 'int-1',
      outcomeStatus: 'rejected',
      correction: 'Keep headings short',
      domain: 'writing',
    });
    const result = confirmProposal(proposal.id, proposal.revision);
    expect(result.ok).toBe(true);
    expect(result.writtenPath).toBe('constraints/writing.md');
    expect(
      existsSync(join(testRoot, 'wiki', 'constraints', 'writing.md')),
    ).toBe(true);

    const written = listJournalEntries({ eventTypes: ['skillify_written'] });
    expect(written).toHaveLength(1);
  });

  it('decline leaves no wiki file', () => {
    const [proposal] = proposeFromOutcome({
      workSessionId: 'ws-1',
      interactionId: 'int-1',
      outcomeStatus: 'rejected',
      correction: 'Never auto-deploy',
      domain: 'ops',
    });
    const result = declineProposal(proposal.id, proposal.revision);
    expect(result.ok).toBe(true);
    expect(existsSync(join(testRoot, 'wiki', 'constraints', 'ops.md'))).toBe(false);
  });

  it('accept creates domain_standard proposal without wiki until confirm', () => {
    const proposals = proposeFromOutcome({
      workSessionId: 'ws-2',
      interactionId: 'int-2',
      outcomeStatus: 'succeeded',
      intent: 'Prefer concise executive summaries',
      domain: 'writing',
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0].kind).toBe('domain_standard');
    expect(existsSync(join(testRoot, 'wiki', 'standards', 'writing.md'))).toBe(false);

    const proposed = listJournalEntries({ eventTypes: ['skillify_proposed'] });
    expect(proposed).toHaveLength(1);
  });

  it('rejects proposal paths outside allowlist', () => {
    const proposal = createProposal({
      kind: 'constraint',
      targetPath: 'skills/evil.md',
      body: 'bad',
      provenance: 'test',
      sourceOutcome: 'test',
      dedupeKey: 'bad-path',
    });
    expect(proposal).toBeNull();
  });
});
