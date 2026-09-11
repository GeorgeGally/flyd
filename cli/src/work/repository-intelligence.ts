import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { observeAllRepos } from "./git-observer.js";
import type { ProjectSnapshot } from "./repository-registry.js";
import { getRecentCommits, type RecentCommit } from "../lib/recent-commits.js";

/**
 * Canonical read surface for repository reality.
 *
 * High-level consumers should use this module instead of invoking git directly
 * for branch / HEAD / dirty-state / changed-files observations. Deeper Git
 * capabilities can be added here as they are consolidated.
 */

export interface RepositoryPathSnapshot {
  root: string;
  branch?: string;
  headDigest?: string;
  statusDigest?: string;
  isDirty: boolean;
  recentCommits?: string[];
  changedFiles?: string[];
}

export function observeKnownRepositories(): ProjectSnapshot[] {
  return observeAllRepos();
}

export async function recentRepositoryCommits(root: string, limit = 5): Promise<RecentCommit[]> {
  return getRecentCommits(root, limit);
}

export function repositoryCommonDir(root: string): string | undefined {
  const common = runGit(root, ["rev-parse", "--git-common-dir"]);
  return common ? resolve(root, common) : undefined;
}

export function inspectRepositoryFromPath(path?: string): RepositoryPathSnapshot | undefined {
  if (!path) return undefined;

  const cwd = startingDirectory(path);
  const root = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) return undefined;

  const branch = runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]) || undefined;
  const headDigest = runGit(root, ["rev-parse", "HEAD"]) || undefined;
  const status = runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"], false);
  const statusDigest = createHash("sha256").update(status || "clean").digest("hex");
  const isDirty = status.length > 0;

  const recentCommitsRaw = runGit(root, ["log", "--oneline", "-5"]);
  const recentCommits = recentCommitsRaw
    ? recentCommitsRaw.split("\n").filter(Boolean)
    : undefined;

  const changedFiles = status
    ? status.split("\n").map(statusPath).filter(Boolean).slice(0, 20)
    : undefined;

  return {
    root,
    branch,
    headDigest,
    statusDigest,
    isDirty,
    recentCommits,
    changedFiles,
  };
}

function startingDirectory(path: string): string {
  try {
    if (existsSync(path) && statSync(path).isDirectory()) return path;
  } catch {
    // Fall back to the parent for inaccessible/nonexistent document paths.
  }
  return dirname(path);
}

function statusPath(line: string): string {
  const path = line.slice(3).trim();
  const renameSeparator = path.indexOf(" -> ");
  return renameSeparator >= 0 ? path.slice(renameSeparator + 4) : path;
}

function runGit(cwd: string, args: string[], trim = true): string {
  try {
    const output = execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 3000,
    });
    return trim ? output.trim() : output.trimEnd();
  } catch {
    return "";
  }
}
