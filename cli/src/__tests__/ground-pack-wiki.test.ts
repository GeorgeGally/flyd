import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

describe('ground-pack-wiki', () => {
  let testRoot: string;
  let previousFlydDir: string | undefined;

  beforeEach(() => {
    testRoot = join(tmpdir(), `flyd-wiki-gp-${randomUUID()}`);
    previousFlydDir = process.env.FLYD_DIR;
    process.env.FLYD_DIR = testRoot;
    mkdirSync(join(testRoot, 'wiki', 'projects'), { recursive: true });
    mkdirSync(join(testRoot, 'wiki', 'people'), { recursive: true });
    mkdirSync(join(testRoot, 'wiki', 'standards'), { recursive: true });
  });

  afterEach(() => {
    if (previousFlydDir === undefined) delete process.env.FLYD_DIR;
    else process.env.FLYD_DIR = previousFlydDir;
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  });

  function wikiPath(...parts: string[]): string {
    return join(testRoot, 'wiki', ...parts);
  }

  it('loads wiki domain_standard over hardcoded fallback', async () => {
    writeFileSync(
      wikiPath('standards', 'design.md'),
      `---
type: domain_standard
domain: design
---
Custom design focus from wiki.`,
      'utf8',
    );

    const { loadDomainStandard } = await import('../work-intelligence/ground-pack-wiki.js');
    const { standard, provenance } = loadDomainStandard({ artifactKind: 'design' });

    expect(provenance).toBe('wiki/standards/design.md');
    expect(standard.focusPrompt).toContain('Custom design focus');
  });

  it('falls back to hardcoded when wiki standard missing', async () => {
    const { loadDomainStandard } = await import('../work-intelligence/ground-pack-wiki.js');
    const { provenance } = loadDomainStandard({ artifactKind: 'code' });
    expect(provenance).toBe('fallback:domain-standards');
  });

  it('rejects path traversal for wiki reads', async () => {
    const { resolveSafeWikiPath } = await import('../work-intelligence/ground-pack-wiki.js');
    expect(resolveSafeWikiPath('../outside.md')).toBeNull();
    expect(resolveSafeWikiPath('projects/../../etc/passwd')).toBeNull();
  });

  it('loads project and people pages from deterministic refs', async () => {
    writeFileSync(
      wikiPath('projects', 'flyd.md'),
      `---
type: project
people:
  - George
---
Flyd project notes.`,
      'utf8',
    );
    writeFileSync(
      wikiPath('people', 'george.md'),
      `---
type: person
---
George builds Flyd.`,
      'utf8',
    );

    const {
      loadWikiProjectSection,
      extractPeopleRefs,
      readSafeWikiPage,
      loadPeopleSections,
    } = await import('../work-intelligence/ground-pack-wiki.js');

    const project = loadWikiProjectSection('Flyd');
    expect(project?.content).toContain('Flyd project notes');

    const parsed = readSafeWikiPage('projects/flyd.md');
    const refs = extractPeopleRefs(parsed);
    expect(refs).toEqual(['George']);

    const people = loadPeopleSections(refs);
    expect(people).toHaveLength(1);
    expect(people[0].content).toContain('George builds Flyd');
  });

  it('invalid domain_standard shape falls back', async () => {
    writeFileSync(
      wikiPath('standards', 'code.md'),
      `---
type: skill
domain: code
---
Not a domain standard.`,
      'utf8',
    );

    const { loadDomainStandard } = await import('../work-intelligence/ground-pack-wiki.js');
    const { provenance } = loadDomainStandard({ artifactKind: 'code' });
    expect(provenance).toBe('fallback:domain-standards');
  });
});
