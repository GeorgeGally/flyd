import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  configureSkillifyProposalDirectory,
  createProposal,
  getProposal,
  listPendingProposals,
  updateProposalStatus,
  expireStaleProposals,
} from '../proposal-store.js';
import { SKILLIFY_MAX_PENDING } from '../types.js';

describe('skillify proposal-store', () => {
  let testRoot: string;
  let previousFlydDir: string | undefined;

  beforeEach(() => {
    testRoot = join(tmpdir(), `flyd-skillify-store-${randomUUID()}`);
    previousFlydDir = process.env.FLYD_DIR;
    process.env.FLYD_DIR = testRoot;
    mkdirSync(join(testRoot, 'wiki', 'constraints'), { recursive: true });
    mkdirSync(join(testRoot, 'overlay', 'skillify-proposals'), { recursive: true });
    configureSkillifyProposalDirectory(undefined);
  });

  afterEach(() => {
    configureSkillifyProposalDirectory(undefined);
    if (previousFlydDir === undefined) delete process.env.FLYD_DIR;
    else process.env.FLYD_DIR = previousFlydDir;
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  });

  const baseInput = {
    kind: 'constraint' as const,
    targetPath: 'constraints/test.md',
    body: '# test\n\nbody',
    provenance: 'test',
    sourceOutcome: 'rejected',
    dedupeKey: 'constraint:constraints/test.md:abc',
  };

  it('creates pending proposal', () => {
    const proposal = createProposal(baseInput);
    expect(proposal?.status).toBe('proposed');
    expect(getProposal(proposal!.id)?.targetPath).toBe('constraints/test.md');
  });

  it('coalesces duplicate dedupeKey', () => {
    const first = createProposal(baseInput);
    const second = createProposal({ ...baseInput, body: 'different body' });
    expect(second?.id).toBe(first?.id);
    expect(listPendingProposals()).toHaveLength(1);
  });

  it('transitions propose → confirmed', () => {
    const proposal = createProposal(baseInput)!;
    const confirmed = updateProposalStatus(proposal.id, 'confirmed', {
      confirmedAt: new Date().toISOString(),
    });
    expect(confirmed?.status).toBe('confirmed');
  });

  it('expires stale proposals after TTL', () => {
    const proposal = createProposal(baseInput)!;
    const expiredAt = new Date(Date.now() - 1000);
    updateProposalStatus(proposal.id, 'proposed', {
      expiresAt: expiredAt.toISOString(),
    });
    expect(expireStaleProposals()).toBe(1);
    expect(getProposal(proposal.id)?.status).toBe('expired');
  });

  it('rejects new proposals when max pending reached', () => {
    for (let i = 0; i < SKILLIFY_MAX_PENDING; i += 1) {
      createProposal({
        ...baseInput,
        dedupeKey: `key-${i}`,
        targetPath: `constraints/test-${i}.md`,
      });
    }
    const overflow = createProposal({
      ...baseInput,
      dedupeKey: 'overflow',
      targetPath: 'constraints/overflow.md',
    });
    expect(overflow).toBeNull();
  });
});
