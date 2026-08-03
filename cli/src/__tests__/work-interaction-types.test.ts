import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import {
  WORK_CONTRACT_VERSION,
  validateField,
  validateString,
  validateEvidenceItem,
} from '../work-intelligence/types.js';
import type {
  WorkInteractionRequest,
  WorkInteractionResponse,
  ActionGrant,
  FounderJournalEntry,
} from '../work-intelligence/types.js';

const FIXTURES = resolvePath(import.meta.dirname, '..', '..', '..', 'test-fixtures', 'work-interaction');

describe('Work Interaction contract', () => {
  describe('contract version', () => {
    it('declares version 1', () => {
      expect(WORK_CONTRACT_VERSION).toBe(1);
    });
  });

  describe('golden fixture round-trip: request', () => {
    const raw = readFileSync(join(FIXTURES, 'request-golden.json'), 'utf-8');
    const parsed: WorkInteractionRequest = JSON.parse(raw);

    it('has valid contract version', () => {
      expect(parsed.contract_version).toBe(1);
    });

    it('has valid interaction identity fields', () => {
      expect(parsed.interaction_id).toBe('wi_test_001');
      expect(parsed.work_session_id).toBe('ws_test_001');
      expect(parsed.work_session_revision).toBeGreaterThanOrEqual(1);
      expect(parsed.invocation_id).toBe('inv_test_001');
    });

    it('has textual intent and modality', () => {
      expect(typeof parsed.intent).toBe('string');
      expect(parsed.intent.length).toBeGreaterThan(0);
      expect(parsed.modality).toMatch(/^(text|voice)$/);
    });

    it('has foreground app evidence', () => {
      expect(parsed.current_evidence.foreground_app.bundle_id).toBe('com.apple.dt.Xcode');
      expect(parsed.current_evidence.foreground_app.name).toBe('Xcode');
    });

    it('has focused element evidence', () => {
      expect(parsed.current_evidence.focused_element.ref).toBe('el_01');
      expect(parsed.current_evidence.focused_element.role).toBe('AXTextArea');
      expect(parsed.current_evidence.focused_element.value.length).toBeGreaterThan(0);
    });

    it('has valid display identity and bounds', () => {
      expect(parsed.current_evidence.display_identity).toBe('display_0_2560x1440');
      expect(parsed.current_evidence.focused_bounds).toBeDefined();
      expect(parsed.current_evidence.focused_bounds!.x).toBe(200);
      expect(parsed.current_evidence.focused_bounds!.y).toBe(150);
    });
  });

  describe('golden fixture round-trip: response', () => {
    const raw = readFileSync(join(FIXTURES, 'response-golden.json'), 'utf-8');
    const parsed: WorkInteractionResponse = JSON.parse(raw);

    it('has valid contract version', () => {
      expect(parsed.contract_version).toBe(1);
    });

    it('has current work with evidence provenance', () => {
      expect(parsed.current_work.project.value).toBe('CleanX');
      expect(parsed.current_work.project.source).toBe('foreground');
      expect(parsed.current_work.project.confidence).toBe('high');
      expect(parsed.current_work.project.isHypothesis).toBe(false);

      expect(parsed.current_work.objective.value).toBe('unknown');
      expect(parsed.current_work.objective.isHypothesis).toBe(true);
    });

    it('has artifact identity', () => {
      expect(parsed.current_work.artifact.kind).toBe('code');
      expect(parsed.current_work.artifact.title).toBe('AuthService.swift');
      expect(parsed.current_work.artifact.path).toContain('AuthService.swift');
    });

    it('has evidence summary with repository context', () => {
      expect(parsed.current_work.evidenceSummary.repositoryRoot).toContain('CleanX');
      expect(parsed.current_work.evidenceSummary.branch).toBe('main');
      expect(parsed.current_work.evidenceSummary.foregroundApp).toBe('Xcode');
    });

    it('marks missing fields as uncertain', () => {
      expect(parsed.current_work.uncertainty).toHaveLength(2);
      expect(parsed.current_work.uncertainty[0].field).toBe('objective');
      expect(parsed.current_work.uncertainty[1].field).toBe('constraints');
    });

    it('has diagnosis with primary issue', () => {
      expect(parsed.diagnosis.primaryIssue.category).toBe('correctness');
      expect(parsed.diagnosis.primaryIssue.severity).toBe('critical');
      expect(parsed.diagnosis.primaryIssue.domain).toBe('code');
      expect(parsed.diagnosis.primaryIssue.evidenceRefs).toContain('foreground_element_value');
    });

    it('has intervention with stronger alternative and options', () => {
      expect(parsed.intervention.kind).toBe('critique');
      expect(parsed.intervention.strongerAlternative).toBeDefined();
      expect(parsed.intervention.options).toHaveLength(2);
    });

    it('has visual grounding with placement', () => {
      expect(parsed.intervention.visualGrounding).toBeDefined();
      expect(parsed.intervention.visualGrounding!.placement).toBe('below_element');
      expect(parsed.intervention.visualGrounding!.regionDescription.elementRef).toBe('el_01');
    });

    it('includes timing', () => {
      expect(parsed.timing.total_ms).toBeGreaterThan(0);
    });
  });

  describe('golden fixture round-trip: action grant', () => {
    const raw = readFileSync(join(FIXTURES, 'action-grant-golden.json'), 'utf-8');
    const parsed: ActionGrant = JSON.parse(raw);

    it('has valid grant fields', () => {
      expect(parsed.grantId).toBe('ag_test_001');
      expect(parsed.actionId).toBe('act_test_001');
      expect(parsed.status).toBe('approved');
      expect(parsed.workSessionRevision).toBe(1);
    });

    it('has target fingerprint', () => {
      expect(parsed.targetFingerprint.elementRef).toBe('el_01');
      expect(parsed.targetFingerprint.fieldValueDigest).toMatch(/^sha256:/);
      expect(parsed.targetFingerprint.repositoryRoot).toContain('CleanX');
      expect(parsed.targetFingerprint.branch).toBe('main');
    });
  });

  describe('golden fixture round-trip: outcome', () => {
    const raw = readFileSync(join(FIXTURES, 'outcome-golden.json'), 'utf-8');
    const parsed: FounderJournalEntry = JSON.parse(raw);

    it('has valid journal entry fields', () => {
      expect(parsed.entryId).toBe('fe_test_001');
      expect(parsed.interactionId).toBe('wi_test_001');
      expect(parsed.workSessionId).toBe('ws_test_001');
      expect(parsed.eventType).toBe('intervention_accepted');
    });

    it('has details without raw content', () => {
      expect(parsed.details).toBeDefined();
      expect(parsed.details.domain).toBe('code');
      expect(parsed.details.artifactKind).toBe('code');
      expect(parsed.details.artifactTitle).toBe('AuthService.swift');
    });
  });
});

describe('type validation helpers', () => {
  describe('validateField', () => {
    it('returns true and type-narrows for defined values', () => {
      const errors: string[] = [];
      const result = validateField('hello', 'test', errors);
      expect(result).toBe(true);
      expect(errors).toHaveLength(0);
    });

    it('returns false and appends error for undefined', () => {
      const errors: string[] = [];
      const result = validateField(undefined, 'test', errors);
      expect(result).toBe(false);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('test');
    });

    it('returns false for null', () => {
      const errors: string[] = [];
      const result = validateField(null, 'test', errors);
      expect(result).toBe(false);
    });
  });

  describe('validateString', () => {
    it('returns the string for valid values', () => {
      const errors: string[] = [];
      const result = validateString('hello', 'test', errors);
      expect(result).toBe('hello');
      expect(errors).toHaveLength(0);
    });

    it('returns empty and reports error for empty string', () => {
      const errors: string[] = [];
      const result = validateString('   ', 'test', errors);
      expect(result).toBe('');
      expect(errors).toHaveLength(1);
    });
  });

  describe('validateEvidenceItem', () => {
    it('validates a well-formed evidence item', () => {
      const errors: string[] = [];
      const result = validateEvidenceItem(
        { value: 'CleanX', source: 'foreground', confidence: 'high' },
        'project',
        errors
      );
      expect(result).toBe(true);
      expect(errors).toHaveLength(0);
    });

    it('rejects invalid source', () => {
      const errors: string[] = [];
      const result = validateEvidenceItem(
        { value: 'CleanX', source: 'imagination' },
        'project',
        errors
      );
      expect(result).toBe(false);
      expect(errors.some(e => e.includes('source'))).toBe(true);
    });

    it('rejects missing value', () => {
      const errors: string[] = [];
      const result = validateEvidenceItem(
        { source: 'foreground' },
        'project',
        errors
      );
      expect(result).toBe(false);
    });
  });
});
