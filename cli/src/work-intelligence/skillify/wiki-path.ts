import { existsSync, realpathSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { homedir } from 'node:os';

export const SKILLIFY_WRITE_SUBDIRS = ['standards', 'projects', 'constraints'] as const;

function wikiRoot(): string {
  const flydDir = process.env.FLYD_DIR?.trim() || join(homedir(), '.flyd');
  return join(flydDir, 'wiki');
}

function resolveWikiBase(root: string): string {
  if (!existsSync(root)) return root;
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

function isAllowedRelativeParent(relParent: string): boolean {
  if (!relParent || relParent === '.') return false;
  if (relParent.startsWith('..') || relParent.includes(`${sep}..${sep}`)) return false;
  const top = relParent.split(/[\\/]/)[0];
  return SKILLIFY_WRITE_SUBDIRS.includes(top as typeof SKILLIFY_WRITE_SUBDIRS[number]);
}

/** Canonicalize a wiki-relative path for Skillify writes. */
export function canonicalizeSkillifyTargetPath(relativePath: string): string | null {
  if (!relativePath || relativePath.includes('\0')) return null;
  const normalized = relativePath.replace(/^\/+/, '').replace(/\\/g, '/');
  if (normalized.includes('..') || normalized.startsWith('/')) return null;
  if (!normalized.endsWith('.md')) return null;

  const top = normalized.split('/')[0];
  if (!SKILLIFY_WRITE_SUBDIRS.includes(top as typeof SKILLIFY_WRITE_SUBDIRS[number])) {
    return null;
  }

  const wikiBase = resolveWikiBase(wikiRoot());
  if (!existsSync(wikiBase)) return normalized;

  const candidate = join(wikiBase, normalized);
  const parent = dirname(candidate);

  if (existsSync(candidate)) {
    let resolved: string;
    try {
      resolved = realpathSync(candidate);
    } catch {
      return null;
    }
    const rel = relative(wikiBase, resolved);
    if (rel.startsWith('..') || rel.includes(`${sep}..${sep}`)) return null;
    return normalized;
  }

  if (!existsSync(parent)) {
    const relParent = relative(wikiBase, parent);
    return isAllowedRelativeParent(relParent) ? normalized : null;
  }

  let resolvedParent: string;
  try {
    resolvedParent = realpathSync(parent);
  } catch {
    return null;
  }
  const relParent = relative(wikiBase, resolvedParent);
  return isAllowedRelativeParent(relParent) ? normalized : null;
}

export function skillifyWikiAbsolutePath(relativePath: string): string | null {
  const canonical = canonicalizeSkillifyTargetPath(relativePath);
  if (!canonical) return null;
  return join(resolveWikiBase(wikiRoot()), canonical);
}

/** Paths managed by Skillify confirm-write — crystallize must not blind-write here. */
export function isSkillifyReservedWikiPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/^\/+/, '').replace(/\\/g, '/');
  return normalized.startsWith('standards/') || normalized.startsWith('constraints/');
}
