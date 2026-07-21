import { execFile } from "child_process";
import { mkdtemp, rm, symlink, writeFile } from "fs/promises";
import { homedir, tmpdir } from "os";
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

  it("fails a review result that modified the repository", async () => {
    const repo = await repository();
    await writeFile(join(repo.root, "one.txt"), "review changed this\n");

    const result = await verifyWorkerResult({
      worktreePath: repo.root,
      baseHead: repo.head,
      commands: ["git diff --check"],
      requireUnchanged: true,
    });

    expect(result.passed).toBe(false);
    expect(result.changedFiles).toEqual(["one.txt"]);
  });

  it("rejects shell operators instead of interpreting an unstructured command", async () => {
    const repo = await repository();

    await expect(verifyWorkerResult({
      worktreePath: repo.root,
      baseHead: repo.head,
      commands: ["npm test; rm -rf /"],
    })).rejects.toThrow("unsupported shell operator");
  });

  it("denies unrelated home reads and writes outside the verification worktree", async () => {
    const repo = await repository();
    const outside = await mkdtemp(join(homedir(), ".flyd-verifier-outside-"));
    roots.push(outside);
    const outsideTemp = await mkdtemp(join(tmpdir(), "flyd-verifier-outside-temp-"));
    roots.push(outsideTemp);
    const secret = join(outside, "secret.txt");
    const attemptedWrite = join(outside, "written.txt");
    const attemptedTempWrite = join(outsideTemp, "written.txt");
    const temporarySecret = join(outsideTemp, "secret.txt");
    await writeFile(secret, "must-not-be-readable\n");
    await writeFile(temporarySecret, "temporary-secret\n");

    const result = await verifyWorkerResult({
      worktreePath: repo.root,
      baseHead: repo.head,
      commands: [
        `/bin/cat ${secret}`,
        `/bin/cat ${temporarySecret}`,
        `/usr/bin/touch ${attemptedWrite}`,
        `/usr/bin/touch ${attemptedTempWrite}`,
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.commands.map((command) => command.exitStatus)).toEqual([1, 1, 1, 1]);
    expect(result.commands[0].stdout).not.toContain("must-not-be-readable");
    expect(result.commands[1].stdout).not.toContain("temporary-secret");
  });

  it("rejects a worktree symlink that resolves outside the verification root", async () => {
    const repo = await repository();
    const outside = await mkdtemp(join(tmpdir(), "flyd-verifier-symlink-target-"));
    roots.push(outside);
    const secret = join(outside, "secret.txt");
    await writeFile(secret, "outside\n");
    await symlink(secret, join(repo.root, "escaped-secret"));

    await expect(verifyWorkerResult({
      worktreePath: repo.root,
      baseHead: repo.head,
      commands: ["git diff --check"],
    })).rejects.toThrow("escaping symlink");
  });

  it("removes inherited secrets and denies verifier network access", async () => {
    const repo = await repository();
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "must-not-reach-verification";
    try {
      const result = await verifyWorkerResult({
        worktreePath: repo.root,
        baseHead: repo.head,
        commandTimeoutMs: 5_000,
        commands: ["/usr/bin/env", "/usr/bin/curl --max-time 2 https://example.com"],
      });

      expect(result.commands[0].exitStatus).toBe(0);
      expect(result.commands[0].stdout).not.toContain("OPENAI_API_KEY");
      expect(result.commands[0].stdout).not.toContain("must-not-reach-verification");
      expect(result.commands[1].exitStatus).not.toBe(0);
    } finally {
      if (previous == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });
});
