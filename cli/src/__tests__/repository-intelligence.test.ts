import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectRepositoryFromPath } from "../work/repository-intelligence.js";

const cleanup: string[] = [];

function makeRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "flyd-repo-intelligence-"));
  cleanup.push(root);
  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  writeFileSync(join(root, "README.md"), "hello\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: root });
  return root;
}

afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Repository Intelligence", () => {
  it("resolves repository reality from a document path", () => {
    const root = makeRepository();
    const nested = join(root, "src");
    mkdirSync(nested);
    const documentPath = join(nested, "example.ts");
    writeFileSync(documentPath, "export const value = 1;\n");

    const snapshot = inspectRepositoryFromPath(documentPath);

    expect(snapshot).toBeDefined();
    expect(snapshot?.root).toBe(root);
    expect(snapshot?.branch).toBe("main");
    expect(snapshot?.headDigest).toMatch(/^[0-9a-f]{40}$/);
    expect(snapshot?.isDirty).toBe(true);
    expect(snapshot?.changedFiles).toContain("src/example.ts");
    expect(snapshot?.recentCommits?.[0]).toContain("Initial commit");
    expect(snapshot?.statusDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports a clean repository without inventing changed files", () => {
    const root = makeRepository();

    const snapshot = inspectRepositoryFromPath(root);

    expect(snapshot?.isDirty).toBe(false);
    expect(snapshot?.changedFiles).toBeUndefined();
  });

  it("returns undefined outside a Git repository", () => {
    const root = mkdtempSync(join(tmpdir(), "flyd-not-a-repo-"));
    cleanup.push(root);

    expect(inspectRepositoryFromPath(join(root, "note.txt"))).toBeUndefined();
  });
});
