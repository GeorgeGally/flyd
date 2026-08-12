import type { WorkHypothesis } from '../../../work/work-hypothesis/types.js';
import type { WorkSessionCloseout } from '../../types.js';
import {
  assembleGroundPack,
  formatGroundPackForPrompt,
  resolveOvernightProject,
  type GroundPack,
} from '../../ground-pack.js';
import {
  loadDomainStandard,
  loadWikiProjectSection,
  loadPeopleSections,
} from '../../ground-pack-wiki.js';
import type { JobDef, JobTool } from '../types.js';
import { PRESENT_MODEL_FRESH_MS } from '../types.js';
import { assertToolAllowed } from '../tool-policy.js';

export interface MorningBriefingDeps {
  readPresentModel: () => WorkHypothesis | null;
  readLatestCloseoutForProject: (projectName: string) => WorkSessionCloseout | null;
  nowMs?: number;
}

export interface MorningBriefingComposeResult {
  ok: boolean;
  error?: string;
  projectName?: string;
  pack?: GroundPack;
  markdown?: string;
  toolsUsed: JobTool[];
}

function buildOvernightForegroundSummary(projectName: string, presentModel: WorkHypothesis | null): string {
  const lines = [
    `Project: ${projectName}`,
    `Mode: overnight morning briefing (no live foreground)`,
  ];
  if (presentModel?.objective?.value) {
    lines.push(`Objective: ${presentModel.objective.value}`);
  }
  if (presentModel?.uncertainty?.length) {
    lines.push(
      ...presentModel.uncertainty.slice(0, 3).map((u) => `Uncertainty (${u.field}): ${u.reason}`),
    );
  }
  return lines.join('\n');
}

export function composeMorningBriefing(
  job: JobDef,
  deps: MorningBriefingDeps,
): MorningBriefingComposeResult {
  const toolsUsed: JobTool[] = [];

  try {
    assertToolAllowed(job, 'present_model_read');
    toolsUsed.push('present_model_read');
    const presentModel = deps.readPresentModel();

    const resolution = resolveOvernightProject({
      projectId: job.projectId,
      presentModel,
      nowMs: deps.nowMs,
      freshMs: PRESENT_MODEL_FRESH_MS,
    });
    if (!resolution.ok) {
      return { ok: false, error: resolution.failReason, toolsUsed };
    }

    const projectName = resolution.primaryProject;

    assertToolAllowed(job, 'wiki_read');
    toolsUsed.push('wiki_read');
    const { standard, provenance } = loadDomainStandard({
      artifactKind: 'code',
      projectName,
    });
    const wikiProjectSection = loadWikiProjectSection(projectName);
    const peopleSections = loadPeopleSections([]);

    assertToolAllowed(job, 'closeout_read');
    toolsUsed.push('closeout_read');
    const closeout = deps.readLatestCloseoutForProject(projectName);

    assertToolAllowed(job, 'local_compose');
    toolsUsed.push('local_compose');

    const pack = assembleGroundPack({
      foregroundSummary: buildOvernightForegroundSummary(projectName, presentModel),
      domainStandard: standard,
      domainStandardProvenance: provenance,
      presentModel,
      closeout,
      foregroundProject: projectName,
      wikiProjectSection,
      peopleSections,
      maxChars: job.budgets.maxPackChars,
    });

    const packText = formatGroundPackForPrompt(pack);
    const promptNote = job.prompt?.trim() ? `\n\nJob prompt:\n${job.prompt.trim()}` : '';
    const skillNote =
      job.skillIds.length > 0
        ? `\n\nSkill ids (wiki standards/constraints slugs): ${job.skillIds.join(', ')}`
        : '';

    const markdown = [
      `# Morning briefing — ${projectName}`,
      '',
      `Generated: ${new Date(deps.nowMs ?? Date.now()).toISOString()}`,
      `Job: ${job.id}`,
      '',
      '## Ground pack',
      '',
      packText,
      promptNote,
      skillNote,
      '',
      '## Notes',
      '',
      '- Artifact-only delivery (pull-first). Not auto-injected into Diagnose.',
      '- No evidence network and no wiki writes in this job type.',
    ].join('\n');

    return { ok: true, projectName, pack, markdown, toolsUsed };
  } catch (error) {
    return { ok: false, error: (error as Error).message, toolsUsed };
  }
}
