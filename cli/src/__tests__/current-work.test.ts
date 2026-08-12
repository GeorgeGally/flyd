import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  constructCurrentWork,
  resolveRepositoryFromPath,
  type EnvironmentCapture,
  type GroundingContext,
} from '../work-intelligence/current-work.js';

function makeEnv(overrides: Partial<EnvironmentCapture> = {}): EnvironmentCapture {
  return {
    application: { bundle_id: 'com.apple.dt.Xcode', name: 'Xcode' },
    window: { title: 'AuthService.swift — CleanX', ref: 'win_01' },
    focused_element: {
      ref: 'el_01',
      role: 'AXTextArea',
      description: '/Users/george/Projects/CleanX/Sources/Services/AuthService.swift',
      value: 'func login(email: String, password: String) async throws -> Token { ... }',
      placeholder: '',
      selected_text: '',
    },
    selection: '',
    sufficiency: 'semantic',
    ...overrides,
  };
}

describe('constructCurrentWork', () => {
  it('constructs current work from foreground evidence', () => {
    const ctx: GroundingContext = {
      environment: makeEnv({
        document_path: '/Users/george/Projects/CleanX/Sources/Services/AuthService.swift',
      }),
      resolvedProjectRoot: '/Users/george/Projects/CleanX',
      gitBranch: 'main',
      gitHeadDigest: 'abc123',
      gitStatusDigest: 'clean',
    };
    const cw = constructCurrentWork(ctx);

    expect(cw.project.value).toBe('CleanX');
    expect(cw.project.source).toBe('foreground');
    expect(cw.project.confidence).toBe('high');
    expect(cw.project.isHypothesis).toBe(false);

    expect(cw.artifact.kind).toBe('code');
    expect(cw.artifact.title).toContain('AuthService.swift');
    expect(cw.artifact.path).toBeDefined();

    expect(cw.stage.value).toBe('execution');
    expect(cw.stage.source).toBe('foreground');

    expect(cw.objective.value.length).toBeGreaterThan(0);

    expect(cw.evidenceSummary.repositoryRoot).toBe('/Users/george/Projects/CleanX');
    expect(cw.evidenceSummary.branch).toBe('main');
    expect(cw.evidenceSummary.headDigest).toBe('abc123');
  });

  it('marks project as hypothesis when no repository evidence', () => {
    const ctx: GroundingContext = {
      environment: makeEnv(),
    };
    const cw = constructCurrentWork(ctx);

    expect(cw.project.confidence).toBe('low');
    expect(cw.project.isHypothesis).toBe(true);
    expect(cw.project.value).toBe('Xcode');
  });

  it('identifies presentation artifact kind', () => {
    const ctx: GroundingContext = {
      environment: makeEnv({
        application: { bundle_id: 'com.apple.iWork.Keynote', name: 'Keynote' },
        window: { title: 'Investor Pitch.key', ref: 'win_01' },
        focused_element: {
          ref: 'el_01',
          role: 'AXGroup',
          description: 'Slide',
          value: '',
          placeholder: '',
          selected_text: '',
        },
      }),
    };
    const cw = constructCurrentWork(ctx);
    expect(cw.artifact.kind).toBe('presentation');
  });

  it('identifies message artifact kind', () => {
    const ctx: GroundingContext = {
      environment: makeEnv({
        application: { bundle_id: 'com.apple.mail', name: 'Mail' },
        window: { title: 'Re: Proposal Update', ref: 'win_01' },
      }),
    };
    const cw = constructCurrentWork(ctx);
    expect(cw.artifact.kind).toBe('message');
  });

  it('identifies design artifact kind', () => {
    const ctx: GroundingContext = {
      environment: makeEnv({
        application: { bundle_id: 'com.figma.Desktop', name: 'Figma' },
        window: { title: 'Homepage Redesign – Figma', ref: 'win_01' },
        focused_element: {
          ref: 'el_01',
          role: 'AXGroup',
          description: 'Frame',
          value: '',
          placeholder: '',
          selected_text: '',
        },
      }),
    };
    const cw = constructCurrentWork(ctx);
    expect(cw.artifact.kind).toBe('design');
  });

  it('marks uncertain fields', () => {
    const ctx: GroundingContext = {
      environment: makeEnv(),
    };
    const cw = constructCurrentWork(ctx);
    expect(cw.uncertainty.some(u => u.field === 'objective')).toBe(true);
    expect(cw.uncertainty.some(u => u.field === 'constraints')).toBe(true);
  });

  it('sets confidence levels for each field', () => {
    const ctx: GroundingContext = {
      environment: makeEnv(),
      resolvedProjectRoot: '/Users/george/Projects/CleanX',
      gitBranch: 'main',
    };
    const cw = constructCurrentWork(ctx);

    const projectConf = cw.confidence.find(c => c.field === 'project');
    expect(projectConf?.confidence).toBe('high');

    const objectiveConf = cw.confidence.find(c => c.field === 'objective');
    expect(objectiveConf?.confidence).toBe('medium');
  });

  it('constructs selected region when bounds are available', () => {
    const ctx: GroundingContext = {
      environment: makeEnv({
        focused_bounds: { x: 200, y: 150, width: 800, height: 600 },
        display_identity: 'display_0_2560x1440',
        focused_element: {
          ref: 'el_01',
          role: 'AXTextArea',
          description: 'Some file',
          value: 'const x = 1;',
          placeholder: '',
          selected_text: 'const x = 1;',
        },
      }),
      resolvedProjectRoot: '/Users/george/Projects/CleanX',
    };
    const cw = constructCurrentWork(ctx);
    expect(cw.artifact.selectedRegion).toBeDefined();
    expect(cw.artifact.selectedRegion!.bounds.x).toBe(200);
    expect(cw.artifact.selectedRegion!.displayId).toBe('display_0_2560x1440');
  });

  it('infers review stage when text is selected', () => {
    const ctx: GroundingContext = {
      environment: makeEnv({
        focused_element: {
          ref: 'el_01',
          role: 'AXTextArea',
          description: 'Some file',
          value: 'hello world',
          placeholder: '',
          selected_text: 'hello',
        },
      }),
    };
    const cw = constructCurrentWork(ctx);
    expect(cw.stage.value).toBe('review');
  });
});

describe('resolveRepositoryFromPath', () => {
  it('resolves the current project from document path', () => {
    // This test depends on the current working tree being a git repo
    const result = resolveRepositoryFromPath(process.cwd());
    if (result.root) {
      expect(result.branch).toBeDefined();
      expect(result.headDigest).toBeDefined();
      expect(result.statusDigest).toBeDefined();
    }
  });

  it('marks an untracked-only repository dirty and includes the untracked file', () => {
    const root = mkdtempSync(join(tmpdir(), 'flyd-current-work-'));
    execFileSync('git', ['init', '-q', root]);
    writeFileSync(join(root, 'tracked.txt'), 'tracked\n');
    execFileSync('git', ['-C', root, 'add', 'tracked.txt']);
    execFileSync('git', [
      '-C', root,
      '-c', 'user.name=Flyd Test',
      '-c', 'user.email=flyd@example.test',
      'commit', '-q', '-m', 'Initial commit',
    ]);
    writeFileSync(join(root, 'untracked.ts'), 'export const value = 1;\n');

    const result = resolveRepositoryFromPath(root);

    expect(result.isDirty).toBe(true);
    expect(result.changedFiles).toContain('untracked.ts');
  });

  it('returns empty for non-existent path', () => {
    const result = resolveRepositoryFromPath('/nonexistent/path/to/file.txt');
    expect(result.root).toBeUndefined();
  });

  it('returns empty for undefined path', () => {
    const result = resolveRepositoryFromPath(undefined);
    expect(result.root).toBeUndefined();
  });
});
