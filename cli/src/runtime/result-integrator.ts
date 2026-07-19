import { randomUUID } from "crypto";
import { execFile as nodeExecFile } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { inspectRepository } from "./repository-inspector.js";
import { verifyWorkerResult, type VerifiedWorkerResult } from "./result-verifier.js";
import { GitWorktreeManager } from "./worktree-manager.js";
import type { RepositorySnapshot } from "./types.js";

const execFileAsync = promisify(nodeExecFile);

export interface IntegrationResult {
  status: "integrated" | "blocked";
  reason: string | null;
  changedFiles: string[];
  patchDigest: string | null;
  repositorySnapshot?: RepositorySnapshot;
  verification?: VerifiedWorkerResult;
}

function overlappingFiles(results: VerifiedWorkerResult[]): string[] {
  const counts = new Map<string, number>();
  for (const file of results.flatMap((result) => result.changedFiles)) {
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return [...counts].filter(([, count]) => count > 1).map(([file]) => file).sort();
}

function unchanged(base: RepositorySnapshot, current: RepositorySnapshot): boolean {
  return !base.dirty && !current.dirty &&
    current.branch === base.branch &&
    current.head === base.head &&
    current.statusDigest === base.statusDigest;
}

function sameRepositoryState(base: RepositorySnapshot, current: RepositorySnapshot): boolean {
  return current.branch === base.branch &&
    current.head === base.head &&
    current.dirty === base.dirty &&
    current.statusDigest === base.statusDigest;
}

async function applyPatch(cwd: string, patch: string, checkOnly = false): Promise<void> {
  if (!patch) return;
  const directory = await mkdtemp(join(tmpdir(), "flyd-patch-"));
  const path = join(directory, "change.patch");
  try {
    await writeFile(path, patch, { encoding: "utf8", mode: 0o600 });
    const args = [ "-C", cwd, "apply" ];
    if (checkOnly) args.push("--check");
    args.push("--whitespace=error-all", path);
    await execFileAsync("git", args, { encoding: "utf8", timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function integrateVerifiedResults(input: {
  repositoryRoot: string;
  taskKey: string;
  baseSnapshot: RepositorySnapshot;
  results: VerifiedWorkerResult[];
  verificationCommands: string[];
  manager: GitWorktreeManager;
}): Promise<IntegrationResult> {
  if (input.results.length === 0 || input.results.some((result) => !result.passed)) {
    return { status: "blocked", reason: "Every assignment must pass independent verification", changedFiles: [], patchDigest: null };
  }
  if (input.results.some((result) => result.baseHead !== input.baseSnapshot.head)) {
    return { status: "blocked", reason: "Assignments do not share the recorded base head", changedFiles: [], patchDigest: null };
  }
  const overlaps = overlappingFiles(input.results);
  if (overlaps.length > 0) {
    return {
      status: "blocked",
      reason: `Assignments changed overlapping files: ${overlaps.join(", ")}`,
      changedFiles: overlaps,
      patchDigest: null,
    };
  }
  const currentSource = await inspectRepository(input.repositoryRoot);
  const changedFiles = [...new Set(input.results.flatMap((result) => result.changedFiles))].sort();
  if (changedFiles.length === 0) {
    if (!sameRepositoryState(input.baseSnapshot, currentSource)) {
      return { status: "blocked", reason: "Source repository changed after assignments started", changedFiles: [], patchDigest: null };
    }
    return {
      status: "integrated",
      reason: null,
      changedFiles: [],
      patchDigest: input.results[0].patchDigest,
      repositorySnapshot: currentSource,
      verification: input.results[0],
    };
  }
  if (!unchanged(input.baseSnapshot, currentSource)) {
    return { status: "blocked", reason: "Source repository changed after assignments started", changedFiles: [], patchDigest: null };
  }

  const integrationWorktree = await input.manager.prepare({
    repositoryRoot: input.repositoryRoot,
    taskKey: input.taskKey,
    assignmentKey: `integration-${randomUUID()}`,
    baseHead: input.baseSnapshot.head,
  });
  try {
    for (const result of input.results) await applyPatch(integrationWorktree.path, result.patch);
    const verification = await verifyWorkerResult({
      worktreePath: integrationWorktree.path,
      baseHead: input.baseSnapshot.head,
      commands: input.verificationCommands,
    });
    if (!verification.passed) {
      return {
        status: "blocked",
        reason: "Combined assignment result failed verification",
        changedFiles: verification.changedFiles,
        patchDigest: verification.patchDigest,
        verification,
      };
    }
    if (!unchanged(input.baseSnapshot, await inspectRepository(input.repositoryRoot))) {
      return {
        status: "blocked",
        reason: "Source repository changed after assignments started",
        changedFiles: verification.changedFiles,
        patchDigest: verification.patchDigest,
        verification,
      };
    }
    await applyPatch(input.repositoryRoot, verification.patch, true);
    await applyPatch(input.repositoryRoot, verification.patch);
    return {
      status: "integrated",
      reason: null,
      changedFiles: verification.changedFiles,
      patchDigest: verification.patchDigest,
      repositorySnapshot: await inspectRepository(input.repositoryRoot),
      verification,
    };
  } finally {
    await input.manager.remove(input.repositoryRoot, integrationWorktree, true);
  }
}
