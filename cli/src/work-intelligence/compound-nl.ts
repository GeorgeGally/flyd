import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { parse } from '../lib/frontmatter.js';
import { listPendingProposals } from './skillify/proposal-store.js';
import { listJobs, listJobAudits, ensureDefaultMorningBriefingJob } from './jobs/store.js';
import { isJobsGloballyPaused, readPauseReason } from './jobs/controls.js';
import { readPresentModel } from '../work/work-hypothesis/index.js';
import { readLatestCloseoutForProject } from './work-session-closeout-store.js';
import { loadWikiProjectSection } from './ground-pack-wiki.js';

export type CompoundNlKind =
  | 'skills_inventory'
  | 'skillify_propose'
  | 'jobs_status'
  | 'jobs_run_briefing'
  | 'job_hunt_status';

export interface CompoundNlMatch {
  kind: CompoundNlKind;
  reply: string;
}

const SKILLS_INVENTORY =
  /\b(?:what(?:'s|s| are)?\s+(?:my\s+)?skills|skills?\s+do\s+i\s+have|list\s+(?:my\s+)?skills|show\s+(?:my\s+)?skills|what\s+(?:domain\s+)?standards|pending\s+skillify|skillify\s+(?:list|pending))\b/i;

const SKILLIFY_PROPOSE =
  /\b(?:(?:can|could|should)\s+i\s+)?(?:make|turn|convert|save|skillify)\s+(?:this|that|it)\s+(?:into\s+)?(?:a\s+)?skill\b|\bmake\s+this\s+a\s+(?:skill|standard|constraint)\b|\bremember\s+this\s+as\s+a\s+(?:skill|standard|constraint)\b|\bskillify\s+(?:this|that)\b/i;

const JOBS_STATUS =
  /\b(?:(?:list|show|status)\s+(?:my\s+)?(?:overnight\s+)?jobs|(?:overnight|scheduled)\s+jobs|morning\s+briefing(?:\s+status)?|flyd\s+jobs|jobs?\s+(?:enabled|paused|running))\b/i;

const JOBS_RUN =
  /\b(?:(?:run|enable|start)\s+(?:my\s+)?(?:morning\s+)?briefing|(?:run|enable)\s+(?:overnight\s+)?job)\b/i;

const JOB_HUNT =
  /\b(?:job\s+hunt|job\s+search|looking\s+for\s+(?:a\s+)?job|interview\s+prep|how(?:'s| is)\s+my\s+job\s+(?:hunt|search))\b/i;

function flydRoot(): string {
  return process.env.FLYD_DIR?.trim() || join(homedir(), '.flyd');
}

function wikiDir(...parts: string[]): string {
  return join(flydRoot(), 'wiki', ...parts);
}

function listMarkdownTitles(subdir: string): Array<{ file: string; title: string; excerpt: string }> {
  const dir = wikiDir(subdir);
  if (!existsSync(dir)) return [];
  const out: Array<{ file: string; title: string; excerpt: string }> = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    try {
      const raw = readFileSync(join(dir, file), 'utf-8');
      const parsed = parse(raw);
      const title =
        String(parsed.metadata.title ?? parsed.metadata.domain ?? basename(file, '.md'));
      const excerpt = parsed.body.trim().split('\n').find((l) => l.trim())?.slice(0, 120) ?? '';
      out.push({ file: `${subdir}/${file}`, title, excerpt });
    } catch {
      out.push({ file: `${subdir}/${file}`, title: basename(file, '.md'), excerpt: '' });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

export function detectCompoundNlKind(message: string): CompoundNlKind | null {
  const text = message.trim();
  if (!text) return null;
  // Propose before inventory so "make this into a skill" wins over broad "skill"
  if (SKILLIFY_PROPOSE.test(text)) return 'skillify_propose';
  if (JOBS_RUN.test(text)) return 'jobs_run_briefing';
  if (JOBS_STATUS.test(text)) return 'jobs_status';
  if (JOB_HUNT.test(text)) return 'job_hunt_status';
  if (SKILLS_INVENTORY.test(text)) return 'skills_inventory';
  return null;
}

export function isCompoundNlUtterance(message: string): boolean {
  return detectCompoundNlKind(message) !== null;
}

function formatEntryList(
  label: string,
  entries: Array<{ file: string; title: string; excerpt: string }>,
): string {
  if (entries.length === 0) return `${label}: none yet.`;
  return [
    `${label}:`,
    ...entries.map((e) =>
      `- ${e.title} (\`${e.file}\`)${e.excerpt ? ` — ${e.excerpt}` : ''}`,
    ),
  ].join('\n');
}

export function buildSkillsInventoryReply(): string {
  const standards = listMarkdownTitles('standards');
  const skills = listMarkdownTitles('skills');
  const constraints = listMarkdownTitles('constraints');
  const pending = listPendingProposals();

  const lines = [
    'Here is what Flyd has as durable skills/judgment (wiki), plus pending Skillify proposals.',
    '',
    formatEntryList('Domain standards', standards),
    '',
    formatEntryList('Identity skills', skills),
    '',
    formatEntryList('Constraints', constraints),
    '',
  ];

  if (pending.length === 0) {
    lines.push('Pending Skillify proposals: none.');
  } else {
    lines.push('Pending Skillify proposals (confirm to write wiki):');
    for (const p of pending) {
      lines.push(`- ${p.kind} → \`${p.targetPath}\` (${p.id.slice(0, 8)})`);
    }
    lines.push('', 'Confirm with: `flyd skillify list` then `flyd skillify confirm <id>`');
  }

  if (standards.length === 0 && skills.length === 0 && constraints.length === 0 && pending.length === 0) {
    lines.push(
      '',
      'Nothing written yet. Accept a critique, reject with a correction, or say “make this into a skill” to propose one.',
    );
  }

  return lines.join('\n');
}

export function buildSkillifyProposeReply(params?: {
  selection?: string | null;
  domain?: string;
}): string {
  const selection = params?.selection?.trim();
  if (selection && selection.length >= 12) {
    const domain = (params?.domain || 'strategy').toLowerCase();
    return [
      'Yes — that can become a Skillify proposal (confirm required before wiki write).',
      '',
      `Suggested kind: domain_standard / constraint under domain “${domain}”.`,
      `Excerpt: ${selection.slice(0, 200)}${selection.length > 200 ? '…' : ''}`,
      '',
      'Next:',
      '1. Accept/reject+correct in work intervention, or use CLI after propose.',
      '2. `flyd skillify list` → `flyd skillify show <id>` → `flyd skillify confirm <id>`',
      '',
      'Pending proposals never steer Diagnose until confirmed and written.',
    ].join('\n');
  }

  return [
    'Yes. Flyd skillifies durable judgment into wiki markdown with your confirm — not silently.',
    '',
    'Ways to propose:',
    '- Accept a work intervention (standard/decision candidate)',
    '- Reject with a correction (constraint candidate)',
    '- After closeout, review pending proposals',
    '',
    'Then: `flyd skillify list` → `show` → `confirm` (or Decline).',
    'Written skills live under `wiki/standards/` and `wiki/constraints/` and feed the next Ground pack.',
  ].join('\n');
}

export function buildJobsStatusReply(): string {
  const jobs = listJobs();
  const paused = isJobsGloballyPaused();
  const audits = listJobAudits(5);
  const lines = [
    'Overnight work jobs (artifact-first, pull delivery — not PRESENT cognition):',
    '',
  ];

  if (paused) {
    lines.push(`Global pause: ${readPauseReason()}`);
    lines.push('');
  }

  if (jobs.length === 0) {
    lines.push('No jobs configured yet.');
    lines.push('Enable one with: `flyd jobs enable morning-briefing --project <name>`');
  } else {
    for (const job of jobs) {
      lines.push(
        `- ${job.type} ${job.enabled ? 'on' : 'off'} @ ${job.schedule}` +
          (job.projectId ? ` project=${job.projectId}` : '') +
          ` (${job.id.slice(0, 8)})`,
      );
    }
  }

  if (audits.length > 0) {
    lines.push('', 'Recent runs:');
    for (const a of audits) {
      lines.push(
        `- ${a.status} ${a.scheduleSlot}` +
          (a.artifactPath ? ` → ${a.artifactPath}` : '') +
          (a.reason ? ` (${a.reason})` : ''),
      );
    }
  }

  lines.push('', 'Run now: `flyd jobs run morning-briefing --project <name>`');
  return lines.join('\n');
}

export function buildJobsRunBriefingReply(projectHint?: string): string {
  const job = ensureDefaultMorningBriefingJob(projectHint);
  return [
    'Morning briefing is an opt-in overnight job that writes a pull-first artifact (no PRESENT interrupt).',
    '',
    `Job ${job.id.slice(0, 8)} is ${job.enabled ? 'enabled' : 'disabled'} (schedule ${job.schedule}` +
      (job.projectId ? `, project ${job.projectId}` : '') +
      ').',
    '',
    projectHint
      ? `Run: \`flyd jobs run morning-briefing --project ${projectHint}\``
      : 'Run: `flyd jobs run morning-briefing --project <name>` (or set projectId on the job).',
    'Artifacts land in `~/.flyd/overlay/job-artifacts/`. List with `flyd jobs audits`.',
  ].join('\n');
}

export function buildJobHuntStatusReply(presentHypothesis?: string | null): string {
  const lines: string[] = ['Job hunt status (from Present Model + wiki — not invented):', ''];

  let pm: string | null = null;
  if (presentHypothesis !== undefined) {
    pm = presentHypothesis?.trim() || null;
  } else {
    const model = readPresentModel();
    pm = model?.hypothesisText?.trim() || null;
  }
  if (pm) {
    lines.push('Present Model:');
    lines.push(pm);
    lines.push('');
  } else {
    lines.push('No Present Model hypothesis on disk yet.');
    lines.push('');
  }

  const candidates = ['job-hunt', 'jobhunt', 'job-search', 'interviews', 'career'];
  let foundWiki = false;
  for (const name of candidates) {
    const section = loadWikiProjectSection(name);
    if (section) {
      foundWiki = true;
      lines.push(`Wiki project (${section.provenance}):`);
      lines.push(section.content.slice(0, 800));
      lines.push('');
      const closeout = readLatestCloseoutForProject(name);
      if (closeout) {
        lines.push(`Latest closeout: next=${closeout.nextAction}; verified=${closeout.lastVerifiedState}`);
        lines.push('');
      }
      break;
    }
  }

  // Optional: projects/jobs.md only if it clearly looks like a job hunt page
  if (!foundWiki) {
    const jobsPage = loadWikiProjectSection('jobs');
    if (jobsPage && /\b(interview|hunt|search|application|resume|cv)\b/i.test(jobsPage.content)) {
      foundWiki = true;
      lines.push(`Wiki project (${jobsPage.provenance}):`);
      lines.push(jobsPage.content.slice(0, 800));
      lines.push('');
    }
  }

  // Also surface career folder pages mentioning hunt/search
  const career = listMarkdownTitles('career').filter((e) =>
    /job|hunt|interview|search|career/i.test(`${e.title} ${e.excerpt}`),
  );
  if (career.length > 0) {
    lines.push(formatEntryList('Career wiki pages', career.slice(0, 5)));
    lines.push('');
    foundWiki = true;
  }

  if (!foundWiki && !pm) {
    lines.push(
      'I do not have a job-hunt project page or Present Model signal yet — I will not invent progress.',
    );
    lines.push(
      'Capture a project as `wiki/projects/job-hunt.md` or keep working with Flyd open so Present Model can form.',
    );
  } else if (!foundWiki) {
    lines.push(
      'No dedicated `wiki/projects/job-hunt.md` yet. Present Model above is the current signal; Skillify a standard if judgment should stick.',
    );
  }

  return lines.join('\n').trim();
}

export function handleCompoundNl(
  message: string,
  opts?: { selection?: string | null; presentHypothesis?: string | null; projectHint?: string },
): CompoundNlMatch | null {
  const kind = detectCompoundNlKind(message);
  if (!kind) return null;

  switch (kind) {
    case 'skills_inventory':
      return { kind, reply: buildSkillsInventoryReply() };
    case 'skillify_propose':
      return { kind, reply: buildSkillifyProposeReply({ selection: opts?.selection }) };
    case 'jobs_status':
      return { kind, reply: buildJobsStatusReply() };
    case 'jobs_run_briefing':
      return { kind, reply: buildJobsRunBriefingReply(opts?.projectHint) };
    case 'job_hunt_status':
      return { kind, reply: buildJobHuntStatusReply(opts?.presentHypothesis) };
  }
}
