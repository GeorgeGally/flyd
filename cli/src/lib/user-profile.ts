import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "./config.js";

// George's own profile: a plain Markdown file he can read and edit. It is the
// highest-authority personal context Flyd has — derived projections and
// archive recall only fill in what it does not say.

export const USER_PROFILE_MAX_CHARS = 8_000;
const LEARNED_HEADING = "## Learned in conversation";

export function userProfilePath(): string {
  return process.env.FLYD_USER_PROFILE?.trim() || join(FLYD_DIR, "USER.md");
}

export const USER_PROFILE_TEMPLATE = `# George

<!-- Flyd reads this file before every answer and trusts it over anything it
inferred. Edit freely. Keep it short: facts, preferences, people, constraints. -->

## About me
- 

## Preferences
- 

## People
- 

## Constraints
- 

${LEARNED_HEADING}
`;

/** Profile body for prompts, or null when George has not written one. */
export function readUserProfile(path = userProfilePath()): string | null {
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
  return text.length > USER_PROFILE_MAX_CHARS ? `${text.slice(0, USER_PROFILE_MAX_CHARS)}\n…(truncated)` : text;
}

export function ensureUserProfile(path = userProfilePath()): string {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, USER_PROFILE_TEMPLATE, { encoding: "utf8", mode: 0o600 });
  }
  return path;
}

/** Append one learned fact; returns false when it is already there. */
export function appendUserProfileFact(fact: string, now = new Date(), path = userProfilePath()): boolean {
  const clean = fact.replace(/\s+/g, " ").trim();
  if (!clean) return false;
  ensureUserProfile(path);
  const current = readFileSync(path, "utf8");
  const normalized = clean.toLowerCase().replace(/[.!]+$/, "");
  const exists = current.split("\n").some((line) =>
    line.replace(/^\s*-\s*/, "").replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, "").toLowerCase().replace(/[.!]+$/, "").trim() === normalized);
  if (exists) return false;
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const entry = `- ${clean} (${stamp})`;
  const next = current.includes(LEARNED_HEADING)
    ? `${current.replace(/\s*$/, "")}\n${entry}\n`
    : `${current.replace(/\s*$/, "")}\n\n${LEARNED_HEADING}\n${entry}\n`;
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, next, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
  return true;
}
