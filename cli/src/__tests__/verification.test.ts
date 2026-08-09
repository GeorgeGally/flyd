import { describe, it, expect } from 'vitest';
import {
  verifyTextOperation,
  verifyActionAgainstGrant,
  type VerificationContext,
} from '../work-intelligence/verification.js';
import type { ActionGrant } from '../work-intelligence/types.js';

describe('verification', () => {
  describe('verifyTextOperation', () => {
    it('verifies when post-execution value matches expected', () => {
      const ctx: VerificationContext = {
        preExecutionValue: 'hello world',
        preExecutionSelectedText: '',
        postExecutionValue: 'hello world',
        postExecutionSelectedText: '',
        expectedOperation: 'insert_text',
        targetElementRef: 'el_01',
      };

      const result = verifyTextOperation(ctx);
      expect(result.verdict).toBe('verified');
      expect(result.verificationChecks.reRead.passed).toBe(true);
    });

    it('returns partial when values differ but expected has content', () => {
      const ctx: VerificationContext = {
        preExecutionValue: 'hello world',
        preExecutionSelectedText: '',
        postExecutionValue: 'hello WORLD',
        postExecutionSelectedText: '',
        expectedOperation: 'replace_text',
        targetElementRef: 'el_01',
      };

      const result = verifyTextOperation(ctx);
      expect(result.verdict).toBe('partial');
      expect(result.verificationChecks.reRead.passed).toBe(false);
    });

    it('returns failed when post-execution is empty', () => {
      const ctx: VerificationContext = {
        preExecutionValue: 'hello world',
        preExecutionSelectedText: '',
        postExecutionValue: '',
        postExecutionSelectedText: '',
        expectedOperation: 'replace_text',
        targetElementRef: 'el_01',
      };

      const result = verifyTextOperation(ctx);
      expect(result.verdict).toBe('failed');
    });

    it('includes timestamp and evidence', () => {
      const ctx: VerificationContext = {
        preExecutionValue: 'hello',
        preExecutionSelectedText: '',
        postExecutionValue: 'hello',
        postExecutionSelectedText: '',
        expectedOperation: 'insert_text',
        targetElementRef: 'el_01',
      };

      const result = verifyTextOperation(ctx);
      expect(result.timestamp).toBeDefined();
      expect(result.evidence).toContain('el_01');
      expect(result.verdict).toBe('verified');
    });

    it('describes character-level changes', () => {
      const ctx: VerificationContext = {
        preExecutionValue: 'short',
        preExecutionSelectedText: '',
        postExecutionValue: 'much longer content here',
        postExecutionSelectedText: '',
        expectedOperation: 'replace_text',
        targetElementRef: 'el_01',
      };

      const result = verifyTextOperation(ctx);
      expect(result.actualChanges).toContain('Added');
    });
  });

  describe('verifyActionAgainstGrant', () => {
    const baseGrant: ActionGrant = {
      grantId: 'ag_001',
      actionId: 'act_001',
      interactionId: 'interaction-001',
      diagnosedIssueId: 'diagnosis-001',
      instruction: 'Replace the text',
      allowedOperation: 'replace_text',
      finishCondition: 'The replacement is present',
      status: 'approved',
      grantedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      workSessionRevision: 1,
      targetFingerprint: {},
    };

    it('returns true when verified outcome matches approved grant', () => {
      const result = verifyTextOperation({
        preExecutionValue: 'test',
        preExecutionSelectedText: '',
        postExecutionValue: 'test',
        postExecutionSelectedText: '',
        expectedOperation: 'insert_text',
        targetElementRef: 'el_01',
      });

      expect(verifyActionAgainstGrant(baseGrant, result)).toBe(true);
    });

    it('returns false when grant is already invalidated', () => {
      const grant: ActionGrant = { ...baseGrant, status: 'invalidated' };
      const result = verifyTextOperation({
        preExecutionValue: 'test',
        preExecutionSelectedText: '',
        postExecutionValue: 'test',
        postExecutionSelectedText: '',
        expectedOperation: 'insert_text',
        targetElementRef: 'el_01',
      });

      expect(verifyActionAgainstGrant(grant, result)).toBe(false);
    });
  });
});
