import { existsSync, readdirSync, statSync, readFileSync } from "fs";
import { join, resolve, basename } from "path";
import { homedir } from "os";
import { getDb } from "./database.js";
import { createHash } from "crypto";
import { observeRepository } from "./git-observer.js";

export interface ManagedRepository {
  id: string;
  name: string;
  root: string;
  remoteUrl?: string;
  defaultBranch?: string;
  lastSeenHead?: string;
  lastIndexedHead?: string;
  /** Last verified work activity (commit time), not observation time. */
  lastActivityAt?: string;
  /** Last time Flyd observed this repo (scan/fingerprint). */
  observedAt?: string;
  projectFileExists: boolean;
  agentsFileExists: boolean;
  enabled: boolean;
}

export interface GlobalPresentModel {
  foregroundProject?: ProjectSnapshot;
  activeProjects: ProjectSnapshot[];
  recentActivity: WorkActivity[];
  openTasks: WorkTask[];
  gaps: string[];
}

export interface ProjectSnapshot {
  repositoryId: string;
  name: string;
  root: string;
  branch?: string;
  head?: string;
  dirty: boolean;
  lastActivityAt?: string;
  projectFileExists: boolean;
  agentsFileExists: boolean;
  uncommittedFiles: number;
}

export interface WorkActivity {
  id: string;
  projectId: string;
  occurredAt: string;
  type: "implementation" | "fix" | "refactor" | "research" | "documentation" | "release" | "setup" | "unknown";
  summary: string;
  significance: "major" | "minor";
  commitRefs: string[];
  fileRefs: string[];
  verified: boolean;
}

export interface WorkTask {
  id: string;
  projectId?: string;
  description: string;
  status: "open" | "in_progress" | "blocked" | "waiting" | "done" | "cancelled";
  priority?: "high" | "medium" | "low";
  sourceType: string;
  sourceRef?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

function getDiscoveryDirs(): string[] {
  if (process.env.FLYD_WORK_ROOTS) {
    const roots = process.env.FLYD_WORK_ROOTS.split(",").map(r => resolve(r.trim())).filter(Boolean);
    return [...new Set(roots)];
  }

  const defaultDirs = [
    join(homedir(), "Documents"),
    join(homedir(), "Code"),
    join(homedir(), "Projects"),
    join(homedir(), "Developer"),
    join(homedir(), "src"),
    join(homedir(), "dev"),
  ];
  return [...new Set(defaultDirs.map(d => resolve(d)))];
}

function isValidRepo(dir: string): boolean {
  try {
    const gitDir = join(dir, ".git");
    return existsSync(gitDir) && statSync(gitDir).isDirectory();
  } catch {
    return false;
  }
}

function canonicalizeProjectName(name: string): string {
  if (name === "cli") return "flyd";
  if (name === "mac-adapter") return "flyd";
  return name;
}

function discoverReposInDir(parent: string): { name: string; root: string }[] {
  if (!existsSync(parent)) return [];
  try {
    return readdirSync(parent)
      .map((entry) => {
        const full = resolve(parent, entry);
        try {
          if (!statSync(full).isDirectory()) return null;
        } catch {
          return null;
        }
        if (entry.startsWith(".")) return null;
        if (isValidRepo(full)) return { name: canonicalizeProjectName(entry), root: full };
        return null;
      })
      .filter((r): r is { name: string; root: string } => r !== null);
  } catch {
    return [];
  }
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function scanDirectories(): { name: string; root: string }[] {
  const seen = new Set<string>();
  const results: { name: string; root: string }[] = [];
  const dirs = getDiscoveryDirs();
  for (const dir of dirs) {
    for (const repo of discoverReposInDir(dir)) {
      const key = resolve(repo.root);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(repo);
    }
  }
  return results;
}

export function listRepositories(): ManagedRepository[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM repositories ORDER BY last_activity_at DESC NULLS LAST, name ASC")
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapRepoRow);
}

export function getRepository(idOrRoot: string): ManagedRepository | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM repositories WHERE id = ? OR root = ?").get(idOrRoot, idOrRoot) as
    | Record<string, unknown>
    | undefined;
  return row ? mapRepoRow(row) : undefined;
}

function mapRepoRow(r: Record<string, unknown>): ManagedRepository {
  return {
    id: r.id as string,
    name: r.name as string,
    root: r.root as string,
    remoteUrl: (r.remote_url as string) || undefined,
    defaultBranch: (r.default_branch as string) || undefined,
    lastSeenHead: (r.last_seen_head as string) || undefined,
    lastIndexedHead: (r.last_indexed_head as string) || undefined,
    lastActivityAt: (r.last_activity_at as string) || undefined,
    observedAt: (r.observed_at as string) || undefined,
    projectFileExists: Boolean(r.project_file_exists),
    agentsFileExists: Boolean(r.agents_file_exists),
    enabled: Boolean(r.enabled),
  };
}

export function addRepository(root: string, name?: string): ManagedRepository {
  const db = getDb();
  const resolved = resolve(root);
  const existing = db
    .prepare("SELECT * FROM repositories WHERE root = ?")
    .get(resolved) as Record<string, unknown> | undefined;
  if (existing) return mapRepoRow(existing);

  const repoName = name ?? basename(resolved);
  const rootHash = createHash("sha256").update(resolved).digest("hex").slice(0, 8);
  const id = `${slug(repoName)}-${rootHash}`;
  const projectFileExists = existsSync(join(resolved, "PROJECT.md"));
  const agentsFileExists = existsSync(join(resolved, "AGENTS.md"));

  db.prepare(
    `INSERT INTO repositories (id, name, root, project_file_exists, agents_file_exists)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, repoName, resolved, projectFileExists ? 1 : 0, agentsFileExists ? 1 : 0);

  return {
    id,
    name: repoName,
    root: resolved,
    projectFileExists,
    agentsFileExists,
    enabled: true,
  };
}

export function removeRepository(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM repositories WHERE id = ?").run(id);
  return result.changes > 0;
}

export function registerDiscoveredRepos(): { added: number; existing: number } {
  const discovered = scanDirectories();
  let added = 0;
  let existing = 0;

  for (const repo of discovered) {
    const db = getDb();
    const row = db.prepare("SELECT id FROM repositories WHERE root = ?").get(resolve(repo.root));
    if (row) {
      existing++;
      db.prepare(
        "UPDATE repositories SET project_file_exists = ?, agents_file_exists = ?, updated_at = datetime('now') WHERE root = ?",
      ).run(
        existsSync(join(repo.root, "PROJECT.md")) ? 1 : 0,
        existsSync(join(repo.root, "AGENTS.md")) ? 1 : 0,
        resolve(repo.root),
      );
    } else {
      addRepository(repo.root, repo.name);
      added++;
    }
  }

  return { added, existing };
}

/**
 * Record an observation of a repository.
 * Updates fingerprint head + observed_at. Does NOT treat observation as work activity.
 * Pass workActivityAt (commit author time) only when recording real git work.
 */
export function setRepositoryActivity(
  repositoryId: string,
  head: string,
  workActivityAt?: string,
): void {
  const db = getDb();
  const observedAt = new Date().toISOString();
  if (workActivityAt) {
    db.prepare(
      `UPDATE repositories
       SET last_seen_head = ?, observed_at = ?, last_activity_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(head, observedAt, workActivityAt, repositoryId);
  } else {
    db.prepare(
      `UPDATE repositories
       SET last_seen_head = ?, observed_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(head, observedAt, repositoryId);
  }
}

export function setRepositoryIndexedHead(repositoryId: string, head: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE repositories SET last_indexed_head = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(head, repositoryId);
}

/**
 * Recompute last_activity_at from the newest activity.occurred_at per repo.
 * Leaves observed_at alone. Safe to run on poisoned founder DBs.
 */
export function backfillActivityFromCommits(): number {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT repository_id AS id, MAX(occurred_at) AS occurred_at
       FROM activities
       GROUP BY repository_id`,
    )
    .all() as Array<{ id: string; occurred_at: string }>;
  let updated = 0;
  const stmt = db.prepare(
    "UPDATE repositories SET last_activity_at = ?, updated_at = datetime('now') WHERE id = ?",
  );
  for (const row of rows) {
    if (!row.occurred_at) continue;
    stmt.run(row.occurred_at, row.id);
    updated++;
  }
  return updated;
}

export function refreshRepositoryFileFlags(repositoryId: string): void {
  const db = getDb();
  let repo = db.prepare("SELECT root FROM repositories WHERE id = ?").get(repositoryId) as
    | { root: string }
    | undefined;
  if (!repo) {
    repo = db.prepare("SELECT root FROM repositories WHERE root = ?").get(repositoryId) as
      | { root: string }
      | undefined;
  }
  if (!repo) return;
  db.prepare(
    "UPDATE repositories SET project_file_exists = ?, agents_file_exists = ?, updated_at = datetime('now') WHERE root = ?",
  ).run(
    existsSync(join(repo.root, "PROJECT.md")) ? 1 : 0,
    existsSync(join(repo.root, "AGENTS.md")) ? 1 : 0,
    repo.root,
  );
}

export function insertActivity(activity: WorkActivity): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO activities (id, repository_id, occurred_at, type, summary, significance, commit_refs, file_refs, verified, source_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    activity.id,
    activity.projectId,
    activity.occurredAt,
    activity.type,
    activity.summary,
    activity.significance,
    JSON.stringify(activity.commitRefs),
    JSON.stringify(activity.fileRefs),
    activity.verified ? 1 : 0,
    "git",
  );
}

export function listActivities(repositoryId?: string, limit = 20): WorkActivity[] {
  const db = getDb();
  const query = repositoryId
    ? "SELECT * FROM activities WHERE repository_id = ? ORDER BY occurred_at DESC LIMIT ?"
    : "SELECT * FROM activities ORDER BY occurred_at DESC LIMIT ?";
  const params = repositoryId ? [repositoryId, limit] : [limit];
  const rows = db.prepare(query).all(...params) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: r.id as string,
    projectId: r.repository_id as string,
    occurredAt: r.occurred_at as string,
    type: r.type as WorkActivity["type"],
    summary: r.summary as string,
    significance: r.significance as WorkActivity["significance"],
    commitRefs: JSON.parse(r.commit_refs as string),
    fileRefs: JSON.parse(r.file_refs as string),
    verified: Boolean(r.verified),
  }));
}

export function buildGlobalPresentModel(foregroundRoot?: string): GlobalPresentModel {
  const repos = listRepositories();
  const gaps: string[] = [];

  const activeProjects: ProjectSnapshot[] = repos.map((r) => {
    if (!existsSync(r.root)) {
      gaps.push(`repo_unavailable:${r.name}`);
      return {
        repositoryId: r.id,
        name: r.name,
        root: r.root,
        head: r.lastSeenHead,
        dirty: false,
        lastActivityAt: r.lastActivityAt,
        projectFileExists: r.projectFileExists,
        agentsFileExists: r.agentsFileExists,
        uncommittedFiles: 0,
      };
    }
    
    try {
      const obs = observeRepository(r.root, r.id);
      return {
        repositoryId: r.id,
        name: r.name,
        root: r.root,
        branch: obs.branch,
        head: obs.head !== "unknown" ? obs.head : r.lastSeenHead,
        dirty: obs.dirty,
        lastActivityAt: r.lastActivityAt,
        projectFileExists: r.projectFileExists,
        agentsFileExists: r.agentsFileExists,
        uncommittedFiles: obs.stagedFiles.length + obs.modifiedFiles.length + obs.untrackedFiles.length,
      };
    } catch {
      gaps.push(`repo_observation_failed:${r.name}`);
      return {
        repositoryId: r.id,
        name: r.name,
        root: r.root,
        head: r.lastSeenHead,
        dirty: false,
        lastActivityAt: r.lastActivityAt,
        projectFileExists: r.projectFileExists,
        agentsFileExists: r.agentsFileExists,
        uncommittedFiles: 0,
      };
    }
  });

  let foregroundProject: ProjectSnapshot | undefined;
  if (foregroundRoot) {
    foregroundProject = activeProjects.find((p) => p.root === resolve(foregroundRoot));
  }

  const recentActivity = listActivities(undefined, 20);

  return {
    foregroundProject,
    activeProjects,
    recentActivity,
    openTasks: [],
    gaps,
  };
}
