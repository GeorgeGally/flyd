import {
  ALWAYS_DENIED_TOOLS,
  MORNING_BRIEFING_ALLOWLIST,
  type JobDef,
  type JobTool,
  type JobType,
} from './types.js';

const TYPE_ALLOWLISTS: Record<JobType, readonly JobTool[]> = {
  morning_briefing: MORNING_BRIEFING_ALLOWLIST,
};

/** Effective tools = job toolPolicy ∩ type-hard allowlist; always-denied never pass. */
export function resolveEffectiveTools(job: JobDef): JobTool[] {
  const typeAllow = new Set(TYPE_ALLOWLISTS[job.type] ?? []);
  const requested =
    job.toolPolicy.length === 1 && job.toolPolicy[0] === '*'
      ? [...typeAllow]
      : (job.toolPolicy as JobTool[]);

  return requested.filter((tool) => {
    if (ALWAYS_DENIED_TOOLS.includes(tool)) return false;
    return typeAllow.has(tool);
  });
}

export function assertToolAllowed(job: JobDef, tool: JobTool): void {
  const effective = resolveEffectiveTools(job);
  if (!effective.includes(tool)) {
    throw new Error(`Tool "${tool}" not allowed for job type ${job.type}`);
  }
}

export function isToolDeniedEvenIfListed(tool: JobTool): boolean {
  return ALWAYS_DENIED_TOOLS.includes(tool);
}
