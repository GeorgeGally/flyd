import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FLYD_DIR } from "../lib/config.js";

// Skills: how to do one kind of job well (chase a payment, plan a launch,
// write a message he can send), loaded into a chat turn only when that turn
// is that kind of job. Flyd answered every kind of request from one general
// prompt; a skill brings the specific know-how without making every other
// turn carry it. Same SKILL.md format as George's Claude and OpenCode skills,
// so he can edit them and import his own.

export interface Skill {
  name: string;
  /** When it applies, in a line: this is what a turn is matched against. */
  description: string;
  body: string;
  path: string;
}

export const MAX_SKILL_CHARS = 6_000;
/** Skills matched per turn; more stays out of the matcher. */
export const MAX_MATCHED_SKILLS = 24;

export function skillsHome(): string {
  return process.env.FLYD_SKILLS_DIR?.trim() || join(FLYD_DIR, "skills");
}

/** Skills Flyd ships with, seeded into skillsHome once so George can edit or delete them. */
export function bundledSkillsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "agent", "flyd-skills");
}

/** Where George's other assistants keep skills he can import. */
export function importSources(): string[] {
  return [join(homedir(), ".claude", "skills"), join(homedir(), ".config", "opencode", "skills")];
}

export function parseSkill(text: string, path: string): Skill | null {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const field = (key: string) => match[1].match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1].trim().replace(/^["']|["']$/g, "") ?? "";
  const name = field("name");
  const description = field("description");
  if (!name || !description) return null;
  return { name, description: description.slice(0, 400), body: match[2].trim().slice(0, MAX_SKILL_CHARS), path };
}

/** Copy bundled skills George hasn't seen yet; one he deleted stays deleted. */
export function seedSkills(home = skillsHome(), bundled = bundledSkillsDir()): string[] {
  if (!existsSync(bundled)) return [];
  const markerPath = join(home, ".seeded");
  const seeded = new Set(existsSync(markerPath) ? readFileSync(markerPath, "utf8").split("\n").filter(Boolean) : []);
  const added: string[] = [];
  for (const name of readdirSync(bundled)) {
    const source = join(bundled, name, "SKILL.md");
    if (seeded.has(name) || !existsSync(source)) continue;
    const target = join(home, name, "SKILL.md");
    if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
      added.push(name);
    }
    seeded.add(name);
  }
  mkdirSync(home, { recursive: true });
  writeFileSync(markerPath, `${[...seeded].sort().join("\n")}\n`);
  return added;
}

export function loadSkills(home = skillsHome()): Skill[] {
  if (!existsSync(home)) return [];
  return readdirSync(home, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const path = join(home, entry.name, "SKILL.md");
      try { const skill = parseSkill(readFileSync(path, "utf8"), path); return skill ? [skill] : []; } catch { return []; }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_MATCHED_SKILLS);
}

/** Bring one of his Claude/OpenCode skills into Flyd; he chose it, so it's trusted like his own. */
export function importSkill(name: string, home = skillsHome(), sources = importSources()): Skill {
  for (const root of sources) {
    const source = join(root, name, "SKILL.md");
    if (!existsSync(source)) continue;
    const skill = parseSkill(readFileSync(source, "utf8"), source);
    if (!skill) throw new Error(`${source} has no name/description frontmatter`);
    const target = join(home, name, "SKILL.md");
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    return { ...skill, path: target };
  }
  throw new Error(`No skill named ${name} in ${sources.join(" or ")}`);
}

export function skillPromptBlock(skill: Skill): string {
  return `## How to do this well (${skill.name})\n${skill.body}`;
}

export function describeSkills(skills = loadSkills()): string {
  return skills.length ? skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n") : "No skills yet.";
}
