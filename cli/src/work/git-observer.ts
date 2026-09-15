import { execSync } from "child_process";
import { createHash } from "crypto";
import type { ProjectSnapshot } from "./repository-registry.js";
import {
  getRepository,
  setRepositoryObservation,
  setRepositoryIndexedHead,
  insertActivity,
  listRepositories,
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

const REPOSITORY_READ_TIMEOUT_MS = 3000;

export class RepositoryReadStalledError extends Error {
  constructor(args: string, cwd: string) {
    super(`git ${args} timed out in ${cwd}`);
    this.name = "RepositoryReadStalledError";
  }
}

export type GitRead = (args: string, cwd: string) => string;

export function isGitReadTimeout(error: unknown): boolean {
  const candidate = error as { code?: string; killed?: boolean } | undefined;
  return Boolean(candidate && (candidate.code === "ETIMEDOUT" || candidate.killed === true));
}

export function defaultGitRead(args: string, cwd: string): string {
  try {
    return execSync(`git ${args}`, { cwd, encoding: "utf8", timeout: REPOSITORY_READ_TIMEOUT_MS }).trim();
  } catch (error) {
    if (isGitReadTimeout(error)) throw new RepositoryReadStalledError(args, cwd);
    return "";
  }
}

export function computeFingerprint(root: string, read: GitRead = defaultGitRead): string {
  const head = read("rev-parse HEAD", root);
  const branch = read("branch --show-current", root);
  const statusOutput = read("status --porcelain", root);

  const hash = createHash("sha1");
  hash.update(`${head}:${branch}:${statusOutput}`);
  return hash.digest("hex");
}

export function observeRepository(root: string, repositoryId: string, read: GitRead = defaultGitRead): RepositoryObservation {
  const now = new Date().toISOString();
  const head = read("rev-parse HEAD", root) || "unknown";
  const branch = read("branch --show-current", root) || "unknown";
  const statusOutput = read("status --porcelain", root);

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
    const log = read(`log --format="%H||%s||%aI" ${range}`, root);
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

export function observeAndRecord(repositoryId: string, knownFingerprint?: string, read: GitRead = defaultGitRead): ProjectSnapshot {
  const repo = getRepository(repositoryId);
  if (!repo) throw new Error(`Repository not found: ${repositoryId}`);

  const fingerprint = knownFingerprint ?? computeFingerprint(repo.root, read);
  const obs = observeRepository(repo.root, repositoryId, read);
  const uncommittedFiles = obs.stagedFiles.length + obs.modifiedFiles.length + obs.untrackedFiles.length;
  let lastActivityAt = repo.lastActivityAt;

  if (!repo.lastIndexedHead && obs.head && obs.head !== "unknown") {
    const firstCommitLog = read(`log -1 --format="%H||%s||%aI"`, repo.root);
    if (firstCommitLog && !firstCommitLog.startsWith("fatal:")) {
      const [hash, subject, authorDate] = firstCommitLog.split("||");
      if (hash && subject) {
        const entry: CommitEntry = { hash, subject, authorDate: authorDate || obs.observedAt };
        const firstActivityAt = entry.authorDate || obs.observedAt;
        lastActivityAt = firstActivityAt;
        insertActivity({
          id: `git-${repositoryId}-${hash.slice(0, 8)}`,
          projectId: repositoryId,
          occurredAt: firstActivityAt,
          type: classifyDelta([entry]),
          summary: subject,
          significance: "minor",
          commitRefs: [`git:${repositoryId}:${hash.slice(0, 7)}`],
          fileRefs: [],
          verified: false,
        });
        setRepositoryObservation(repositoryId, {
          head: obs.head,
          fingerprint,
          branch: obs.branch,
          dirty: obs.dirty,
          uncommittedFiles,
          workActivityAt: firstActivityAt,
        });
        setRepositoryIndexedHead(repositoryId, obs.head);
        return {
          repositoryId,
          name: repo.name,
          root: repo.root,
          branch: obs.branch,
          head: obs.head,
          dirty: obs.dirty,
          lastActivityAt,
          projectFileExists: repo.projectFileExists,
          agentsFileExists: repo.agentsFileExists,
          uncommittedFiles,
        };
      }
    }
    setRepositoryObservation(repositoryId, {
      head: obs.head,
      fingerprint,
      branch: obs.branch,
      dirty: obs.dirty,
      uncommittedFiles,
    });
    setRepositoryIndexedHead(repositoryId, obs.head);
  } else if (obs.commitsSinceLastIndex.length > 0) {
    const type = classifyDelta(obs.commitsSinceLastIndex);
    const summary = makeSummary(obs.commitsSinceLastIndex);
    const fileRefs = [...new Set([...obs.stagedFiles, ...obs.modifiedFiles])];
    const workActivityAt = obs.commitsSinceLastIndex[0].authorDate || obs.observedAt;
    lastActivityAt = workActivityAt;

    insertActivity({
      id: `git-${repositoryId}-${obs.commitsSinceLastIndex[0].hash.slice(0, 8)}`,
      projectId: repositoryId,
      occurredAt: workActivityAt,
      type,
      summary,
      significance: obs.commitsSinceLastIndex.length > 3 ? "major" : "minor",
      commitRefs: obs.commitsSinceLastIndex.map((c) => `git:${repositoryId}:${c.hash.slice(0, 7)}`),
      fileRefs,
      verified: false,
    });

    setRepositoryObservation(repositoryId, {
      head: obs.head,
      fingerprint,
      branch: obs.branch,
      dirty: obs.dirty,
      uncommittedFiles,
      workActivityAt,
    });
    setRepositoryIndexedHead(repositoryId, obs.head);
  } else {
    setRepositoryObservation(repositoryId, {
      head: obs.head,
      fingerprint,
      branch: obs.branch,
      dirty: obs.dirty,
      uncommittedFiles,
    });
  }

  return {
    repositoryId,
    name: repo.name,
    root: repo.root,
    branch: obs.branch,
    head: obs.head,
    dirty: obs.dirty,
    lastActivityAt,
    projectFileExists: repo.projectFileExists,
    agentsFileExists: repo.agentsFileExists,
    uncommittedFiles,
  };
}

let repositoryReadsStalled = false;
let stalledSkippedRepoNames: string[] = [];

export function repositoryReadsAreStalled(): boolean {
  return repositoryReadsStalled;
}

export function stalledSkippedRepositoryNames(): string[] {
  return stalledSkippedRepoNames;
}

export function observeAllRepos(read: GitRead = defaultGitRead): ProjectSnapshot[] {
  const repos = listRepositories();
  const results: ProjectSnapshot[] = [];
  repositoryReadsStalled = false;
  stalledSkippedRepoNames = [];

  for (const [index, repo] of repos.entries()) {
    if (!repo.enabled) continue;
    try {
      const fingerprint = computeFingerprint(repo.root, read);
      const cacheComplete = Boolean(
        repo.observedAt
        && repo.lastObservationFingerprint
        && repo.lastSeenHead
        && repo.observedBranch
        && repo.observedDirty !== undefined
        && repo.observedUncommittedFiles !== undefined,
      );

      if (!cacheComplete || fingerprint !== repo.lastObservationFingerprint) {
        results.push(observeAndRecord(repo.id, fingerprint, read));
      } else {
        const head = repo.lastSeenHead;
        const branch = repo.observedBranch;
        const dirty = repo.observedDirty;
        const uncommittedFiles = repo.observedUncommittedFiles;
        if (!head || !branch || dirty === undefined || uncommittedFiles === undefined) {
          results.push(observeAndRecord(repo.id, fingerprint, read));
          continue;
        }

        // The fingerprint check itself freshly verifies HEAD, branch and status.
        // Refresh observation freshness without inventing new work activity.
        setRepositoryObservation(repo.id, {
          head,
          fingerprint,
          branch,
          dirty,
          uncommittedFiles,
        });
        results.push({
          repositoryId: repo.id,
          name: repo.name,
          root: repo.root,
          branch,
          head,
          dirty,
          lastActivityAt: repo.lastActivityAt,
          projectFileExists: repo.projectFileExists,
          agentsFileExists: repo.agentsFileExists,
          uncommittedFiles,
        });
      }
    } catch (error) {
      if (error instanceof RepositoryReadStalledError) {
        // ponytail: latch is per-sweep, so a still-wedged repo re-pays one bound next sweep; persist it if that ever matters
        repositoryReadsStalled = true;
        stalledSkippedRepoNames = repos.slice(index + 1).filter((r) => r.enabled).map((r) => r.name);
        break;
      }
      // repo inaccessible, skip
    }
  }

  return results;
}

function classifyDelta(commits: CommitEntry[]): "implementation" | "fix" | "refactor" | "research" | "documentation" | "release" | "setup" | "unknown" {
  const text = commits.map((c) => c.subject.toLowerCase()).join(" ");
  if (/^fix/i.test(commits[0]?.subject ?? "")) return "fix";
  if (text.includes("refactor")) return "refactor";
  if (text.includes("release") || text.includes("version") || /^v\d/.test(commits[0]?.subject ?? "")) return "release";
  if (text.includes("doc") || text.includes("readme")) return "documentation";
  if (text.includes("setup") || text.includes("init")) return "setup";
  if (text.includes("research") || text.includes("explore") || text.includes("spike")) return "research";
  return "implementation";
}

function makeSummary(commits: CommitEntry[]): string {
  return commits.map((c) => c.subject).join("; ");
}
