import { execSync } from "child_process";
import { statSync } from "fs";
import { createHash } from "crypto";
import { join, resolve } from "path";
import type { ProjectSnapshot } from "./repository-registry.js";
import {
  getRepository,
  setRepositoryActivity,
  setRepositoryIndexedHead,
  insertActivity,
  listRepositories,
  listActivities,
} from "./repository-registry.js";

export interface RepositoryObservation {
  repositoryId: string;
  observedAt: string;
  branch: string;
  head: string;
  dirty: boolean;
  stagedFiles: string[];
  modifiedFiles: string[];
  untrackedFiles: string[];
  commitsSinceLastIndex: CommitEntry[];
}

export interface CommitEntry {
  hash: string;
  subject: string;
  authorDate: string;
}

function execGit(args: string, cwd: string): string {
  try {
    return execSync(`git ${args}`, { cwd, encoding: "utf8", timeout: 10000 }).trim();
  } catch {
    return "";
  }
}

function fingerprintDir(path: string): string {
  try {
    const stat = statSync(path);
    const hash = createHash("sha1");
    hash.update(`${stat.mtimeMs}:${stat.size}`);
    return hash.digest("hex").slice(0, 12);
  } catch {
    return "missing";
  }
}

export function computeFingerprint(root: string): string {
  const indexFp = fingerprintDir(join(root, ".git", "index"));
  const headFp = fingerprintDir(join(root, ".git", "HEAD"));
  const refsFp = fingerprintDir(join(root, ".git", "refs"));
  const head = execGit("rev-parse HEAD", root);
  const branch = execGit("branch --show-current", root);
  const statusOutput = execGit("status --porcelain", root);

  const hash = createHash("sha1");
  hash.update(`${indexFp}:${headFp}:${refsFp}:${head}:${branch}:${statusOutput}`);
  return hash.digest("hex");
}

export function observeRepository(root: string, repositoryId: string): RepositoryObservation {
  const now = new Date().toISOString();
  const head = execGit("rev-parse HEAD", root) || "unknown";
  const branch = execGit("branch --show-current", root) || "unknown";
  const statusOutput = execGit("status --porcelain", root);

  const stagedFiles: string[] = [];
  const modifiedFiles: string[] = [];
  const untrackedFiles: string[] = [];

  if (statusOutput) {
    for (const line of statusOutput.split("\n")) {
      if (line.length < 3) continue;
      const xy = line.slice(0, 2);
      const file = line.slice(3);
      if (xy === "??") untrackedFiles.push(file);
      else if (xy[0] !== " ") stagedFiles.push(file);
      else modifiedFiles.push(file);
    }
  }

  const commitsSinceLastIndex: CommitEntry[] = [];
  const repo = getRepository(repositoryId);
  const lastIndexedHead = repo?.lastIndexedHead;

  if (lastIndexedHead && head && head !== "unknown") {
    const range = `${lastIndexedHead}..${head}`;
    const log = execGit(`log --format="%H||%s||%aI" ${range}`, root);
    if (log && !log.startsWith("fatal:")) {
      for (const line of log.split("\n")) {
        const parts = line.split("||");
        if (parts.length >= 3) {
          commitsSinceLastIndex.push({
            hash: parts[0],
            subject: parts[1],
            authorDate: parts[2],
          });
        }
      }
    }
  }

  const dirty = stagedFiles.length > 0 || modifiedFiles.length > 0 || untrackedFiles.length > 0;

  return {
    repositoryId,
    observedAt: now,
    branch,
    head,
    dirty,
    stagedFiles,
    modifiedFiles,
    untrackedFiles,
    commitsSinceLastIndex,
  };
}

export function observeAndRecord(repositoryId: string): ProjectSnapshot {
  const repo = getRepository(repositoryId);
  if (!repo) throw new Error(`Repository not found: ${repositoryId}`);

  const obs = observeRepository(repo.root, repositoryId);

  setRepositoryActivity(repositoryId, obs.head);

  if (!repo.lastIndexedHead && obs.head && obs.head !== "unknown") {
    setRepositoryIndexedHead(repositoryId, obs.head);
  } else if (obs.commitsSinceLastIndex.length > 0) {
    const type = classifyDelta(obs.commitsSinceLastIndex);
    const summary = makeSummary(obs.commitsSinceLastIndex);
    const fileRefs = [...new Set([...obs.stagedFiles, ...obs.modifiedFiles])];

    insertActivity({
      id: `git-${repositoryId}-${obs.commitsSinceLastIndex[0].hash.slice(0, 8)}`,
      projectId: repositoryId,
      occurredAt: obs.observedAt,
      type,
      summary,
      significance: obs.commitsSinceLastIndex.length > 3 ? "major" : "minor",
      commitRefs: obs.commitsSinceLastIndex.map((c) => `git:${repositoryId}:${c.hash.slice(0, 7)}`),
      fileRefs,
      verified: false,
    });

    setRepositoryIndexedHead(repositoryId, obs.head);

    // ponytail: auto-reconcile PROJECT.md when new commits land
    try {
      autoReconcileIfStale(repo.root, repositoryId);
    } catch {
      // reconciliation is best-effort, don't block observation
    }
  }

  return {
    repositoryId,
    name: repo.name,
    root: repo.root,
    branch: obs.branch,
    head: obs.head,
    dirty: obs.dirty,
    lastActivityAt: obs.observedAt,
    projectFileExists: repo.projectFileExists,
    agentsFileExists: repo.agentsFileExists,
    uncommittedFiles: obs.stagedFiles.length + obs.modifiedFiles.length + obs.untrackedFiles.length,
  };
}

export function observeAllRepos(): ProjectSnapshot[] {
  const repos = listRepositories();
  const results: ProjectSnapshot[] = [];

  for (const repo of repos) {
    if (!repo.enabled) continue;
    try {
      const fp = computeFingerprint(repo.root);
      // ponytail: only deep-observe if fingerprint changed or no prior observation
      if (fp !== repo.lastSeenHead || !repo.lastActivityAt) {
        results.push(observeAndRecord(repo.id));
      } else {
        results.push({
          repositoryId: repo.id,
          name: repo.name,
          root: repo.root,
          dirty: false,
          lastActivityAt: repo.lastActivityAt,
          projectFileExists: repo.projectFileExists,
          agentsFileExists: repo.agentsFileExists,
          uncommittedFiles: 0,
        });
      }
    } catch {
      // repo inaccessible, skip
    }
  }

  return results;
}

// ponytail: simple keyword-based classification, no LLM needed for obvious cases
function classifyDelta(commits: CommitEntry[]): "implementation" | "fix" | "refactor" | "research" | "documentation" | "release" | "setup" | "unknown" {
  const text = commits.map((c) => c.subject.toLowerCase()).join(" ");
  if (/^fix/i.test(commits[0]?.subject ?? "")) return "fix";
  if (text.includes("refactor")) return "refactor";
  if (text.includes("release") || text.includes("version") || /^v\d/.test(commits[0]?.subject ?? ""))
    return "release";
  if (text.includes("doc") || text.includes("readme")) return "documentation";
  if (text.includes("setup") || text.includes("init")) return "setup";
  if (text.includes("research") || text.includes("explore") || text.includes("spike")) return "research";
  return "implementation";
}

function makeSummary(commits: CommitEntry[]): string {
  return commits.map((c) => c.subject).join("; ");
}

function autoReconcileIfStale(root: string, repositoryId: string): void {
  const { join } = require("path") as typeof import("path");
  const { existsSync } = require("fs") as typeof import("fs");
  const projectPath = join(root, "PROJECT.md");
  if (!existsSync(projectPath)) return;

  // ponytail: dynamic import to avoid circular dependency at module load
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { reconcileProject } = require("./project-reconciler.js") as typeof import("./project-reconciler.js");
  const activities = listActivities(repositoryId, 5);
  reconcileProject(root, activities);
}
