import type { WorkHypothesis } from '../work/work-hypothesis/types.js';
import type { DomainStandard } from './domain-standards.js';
import type { CurrentWork, WorkSessionCloseout } from './types.js';

export type GroundPackSectionKind =
  | 'foreground'
  | 'domain_standard'
  | 'closeout'
  | 'wiki_project'
  | 'present_model'
  | 'people'
  | 'colleague_preload';

export interface GroundPackSection {
  kind: GroundPackSectionKind;
  label: string;
  provenance: string;
  content: string;
  uncertain?: boolean;
}

export interface GroundPackProjectResolution {
  primaryProject: string;
  primarySource: 'foreground' | 'present_model';
  secondaryProject?: string;
  conflict: boolean;
  uncertaintyReason?: string;
}

export interface GroundPack {
  project: GroundPackProjectResolution;
  sections: GroundPackSection[];
  gaps: string[];
  domainStandard: DomainStandard;
  domainStandardProvenance: string;
  totalChars: number;
}

export const DEFAULT_GROUND_PACK_CHAR_BUDGET = 12_000;

/** Trim priority: drop lowest-value sections first (colleague → people → …). */
export const TRIM_ORDER: GroundPackSectionKind[] = [
  'colleague_preload',
  'people',
  'present_model',
  'wiki_project',
  'closeout',
  'domain_standard',
];

export const PROTECTED_SECTION_KINDS: GroundPackSectionKind[] = ['foreground'];

export function buildForegroundSummary(currentWork: CurrentWork): string {
  return [
    `Project: ${currentWork.project.value}`,
    `Objective: ${currentWork.objective.value}`,
    `Artifact: ${currentWork.artifact.title} (${currentWork.artifact.kind})`,
    `Stage: ${currentWork.stage.value}`,
    currentWork.nextAction?.value?.description
      ? `Next action: ${currentWork.nextAction.value.description}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function normalizeProjectName(name: string): string {
  return name.trim().toLowerCase();
}

export function resolvePackProject(
  foregroundProject: string,
  presentModel: WorkHypothesis | null,
): GroundPackProjectResolution {
  const foreground = foregroundProject.trim();
  const pmPrimary = presentModel?.primaryThreads?.[0]?.name?.trim();

  if (!pmPrimary || normalizeProjectName(pmPrimary) === normalizeProjectName(foreground)) {
    return {
      primaryProject: foreground,
      primarySource: 'foreground',
      conflict: false,
    };
  }

  return {
    primaryProject: foreground,
    primarySource: 'foreground',
    secondaryProject: pmPrimary,
    conflict: true,
    uncertaintyReason: `Present Model suggests ${pmPrimary} as primary work; foreground is ${foreground}.`,
  };
}

export function resolveOvernightProject(params: {
  projectId?: string;
  presentModel: WorkHypothesis | null;
  nowMs?: number;
  freshMs?: number;
}): GroundPackProjectResolution & { ok: boolean; failReason?: string } {
  const nowMs = params.nowMs ?? Date.now();
  const freshMs = params.freshMs ?? 36 * 60 * 60 * 1000;
  const explicit = params.projectId?.trim();

  if (explicit) {
    const pmPrimary = params.presentModel?.primaryThreads?.[0]?.name?.trim();
    if (pmPrimary && normalizeProjectName(pmPrimary) !== normalizeProjectName(explicit)) {
      return {
        ok: true,
        primaryProject: explicit,
        primarySource: 'foreground',
        secondaryProject: pmPrimary,
        conflict: true,
        uncertaintyReason: `Job projectId=${explicit}; Present Model primary is ${pmPrimary} (background only).`,
      };
    }
    return {
      ok: true,
      primaryProject: explicit,
      primarySource: 'foreground',
      conflict: false,
    };
  }

  const pm = params.presentModel;
  const pmPrimary = pm?.primaryThreads?.[0]?.name?.trim();
  if (!pm || !pmPrimary) {
    return {
      ok: false,
      primaryProject: 'unknown',
      primarySource: 'present_model',
      conflict: false,
      failReason: 'Overnight briefing requires job projectId or a Present Model primary thread',
    };
  }

  const revisedAt = Date.parse(pm.revisedAt || pm.generatedAt);
  if (!Number.isFinite(revisedAt) || nowMs - revisedAt > freshMs) {
    return {
      ok: false,
      primaryProject: pmPrimary,
      primarySource: 'present_model',
      conflict: false,
      failReason: 'Present Model is stale for overnight project resolution; set job projectId',
    };
  }

  return {
    ok: true,
    primaryProject: pmPrimary,
    primarySource: 'present_model',
    conflict: false,
  };
}

export function buildPresentModelSection(
  presentModel: WorkHypothesis | null,
  resolution: GroundPackProjectResolution,
): GroundPackSection | null {
  if (!presentModel) return null;

  const lines: string[] = [
    presentModel.hypothesisText,
  ];

  if (presentModel.objective?.value) {
    lines.push(`Objective: ${presentModel.objective.value}`);
  }

  if (presentModel.primaryThreads.length > 0) {
    lines.push(
      `Primary threads: ${presentModel.primaryThreads.map((t) => t.name).join(', ')}`,
    );
  }

  if (presentModel.secondaryThreads.length > 0) {
    lines.push(
      `Secondary threads: ${presentModel.secondaryThreads.map((t) => t.name).join(', ')}`,
    );
  }

  if (presentModel.uncertainty.length > 0) {
    lines.push(
      ...presentModel.uncertainty.map((u) => `Uncertainty (${u.field}): ${u.reason}`),
    );
  }

  return {
    kind: 'present_model',
    label: 'PRESENT_MODEL',
    provenance: 'work-hypothesis',
    content: lines.join('\n'),
    uncertain: resolution.conflict,
  };
}

export function buildCloseoutSection(
  closeout: WorkSessionCloseout | null,
  projectName: string,
): GroundPackSection | null {
  if (!closeout) return null;
  if (normalizeProjectName(closeout.project) !== normalizeProjectName(projectName)) {
    return null;
  }

  const lines = [
    `Last verified: ${closeout.lastVerifiedState}`,
    `Next action: ${closeout.nextAction}`,
  ];

  if (closeout.unresolvedIssues.length > 0) {
    lines.push(`Unresolved: ${closeout.unresolvedIssues.join('; ')}`);
  }

  if (closeout.corrections.length > 0) {
    lines.push(`Corrections: ${closeout.corrections.join('; ')}`);
  }

  return {
    kind: 'closeout',
    label: 'CLOSEOUT',
    provenance: `session-closeout:${closeout.workSessionId}`,
    content: lines.join('\n'),
  };
}

export function buildColleaguePreload(
  sections: GroundPackSection[],
  maxChars: number,
): GroundPackSection | null {
  const sourceKinds: GroundPackSectionKind[] = [
    'wiki_project',
    'closeout',
    'present_model',
    'people',
  ];

  const excerpts: string[] = [];
  for (const kind of sourceKinds) {
    const section = sections.find((s) => s.kind === kind);
    if (!section?.content.trim()) continue;
    const snippet = section.content.trim().slice(0, 400);
    excerpts.push(`- [${section.label} / ${section.provenance}] ${snippet}`);
  }

  if (excerpts.length === 0) return null;

  let content = [
    'Background context Flyd already knows (does not override foreground):',
    ...excerpts,
  ].join('\n');

  if (content.length > maxChars) {
    content = content.slice(0, maxChars - 3) + '...';
  }

  return {
    kind: 'colleague_preload',
    label: 'COLLEAGUE_PRELOAD',
    provenance: 'deterministic-excerpt',
    content,
  };
}

export function trimPackSections(
  sections: GroundPackSection[],
  maxChars: number,
): { sections: GroundPackSection[]; gaps: string[]; totalChars: number } {
  const gaps: string[] = [];
  let working = [...sections];
  let totalChars = working.reduce((sum, s) => sum + s.content.length, 0);

  for (const kind of TRIM_ORDER) {
    if (totalChars <= maxChars) break;
    const idx = working.findIndex((s) => s.kind === kind);
    if (idx === -1) continue;
    gaps.push(`trimmed:${kind}`);
    working.splice(idx, 1);
    totalChars = working.reduce((sum, s) => sum + s.content.length, 0);
  }

  return { sections: working, gaps, totalChars };
}

export function formatGroundPackForPrompt(pack: GroundPack): string {
  const blocks: string[] = [];

  if (pack.project.conflict && pack.project.uncertaintyReason) {
    blocks.push(
      `PROJECT CONFLICT (foreground wins): ${pack.project.uncertaintyReason}`,
    );
  }

  for (const section of pack.sections) {
    const uncertainTag = section.uncertain ? ' [uncertain — background only]' : '';
    blocks.push(
      `${section.label}${uncertainTag} (${section.provenance}):\n${section.content}`,
    );
  }

  if (pack.gaps.length > 0) {
    blocks.push(`PACK GAPS: ${pack.gaps.join(', ')}`);
  }

  return blocks.join('\n\n');
}

export function assembleGroundPack(params: {
  foregroundSummary: string;
  domainStandard: DomainStandard;
  domainStandardProvenance: string;
  presentModel: WorkHypothesis | null;
  closeout: WorkSessionCloseout | null;
  foregroundProject: string;
  wikiProjectSection: GroundPackSection | null;
  peopleSections: GroundPackSection[];
  maxChars?: number;
}): GroundPack {
  const maxChars = params.maxChars ?? DEFAULT_GROUND_PACK_CHAR_BUDGET;
  const project = resolvePackProject(params.foregroundProject, params.presentModel);
  const gaps: string[] = [];

  const sections: GroundPackSection[] = [
    {
      kind: 'foreground',
      label: 'FOREGROUND',
      provenance: 'current-work',
      content: params.foregroundSummary,
    },
    {
      kind: 'domain_standard',
      label: 'DOMAIN_STANDARD',
      provenance: params.domainStandardProvenance,
      content: [
        `Domain: ${params.domainStandard.domain}`,
        'Evaluation dimensions:',
        ...params.domainStandard.evaluationDimensions.map((d) => `  - ${d}`),
        params.domainStandard.focusPrompt,
        'Avoidances:',
        ...params.domainStandard.avoidances.map((a) => `  - ${a}`),
      ].join('\n'),
    },
  ];

  const closeoutSection = buildCloseoutSection(params.closeout, project.primaryProject);
  if (closeoutSection) {
    sections.push(closeoutSection);
  } else if (params.closeout) {
    gaps.push('closeout:project-mismatch');
  }

  if (params.wikiProjectSection) {
    sections.push(params.wikiProjectSection);
  } else {
    gaps.push('wiki_project:missing');
  }

  const presentModelSection = buildPresentModelSection(params.presentModel, project);
  if (presentModelSection) {
    sections.push(presentModelSection);
  } else {
    gaps.push('present_model:missing');
  }

  if (params.peopleSections.length > 0) {
    sections.push(...params.peopleSections);
  } else {
    gaps.push('people:none');
  }

  const preload = buildColleaguePreload(sections, 1_500);
  if (preload) {
    sections.push(preload);
  }

  const trimmed = trimPackSections(sections, maxChars);

  return {
    project,
    sections: trimmed.sections,
    gaps: [...gaps, ...trimmed.gaps],
    domainStandard: params.domainStandard,
    domainStandardProvenance: params.domainStandardProvenance,
    totalChars: trimmed.totalChars,
  };
}
