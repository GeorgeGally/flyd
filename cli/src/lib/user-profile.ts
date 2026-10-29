import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "./config.js";

// George's own profile: a plain Markdown file he can read and edit. It is the
// highest-authority personal context Flyd has — derived projections and
// archive recall only fill in what it does not say.

/**
 * Ceiling for the profile in a prompt. Over it, sections are trimmed from
 * within (longest first) so no section ever silently disappears.
 */
export const USER_PROFILE_MAX_CHARS = 24_000;
/** Never trimmed while anything else can give way: his voice rules and hard limits. */
export const PROTECTED_PROFILE_SECTIONS = ["How to be with me", "Constraints"] as const;
const LEARNED_HEADING = "## Learned in conversation";

export function userProfilePath(): string {
  return process.env.FLYD_USER_PROFILE?.trim() || join(FLYD_DIR, "USER.md");
}

export const PROFILE_SECTIONS = [
  "About me", "How to be with me", "Work", "People", "Preferences", "Routines", "Goals", "Constraints",
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number] | "Learned in conversation";

export const USER_PROFILE_TEMPLATE = `# George

<!-- Flyd reads this file before every answer and trusts it over anything it
inferred. Edit freely. Keep it short: facts, preferences, people, constraints. -->

${PROFILE_SECTIONS.map((section) => `## ${section}\n- \n`).join("\n")}
${LEARNED_HEADING}
`;

/** Profile body for prompts, or null when George has not written one. */
export function readUserProfile(path = userProfilePath(), maxChars = USER_PROFILE_MAX_CHARS): string | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .filter((line) => !/^\s*-\s*$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const hasFacts = /^\s*-\s+\S/m.test(text) || text.split("\n").some((line) => line.trim() && !line.startsWith("#"));
  if (!hasFacts) return null;
  return fitProfile(text, maxChars);
}

interface ProfileBlock { heading: string | null; lines: string[]; dropped: number }

function renderBlocks(blocks: ProfileBlock[]): string {
  return blocks.map((block) => [
    ...(block.heading === null ? [] : [block.heading]),
    ...block.lines,
    ...(block.dropped ? [`- …(${block.dropped} more line${block.dropped === 1 ? "" : "s"} in USER.md)`] : []),
  ].join("\n")).filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Fit the profile to `max` without dropping a section: the longest
 * unprotected section gives up one line at a time (oldest first in "Learned
 * in conversation", from the end elsewhere); protected sections give way last.
 */
export function fitProfile(text: string, max = USER_PROFILE_MAX_CHARS): string {
  if (text.length <= max) return text;
  const blocks: ProfileBlock[] = [{ heading: null, lines: [], dropped: 0 }];
  for (const line of text.split("\n")) {
    if (/^##\s/.test(line)) blocks.push({ heading: line, lines: [], dropped: 0 });
    else blocks[blocks.length - 1].lines.push(line);
  }
  const name = (block: ProfileBlock) => block.heading?.replace(/^##\s+/, "").trim().toLowerCase() ?? "";
  const isProtected = (block: ProfileBlock) => block.heading === null
    || (PROTECTED_PROFILE_SECTIONS as readonly string[]).some((section) => section.toLowerCase() === name(block));
  const size = (block: ProfileBlock) => block.lines.reduce((sum, line) => sum + line.length + 1, 0);
  const trimmable = (block: ProfileBlock) => block.lines.some((line) => line.trim());
  const learned = LEARNED_HEADING.replace(/^##\s+/, "").toLowerCase();
  let rendered = renderBlocks(blocks);
  while (rendered.length > max) {
    const unprotected = blocks.filter((block) => trimmable(block) && !isProtected(block));
    const pool = unprotected.length ? unprotected : blocks.filter(trimmable);
    if (pool.length === 0) break;
    const target = pool.reduce((a, b) => (size(b) > size(a) ? b : a));
    while (target.lines.length && !target.lines[target.lines.length - 1].trim()) target.lines.pop();
    if (name(target) === learned) target.lines.splice(target.lines.findIndex((line) => line.trim()), 1);
    else target.lines.pop();
    target.dropped += 1;
    rendered = renderBlocks(blocks);
  }
  return rendered.length > max ? `${rendered.slice(0, max)}\n…(truncated)` : rendered;
}

export function ensureUserProfile(path = userProfilePath()): string {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, USER_PROFILE_TEMPLATE, { encoding: "utf8", mode: 0o600 });
  }
  return path;
}

function normalizeFact(text: string): string {
  return text.replace(/^\s*-\s*/, "").replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, "").toLowerCase().replace(/[.!]+$/, "").trim();
}

function localStamp(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Add one fact under a profile section (created at the end if missing),
 * replacing the section's empty placeholder bullet. Returns false for duplicates.
 */
export function addUserProfileFact(
  fact: string,
  options: { section?: ProfileSection; now?: Date; path?: string; dated?: boolean } = {},
): boolean {
  const clean = fact.replace(/\s+/g, " ").trim();
  if (!clean) return false;
  const path = options.path ?? userProfilePath();
  const section = options.section ?? "Learned in conversation";
  ensureUserProfile(path);
  const current = readFileSync(path, "utf8");
  if (current.split("\n").some((line) => normalizeFact(line) === normalizeFact(clean))) return false;
  const entry = options.dated === false ? `- ${clean}` : `- ${clean} (${localStamp(options.now ?? new Date())})`;
  const lines = current.replace(/\s*$/, "").split("\n");
  const headingIndex = lines.findIndex((line) => line.trim().toLowerCase() === `## ${section}`.toLowerCase());
  let next: string[];
  if (headingIndex === -1) {
    next = [...lines, "", `## ${section}`, entry];
  } else {
    let end = headingIndex + 1;
    while (end < lines.length && !/^##\s/.test(lines[end])) end += 1;
    const body = lines.slice(headingIndex + 1, end).filter((line) => !/^\s*-\s*$/.test(line));
    while (body.length && !body[body.length - 1].trim()) body.pop();
    const trailingBlank = end < lines.length ? [""] : [];
    next = [...lines.slice(0, headingIndex + 1), ...body, entry, ...trailingBlank, ...lines.slice(end)];
  }
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${next.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
  return true;
}

/** Append one learned fact; returns false when it is already there. */
export function appendUserProfileFact(fact: string, now = new Date(), path = userProfilePath()): boolean {
  return addUserProfileFact(fact, { now, path });
}
