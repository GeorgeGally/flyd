import { describe, it, expect } from 'vitest';
import {
  resolvePackProject,
  trimPackSections,
  buildColleaguePreload,
  assembleGroundPack,
  DEFAULT_GROUND_PACK_CHAR_BUDGET,
} from '../work-intelligence/ground-pack.js';
import { DOMAIN_STANDARDS } from '../work-intelligence/domain-standards.js';
import type { WorkHypothesis } from '../work/work-hypothesis/types.js';
import type { GroundPackSection } from '../work-intelligence/ground-pack.js';

function makePresentModel(primaryName: string): WorkHypothesis {
  return {
    id: 'h1',
    hypothesisText: `Working on ${primaryName}`,
    primaryThreads: [{ root: '/p', name: primaryName, isDirty: false, hasTasks: false, isForeground: false, signals: [], demoted: false }],
    secondaryThreads: [],
    confidence: 'medium',
    uncertainty: [],
    evidenceRefs: [],
    demotions: [],
    revisedAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    fromCache: false,
  };
}

describe('resolvePackProject', () => {
  it('returns single primary when foreground and Present Model agree', () => {
    const result = resolvePackProject('Flyd', makePresentModel('Flyd'));
    expect(result.primaryProject).toBe('Flyd');
    expect(result.conflict).toBe(false);
    expect(result.secondaryProject).toBeUndefined();
  });

  it('foreground wins when Present Model disagrees', () => {
    const result = resolvePackProject('Flyd', makePresentModel('CleanX'));
    expect(result.primaryProject).toBe('Flyd');
    expect(result.secondaryProject).toBe('CleanX');
    expect(result.conflict).toBe(true);
    expect(result.uncertaintyReason).toContain('CleanX');
  });

  it('handles missing Present Model', () => {
    const result = resolvePackProject('Flyd', null);
    expect(result.primaryProject).toBe('Flyd');
    expect(result.conflict).toBe(false);
  });
});

describe('trimPackSections', () => {
  const section = (kind: GroundPackSection['kind'], size: number): GroundPackSection => ({
    kind,
    label: kind.toUpperCase(),
    provenance: 'test',
    content: 'x'.repeat(size),
  });

  it('drops lowest-priority sections first when over budget', () => {
    const sections = [
      section('foreground', 100),
      section('domain_standard', 100),
      section('colleague_preload', 500),
      section('people', 500),
    ];

    const result = trimPackSections(sections, 400);
    expect(result.sections.some((s) => s.kind === 'foreground')).toBe(true);
    expect(result.sections.some((s) => s.kind === 'domain_standard')).toBe(true);
    expect(result.sections.some((s) => s.kind === 'colleague_preload')).toBe(false);
    expect(result.gaps.some((g) => g.includes('colleague_preload'))).toBe(true);
  });
});

describe('buildColleaguePreload', () => {
  it('formats deterministic excerpts with provenance labels', () => {
    const sections: GroundPackSection[] = [
      {
        kind: 'wiki_project',
        label: 'WIKI_PROJECT',
        provenance: 'wiki/projects/flyd.md',
        content: 'Flyd is work intelligence.',
      },
    ];

    const preload = buildColleaguePreload(sections, 2000);
    expect(preload?.content).toContain('does not override foreground');
    expect(preload?.content).toContain('wiki/projects/flyd.md');
    expect(preload?.content).toContain('Flyd is work intelligence');
  });
});

describe('assembleGroundPack', () => {
  it('assembles a valid pack with gaps for missing optional sections', () => {
    const pack = assembleGroundPack({
      foregroundSummary: 'Project Flyd, artifact code.ts',
      domainStandard: DOMAIN_STANDARDS.code,
      domainStandardProvenance: 'fallback:domain-standards',
      presentModel: null,
      closeout: null,
      foregroundProject: 'Flyd',
      wikiProjectSection: null,
      peopleSections: [],
      maxChars: DEFAULT_GROUND_PACK_CHAR_BUDGET,
    });

    expect(pack.project.primaryProject).toBe('Flyd');
    expect(pack.sections.some((s) => s.kind === 'foreground')).toBe(true);
    expect(pack.sections.some((s) => s.kind === 'domain_standard')).toBe(true);
    expect(pack.gaps).toContain('wiki_project:missing');
    expect(pack.gaps).toContain('present_model:missing');
  });

  it('labels Present Model uncertain when conflict exists', () => {
    const pack = assembleGroundPack({
      foregroundSummary: 'Foreground Flyd',
      domainStandard: DOMAIN_STANDARDS.strategy,
      domainStandardProvenance: 'fallback:domain-standards',
      presentModel: makePresentModel('CleanX'),
      closeout: null,
      foregroundProject: 'Flyd',
      wikiProjectSection: null,
      peopleSections: [],
    });

    const pm = pack.sections.find((s) => s.kind === 'present_model');
    expect(pm?.uncertain).toBe(true);
    expect(pack.project.conflict).toBe(true);
  });
});
