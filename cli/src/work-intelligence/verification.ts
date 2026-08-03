import { createHash } from 'node:crypto';
import type { VerificationResult, VerificationChecks, ActionGrant } from './types.js';

export interface VerificationContext {
  preExecutionValue: string;
  preExecutionSelectedText: string;
  postExecutionValue: string;
  postExecutionSelectedText: string;
  expectedOperation: string;
  targetElementRef: string;
  diagnosedIssueFinding?: string;
}

export function verifyTextOperation(ctx: VerificationContext): VerificationResult {
  const now = new Date().toISOString();
  const checks: VerificationChecks = {
    reRead: checkReRead(ctx),
  };

  const allChecked = checks.reRead.passed;
  const diagnosisResolved = ctx.diagnosedIssueFinding
    ? evaluateDiagnosisResolution(ctx.postExecutionValue, ctx.diagnosedIssueFinding)
    : true;

  const verified = allChecked && diagnosisResolved;

  let verdict: 'verified' | 'partial' | 'failed';
  if (verified) {
    verdict = 'verified';
  } else if (checks.reRead.expected !== checks.reRead.actual && checks.reRead.actual.length > 0) {
    verdict = 'partial';
  } else {
    verdict = 'failed';
  }

  const actualChanges = describeChanges(ctx);

  return {
    actionGrantId: 'pending',
    diagnosisResolved,
    actualChanges,
    verificationChecks: checks,
    verdict,
    evidence: `Post-execution re-read of ${ctx.targetElementRef}: ${verdict === 'verified' ? 'matches expected' : 'diverged from expected'}`,
    timestamp: now,
  };
}

function checkReRead(ctx: VerificationContext): VerificationChecks['reRead'] {
  const expected = computeExpectedValue(ctx);
  const actual = ctx.postExecutionValue;

  return {
    passed: actual === expected || hashMatch(actual, expected),
    expected: expected.slice(0, 200),
    actual: actual.slice(0, 200),
  };
}

function computeExpectedValue(ctx: VerificationContext): string {
  const before = ctx.preExecutionValue;
  const selected = ctx.preExecutionSelectedText;

  if (selected && selected.length > 0) {
    return before.replace(selected, '');
  }

  return before;
}

function evaluateDiagnosisResolution(newValue: string, diagnosis: string): boolean {
  if (!diagnosis || diagnosis.trim().length === 0) return true;
  const keyTerms = diagnosis.toLowerCase().match(/\b\w{4,}\b/g) || [];
  const newLower = newValue.toLowerCase();
  const matched = keyTerms.filter(term => newLower.includes(term));
  return matched.length >= Math.min(2, keyTerms.length);
}

function describeChanges(ctx: VerificationContext): string {
  const beforeLen = ctx.preExecutionValue.length;
  const afterLen = ctx.postExecutionValue.length;
  const diff = afterLen - beforeLen;

  if (diff === 0) return 'No length change detected';
  if (diff > 0) return `Added ${diff} characters (${beforeLen} → ${afterLen})`;
  return `Removed ${Math.abs(diff)} characters (${beforeLen} → ${afterLen})`;
}

function hashMatch(a: string, b: string): boolean {
  try {
    return createHash('sha256').update(a).digest('hex') ===
           createHash('sha256').update(b).digest('hex');
  } catch {
    return false;
  }
}

export function verifyActionAgainstGrant(
  grant: ActionGrant,
  verifyResult: VerificationResult
): boolean {
  if (grant.status !== 'approved' && grant.status !== 'executing') {
    return false;
  }

  if (verifyResult.verdict === 'verified') {
    return true;
  }

  return verifyResult.verdict === 'partial';
}
