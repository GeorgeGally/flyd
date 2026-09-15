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
import { buildPresentModelBelief, readPresentModel } from "../work/work-hypothesis/index.js";
import type { CandidateRepoInput } from "../work/work-hypothesis/types.js";

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
    observeAllRepos();
    expect(buildGlobalPresentModel().gaps.filter((g) => g.startsWith("stale_observation:"))).toEqual([]);

    // Read the sweep's own ordering after observations are settled, so the
    // stall lands on the first repo and the skipped set is deterministic.
    const [stalled] = listRepositories();
    const skipped = listRepositories().slice(1).map((r) => r.name);

    const read: GitRead = (args, cwd) => {
      if (cwd === stalled.root) throw new RepositoryReadStalledError(args, cwd);
      return defaultGitRead(args, cwd);
    };
    observeAllRepos(read);

    expect(repositoryReadsAreStalled()).toBe(true);
    expect([...stalledSkippedRepositoryNames()].sort()).toEqual(skipped.sort());

    const result = answerQuestion(`status of ${stalled.name}`);

    expect(result.answer).toContain("possibly stale");
    const project = result.data.projects?.find((p) => p.repositoryId === stalled.id);
    expect(project?.dirty).toBe(false);
  });

  it("a stalled sweep does not overwrite the persisted belief with a degraded rebuild", async () => {
    observeAllRepos();
    expect(repositoryReadsAreStalled()).toBe(false);

    const now = new Date("2026-09-15T00:00:00.000Z");
    const repos: CandidateRepoInput[] = [
      { id: "alpha", name: "alpha", root: "/Users/george/Documents/alpha", lastCommitAt: "2026-09-14T00:00:00.000Z", isDirty: false, hasTasks: false, isForeground: false },
      { id: "beta", name: "beta", root: "/Users/george/Documents/beta", lastCommitAt: "2026-09-14T00:00:00.000Z", isDirty: false, hasTasks: false, isForeground: false },
      { id: "gamma", name: "gamma", root: "/Users/george/Documents/gamma", lastCommitAt: "2026-09-14T00:00:00.000Z", isDirty: false, hasTasks: false, isForeground: false },
    ];

    const grounded = await buildPresentModelBelief({ repos, now, coreCwd: "/Users/george/Documents/alpha" });
    expect(grounded.primaryThreads.length).toBeGreaterThan(0);
    const before = readPresentModel();
    expect(before?.revisedAt).toBe(grounded.revisedAt);

    const [storedA] = listRepositories().filter((r) => r.root === repoA);
    const read: GitRead = (args, cwd) => {
      if (cwd === storedA.root) throw new RepositoryReadStalledError(args, cwd);
      return defaultGitRead(args, cwd);
    };
    observeAllRepos(read);
    expect(repositoryReadsAreStalled()).toBe(true);

    // Changed evidence at a later time: one repo drops out of the admit
    // window, so a fresh rebuild would produce a different belief.
    const later = new Date("2026-09-15T12:00:00.000Z");
    const attempted = await buildPresentModelBelief({
      repos: repos.map((r) =>
        r.id === "alpha"
          ? { ...r, lastCommitAt: "2026-08-01T00:00:00.000Z" }
          : { ...r, lastCommitAt: "2026-09-14T00:00:00.000Z" },
      ),
      now: later,
      coreCwd: "/Users/george/Documents/alpha",
    });

    const after = readPresentModel();
    expect(after?.id).toBe(before?.id);
    expect(after?.revisedAt).toBe(before?.revisedAt);
    expect(after?.primaryThreads.length).toBe(before?.primaryThreads.length);
    expect(after?.fromCache).toBe(false);
    expect(attempted.revisedAt).toBe(before?.revisedAt);
    expect(attempted.id).toBe(before?.id);
  });

  it("a slow-but-healthy repository does not freeze the belief: clean reads still update it while stalled and skipped repos keep their previous observation", async () => {
    observeAllRepos();
    expect(repositoryReadsAreStalled()).toBe(false);

    const t0 = "2026-09-14T00:00:00.000Z";
    const groundedAt = new Date("2026-09-14T12:00:00.000Z");
    const later = new Date("2026-09-15T12:00:00.000Z");
    const otherCwd = "/Users/george/Documents/other";

    const grounded: CandidateRepoInput[] = [
      { id: "alpha", name: "alpha", root: "/Users/george/Documents/alpha", lastCommitAt: t0, latestSubject: "Alpha grounded", observedAt: t0, isDirty: false, hasTasks: false, isForeground: false },
      { id: "beta", name: "beta", root: "/Users/george/Documents/beta", lastCommitAt: t0, latestSubject: "Beta grounded", observedAt: t0, isDirty: false, hasTasks: false, isForeground: false },
      { id: "gamma", name: "gamma", root: "/Users/george/Documents/gamma", lastCommitAt: t0, latestSubject: "Gamma grounded", observedAt: t0, isDirty: false, hasTasks: false, isForeground: false },
    ];
    await buildPresentModelBelief({ repos: grounded, now: groundedAt, coreCwd: otherCwd });
    const before = readPresentModel();
    expect(before?.revisedAt).toBe(groundedAt.toISOString());

    // A sweep stalls on the slow-but-healthy repository: alpha read cleanly,
    // beta stalled, gamma was skipped.
    const [stalledRepo] = listRepositories();
    const read: GitRead = (args, cwd) => {
      if (cwd === stalledRepo.root) throw new RepositoryReadStalledError(args, cwd);
      return defaultGitRead(args, cwd);
    };
    observeAllRepos(read);
    expect(repositoryReadsAreStalled()).toBe(true);

    const swept: CandidateRepoInput[] = [
      { ...grounded[0], lastCommitAt: "2026-09-15T08:00:00.000Z", latestSubject: "Alpha new work", observedAt: later.toISOString() },
      { ...grounded[1], latestSubject: undefined },
      { ...grounded[2], latestSubject: undefined },
    ];

    const updated = await buildPresentModelBelief({ repos: swept, now: later, coreCwd: otherCwd });
    const after = readPresentModel();

    // The belief is not frozen: it was rewritten from the clean read.
    expect(after?.id).toBe(before?.id);
    expect(after?.revisedAt).toBe(later.toISOString());
    expect(updated.revisedAt).toBe(later.toISOString());

    const threads = [...(after?.primaryThreads ?? []), ...(after?.secondaryThreads ?? [])];
    const alpha = threads.find((t) => t.repositoryId === "alpha");
    const beta = threads.find((t) => t.repositoryId === "beta");
    const gamma = threads.find((t) => t.repositoryId === "gamma");

    expect(alpha?.lastCommitAt).toBe("2026-09-15T08:00:00.000Z");
    expect(alpha?.latestSubject).toBe("Alpha new work");
    expect(alpha?.observedAt).toBe(later.toISOString());

    // Slow and skipped repositories keep their previous fully-grounded values
    // and their previous per-observation revision time.
    expect(beta?.lastCommitAt).toBe(t0);
    expect(beta?.latestSubject).toBe("Beta grounded");
    expect(beta?.observedAt).toBe(t0);
    expect(gamma?.lastCommitAt).toBe(t0);
    expect(gamma?.latestSubject).toBe("Gamma grounded");
    expect(gamma?.observedAt).toBe(t0);

    // The skipped repository stays labelled possibly out of date through the
    // existing staleness-note channel.
    const note = answerQuestion(`status of ${stalledRepo.name}`);
    expect(note.answer).toContain("possibly stale");
  });

  it("a stalled first sweep does not flag never-observed repositories as possibly stale", () => {
    expect(buildGlobalPresentModel().gaps).toEqual([]);

    const [stalled] = listRepositories();
    const read: GitRead = (args, cwd) => {
      if (cwd === stalled.root) throw new RepositoryReadStalledError(args, cwd);
      return defaultGitRead(args, cwd);
    };
    observeAllRepos(read);

    expect(repositoryReadsAreStalled()).toBe(true);
    expect(stalledSkippedRepositoryNames()).toEqual([]);

    const result = answerQuestion(`status of ${stalled.name}`);
    expect(result.answer).toContain("a repository read stalled");
    expect(result.answer).not.toContain("possibly stale");
  });

  it("task-store recall answers never carry a repository staleness note", () => {
    observeAllRepos();
    expect(repositoryReadsAreStalled()).toBe(false);

    const [stalled] = listRepositories();
    const skipped = listRepositories().slice(1).map((r) => r.name);
    const read: GitRead = (args, cwd) => {
      if (cwd === stalled.root) throw new RepositoryReadStalledError(args, cwd);
      return defaultGitRead(args, cwd);
    };
    observeAllRepos(read);

    expect(repositoryReadsAreStalled()).toBe(true);
    expect([...stalledSkippedRepositoryNames()].sort()).toEqual(skipped.sort());

    const status = answerQuestion(`status of ${stalled.name}`);
    expect(status.answer).toContain("may be stale");

    const tasks = answerQuestion("open tasks");
    expect(tasks.answer).toContain("No open tasks.");
    expect(tasks.answer).not.toContain("may be stale");
  });
});
