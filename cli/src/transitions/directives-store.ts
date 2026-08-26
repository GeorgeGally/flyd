import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Directive persistence (transition-log plan U6).
 *
 * Single flat JSON array file per store directory, 0600 perms — dedupe scans
 * need the whole collection anyway, so per-id files buy nothing here.
 */

export interface BehaviouralDirective {
  directiveId: string;
  /** Sanitized user words, ≤200 chars. */
  text: string;
  /** Normalized similarity key used for TTL-window dedupe. */
  dedupeKey: string;
  /** Sequence of the transition event whose correction produced this directive. */
  sourceSeq: number;
  /** Invocation id of the producing transition; outcome correlation key. */
  sourceCorrelationId: string;
  createdAt: string;
  lastSeenAt: string;
  occurrences: number;
  corroborations: number;
  utility: number;
  negatives: number;
  active: boolean;
  inactiveReason?: string;
}

let directoryOverride: string | undefined;

/** Test/dogfood injection point, mirroring configureSkillifyProposalDirectory. */
export function configureDirectivesStore(directory?: string): void {
  directoryOverride = directory;
}

function directivesDir(): string {
  if (directoryOverride) return directoryOverride;
  const flydDir = process.env.FLYD_DIR?.trim() || join(homedir(), ".flyd");
  return join(flydDir, "overlay", "behavioural-directives");
}

function directivesFilePath(): string {
  return join(directivesDir(), "directives.json");
}

export function loadDirectives(): BehaviouralDirective[] {
  const path = directivesFilePath();
  if (!existsSync(path)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!Array.isArray(parsed)) throw new Error("store is not an array");
    return parsed as BehaviouralDirective[];
  } catch (error) {
    console.warn(
      "[directives] corrupt directives store, treating as empty:",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

export function saveDirectives(directives: BehaviouralDirective[]): void {
  const dir = directivesDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(directivesFilePath(), JSON.stringify(directives, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export function listDirectives(options: { activeOnly?: boolean } = {}): BehaviouralDirective[] {
  const all = loadDirectives();
  return options.activeOnly ? all.filter((d) => d.active) : all;
}

export function getDirective(directiveId: string): BehaviouralDirective | null {
  return loadDirectives().find((d) => d.directiveId === directiveId) ?? null;
}

export function findDirectiveByDedupeKey(dedupeKey: string): BehaviouralDirective | null {
  return loadDirectives().find((d) => d.dedupeKey === dedupeKey) ?? null;
}
