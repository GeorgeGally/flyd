import { describe, it, expect } from 'vitest';
import {
  selectDomainStandard,
  DOMAIN_STANDARDS,
} from '../work-intelligence/domain-standards.js';
import {
  buildWorkIntelligencePrompt,
  parseWorkIntelligenceResponse,
} from '../work-intelligence/intervention.js';
import { assembleGroundPack } from '../work-intelligence/ground-pack.js';
import type { CurrentWork } from '../work-intelligence/types.js';

function makeCurrentWork(overrides: Partial<CurrentWork> = {}): CurrentWork {
  return {
    project: { value: 'CleanX', source: 'foreground', confidence: 'high', provenance: 'test', sourceTimestamp: new Date().toISOString(), isHypothesis: false },
    objective: { value: 'Build auth service', source: 'foreground', confidence: 'medium', provenance: 'test', sourceTimestamp: new Date().toISOString(), isHypothesis: false },
    artifact: { kind: 'code', title: 'AuthService.swift', contentDigest: 'test', bundleId: 'com.apple.dt.Xcode' },
    stage: { value: 'execution', source: 'foreground', confidence: 'medium', provenance: 'test', sourceTimestamp: new Date().toISOString(), isHypothesis: false },
    constraints: { value: ['Must maintain backward compatibility'], source: 'conversation', confidence: 'high', provenance: 'test', sourceTimestamp: new Date().toISOString(), isHypothesis: false },
    openLoops: [],
    nextAction: { value: { description: 'Review', readiness: 'ready' }, source: 'foreground', confidence: 'high', provenance: 'test', sourceTimestamp: new Date().toISOString(), isHypothesis: false },
    evidenceSummary: {
      sources: ['foreground_element', 'repository'],
      snapshotTimestamp: new Date().toISOString(),
      foregroundApp: 'Xcode',
      repositoryRoot: '/Users/george/Projects/CleanX',
      branch: 'main',
      activeWindowTitle: 'AuthService.swift — CleanX',
    },
    uncertainty: [{ field: 'objective', reason: 'No explicit goal found' }],
    confidence: [{ field: 'project', confidence: 'high' }],
    ...overrides,
  };
}

describe('domain-standards', () => {
  it('selects code standard for code artifact', () => {
    const standard = selectDomainStandard({ artifactKind: 'code' });
    expect(standard.domain).toBe('code');
  });

  it('selects design standard for design bundle', () => {
    const standard = selectDomainStandard({ artifactKind: 'design', bundleId: 'com.figma.Desktop' });
    expect(standard.domain).toBe('design');
  });

  it('selects writing standard for message artifact', () => {
    const standard = selectDomainStandard({ artifactKind: 'message' });
    expect(standard.domain).toBe('writing');
  });

  it('selects research standard for browser', () => {
    const standard = selectDomainStandard({ bundleId: 'com.apple.Safari' });
    expect(standard.domain).toBe('research');
  });

  it('defaults to strategy for unknown', () => {
    const standard = selectDomainStandard({});
    expect(standard.domain).toBe('strategy');
  });

  it('all domains have evaluation dimensions', () => {
    for (const domain of Object.keys(DOMAIN_STANDARDS) as Array<keyof typeof DOMAIN_STANDARDS>) {
      expect(DOMAIN_STANDARDS[domain].evaluationDimensions.length).toBeGreaterThan(0);
      expect(DOMAIN_STANDARDS[domain].focusPrompt.length).toBeGreaterThan(0);
      expect(DOMAIN_STANDARDS[domain].avoidances.length).toBeGreaterThan(0);
    }
  });
});

describe('intervention prompt', () => {
  it('builds a prompt with current work and domain standard', () => {
    const cw = makeCurrentWork();
    const standard = DOMAIN_STANDARDS.code;
    const prompt = buildWorkIntelligencePrompt({
      currentWork: cw,
      domainStandard: standard,
      intent: 'Review this function',
    });

    expect(prompt).toContain('CleanX');
    expect(prompt).toContain('AuthService.swift');
    expect(prompt).toContain('correctness');
    expect(prompt).toContain('maintainability');
    expect(prompt).toContain('Review this function');
    expect(prompt).toContain('GROUND RULES');
    expect(prompt).toContain('UNKNOWN FIELDS');
  });

  it('includes ground pack sections when provided', () => {
    const cw = makeCurrentWork();
    const standard = DOMAIN_STANDARDS.code;
    const groundPack = assembleGroundPack({
      foregroundSummary: 'Foreground summary',
      domainStandard: standard,
      domainStandardProvenance: 'fallback:domain-standards',
      presentModel: null,
      closeout: null,
      foregroundProject: 'CleanX',
      wikiProjectSection: null,
      peopleSections: [],
    });

    const prompt = buildWorkIntelligencePrompt({
      currentWork: cw,
      domainStandard: standard,
      intent: 'Review this function',
      groundPack,
    });

    expect(prompt).toContain('GROUND PACK');
    expect(prompt).toContain('DOMAIN_STANDARD');
    expect(prompt).toContain('FOREGROUND');
  });

  it('includes conversation history when provided', () => {
    const cw = makeCurrentWork();
    const standard = DOMAIN_STANDARDS.writing;
    const prompt = buildWorkIntelligencePrompt({
      currentWork: cw,
      domainStandard: standard,
      intent: 'Make this stronger',
      conversationHistory: 'User: Write email\nFlyd: Here you go',
    });

    expect(prompt).toContain('RECENT CONVERSATION');
    expect(prompt).toContain('Write email');
  });

  it('describes finish_condition as independent action success criteria', () => {
    const prompt = buildWorkIntelligencePrompt({
      currentWork: makeCurrentWork(),
      domainStandard: DOMAIN_STANDARDS.code,
      intent: 'Fix the regression',
    });

    expect(prompt).toContain('"finish_condition"');
  });

  it('reports a dirty worktree from the explicit evidence flag', () => {
    const currentWork = makeCurrentWork();
    currentWork.evidenceSummary = {
      ...currentWork.evidenceSummary,
      isDirty: true,
      statusDigest: 'f4d3a9d1b6f65d1a',
      changedFiles: [],
    };

    const prompt = buildWorkIntelligencePrompt({
      currentWork,
      domainStandard: DOMAIN_STANDARDS.code,
      intent: 'Review this repository',
    });

    expect(prompt).toContain('Working tree is dirty (uncommitted changes present).');
  });
});

describe('parseWorkIntelligenceResponse', () => {
  it('parses a valid response with diagnosis and intervention', () => {
    const raw = JSON.stringify({
      grounding_notes: 'The user is working on auth service code in CleanX',
      diagnosis: {
        primary_issue: {
          category: 'correctness',
          severity: 'critical',
          finding: 'The login function does not handle HTTP errors',
          causal_explanation: 'Without error handling, callers cannot distinguish auth failures from network errors',
          domain: 'code',
          evidence_refs: ['foreground_element_value'],
        },
        contrary_evidence: null,
      },
      intervention: {
        kind: 'critique',
        content: 'Define an AuthError enum and map API errors before propagating',
        stronger_alternative: 'Wrap the api.post call in a do/catch that maps status codes',
        options: [
          { label: 'Show the fix', description: 'Generate refactored code', consequence: 'Code will be updated' },
        ],
      },
    });

    const result = parseWorkIntelligenceResponse(raw);
    expect(result.diagnosis.primaryIssue.category).toBe('correctness');
    expect(result.diagnosis.primaryIssue.severity).toBe('critical');
    expect(result.intervention.kind).toBe('critique');
    expect(result.intervention.strongerAlternative).toBeDefined();
    expect(result.intervention.options).toHaveLength(1);
  });

  it('handles unparseable response gracefully', () => {
    const result = parseWorkIntelligenceResponse('not json at all');
    expect(result.diagnosis.primaryIssue.severity).toBe('improvement');
    expect(result.intervention.kind).toBe('insight');
  });

  it('handles partial response with missing fields', () => {
    const raw = JSON.stringify({
      grounding_notes: '',
      diagnosis: { primary_issue: {} },
      intervention: {},
    });

    const result = parseWorkIntelligenceResponse(raw);
    expect(result.diagnosis.primaryIssue.category).toBeDefined();
    expect(result.intervention.content).toBeDefined();
  });

  it('parses finish_condition independently from the action description', () => {
    const raw = JSON.stringify({
      diagnosis: { primary_issue: {} },
      intervention: {
        content: 'Fix the failing repository check',
        proposed_action: {
          kind: 'repository_action',
          description: 'Update the verifier',
          finish_condition: 'The focused verifier tests pass',
        },
      },
    });

    const result = parseWorkIntelligenceResponse(raw);

    expect(result.intervention.proposedAction?.description).toBe('Update the verifier');
    expect(result.intervention.proposedAction?.finishCondition).toBe('The focused verifier tests pass');
  });

  it('keeps a repository recommendation advisory when finish_condition is absent', () => {
    const raw = JSON.stringify({
      diagnosis: { primary_issue: {} },
      intervention: {
        content: 'The verifier should reject escaping paths',
        proposed_action: {
          kind: 'repository_action',
          description: 'Update the verifier',
        },
      },
    });

    const result = parseWorkIntelligenceResponse(raw);

    expect(result.intervention.content).toBe('The verifier should reject escaping paths');
    expect(result.intervention.proposedAction).toBeUndefined();
  });
});
