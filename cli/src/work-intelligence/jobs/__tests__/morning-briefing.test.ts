import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createJobDef } from '../store.js';
import { composeMorningBriefing } from '../jobs/morning-briefing.js';
import { resolveOvernightProject } from '../../ground-pack.js';
import type { WorkHypothesis } from '../../../work/work-hypothesis/types.js';
import { ALWAYS_DENIED_TOOLS } from '../types.js';
import { assertToolAllowed } from '../tool-policy.js';

describe('morning briefing', () => {
  let testRoot: string;
  let previousFlydDir: string | undefined;

  beforeEach(() => {
    testRoot = join(tmpdir(), `flyd-jobs-mb-${randomUUID()}`);
    previousFlydDir = process.env.FLYD_DIR;
    process.env.FLYD_DIR = testRoot;
    mkdirSync(join(testRoot, 'wiki', 'projects'), { recursive: true });
    mkdirSync(join(testRoot, 'wiki', 'standards'), { recursive: true });
    writeFileSync(
      join(testRoot, 'wiki', 'projects', 'flyd.md'),
      '---\ntype: project\n---\nFlyd project notes.',
      'utf8',
    );
  });

  afterEach(() => {
    if (previousFlydDir === undefined) delete process.env.FLYD_DIR;
    else process.env.FLYD_DIR = previousFlydDir;
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  });

  function pm(overrides: Partial<WorkHypothesis> = {}): WorkHypothesis {
    return {
      id: 'wh-1',
      hypothesisText: 'Working on flyd',
      primaryThreads: [{
        root: '/tmp/flyd',
        name: 'flyd',
        isDirty: false,
        hasTasks: false,
        isForeground: false,
        signals: [],
        demoted: false,
      }],
      secondaryThreads: [],
      confidence: 'medium',
      uncertainty: [{ field: 'objective', reason: 'unclear next slice' }],
      evidenceRefs: [],
      demotions: [],
      revisedAt: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      fromCache: false,
      ...overrides,
    };
  }

  it('composes briefing via ground pack assembler (not ad-hoc wiki dump)', () => {
    const job = createJobDef({
      type: 'morning_briefing',
      schedule: '07:00',
      projectId: 'flyd',
    });
    const result = composeMorningBriefing(job, {
      readPresentModel: () => pm(),
      readLatestCloseoutForProject: () => null,
    });
    expect(result.ok).toBe(true);
    expect(result.markdown).toContain('## Ground pack');
    expect(result.markdown).toContain('FOREGROUND');
    expect(result.markdown).toContain('DOMAIN_STANDARD');
    expect(result.pack?.domainStandardProvenance).toBeTruthy();
    expect(result.toolsUsed).toContain('wiki_read');
    expect(result.toolsUsed).toContain('local_compose');
  });

  it('requires projectId or fresh Present Model primary', () => {
    const stale = resolveOvernightProject({
      presentModel: pm({
        revisedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(stale.ok).toBe(false);

    const withId = resolveOvernightProject({
      projectId: 'flyd',
      presentModel: null,
    });
    expect(withId.ok).toBe(true);
    expect(withId.primaryProject).toBe('flyd');
  });

  it('refuses denied tools even during compose', () => {
    const job = createJobDef({
      type: 'morning_briefing',
      schedule: '07:00',
      projectId: 'flyd',
      toolPolicy: ['wiki_read'] as never,
    });
    expect(() => assertToolAllowed(job, 'evidence_network')).toThrow();
    for (const tool of ALWAYS_DENIED_TOOLS) {
      expect(() => assertToolAllowed(job, tool)).toThrow();
    }
  });

  it('does not import PRESENT bridge surfaces', async () => {
    const runnerSource = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../runner.ts', import.meta.url), 'utf-8'),
    );
    expect(runnerSource).not.toMatch(/PRESENT|AttentionEngine|mac-adapter|Swift|NSWorkspace/);
    const briefingSource = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../jobs/morning-briefing.ts', import.meta.url), 'utf-8'),
    );
    expect(briefingSource).not.toMatch(/AttentionEngine|mac-adapter|NSWorkspace/);
  });
});
