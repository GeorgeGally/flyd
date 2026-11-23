import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fitProfile, readUserProfile } from "../lib/user-profile.js";
import { memoryPaths } from "./memory-store.js";

export function newsInterestsPath(memory = memoryPaths().memory): string {
  return join(dirname(memory), "news-interests.txt");
}

export function readNewsInterests(fallback: string, path = newsInterestsPath()): string {
  try { return readFileSync(path, "utf8").trim() || fallback; } catch { return fallback; }
}

/**
 * The brief every news-model call reads: Scout's opinionated taste (seeded from
 * George's Hermes curator, evolved from his feedback) with the Librarian's
 * curated interests layered on top. The interests add to the taste; they never
 * replace its favour/avoid rules.
 */
export function newsTaste(taste: string, path = newsInterestsPath()): string {
  const interests = readNewsInterests("", path);
  if (!interests || taste.includes(interests)) return taste;
  return `${taste}\n\nCurrent interests (curated from his conversations):\n${interests}`;
}

/** USER.md sections that say what George cares about. People, routines, constraints and voice rules stay out of news prompts. */
export const NEWS_PROFILE_SECTIONS = ["About me", "Work", "Preferences", "Goals", "Learned in conversation"] as const;
export const NEWS_PROFILE_MAX_CHARS = 4_000;

/**
 * George's personal preferences for the news curator, from his own USER.md —
 * the input Hermes's curator read. A profile written with sections keeps only
 * NEWS_PROFILE_SECTIONS; one written as plain notes is used as written.
 */
export function newsProfile(profile: string | null = readUserProfile()): string | null {
  if (!profile?.trim()) return null;
  const lines = profile.split("\n");
  if (!lines.some((line) => /^##\s+\S/.test(line))) return fitProfile(profile.trim(), NEWS_PROFILE_MAX_CHARS);
  const wanted = new Set(NEWS_PROFILE_SECTIONS.map((section) => section.toLowerCase()));
  const kept: string[] = [];
  let keep = false;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) keep = wanted.has(heading[1]!.toLowerCase());
    else if (/^#\s/.test(line)) keep = false;
    if (keep) kept.push(line);
  }
  const text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return /^\s*-?\s*[^#\s-]/m.test(text) ? fitProfile(text, NEWS_PROFILE_MAX_CHARS) : null;
}

/** Only the curator writes this derived, bounded brief; missing or invalid proposals leave it alone. */
export function writeNewsInterests(value: unknown, path = newsInterestsPath()): void {
  if (typeof value !== "string") return;
  const brief = value.trim();
  if (brief.length < 30 || brief.length > 2000) return;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${brief}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}
