import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { readProjects, type Project } from "./projects.js";
import { markPrinciplesSeeded, seedPrinciples } from "./taste-principles.js";
import { carriedTaste, readTaste, tastePath, writeTaste, type TasteProfile, type TasteRule, type TasteSkillKind } from "./taste.js";

// George's taste, carried into every agent's work as skills. TASTE.md is the
// source of truth; from it Flyd compiles standard SKILL.md files that agents
// load on their own whenever they do UI, layout, CSS or design work — Claude
// Code, OpenCode, Codex and Pi all read ~/.claude/skills or ~/.agents/skills.
// So his taste reaches work Flyd never launched, before he has to correct it.
//
// Two George-wide skills (his interface principles, and spacing — his most
// repeated correction) plus one per project with rules of its own, which says
// it holds only in that project's repo so one client's rules never leak into
// another's. Only durable rules make the cut: a principle, a rule of his own,
// or one seen at least twice. Rules seen once stay in TASTE.md until repeated.
// Which skill a rule lands in is the Librarian's call (carriedTaste in taste.ts).
//
// The files are generated: each carries a marker and is rewritten atomically
// when taste changes. A skill without the marker is someone else's and is
// never touched, and a generated skill that no longer has rules is removed.
// FLYD_TASTE_SKILLS=0 stops generation; FLYD_TASTE_SKILL_DIRS overrides where
// they go (tests never write to the real home without it).

export const SKILL_PREFIX = "flyd-taste-";
const MARKER = "<!-- flyd-taste-skill:";

export interface TasteSkill {
  name: string;
  kind: TasteSkillKind | "project";
  title: string;
  /** Frontmatter description: when an agent should load it. */
  description: string;
  /** In plain words, when it loads (for George's taste page). */
  when: string;
  project?: string;
  principles: TasteRule[];
  rules: TasteRule[];
}

function split(rules: TasteRule[]): { principles: TasteRule[]; rules: TasteRule[] } {
  return { principles: rules.filter((rule) => rule.principle), rules: rules.filter((rule) => !rule.principle) };
}

const UI_WORK = "UI, layout, visual, CSS, front-end or design work";

/** The skills his taste compiles to right now, in the order the taste page shows them. */
export function planTasteSkills(profile: TasteProfile, projects: Project[] = []): TasteSkill[] {
  const carried = carriedTaste(profile);
  const skills: TasteSkill[] = [];
  const interfaceRules = split(carried.interface);
  if (interfaceRules.principles.length + interfaceRules.rules.length) {
    skills.push({
      name: `${SKILL_PREFIX}interface`,
      kind: "interface",
      title: "George's interface taste",
      description: `George's interface and design taste, in his own words, compiled by Flyd from how he corrects and approves work. Use whenever doing any ${UI_WORK} — screens, motion, type, data display, on-screen copy — in any project, and check the work against it before reporting done.`,
      when: "Loads for any UI, layout, CSS, front-end or design work, in every project.",
      ...interfaceRules,
    });
  }
  const spacingRules = split(carried.spacing);
  if (spacingRules.principles.length + spacingRules.rules.length) {
    skills.push({
      name: `${SKILL_PREFIX}spacing`,
      kind: "spacing",
      title: "George's spacing and balance",
      description: `George's spacing and layout taste — padding, margins, gaps, alignment and the balance between text elements and buttons — in his own words, compiled by Flyd. It is the correction he makes most. Use whenever doing any ${UI_WORK} in any project, and check every gap against it before reporting done.`,
      when: "Loads for any UI, layout, CSS, front-end or design work, in every project.",
      ...spacingRules,
    });
  }
  for (const { id, rules } of carried.projects) {
    const name = profile.names[id] ?? id;
    const repos = projects.find((project) => project.id === id)?.repos ?? [];
    // The repo is the trigger: similar-looking work elsewhere must not pull a client's rules in.
    const where = repos.length
      ? `Use only when the working directory is inside ${repos.join(" or ")}; do not load it anywhere else, even for work that looks similar.`
      : `Use only when George says the work is for ${name}; do not load it anywhere else, even for work that looks similar.`;
    skills.push({
      name: `${SKILL_PREFIX}${id}`.slice(0, 64).replace(/-+$/, ""),
      kind: "project",
      project: id,
      title: `George's taste for ${name}`,
      description: `George's taste for the ${name} project alone, in his own words, compiled by Flyd. ${where} There, check any ${UI_WORK} against it before reporting done.`,
      when: repos.length ? `Loads only when working in ${repos.map((repo) => repo.replace(homedir(), "~")).join(" or ")}.` : `Loads only when working on ${name}.`,
      ...split(rules),
    });
  }
  return skills;
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s+/g, " ")}"`;
}

function ruleLines(rule: TasteRule, names: Record<string, string>, quotes: number): string[] {
  const seen = rule.principle ? "" : rule.count === 0 ? " (his own words)" : ` (seen ${rule.count}×)`;
  return [
    `- **${rule.text}**${seen}`,
    ...rule.evidence.slice(0, quotes).map((item) =>
      `  - "${item.quote.replace(/\s+/g, " ")}" — ${[item.source, item.project ? names[item.project] ?? item.project : "", item.date].filter(Boolean).join(", ")}`),
  ];
}

/** One standard SKILL.md: frontmatter, the generated marker, then the rules with his words. */
export function renderTasteSkill(skill: TasteSkill, profile: TasteProfile, source = tastePath()): string {
  const scope = skill.kind === "project"
    ? `These are the rules for ${profile.names[skill.project!] ?? skill.project} only. George's interface and spacing skills hold here too.`
    : "These hold across all of George's work. A project may add rules of its own in its own skill.";
  return [
    "---",
    `name: ${skill.name}`,
    `description: ${yamlString(skill.description)}`,
    "---",
    `${MARKER} generated by Flyd from ${source}. Do not hand-edit: edit TASTE.md, or say "not me" on Flyd's taste page, and Flyd regenerates this file. -->`,
    "",
    `# ${skill.title}`,
    "",
    `Flyd learned these from George's own corrections, rejections and approvals. Each rule is Flyd's summary; the quoted lines under it are George's exact words, with where and when he said them. ${scope}`,
    "",
    "Before you report the work done, check it against every rule below and fix what does not hold, so George never has to ask twice. Where a rule and an explicit instruction for this task disagree, follow the instruction and say so in your report.",
    "",
    ...(skill.principles.length ? ["## His principles", "", ...skill.principles.flatMap((rule) => ruleLines(rule, profile.names, 3)), ""] : []),
    ...(skill.rules.length ? [skill.principles.length ? "## Learned from his corrections" : "## Rules", "", ...skill.rules.flatMap((rule) => ruleLines(rule, profile.names, 2)), ""] : []),
  ].join("\n");
}

/** Where agents discover global skills: Claude Code, and the shared ~/.agents tree OpenCode, Codex and Pi read. */
export function tasteSkillRoots(): string[] {
  const configured = process.env.FLYD_TASTE_SKILL_DIRS;
  if (configured !== undefined) return configured.split(delimiter).map((dir) => dir.trim()).filter(Boolean);
  return [join(homedir(), ".claude", "skills"), join(homedir(), ".agents", "skills")];
}

export interface TasteSkillInstall {
  written: string[];
  unchanged: number;
  removed: string[];
  /** Skills of the same name that Flyd did not generate: left alone. */
  refused: string[];
}

function isGenerated(file: string): boolean {
  try { return readFileSync(file, "utf8").includes(MARKER); } catch { return false; }
}

function isSymlink(path: string): boolean {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}

/** Write each skill into every root, atomically and only when it changed; drop generated skills that are gone. */
export function installTasteSkills(skills: Array<{ name: string; content: string }>, roots: string[] = tasteSkillRoots()): TasteSkillInstall {
  const receipt: TasteSkillInstall = { written: [], unchanged: 0, removed: [], refused: [] };
  const wanted = new Set(skills.map((skill) => skill.name));
  for (const root of roots) {
    mkdirSync(root, { recursive: true });
    for (const skill of skills) {
      const dir = join(root, skill.name);
      const file = join(dir, "SKILL.md");
      if (isSymlink(dir) || isSymlink(file)) { receipt.refused.push(file); continue; }
      if (existsSync(file)) {
        if (!isGenerated(file)) { receipt.refused.push(file); continue; }
        if (readFileSync(file, "utf8") === skill.content) { receipt.unchanged += 1; continue; }
      } else if (existsSync(dir) && readdirSync(dir).length) {
        receipt.refused.push(file);
        continue;
      }
      mkdirSync(dir, { recursive: true });
      const temporary = join(dir, `.SKILL.md.${process.pid}.tmp`);
      writeFileSync(temporary, skill.content, "utf8");
      renameSync(temporary, file);
      receipt.written.push(file);
    }
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(SKILL_PREFIX) || wanted.has(entry.name)) continue;
      const file = join(root, entry.name, "SKILL.md");
      if (!isGenerated(file)) continue;
      unlinkSync(file);
      try { rmdirSync(join(root, entry.name)); } catch { /* something else lives there too */ }
      receipt.removed.push(file);
    }
  }
  return receipt;
}

export interface TasteSkillSync extends TasteSkillInstall {
  skipped?: "disabled" | "test";
  /** Principles newly seeded into, or replaced in, TASTE.md. */
  seeded: number;
  skills: string[];
}

/**
 * Bring the installed skills in line with TASTE.md: seed any principle it has
 * never had, compile, install. Cheap and idempotent — run after anything that
 * changes taste (a learning or curation pass, an edit on the taste page).
 */
export function syncTasteSkills(options: { path?: string; roots?: string[]; projects?: Project[] } = {}): TasteSkillSync {
  const none: TasteSkillSync = { seeded: 0, skills: [], written: [], unchanged: 0, removed: [], refused: [] };
  if (process.env.FLYD_TASTE_SKILLS === "0") return { ...none, skipped: "disabled" };
  if (!options.roots && process.env.VITEST && process.env.FLYD_TASTE_SKILL_DIRS === undefined) return { ...none, skipped: "test" };
  const path = options.path ?? tastePath();
  const profile = readTaste(path);
  const seeded = seedPrinciples(profile);
  if (seeded) writeTaste(profile, path);
  markPrinciplesSeeded(profile);
  const skills = planTasteSkills(profile, options.projects ?? readProjects());
  const install = installTasteSkills(skills.map((skill) => ({ name: skill.name, content: renderTasteSkill(skill, profile, path) })), options.roots ?? tasteSkillRoots());
  return { seeded, skills: skills.map((skill) => skill.name), ...install };
}
