import { execFile } from "child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, describe, expect, it } from "vitest";
import { GitWorktreeManager } from "../worktree-manager.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function repository(): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), "flyd-worktree-test-"));
  roots.push(root);
  await execFileAsync("git", ["init", "-b", "main", root]);
  await writeFile(join(root, "README.md"), "base\n");
  await execFileAsync("git", ["-C", root, "add", "README.md"]);
  await execFileAsync("git", ["-C", root, "-c", "user.name=Flyd Test", "-c", "user.email=flyd@example.test", "commit", "-m", "base"]);
  const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
  return { root, head: stdout.trim() };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("GitWorktreeManager", () => {
  it("creates an isolated assignment branch from the recorded base", async () => {
    const repo = await repository();
    const managedRoot = await mkdtemp(join(tmpdir(), "flyd-managed-test-"));
    roots.push(managedRoot);
    const manager = new GitWorktreeManager({ managedRoot });

    const worktree = await manager.prepare({
      repositoryRoot: repo.root,
      taskKey: "task-12345678",
      assignmentKey: "assignment-12345678",
      baseHead: repo.head,
    });
    await writeFile(join(worktree.path, "README.md"), "worker edit\n");

    expect(worktree.path.startsWith(managedRoot)).toBe(true);
    expect(worktree.branchName).toMatch(/^flyd\/task-123\/assignme-[a-f0-9]{8}$/);
    expect(await readFile(join(repo.root, "README.md"), "utf8")).toBe("base\n");
    expect((await stat(join(worktree.path, ".git"))).isDirectory()).toBe(true);
    await expect(execFileAsync("git", ["-C", worktree.path, "rev-parse", "HEAD"], { encoding: "utf8" }))
      .resolves.toMatchObject({ stdout: `${repo.head}\n` });
  });

  it("refuses to reuse an unrelated directory at the managed path", async () => {
    const repo = await repository();
    const managedRoot = await mkdtemp(join(tmpdir(), "flyd-managed-test-"));
    roots.push(managedRoot);
    const manager = new GitWorktreeManager({ managedRoot });
    const path = manager.pathFor("task-12345678", "assignment-12345678");
    await import("fs/promises").then(({ mkdir }) => mkdir(path, { recursive: true }));
    await writeFile(join(path, "unrelated.txt"), "not a worktree");

    await expect(manager.prepare({
      repositoryRoot: repo.root,
      taskKey: "task-12345678",
      assignmentKey: "assignment-12345678",
      baseHead: repo.head,
    })).rejects.toThrow("unrelated directory");
  });

  it("refuses to reuse an assignment clone from a different recorded base", async () => {
    const repo = await repository();
    const managedRoot = await mkdtemp(join(tmpdir(), "flyd-managed-test-"));
    roots.push(managedRoot);
    const manager = new GitWorktreeManager({ managedRoot });
    const input = {
      repositoryRoot: repo.root,
      taskKey: "task-12345678",
      assignmentKey: "assignment-12345678",
      baseHead: repo.head,
    };
    await manager.prepare(input);
    await writeFile(join(repo.root, "README.md"), "new main\n");
    await execFileAsync("git", ["-C", repo.root, "add", "README.md"]);
    await execFileAsync("git", ["-C", repo.root, "-c", "user.name=Flyd Test", "-c", "user.email=flyd@example.test", "commit", "-m", "new main"]);
    const { stdout } = await execFileAsync("git", ["-C", repo.root, "rev-parse", "HEAD"], { encoding: "utf8" });

    await expect(manager.prepare({ ...input, baseHead: stdout.trim() }))
      .rejects.toThrow("unrelated directory");
  });
});
