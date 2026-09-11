import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addRepository } from "../work/repository-registry.js";
import { observeAndRecord } from "../work/git-observer.js";
import { closeDb, resetWorkIndexPath, useWorkIndexPath } from "../work/database.js";

describe("Git observer side effects", () => {
  let dbDir: string;
  let repoDir: string;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "flyd-observer-db-"));
    repoDir = mkdtempSync(join(tmpdir(), "flyd-observer-repo-"));
    useWorkIndexPath(join(dbDir, "work-index.sqlite"));

    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
    writeFileSync(join(repoDir, "README.md"), "initial\n");
    writeFileSync(join(repoDir, "PROJECT.md"), "# Project\n\n## Current objective\nUser-owned objective\n");
    execFileSync("git", ["add", "README.md", "PROJECT.md"], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: repoDir });
  });

  afterEach(() => {
    closeDb();
    resetWorkIndexPath();
    rmSync(dbDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("records new Git activity without mutating PROJECT.md", () => {
    const repo = addRepository(repoDir);
    observeAndRecord(repo.id);

    const before = readFileSync(join(repoDir, "PROJECT.md"), "utf8");
    writeFileSync(join(repoDir, "README.md"), "changed\n");
    execFileSync("git", ["add", "README.md"], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "Implement change"], { cwd: repoDir });

    observeAndRecord(repo.id);

    expect(readFileSync(join(repoDir, "PROJECT.md"), "utf8")).toBe(before);
  });
});
