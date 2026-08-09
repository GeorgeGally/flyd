import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validateRepositoryActionInput,
  verifyModuleDependencyBoundary,
  type RepositoryActionInput,
} from '../work-intelligence/repository-action.js';

const REPO_ROOT = resolve(process.cwd(), '..');

function validInput(overrides: Partial<RepositoryActionInput> = {}): RepositoryActionInput {
  return {
    approvedRoot: REPO_ROOT,
    instruction: 'Add a test comment to the README',
    finishCondition: 'A comment is added and lint passes',
    workSessionRevision: 1,
    actionGrantId: 'grant-approved-123',
    expectedFingerprint: {
      repositoryRoot: REPO_ROOT,
      branch: 'main',
      headDigest: 'head-at-approval',
      statusDigest: 'status-at-approval',
    },
    ...overrides,
  };
}

describe('repository-action', () => {
  describe('validateRepositoryActionInput', () => {
    it('rejects missing root', () => {
      const input: Partial<RepositoryActionInput> = {
        instruction: 'Fix the login function',
        finishCondition: 'Tests pass',
        workSessionRevision: 1,
        actionGrantId: 'grant-approved',
      };
      expect(validateRepositoryActionInput(input as RepositoryActionInput)).toBe('Missing approved root');
    });

    it('rejects non-existent root', () => {
      const input = validInput({ approvedRoot: '/nonexistent/path' });
      expect(validateRepositoryActionInput(input)).toContain('does not exist');
    });

    it('rejects non-git root', () => {
      const input = validInput({ approvedRoot: '/tmp' });
      const result = validateRepositoryActionInput(input);
      if (existsSync('/tmp/.git')) {
        expect(result).toBeNull();
      } else {
        expect(result).toContain('Not a git repository');
      }
    });

    it('rejects missing instruction', () => {
      const input = validInput({ instruction: '' });
      expect(validateRepositoryActionInput(input)).toBe('Missing instruction');
    });

    it('rejects instruction that is too long', () => {
      const input = validInput({ instruction: 'x'.repeat(4001) });
      expect(validateRepositoryActionInput(input)).toBe('Instruction too long');
    });

    it('accepts valid input for current repo', () => {
      const input = validInput();
      const result = validateRepositoryActionInput(input);
      if (existsSync(`${REPO_ROOT}/.git`)) {
        expect(result).toBeNull();
      }
    });

    it('rejects empty approvedRoot string', () => {
      const input = validInput({ approvedRoot: '' });
      expect(validateRepositoryActionInput(input)).toBe('Missing approved root');
    });
  });

  describe('dependency-boundary', () => {
    it('rejects imports from forbidden legacy subsystems', () => {
      const boundary = verifyModuleDependencyBoundary();
      expect(boundary.ok).toBe(true);
      if (!boundary.ok) {
        console.error('Boundary violations:', boundary.violations);
      }
    });

    it('lists forbidden modules that must not be imported', () => {
      const forbiddenModules = [
        'task-store',
        'orchestrator',
        'runtime-bridge',
        'rails',
        'attention',
        'delegation-event',
        'provider-routing',
      ];

      const source = readFileSync(
        resolve(process.cwd(), 'src/work-intelligence/repository-action.ts'),
        'utf-8'
      );

      const importPattern = /(?:from\s+['"]|require\s*\(\s*['"]|import\s*\(?\s*['"])([^'"]+)['")]/g;
      const violations: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = importPattern.exec(source)) !== null) {
        const importPath = match[1];
        for (const forbidden of forbiddenModules) {
          if (importPath.includes(forbidden)) {
            violations.push(`import "${importPath}" matches forbidden "${forbidden}"`);
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe('action grant validation', () => {
    it('validates that the input includes the approved root', () => {
      const input = validInput();
      expect(input.approvedRoot).toBe(REPO_ROOT);
    });

    it('validates that the input includes an instruction', () => {
      const input = validInput();
      expect(input.instruction.length).toBeGreaterThan(0);
    });

    it('validates that the input includes a finish condition', () => {
      const input = validInput();
      expect(input.finishCondition).toBeTruthy();
    });

    it('validates that the input includes a work session revision', () => {
      const input = validInput();
      expect(input.workSessionRevision).toBeGreaterThan(0);
    });

    it('requires an action grant ID for approved interventions', () => {
      const withoutGrant = validInput({ actionGrantId: undefined });
      expect(validateRepositoryActionInput(withoutGrant)).toBe('Missing action grant ID');
    });
  });

  describe('finish condition', () => {
    it('requires a non-empty finish condition', () => {
      const input = validInput({ finishCondition: '' });
      expect(validateRepositoryActionInput(input)).toBe('Missing finish condition');
    });

    it('requires a positive Work Session revision', () => {
      const input = validInput({ workSessionRevision: 0 });
      expect(validateRepositoryActionInput(input)).toBe('Invalid Work Session revision');
    });
  });
});
