import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { userProfilePath } from "../lib/user-profile.js";
import { liveProjects, projectsPath, type Project } from "../council/projects.js";

// What George's dictation should spell right without a hand-kept dictionary:
// his people, projects and the odd names in his profile, plus any explicit
// replacement rules he writes. Read from files that change rarely, so each
// derived value is cached until one of its files' mtime moves.

export interface ReplacementRule {
  from: string;
  to: string;
}

export const TRANSCRIPTION_PROMPT_MAX_CHARS = 800;
const PROMPT_LEAD = "Flyd (pronounced Floyd) is George's AI assistant. Names and terms he uses:";

export function dictationRulesPath(): string {
  return process.env.FLYD_DICTATION_RULES?.trim() || join(FLYD_DIR, "dictation-rules.json");
}

/** `[{ "from": "...", "to": "..." }]`; anything malformed is skipped, not fatal. */
export function parseRules(text: string): ReplacementRule[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    const from = typeof entry?.from === "string" ? entry.from.trim() : "";
    const to = typeof entry?.to === "string" ? entry.to : "";
    return from ? [{ from, to }] : [];
  });
}

/**
 * Terms in priority order: projects named in the front window first, then the
 * rest of the live projects and their people, then names from USER.md.
 */
export function vocabularyTerms(profileText: string | null, projects: Project[], windowTitle = ""): string[] {
  const title = windowTitle.toLowerCase();
  const inWindow = (project: Project) => title.includes(project.name.toLowerCase());
  const ordered = [...projects.filter(inWindow), ...projects.filter((project) => !inWindow(project))];

  const terms = ["Flyd"];
  for (const project of ordered) {
    terms.push(project.name, ...project.people);
  }
  if (profileText) terms.push(...profileNames(profileText));

  const seen = new Set<string>(["george"]);
  return terms.filter((term) => {
    const key = term.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function transcriptionPrompt(terms: string[]): string {
  let prompt = PROMPT_LEAD;
  for (const [index, term] of terms.entries()) {
    const next = `${prompt}${index === 0 ? " " : ", "}${term}`;
    if (next.length + 1 > TRANSCRIPTION_PROMPT_MAX_CHARS) break;
    prompt = next;
  }
  return `${prompt}.`;
}

/** People's names from the People section, and distinctive ALLCAPS/CamelCase names anywhere. */
function profileNames(profileText: string): string[] {
  const names: string[] = [];
  let inPeople = false;
  for (const line of profileText.split("\n")) {
    if (line.startsWith("## ")) {
      inPeople = line.slice(3).trim().toLowerCase() === "people";
      continue;
    }
    if (!inPeople) continue;
    const name = line.match(/^\s*-\s+((?:[A-Z][\p{L}'’-]+)(?:\s+[A-Z][\p{L}'’-]+){0,2})/u)?.[1];
    if (name) names.push(name);
  }
  const distinctive = profileText.match(/\b(?:[A-Z]{3,}[A-Za-z0-9]*|[A-Z][a-z]+[A-Z][A-Za-z0-9]*)\b/g) ?? [];
  return [...names, ...distinctive];
}

function mtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function cachedByMtime<T>(paths: () => string[], build: (paths: string[]) => T): () => T {
  let cache: { key: string; value: T } | null = null;
  return () => {
    const current = paths();
    const key = current.map((path) => `${path}:${mtime(path)}`).join("|");
    if (cache?.key !== key) cache = { key, value: build(current) };
    return cache.value;
  };
}

const cachedSources = cachedByMtime(
  () => [userProfilePath(), projectsPath()],
  ([profile, projects]) => ({ profileText: readOrNull(profile), projects: liveProjects(projects) }),
);

const cachedRules = cachedByMtime(
  () => [dictationRulesPath()],
  ([path]) => {
    const text = readOrNull(path);
    return text === null ? [] : parseRules(text);
  },
);

export function loadVocabulary(windowTitle?: string): string[] {
  const { profileText, projects } = cachedSources();
  return vocabularyTerms(profileText, projects, windowTitle);
}

export function loadReplacementRules(): ReplacementRule[] {
  return cachedRules();
}
