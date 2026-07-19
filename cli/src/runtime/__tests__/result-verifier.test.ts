import { execFile } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, describe, expect, it } from "vitest";
import { filesOutsideScope, verifyWorkerResult } from "../result-verifier.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function repository(): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), "flyd-verify-test-"));
  roots.push(root);
  await execFileAsync("git", ["init", "-b", "main", root]);
  await writeFile(join(root, "one.txt"), "base\n");
  await execFileAsync("git", ["-C", root, "add", "one.txt"]);
  await execFileAsync("git", ["-C", root, "-c", "user.name=Flyd Test", "-c", "user.email=flyd@example.test", "commit", "-m", "base"]);
  const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
  return { root, head: stdout.trim() };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("verifyWorkerResult", () => {
  it("identifies changed files outside the assignment's declared repository scope", () => {
    expect(filesOutsideScope(
      ["app/models/task.rb", "test/models/task_test.rb", "README.md"],
      ["app", "test/models/task_test.rb"],
    )).toEqual(["README.md"]);
    expect(filesOutsideScope(["anything.txt"], ["."])).toEqual([]);
  });

  it("records repository evidence and passing commands independently of worker text", async () => {
    const repo = await repository();
    await writeFile(join(repo.root, "one.txt"), "implemented\n");
    await writeFile(join(repo.root, "new.txt"), "new file\n");

    const result = await verifyWorkerResult({
      worktreePath: repo.root,
      baseHead: repo.head,
      commands: ["git diff --check", "node -e \"process.exit(0)\""],
    });

    expect(result.passed).toBe(true);
    expect(result.changedFiles).toEqual(["new.txt", "one.txt"]);
    expect(result.patch).toContain("implemented");
    expect(result.patchDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.commands.every((command) => command.exitStatus === 0)).toBe(true);
  });

  it("fails verification when a command fails even if a worker claimed success", async () => {
    const repo = await repository();
    await writeFile(join(repo.root, "one.txt"), "claimed success\n");

    const result = await verifyWorkerResult({
      worktreePath: repo.root,
      baseHead: repo.head,
      commands: ["node -e \"process.exit(7)\""],
    });

    expect(result.passed).toBe(false);
    expect(result.commands[0].exitStatus).toBe(7);
  });

  it("fails an implementation result that changed no files", async () => {
    const repo = await repository();

    const result = await verifyWorkerResult({
      worktreePath: repo.root,
      baseHead: repo.head,
      commands: ["git diff --check"],
      requireChanges: true,
    });

    expect(result.passed).toBe(false);
    expect(result.changedFiles).toEqual([]);
  });

  it("rejects shell operators instead of interpreting an unstructured command", async () => {
    const repo = await repository();

    await expect(verifyWorkerResult({
      worktreePath: repo.root,
      baseHead: repo.head,
      commands: ["npm test; rm -rf /"],
    })).rejects.toThrow("unsupported shell operator");
  });
});
