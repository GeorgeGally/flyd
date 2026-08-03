import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validateRepositoryActionInput,
  type RepositoryActionInput,
} from '../work-intelligence/repository-action.js';

const REPO_ROOT = resolve(process.cwd(), '..');

describe('repository-action', () => {
  describe('validateRepositoryActionInput', () => {
    it('rejects missing root', () => {
      const input: Partial<RepositoryActionInput> = {
        instruction: 'Fix the login function',
        finishCondition: 'Tests pass',
        workSessionRevision: 1,
      };
      expect(validateRepositoryActionInput(input as RepositoryActionInput)).toBe('Missing approved root');
    });

    it('rejects non-existent root', () => {
      const input: RepositoryActionInput = {
        approvedRoot: '/nonexistent/path',
        instruction: 'Fix the login function',
        finishCondition: 'Tests pass',
        workSessionRevision: 1,
      };
      expect(validateRepositoryActionInput(input)).toContain('does not exist');
    });

    it('rejects non-git root', () => {
      const input: RepositoryActionInput = {
        approvedRoot: '/tmp',
        instruction: 'Fix the login function',
        finishCondition: 'Tests pass',
        workSessionRevision: 1,
      };
      const result = validateRepositoryActionInput(input);
      if (existsSync('/tmp/.git')) {
        expect(result).toBeNull();
      } else {
        expect(result).toContain('Not a git repository');
      }
    });

    it('rejects missing instruction', () => {
      const input: RepositoryActionInput = {
        approvedRoot: REPO_ROOT,
        instruction: '',
        finishCondition: 'Tests pass',
        workSessionRevision: 1,
      };
      expect(validateRepositoryActionInput(input)).toBe('Missing instruction');
    });

    it('rejects instruction that is too long', () => {
      const input: RepositoryActionInput = {
        approvedRoot: REPO_ROOT,
        instruction: 'x'.repeat(4001),
        finishCondition: 'Tests pass',
        workSessionRevision: 1,
      };
      expect(validateRepositoryActionInput(input)).toBe('Instruction too long');
    });

    it('accepts valid input for current repo', () => {
      const input: RepositoryActionInput = {
        approvedRoot: REPO_ROOT,
        instruction: 'Fix the login function',
        finishCondition: 'Tests pass',
        workSessionRevision: 1,
      };
      const result = validateRepositoryActionInput(input);
      if (existsSync(`${REPO_ROOT}/.git`)) {
        expect(result).toBeNull();
      }
    });
  });
});
