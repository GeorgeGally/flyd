export type JobType = 'morning_briefing';

export type JobWriteMode = 'artifact';

export type JobDelivery = 'pull';

export type JobTool =
  | 'wiki_read'
  | 'present_model_read'
  | 'closeout_read'
  | 'local_compose'
  | 'evidence_network'
  | 'wiki_write'
  | 'schedule_mutation'
  | 'present_bridge'
  | 'credential_exfil';

export interface JobBudgets {
  /** Max wall-clock ms for a single run. */
  maxWallClockMs: number;
  /** Max artifact body chars. */
  maxArtifactChars: number;
  /** Max ground-pack chars for briefing compose. */
  maxPackChars: number;
}

export interface JobDef {
  id: string;
  type: JobType;
  enabled: boolean;
  /** Local-timezone daily HH:MM. */
  schedule: string;
  skillIds: string[];
  prompt?: string;
  toolPolicy: JobTool[] | ['*'];
  budgets: JobBudgets;
  delivery: JobDelivery;
  writeMode: JobWriteMode;
  /** Explicit project for overnight (preferred). */
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobRunAudit {
  runId: string;
  jobId: string;
  scheduleSlot: string;
  startedAt: string;
  finishedAt: string;
  status: 'completed' | 'incomplete' | 'failed' | 'skipped';
  reason?: string;
  artifactPath?: string;
  toolsUsed: JobTool[];
  /** Scrubbed — never stores secrets, screen, AX, or long raw user text. */
  notes?: string;
}

export interface JobRunResult {
  ok: boolean;
  status: JobRunAudit['status'];
  audit: JobRunAudit;
  artifactPath?: string;
  error?: string;
}

export const MORNING_BRIEFING_ALLOWLIST: readonly JobTool[] = [
  'wiki_read',
  'present_model_read',
  'closeout_read',
  'local_compose',
] as const;

export const ALWAYS_DENIED_TOOLS: readonly JobTool[] = [
  'evidence_network',
  'wiki_write',
  'schedule_mutation',
  'present_bridge',
  'credential_exfil',
] as const;

export const DEFAULT_JOB_BUDGETS: JobBudgets = {
  maxWallClockMs: 30_000,
  maxArtifactChars: 8_000,
  maxPackChars: 6_000,
};

/** Present Model older than this is "stale" for overnight project resolution. */
export const PRESENT_MODEL_FRESH_MS = 36 * 60 * 60 * 1000;

export const SECRET_FIELD_PATTERN =
  /^(api[_-]?key|access[_-]?token|refresh[_-]?token|bearer|authorization|password|secret|token)$/i;
