import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { closeDb, resetWorkIndexPath, useWorkIndexPath } from "../work/database.js";
import {
  defaultGitRead,
  observeAllRepos,
  RepositoryReadStalledError,
  repositoryReadsAreStalled,
  stalledSkippedRepositoryNames,
  type GitRead,
} from "../work/git-observer.js";
import * as gitObserver from "../work/git-observer.js";
import { addRepository, buildGlobalPresentModel, listRepositories } from "../work/repository-registry.js";
import { answerQuestion } from "../work/recall-router.js";

function initRepo(dir: string): void {
  execSync("git init -b main", { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "hello\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -m "Initial commit"', { cwd: dir });
}

describe("bounded repository reads on the observation sweep", () => {
  let dbDir: string;
  let repoA: string;
  let repoB: string;
  let repoC: string;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "flyd-bounded-db-"));
    repoA = mkdtempSync(join(tmpdir(), "flyd-a-repo-"));
    repoB = mkdtempSync(join(tmpdir(), "flyd-b-repo-"));
    repoC = mkdtempSync(join(tmpdir(), "flyd-c-repo-"));
    useWorkIndexPath(join(dbDir, "work-index.sqlite"));
    initRepo(repoA);
    initRepo(repoB);
    initRepo(repoC);
    addRepository(repoA);
    addRepository(repoB);
    addRepository(repoC);
  });

  afterEach(() => {
    closeDb();
    resetWorkIndexPath();
    rmSync(dbDir, { recursive: true, force: true });
    rmSync(repoA, { recursive: true, force: true });
    rmSync(repoB, { recursive: true, force: true });
    rmSync(repoC, { recursive: true, force: true });
  });

  it("a stalled repository does not block the answer and does not make other repositories pay the stall", () => {
    const [storedA] = listRepositories().filter((r) => r.root === repoA);
    const attempted: string[] = [];
    const read: GitRead = (args, cwd) => {
      attempted.push(cwd);
      if (cwd === storedA.root) throw new RepositoryReadStalledError(args, cwd);
      return defaultGitRead(args, cwd);
    };

    const results = observeAllRepos(read);

    // The sweep survives the stall instead of throwing.
    expect(repositoryReadsAreStalled()).toBe(true);
    // Repositories after the stalled one are not read at all.
    expect(attempted).not.toContain(repoB);
    expect(attempted).not.toContain(repoC);
    expect(results).toEqual([]);

    // The answer is still served from the cached model, never blocked by git.
    const model = buildGlobalPresentModel();
    expect(model.activeProjects).toHaveLength(3);
    expect(model.activeProjects.every((p) => p.dirty === false)).toBe(true);
  });

  it("the ordinary status answer is served from cached observations without a fresh per-repository observation", () => {
    const [stored] = listRepositories().filter((r) => r.root === repoA);
    observeAllRepos();
    const cachedHead = buildGlobalPresentModel().activeProjects.find((p) => p.repositoryId === stored.id)?.head;

    writeFileSync(join(repoA, "README.md"), "hello\nsecond\n");
    writeFileSync(join(repoA, "untracked.txt"), "dirty\n");
    execSync("git add README.md", { cwd: repoA });
    execSync("git commit -m 'Second commit'", { cwd: repoA });

    const spy = vi.spyOn(gitObserver, "observeAllRepos");
    const result = answerQuestion(`status of ${stored.name}`);

    expect(spy).not.toHaveBeenCalled();
    const project = result.data.projects?.find((p) => p.repositoryId === stored.id);
    expect(project?.head).toBe(cachedHead);
    expect(project?.dirty).toBe(false);
    expect(result.answer).toContain("Dirty: no");
    expect(result.answer).not.toContain("may be stale");
  });

  it("repositories skipped by a stalled sweep are marked possibly stale, not fresh", () => {
    const [storedA] = listRepositories().filter((r) => r.root === repoA);
    const [storedB] = listRepositories().filter((r) => r.root === repoB);
    const [storedC] = listRepositories().filter((r) => r.root === repoC);

    observeAllRepos();
    expect(buildGlobalPresentModel().gaps.filter((g) => g.startsWith("stale_observation:"))).toEqual([]);

    const read: GitRead = (args, cwd) => {
      if (cwd === storedA.root) throw new RepositoryReadStalledError(args, cwd);
      return defaultGitRead(args, cwd);
    };
    observeAllRepos(read);

    expect(repositoryReadsAreStalled()).toBe(true);
    expect(stalledSkippedRepositoryNames()).toEqual([storedB.name, storedC.name]);

    const result = answerQuestion(`status of ${storedB.name}`);

    expect(result.answer).toContain("possibly stale");
    expect(result.answer).toContain(storedB.name);
    const project = result.data.projects?.find((p) => p.repositoryId === storedB.id);
    expect(project?.dirty).toBe(false);
  });
});