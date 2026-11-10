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
  /** Automatically learned rules require adjacent evidence; manual rules stay explicit. */
  contexts?: Array<{ left: string[]; right: string[] }>;
}

export const TRANSCRIPTION_PROMPT_MAX_CHARS = 800;
const PROMPT_LEAD = "Flyd is George's AI assistant. Names and terms he uses:";
// Always in the list, whatever projects.json and USER.md say.
const BUILT_IN_TERMS = ["Flyd", "Jev", "CapFive", "radarboy3000"];

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
  const named = projects.flatMap((project) => {
    const names = projectNames(project);
    return names.length ? [{ project, names }] : [];
  });
  const inWindow = ({ names }: { names: string[] }) => names.some((name) => title.includes(name.toLowerCase()));
  // Projects with people are ones George set up; the rest follow, so they never crowd his out.
  const rank = (entry: { project: Project; names: string[] }) => (inWindow(entry) ? 0 : 2) + (entry.project.people.length ? 0 : 1);
  const ordered = named.map((entry, index) => ({ entry, index }))
    .sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index)
    .map(({ entry }) => entry);

  const terms = [...BUILT_IN_TERMS];
  for (const { project, names } of ordered) {
    terms.push(...names, ...project.people);
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

/**
 * The names a project is spoken by: "Guido (browser ruler tool)" is Guido, and
 * "DIR (Dead Internet Radio)" is both. A project without people whose name reads
 * as a sentence ("CapFive is missing GDPR cookie consent.") is a decision title
 * filed as a project, not a name, and adds nothing.
 */
export function projectNames(project: Pick<Project, "name" | "people">): string[] {
  const aside = project.name.match(/\(([^)]*)\)/)?.[1]?.trim() ?? "";
  const name = project.name.replace(/\s*\([^)]*\)?/g, " ").replace(/\s+/g, " ").trim();
  const nameLike = (text: string) => text.split(" ").length <= 4 && !/[:;,#!?]|\.$|\.\s/.test(text);
  if (!name || (!project.people.length && !nameLike(name))) return [];
  const asideIsName = nameLike(aside) && aside.split(" ").every((word) => /^[\p{Lu}\d]/u.test(word));
  return asideIsName && aside ? [name, aside] : [name];
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
  const distinctive = profileText.match(/\b(?:[A-Z]{3,}[A-Za-z0-9]*|[A-Z][a-z]+[A-Z][A-Za-z0-9]*)\b/g) ?? [];
  return [...peopleNames(profileText), ...distinctive];
}

/** People's names from the profile's People section. */
function peopleNames(profileText: string): string[] {
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
  return names;
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

/** Only his project and people names: what a spaced-out spelling ("clean x") may be joined into. */
export function loadSpokenNames(): string[] {
  const { profileText, projects } = cachedSources();
  return [...new Set([
    ...projects.flatMap((project) => [...projectNames(project), ...project.people]),
    ...(profileText ? peopleNames(profileText) : []),
  ])];
}

export function loadReplacementRules(): ReplacementRule[] {
  return cachedRules();
}
