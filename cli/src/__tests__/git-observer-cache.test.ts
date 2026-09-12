import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { closeDb, getDb, resetWorkIndexPath, useWorkIndexPath } from "../work/database.js";
import { computeFingerprint, observeAllRepos } from "../work/git-observer.js";
import { addRepository, listRepositories } from "../work/repository-registry.js";

describe("Git observer cached repository state", () => {
  let dbDir: string;
  let repoDir: string;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "flyd-observer-db-"));
    repoDir = mkdtempSync(join(tmpdir(), "flyd-observer-repo-"));
    useWorkIndexPath(join(dbDir, "work-index.sqlite"));

    execSync("git init -b main", { cwd: repoDir });
    execSync('git config user.email "test@example.com"', { cwd: repoDir });
    execSync('git config user.name "Test"', { cwd: repoDir });
    writeFileSync(join(repoDir, "README.md"), "hello\n");
    execSync("git add README.md", { cwd: repoDir });
    execSync('git commit -m "Initial commit"', { cwd: repoDir });
    addRepository(repoDir);
  });

  afterEach(() => {
    closeDb();
    resetWorkIndexPath();
    rmSync(dbDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("stores a repository fingerprint separately from HEAD", () => {
    const [snapshot] = observeAllRepos();
    const [stored] = listRepositories();

    expect(stored.lastSeenHead).toBe(snapshot.head);
    expect(stored.lastObservationFingerprint).toBe(computeFingerprint(repoDir));
    expect(stored.lastObservationFingerprint).not.toBe(stored.lastSeenHead);
    expect(stored.observedBranch).toBe("main");
    expect(stored.observedDirty).toBe(false);
    expect(stored.observedUncommittedFiles).toBe(0);
  });

  it("preserves cached dirty state when the fingerprint is unchanged", () => {
    observeAllRepos();

    writeFileSync(join(repoDir, "untracked.txt"), "dirty\n");
    const [changed] = observeAllRepos();
    expect(changed.dirty).toBe(true);
    expect(changed.uncommittedFiles).toBe(1);

    const fingerprintAfterChange = computeFingerprint(repoDir);
    const storedAfterChange = listRepositories()[0];
    expect(storedAfterChange.lastObservationFingerprint).toBe(fingerprintAfterChange);
    expect(storedAfterChange.observedDirty).toBe(true);
    expect(storedAfterChange.observedUncommittedFiles).toBe(1);

    const [cached] = observeAllRepos();
    expect(cached.dirty).toBe(true);
    expect(cached.uncommittedFiles).toBe(1);
    expect(cached.head).toBe(storedAfterChange.lastSeenHead);
    expect(cached.branch).toBe("main");
  });

  it("refreshes observedAt when an unchanged fingerprint is re-verified", () => {
    observeAllRepos();
    const before = listRepositories()[0];
    const staleAt = "2026-01-01T00:00:00.000Z";
    getDb().prepare("UPDATE repositories SET observed_at = ? WHERE id = ?").run(staleAt, before.id);

    const [cached] = observeAllRepos();
    const after = listRepositories()[0];

    expect(cached.head).toBe(before.lastSeenHead);
    expect(cached.branch).toBe(before.observedBranch);
    expect(after.observedAt).toBeDefined();
    expect(after.observedAt).not.toBe(staleAt);
    expect(after.lastActivityAt).toBe(before.lastActivityAt);
    expect(after.lastObservationFingerprint).toBe(before.lastObservationFingerprint);
  });
});
