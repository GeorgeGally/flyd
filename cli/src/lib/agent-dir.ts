import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { parse } from "./frontmatter.js";

// Filesystem-authored capabilities. Only authored capability lives here —
// memory, beliefs, goals and currentness stay in their structured stores.
//
//   cli/agent/skills/<name>.md  → frontmatter metadata + prompt template body
//
// Discovery is env-overridable (FLYD_AGENT_DIR) so tests can point at
// fixture directories.

export interface AuthoredSkill {
  /** Defaults to the file name without extension. */
  name: string;
  triggers: string[];
  contractGoal: string;
  dimensions: string[];
  hardFails: string[];
  /**
   * Named code implementation for skills whose behavior is not expressible
   * as a prompt template ("goal_adjust", "goal_drop"). Absent = template skill.
   * Unknown names are rejected at discovery time.
   */
  impl?: string;
  /** Journal receipt written after a successful run. */
  journalEvent?: string;
  /** Refuse to run below the coach grounding threshold (diagnose-style).
   *  Undefined = unspecified; overrides inherit the built-in's setting. */
  groundingRequired: boolean | undefined;
  /** Prompt template body; {{message}} and {{grounding}} are substituted. */
  template: string;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** Code implementations a skill file may reference. */
export const KNOWN_SKILL_IMPLS: ReadonlySet<string> = new Set(["goal_adjust", "goal_drop"]);

function parseSkillFile(path: string, fileName: string): AuthoredSkill | null {
  let parsed;
  try {
    parsed = parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const meta = parsed.metadata;
  const name = typeof meta.name === "string" && meta.name ? meta.name : fileName.replace(/\.md$/, "");
  const contractGoal = typeof meta.contract_goal === "string" ? meta.contract_goal : "";
  // A skill without routing or a contract is not loadable capability.
  if (!contractGoal) return null;
  const impl = typeof meta.impl === "string" && meta.impl ? meta.impl : undefined;
  if (impl && !KNOWN_SKILL_IMPLS.has(impl)) return null;
  return {
    name,
    triggers: asStringArray(meta.triggers),
    contractGoal,
    dimensions: asStringArray(meta.dimensions),
    hardFails: asStringArray(meta.hard_fails),
    impl,
    journalEvent: typeof meta.journal_event === "string" ? meta.journal_event : undefined,
    groundingRequired: meta.grounding_required === true ? true : undefined,
    template: parsed.body.trim(),
  };
}

/** Locate cli/agent/ from source or compiled layout; FLYD_AGENT_DIR wins. */
export function skillsDirectory(): string | null {
  const override = process.env.FLYD_AGENT_DIR;
  if (override) return existsSync(override) ? override : null;
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidate = join(moduleDir, "..", "..", "agent", "skills");
  return existsSync(candidate) ? candidate : null;
}

let cache: { dir: string | null; skills: AuthoredSkill[] } | null = null;

/**
 * Authored skills discovered at boot. Unparseable files are skipped, never
 * fatal — a bad file must not take down coaching.
 */
export function discoverSkills(): AuthoredSkill[] {
  const dir = skillsDirectory();
  if (cache && cache.dir === dir) return cache.skills;
  const skills: AuthoredSkill[] = [];
  if (dir) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      cache = { dir, skills: [] };
      return skills;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const skill = parseSkillFile(join(dir, entry), entry);
      if (skill) skills.push(skill);
    }
  }
  cache = { dir, skills };
  return skills;
}

/** Test-only: drop the discovery cache so the next call re-reads disk. */
export function resetAuthoredSkillsCache(): void {
  cache = null;
}
