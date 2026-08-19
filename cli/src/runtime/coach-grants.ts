import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import { FLYD_DIR } from '../lib/config.js';

export type CoachGrantScope = 'existing_signals' | 'browsing' | 'extended';

export const DEFAULT_GRANTS: CoachGrantScope[] = ['existing_signals'];

const DEFAULT_GRANT_SET = new Set<string>(DEFAULT_GRANTS);
const ALL_GRANTS = new Set<string>([
  'existing_signals', 'browsing', 'extended',
]);

let grantsPath = join(FLYD_DIR, 'coach', 'grants.json');

export function configureCoachGrantsPath(path: string): void {
  grantsPath = resolvePath(path);
}

function ensureGrantsFile(): void {
  const dir = join(grantsPath, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!existsSync(grantsPath)) {
    writeFileSync(grantsPath, JSON.stringify(DEFAULT_GRANTS, null, 2), { encoding: 'utf-8', mode: 0o600 });
  }
}

export function listCoachGrants(): CoachGrantScope[] {
  ensureGrantsFile();
  try {
    const raw = JSON.parse(readFileSync(grantsPath, 'utf-8')) as CoachGrantScope[];
    return raw.filter((s) => ALL_GRANTS.has(s));
  } catch {
    return [...DEFAULT_GRANTS];
  }
}

export function hasCoachGrant(scope: CoachGrantScope): boolean {
  // existing_signals is always granted by default — the coach may read what
  // Flyd already holds (invocations, Present Model, journal, wiki). No new
  // capture, no external network. This keeps PRESENT invariant #11 intact.
  if (scope === 'existing_signals') return true;
  return listCoachGrants().includes(scope);
}

export function grantCoachScope(scope: CoachGrantScope): CoachGrantScope[] {
  if (!ALL_GRANTS.has(scope)) return listCoachGrants();
  const grants = listCoachGrants();
  if (!grants.includes(scope)) {
    grants.push(scope);
    writeFileSync(grantsPath, JSON.stringify(grants, null, 2), { encoding: 'utf-8', mode: 0o600 });
  }
  return grants;
}

export function revokeCoachScope(scope: CoachGrantScope): CoachGrantScope[] {
  if (scope === 'existing_signals') return listCoachGrants(); // default cannot be revoked
  const grants = listCoachGrants().filter((s) => s !== scope);
  writeFileSync(grantsPath, JSON.stringify(grants, null, 2), { encoding: 'utf-8', mode: 0o600 });
  return grants;
}

export function resetCoachGrantsToDefault(): void {
  ensureGrantsFile();
  writeFileSync(grantsPath, JSON.stringify(DEFAULT_GRANTS, null, 2), { encoding: 'utf-8', mode: 0o600 });
}
