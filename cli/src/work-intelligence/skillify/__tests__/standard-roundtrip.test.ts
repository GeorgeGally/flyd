import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { configureSkillifyProposalDirectory } from '../proposal-store.js';
import { configureOutcomeJournalDirectory } from '../../outcome-journal.js';
import { proposeFromOutcome } from '../propose.js';
import { confirmProposal } from '../confirm.js';
import { loadDomainStandard } from '../../ground-pack-wiki.js';

describe('skillify domain standard roundtrip', () => {
  let testRoot: string;
  let previousFlydDir: string | undefined;

  beforeEach(() => {
    testRoot = join(tmpdir(), `flyd-skillify-rt-${randomUUID()}`);
    previousFlydDir = process.env.FLYD_DIR;
    process.env.FLYD_DIR = testRoot;
    mkdirSync(join(testRoot, 'wiki', 'standards'), { recursive: true });
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

  it('uses hardcoded fallback before confirm', () => {
    const { provenance } = loadDomainStandard({ artifactKind: 'design' });
    expect(provenance).toBe('fallback:domain-standards');
  });

  it('loads confirmed wiki standard in next Ground pack', () => {
    const [proposal] = proposeFromOutcome({
      workSessionId: 'ws-roundtrip',
      interactionId: 'int-roundtrip',
      outcomeStatus: 'succeeded',
      intent: 'Lead with user outcomes, not feature lists',
      domain: 'design',
      artifactKind: 'design',
    });

    const result = confirmProposal(proposal.id, proposal.revision);
    expect(result.ok).toBe(true);

    const { standard, provenance } = loadDomainStandard({ artifactKind: 'design' });
    expect(provenance).toBe('wiki/standards/design.md');
    expect(standard.focusPrompt).toContain('user outcomes');
  });

  it('project-specific standard beats generic domain when both exist', () => {
    writeFileSync(
      join(testRoot, 'wiki', 'standards', 'design.md'),
      `---
type: domain_standard
domain: design
---
Generic design guidance.`,
      'utf8',
    );
    writeFileSync(
      join(testRoot, 'wiki', 'standards', 'flyd-design.md'),
      `---
type: domain_standard
domain: design
---
Project-specific Flyd design guidance.`,
      'utf8',
    );

    const { standard, provenance } = loadDomainStandard({
      artifactKind: 'design',
      projectName: 'flyd',
    });
    expect(provenance).toBe('wiki/standards/flyd-design.md');
    expect(standard.focusPrompt).toContain('Project-specific Flyd');
  });
});
