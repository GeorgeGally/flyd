import { existsSync, realpathSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { readWikiFile } from '../lib/wiki.js';
import type { ParsedMarkdown } from '../lib/frontmatter.js';
import {
  DOMAIN_STANDARDS,
  selectDomainStandard,
  type DomainStandard,
  type WorkDomain,
} from './domain-standards.js';
import type { GroundPackSection } from './ground-pack.js';

export const WIKI_READ_TIMEOUT_MS = 2_000;

function wikiRoot(): string {
  const flydDir = process.env.FLYD_DIR?.trim() || join(homedir(), '.flyd');
  return join(flydDir, 'wiki');
}

export const ALLOWED_WIKI_SUBDIRS = [
  'projects',
  'people',
  'standards',
  'constraints',
  'skills',
] as const;

export function slugifyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Resolve a wiki-relative path safely under WIKI_DIR. */
export function resolveSafeWikiPath(relativePath: string): string | null {
  if (!relativePath || relativePath.includes('\0')) return null;
  const normalized = relativePath.replace(/^\/+/, '').replace(/\\/g, '/');
  if (normalized.includes('..') || normalized.startsWith('/')) return null;

  const candidate = resolve(wikiRoot(), normalized);
  if (!existsSync(wikiRoot())) return null;

  let wikiReal: string;
  try {
    wikiReal = realpathSync(wikiRoot());
  } catch {
    return null;
  }

  if (!existsSync(candidate)) return null;

  let resolved: string;
  try {
    resolved = realpathSync(candidate);
  } catch {
    return null;
  }

  const rel = relative(wikiReal, resolved);
  if (rel.startsWith('..') || rel.includes(`${sep}..${sep}`)) return null;

  const topLevel = rel.split(/[\\/]/)[0];
  if (!ALLOWED_WIKI_SUBDIRS.includes(topLevel as typeof ALLOWED_WIKI_SUBDIRS[number])) {
    return null;
  }

  return resolved;
}

export function readSafeWikiPage(relativePath: string): ParsedMarkdown | null {
  const fullPath = resolveSafeWikiPath(relativePath);
  if (!fullPath) return null;
  try {
    return readWikiFile(fullPath);
  } catch {
    return null;
  }
}

function isWorkDomain(value: unknown): value is WorkDomain {
  return typeof value === 'string' && value in DOMAIN_STANDARDS;
}

export function parseDomainStandardFromWiki(
  parsed: ParsedMarkdown,
  fallbackDomain: WorkDomain,
): DomainStandard | null {
  if (parsed.metadata.type !== 'domain_standard') return null;
  const domain = isWorkDomain(parsed.metadata.domain)
    ? parsed.metadata.domain
    : fallbackDomain;
  const fallback = DOMAIN_STANDARDS[domain];
  const body = parsed.body.trim();
  if (!body && !fallback) return null;

  return {
    domain,
    evaluationDimensions: fallback.evaluationDimensions,
    focusPrompt: body || fallback.focusPrompt,
    avoidances: fallback.avoidances,
  };
}

export function loadWikiProjectSection(projectName: string): GroundPackSection | null {
  const slug = slugifyName(projectName);
  if (!slug) return null;

  const parsed = readSafeWikiPage(`projects/${slug}.md`);
  if (!parsed) return null;

  return {
    kind: 'wiki_project',
    label: 'WIKI_PROJECT',
    provenance: `wiki/projects/${slug}.md`,
    content: parsed.body.trim(),
  };
}

export function extractPeopleRefs(parsed: ParsedMarkdown | null): string[] {
  if (!parsed) return [];
  const people = parsed.metadata.people;
  if (Array.isArray(people)) {
    return people.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
  }
  if (typeof people === 'string' && people.trim()) {
    return [people.trim()];
  }
  return [];
}

export function loadPeopleSections(names: string[]): GroundPackSection[] {
  const sections: GroundPackSection[] = [];
  const seen = new Set<string>();

  for (const name of names) {
    const slug = slugifyName(name);
    const key = slug.toLowerCase();
    if (!slug || seen.has(key)) continue;
    seen.add(key);

    const parsed = readSafeWikiPage(`people/${slug}.md`);
    if (!parsed?.body.trim()) continue;

    sections.push({
      kind: 'people',
      label: 'PEOPLE',
      provenance: `wiki/people/${slug}.md`,
      content: `# ${name}\n${parsed.body.trim()}`,
    });
  }

  return sections;
}

export function loadDomainStandard(params: {
  artifactKind?: string;
  bundleId?: string;
  projectName?: string;
}): { standard: DomainStandard; provenance: string } {
  const fallbackDomain = selectDomainStandard({
    artifactKind: params.artifactKind,
    bundleId: params.bundleId,
  }).domain;

  const candidates: string[] = [];
  if (params.projectName) {
    const projectSlug = slugifyName(params.projectName);
    if (projectSlug) {
      candidates.push(`standards/${projectSlug}-${fallbackDomain}.md`);
    }
  }
  candidates.push(`standards/${fallbackDomain}.md`);

  for (const relPath of candidates) {
    const parsed = readSafeWikiPage(relPath);
    if (!parsed) continue;
    const standard = parseDomainStandardFromWiki(parsed, fallbackDomain);
    if (standard) {
      return { standard, provenance: `wiki/${relPath}` };
    }
  }

  return {
    standard: DOMAIN_STANDARDS[fallbackDomain],
    provenance: 'fallback:domain-standards',
  };
}

export function withWikiReadTimeout<T>(
  fn: () => T,
  timeoutMs = WIKI_READ_TIMEOUT_MS,
): T | null {
  const started = Date.now();
  try {
    const result = fn();
    if (Date.now() - started > timeoutMs) return null;
    return result;
  } catch {
    return null;
  }
}
