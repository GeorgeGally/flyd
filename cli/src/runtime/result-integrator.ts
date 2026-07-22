import { createHash, randomUUID } from "crypto";
import { execFile as nodeExecFile } from "child_process";
import { mkdtemp, open, rm, unlink, writeFile } from "fs/promises";
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

export async function preflightVerifiedResults(input: {
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
    return { status: "blocked", reason: `Assignments changed overlapping files: ${overlaps.join(", ")}`, changedFiles: overlaps, patchDigest: null };
  }
  const currentSource = await inspectRepository(input.repositoryRoot);
  const changedFiles = [...new Set(input.results.flatMap((result) => result.changedFiles))].sort();
  if (!sameRepositoryState(input.baseSnapshot, currentSource)) {
    return { status: "blocked", reason: "Source repository changed after assignments started", changedFiles: [], patchDigest: null };
  }
  if (changedFiles.length === 0) {
    return {
      status: "integrated", reason: null, changedFiles: [], patchDigest: input.results[0].patchDigest,
      repositorySnapshot: currentSource, verification: input.results[0],
    };
  }
  if (currentSource.branch !== "main") {
    return { status: "blocked", reason: "Implementation results can only integrate into main", changedFiles: [], patchDigest: null };
  }

  const preflightWorktree = await input.manager.prepare({
    repositoryRoot: input.repositoryRoot,
    taskKey: input.taskKey,
    assignmentKey: `preflight-${randomUUID()}`,
    baseHead: input.baseSnapshot.head,
  });
  try {
    for (const result of input.results) await applyPatch(preflightWorktree.path, result.patch);
    const verification = await verifyWorkerResult({
      worktreePath: preflightWorktree.path,
      baseHead: input.baseSnapshot.head,
      commands: input.verificationCommands,
    });
    return verification.passed
      ? {
          status: "integrated", reason: null, changedFiles: verification.changedFiles,
          patchDigest: verification.patchDigest, repositorySnapshot: currentSource, verification,
        }
      : {
          status: "blocked", reason: "Combined assignment result failed preflight verification",
          changedFiles: verification.changedFiles, patchDigest: verification.patchDigest, verification,
        };
  } finally {
    await input.manager.remove(input.repositoryRoot, preflightWorktree, true);
  }
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
  if (currentSource.branch !== "main") {
    return { status: "blocked", reason: "Implementation results can only integrate into main", changedFiles: [], patchDigest: null };
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
    await execFileAsync("git", [ "-C", integrationWorktree.path, "add", "--all" ], { encoding: "utf8", timeout: 30_000 });
    await execFileAsync("git", [
      "-C", integrationWorktree.path,
      "-c", "user.name=Flyd Runtime",
      "-c", "user.email=runtime@flyd.local",
      "commit", "-m", `flyd: integrate ${input.taskKey}`,
    ], { encoding: "utf8", timeout: 30_000 });
    const { stdout: integrationHeadOutput } = await execFileAsync(
      "git", [ "-C", integrationWorktree.path, "rev-parse", "HEAD" ], { encoding: "utf8", timeout: 10_000 },
    );
    const integrationHead = integrationHeadOutput.trim();
    const { stdout: gitDirectoryOutput } = await execFileAsync(
      "git", [ "-C", input.repositoryRoot, "rev-parse", "--absolute-git-dir" ], { encoding: "utf8", timeout: 10_000 },
    );
    const lockPath = join(gitDirectoryOutput.trim(), "flyd-integration.lock");
    let lock;
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch {
      return {
        status: "blocked",
        reason: "Another Flyd integration is already in progress",
        changedFiles: verification.changedFiles,
        patchDigest: verification.patchDigest,
        verification,
      };
    }
    try {
      if (!unchanged(input.baseSnapshot, await inspectRepository(input.repositoryRoot))) {
        return {
          status: "blocked",
          reason: "Source repository changed after assignments started",
          changedFiles: verification.changedFiles,
          patchDigest: verification.patchDigest,
          verification,
        };
      }
      await execFileAsync("git", [
        "-C", input.repositoryRoot, "fetch", "--no-tags", integrationWorktree.path, integrationHead,
      ], { encoding: "utf8", timeout: 30_000 });
      if (!unchanged(input.baseSnapshot, await inspectRepository(input.repositoryRoot))) {
        return {
          status: "blocked",
          reason: "Source repository changed during integration",
          changedFiles: verification.changedFiles,
          patchDigest: verification.patchDigest,
          verification,
        };
      }
      await execFileAsync("git", [
        "-C", input.repositoryRoot, "merge", "--ff-only", "--no-edit", "FETCH_HEAD",
      ], { encoding: "utf8", timeout: 30_000 });
    } finally {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
    const finalSnapshot = await inspectRepository(input.repositoryRoot);
    const [{ stdout: parentOutput }, { stdout: finalNames }, { stdout: finalPatch }] = await Promise.all([
      execFileAsync("git", [ "-C", input.repositoryRoot, "rev-parse", "HEAD^" ], { encoding: "utf8", timeout: 10_000 }),
      execFileAsync("git", [ "-C", input.repositoryRoot, "diff", "--name-only", input.baseSnapshot.head, "HEAD", "--" ], { encoding: "utf8", timeout: 10_000 }),
      execFileAsync("git", [ "-C", input.repositoryRoot, "diff", "--binary", "--full-index", input.baseSnapshot.head, "HEAD", "--" ], {
        encoding: "utf8", timeout: 30_000, maxBuffer: 50 * 1024 * 1024,
      }),
    ]);
    const finalFiles = finalNames.trim() ? finalNames.trim().split("\n").sort() : [];
    const finalDigest = createHash("sha256").update(finalPatch).digest("hex");
    if (finalSnapshot.branch !== "main" || finalSnapshot.head !== integrationHead || finalSnapshot.dirty ||
      parentOutput.trim() !== input.baseSnapshot.head || JSON.stringify(finalFiles) !== JSON.stringify(verification.changedFiles) ||
      finalDigest !== verification.patchDigest) {
      return {
        status: "blocked",
        reason: "Source repository did not match the verified integration result after merge",
        changedFiles: finalFiles,
        patchDigest: finalDigest,
        repositorySnapshot: finalSnapshot,
        verification,
      };
    }
    return {
      status: "integrated",
      reason: null,
      changedFiles: verification.changedFiles,
      patchDigest: verification.patchDigest,
      repositorySnapshot: finalSnapshot,
      verification,
    };
  } finally {
    await input.manager.remove(input.repositoryRoot, integrationWorktree, true);
  }
}

export async function rollbackIntegratedResult(input: {
  repositoryRoot: string;
  baseSnapshot: RepositorySnapshot;
  integration: IntegrationResult;
}): Promise<void> {
  if (input.integration.status !== "integrated" || input.integration.changedFiles.length === 0) return;
  const integratedSnapshot = input.integration.repositorySnapshot;
  if (!integratedSnapshot) throw new Error("Integrated repository snapshot is missing");
  const current = await inspectRepository(input.repositoryRoot);
  if (current.dirty || current.branch !== integratedSnapshot.branch || current.head !== integratedSnapshot.head) {
    throw new Error(`Cannot roll back ${input.repositoryRoot} because it changed after Flyd integration`);
  }
  await execFileAsync("git", [ "-C", input.repositoryRoot, "reset", "--hard", input.baseSnapshot.head ], {
    encoding: "utf8", timeout: 30_000,
  });
  const restored = await inspectRepository(input.repositoryRoot);
  if (!sameRepositoryState(input.baseSnapshot, restored)) {
    throw new Error(`Flyd could not restore ${input.repositoryRoot} to its recorded base state`);
  }
}
