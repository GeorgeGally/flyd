import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, describe, expect, it } from "vitest";
import { inspectRepository } from "../repository-inspector.js";
import { integrateVerifiedResults, preflightVerifiedResults, rollbackIntegratedResult } from "../result-integrator.js";
import { verifyWorkerResult } from "../result-verifier.js";
import { GitWorktreeManager } from "../worktree-manager.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function repository(): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), "flyd-integrate-test-"));
  roots.push(root);
  await execFileAsync("git", ["init", "-b", "main", root]);
  await writeFile(join(root, "one.txt"), "one base\n");
  await writeFile(join(root, "two.txt"), "two base\n");
  await execFileAsync("git", ["-C", root, "add", "."]);
  await execFileAsync("git", ["-C", root, "-c", "user.name=Flyd Test", "-c", "user.email=flyd@example.test", "commit", "-m", "base"]);
  const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
  return { root, head: stdout.trim() };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("integrateVerifiedResults", () => {
  it("preflights the combined patch without touching main", async () => {
    const repo = await repository();
    const managedRoot = await mkdtemp(join(tmpdir(), "flyd-preflight-managed-"));
    roots.push(managedRoot);
    const manager = new GitWorktreeManager({ managedRoot });
    const worktree = await manager.prepare({ repositoryRoot: repo.root, taskKey: "task-preflight", assignmentKey: "one", baseHead: repo.head });
    await writeFile(join(worktree.path, "one.txt"), "candidate change\n");
    const result = await verifyWorkerResult({ worktreePath: worktree.path, baseHead: repo.head, commands: ["git diff --check"] });

    const preflight = await preflightVerifiedResults({
      repositoryRoot: repo.root,
      taskKey: "task-preflight",
      baseSnapshot: await inspectRepository(repo.root),
      results: [result],
      verificationCommands: ["node -e \"process.exit(9)\""],
      manager,
    });

    expect(preflight).toMatchObject({ status: "blocked", reason: "Combined assignment result failed preflight verification" });
    expect(await readFile(join(repo.root, "one.txt"), "utf8")).toBe("one base\n");
  });

  it("restores an earlier repository when a later repository integration blocks", async () => {
    const repo = await repository();
    const managedRoot = await mkdtemp(join(tmpdir(), "flyd-rollback-managed-"));
    roots.push(managedRoot);
    const manager = new GitWorktreeManager({ managedRoot });
    const worktree = await manager.prepare({ repositoryRoot: repo.root, taskKey: "task-rollback", assignmentKey: "one", baseHead: repo.head });
    await writeFile(join(worktree.path, "one.txt"), "integrated then rolled back\n");
    const result = await verifyWorkerResult({ worktreePath: worktree.path, baseHead: repo.head, commands: ["git diff --check"] });
    const baseSnapshot = await inspectRepository(repo.root);
    const integration = await integrateVerifiedResults({
      repositoryRoot: repo.root, taskKey: "task-rollback", baseSnapshot,
      results: [result], verificationCommands: ["git diff --check"], manager,
    });

    expect(integration.status).toBe("integrated");
    await rollbackIntegratedResult({ repositoryRoot: repo.root, baseSnapshot, integration });

    expect((await inspectRepository(repo.root)).head).toBe(repo.head);
    expect(await readFile(join(repo.root, "one.txt"), "utf8")).toBe("one base\n");
  });

  it("proves disjoint patches together before applying them to unchanged main", async () => {
    const repo = await repository();
    const managedRoot = await mkdtemp(join(tmpdir(), "flyd-integrate-managed-"));
    roots.push(managedRoot);
    const manager = new GitWorktreeManager({ managedRoot });
    const first = await manager.prepare({ repositoryRoot: repo.root, taskKey: "task-1", assignmentKey: "one-1", baseHead: repo.head });
    const second = await manager.prepare({ repositoryRoot: repo.root, taskKey: "task-1", assignmentKey: "two-2", baseHead: repo.head });
    await writeFile(join(first.path, "one.txt"), "one changed\n");
    await writeFile(join(second.path, "two.txt"), "two changed\n");
    const results = await Promise.all([
      verifyWorkerResult({ worktreePath: first.path, baseHead: repo.head, commands: ["git diff --check"] }),
      verifyWorkerResult({ worktreePath: second.path, baseHead: repo.head, commands: ["git diff --check"] }),
    ]);
    const sourceSnapshot = await inspectRepository(repo.root);

    const integration = await integrateVerifiedResults({
      repositoryRoot: repo.root,
      taskKey: "task-1",
      baseSnapshot: sourceSnapshot,
      results,
      verificationCommands: ["git diff --check"],
      manager,
    });

    expect(integration.status).toBe("integrated");
    expect(await readFile(join(repo.root, "one.txt"), "utf8")).toBe("one changed\n");
    expect(await readFile(join(repo.root, "two.txt"), "utf8")).toBe("two changed\n");
  });

  it("blocks overlapping results without touching main", async () => {
    const repo = await repository();
    const managedRoot = await mkdtemp(join(tmpdir(), "flyd-integrate-managed-"));
    roots.push(managedRoot);
    const manager = new GitWorktreeManager({ managedRoot });
    const first = await manager.prepare({ repositoryRoot: repo.root, taskKey: "task-2", assignmentKey: "one-1", baseHead: repo.head });
    const second = await manager.prepare({ repositoryRoot: repo.root, taskKey: "task-2", assignmentKey: "two-2", baseHead: repo.head });
    await writeFile(join(first.path, "one.txt"), "first change\n");
    await writeFile(join(second.path, "one.txt"), "second change\n");
    const results = await Promise.all([
      verifyWorkerResult({ worktreePath: first.path, baseHead: repo.head, commands: ["git diff --check"] }),
      verifyWorkerResult({ worktreePath: second.path, baseHead: repo.head, commands: ["git diff --check"] }),
    ]);

    const integration = await integrateVerifiedResults({
      repositoryRoot: repo.root,
      taskKey: "task-2",
      baseSnapshot: await inspectRepository(repo.root),
      results,
      verificationCommands: ["git diff --check"],
      manager,
    });

    expect(integration).toMatchObject({ status: "blocked", reason: "Assignments changed overlapping files: one.txt" });
    expect(await readFile(join(repo.root, "one.txt"), "utf8")).toBe("one base\n");
  });

  it("blocks stale source state without touching the new main commit", async () => {
    const repo = await repository();
    const managedRoot = await mkdtemp(join(tmpdir(), "flyd-integrate-managed-"));
    roots.push(managedRoot);
    const manager = new GitWorktreeManager({ managedRoot });
    const worktree = await manager.prepare({ repositoryRoot: repo.root, taskKey: "task-3", assignmentKey: "one-1", baseHead: repo.head });
    await writeFile(join(worktree.path, "one.txt"), "worker change\n");
    const result = await verifyWorkerResult({ worktreePath: worktree.path, baseHead: repo.head, commands: ["git diff --check"] });
    const baseSnapshot = await inspectRepository(repo.root);
    await writeFile(join(repo.root, "two.txt"), "new main reality\n");
    await execFileAsync("git", ["-C", repo.root, "add", "two.txt"]);
    await execFileAsync("git", ["-C", repo.root, "-c", "user.name=Flyd Test", "-c", "user.email=flyd@example.test", "commit", "-m", "main changed"]);

    const integration = await integrateVerifiedResults({
      repositoryRoot: repo.root,
      taskKey: "task-3",
      baseSnapshot,
      results: [result],
      verificationCommands: ["git diff --check"],
      manager,
    });

    expect(integration).toMatchObject({ status: "blocked", reason: "Source repository changed after assignments started" });
    expect(await readFile(join(repo.root, "one.txt"), "utf8")).toBe("one base\n");
    expect(await readFile(join(repo.root, "two.txt"), "utf8")).toBe("new main reality\n");
  });

  it("blocks implementation integration outside main", async () => {
    const repo = await repository();
    await execFileAsync("git", ["-C", repo.root, "checkout", "-b", "feature"]);
    const managedRoot = await mkdtemp(join(tmpdir(), "flyd-integrate-managed-"));
    roots.push(managedRoot);
    const manager = new GitWorktreeManager({ managedRoot });
    const worktree = await manager.prepare({ repositoryRoot: repo.root, taskKey: "task-feature", assignmentKey: "one", baseHead: repo.head });
    await writeFile(join(worktree.path, "one.txt"), "worker change\n");
    const result = await verifyWorkerResult({ worktreePath: worktree.path, baseHead: repo.head, commands: ["git diff --check"] });

    const integration = await integrateVerifiedResults({
      repositoryRoot: repo.root,
      taskKey: "task-feature",
      baseSnapshot: await inspectRepository(repo.root),
      results: [result],
      verificationCommands: ["git diff --check"],
      manager,
    });

    expect(integration).toMatchObject({ status: "blocked", reason: "Implementation results can only integrate into main" });
    expect(await readFile(join(repo.root, "one.txt"), "utf8")).toBe("one base\n");
  });

  it("accepts a verified read-only result when an already-dirty source is unchanged", async () => {
    const repo = await repository();
    const managedRoot = await mkdtemp(join(tmpdir(), "flyd-integrate-managed-"));
    roots.push(managedRoot);
    const manager = new GitWorktreeManager({ managedRoot });
    await writeFile(join(repo.root, "one.txt"), "existing user work\n");
    const baseSnapshot = await inspectRepository(repo.root);
    const worktree = await manager.prepare({
      repositoryRoot: repo.root,
      taskKey: "task-4",
      assignmentKey: "assessment",
      baseHead: repo.head,
    });
    const result = await verifyWorkerResult({
      worktreePath: worktree.path,
      baseHead: repo.head,
      commands: ["git diff --check"],
      requireChanges: false,
    });

    const integration = await integrateVerifiedResults({
      repositoryRoot: repo.root,
      taskKey: "task-4",
      baseSnapshot,
      results: [result],
      verificationCommands: ["git diff --check"],
      manager,
    });

    expect(integration).toMatchObject({
      status: "integrated",
      changedFiles: [],
      repositorySnapshot: expect.objectContaining({ statusDigest: baseSnapshot.statusDigest }),
    });
    expect(await readFile(join(repo.root, "one.txt"), "utf8")).toBe("existing user work\n");
  });
});
