import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
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
import * as repositoryIntelligence from "../work/repository-intelligence.js";
import { addRepository, buildGlobalPresentModel, listRepositories } from "../work/repository-registry.js";
import { answerQuestion } from "../work/recall-router.js";
import { buildPresentModelBelief, readPresentModel } from "../work/work-hypothesis/index.js";
import type { CandidateRepoInput } from "../work/work-hypothesis/types.js";

function initRepo(dir: string, commitDate?: string): void {
  execSync("git init -b main", { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "hello\n");
  execSync("git add README.md", { cwd: dir });
  if (commitDate) {
    execSync('git commit -m "Initial commit"', {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_DATE: commitDate, GIT_COMMITTER_DATE: commitDate },
    });
  } else {
    execSync('git commit -m "Initial commit"', { cwd: dir });
  }
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

  it("production path: clean reads still update the belief when a sweep stalls, while stalled and skipped repositories keep their previous observation", async () => {
    const coreCwd = "/Users/george/Documents/core";
    const groundedAt = new Date(Date.now() - 60_000);

    // Repos under tmpdir() are ephemeral and purged by loadLiveRepos, so the
    // production path needs repos inside the worktree. Discovery is pointed at
    // an empty dir so no machine repos leak into the test DB.
    const workRoot = join(process.cwd(), `.flyd-test-repos-${Date.now()}`);
    const emptyDiscovery = join(workRoot, "empty-discovery");
    const previousRoots = process.env.FLYD_WORK_ROOTS;
    process.env.FLYD_WORK_ROOTS = emptyDiscovery;

    try {
      const reposRoot = join(workRoot, "workspace");
      mkdirSync(reposRoot, { recursive: true });
      const names = ["alpha", "beta", "gamma"];
      for (const name of names) {
        const root = join(reposRoot, name);
        mkdirSync(root, { recursive: true });
        initRepo(root);
        addRepository(root, name);
      }

      const grounded = await buildPresentModelBelief({ now: groundedAt, coreCwd });
      expect(grounded.revisedAt).toBe(groundedAt.toISOString());
      const before = readPresentModel();
      expect(before).not.toBeNull();
      expect([...before!.primaryThreads, ...before!.secondaryThreads]).toHaveLength(3);

      // The sweep iterates listRepositories(), which orders by last activity
      // then name. Stalling the second repo leaves the first observed cleanly
      // and the third skipped, so the first repo is where the new evidence
      // must land for the rebuilt belief to be observably different.
      const [clean, stalled, skipped] = listRepositories().map((r) => ({ root: r.root, id: r.id, name: r.name }));

      writeFileSync(join(clean.root, "second.txt"), "second\n");
      execSync("git add second.txt", { cwd: clean.root });
      execSync('git commit -m "Second commit"', { cwd: clean.root });

      const read: GitRead = (args, cwd) => {
        if (cwd === stalled.root) throw new RepositoryReadStalledError(args, cwd);
        return defaultGitRead(args, cwd);
      };
      const sweepSpy = vi
        .spyOn(repositoryIntelligence, "observeKnownRepositories")
        .mockImplementation(() => observeAllRepos(read));

      const later = new Date();
      const updated = await buildPresentModelBelief({ now: later, coreCwd });
      sweepSpy.mockRestore();

      expect(repositoryReadsAreStalled()).toBe(true);
      const after = readPresentModel();

      // The belief was rewritten from the clean read, not frozen by the stall.
      expect(updated.revisedAt).toBe(later.toISOString());
      expect(after?.revisedAt).toBe(later.toISOString());

      const threads = [...(after?.primaryThreads ?? []), ...(after?.secondaryThreads ?? [])];
      const priorThreads = [...(before?.primaryThreads ?? []), ...(before?.secondaryThreads ?? [])];
      const cleanThread = threads.find((t) => t.repositoryId === clean.id);
      const stalledThread = threads.find((t) => t.repositoryId === stalled.id);
      const skippedThread = threads.find((t) => t.repositoryId === skipped.id);
      const priorClean = priorThreads.find((t) => t.repositoryId === clean.id);
      const priorStalled = priorThreads.find((t) => t.repositoryId === stalled.id);
      const priorSkipped = priorThreads.find((t) => t.repositoryId === skipped.id);

      // The cleanly-read repository carries this sweep's observation time and
      // the new commit evidence.
      expect(cleanThread?.observedAt).toBe(later.toISOString());
      expect(cleanThread?.lastCommitAt).not.toBe(priorClean?.lastCommitAt);

      // The stalled commit read never produced the new subject, so the
      // cleanly-read repository keeps the commit subject it already held.
      expect(cleanThread?.latestSubject).toBe(priorClean?.latestSubject);

      // Slow and skipped repositories keep their previous fully-grounded values
      // and their previous per-observation revision time.
      expect(stalledThread?.observedAt).toBe(groundedAt.toISOString());
      expect(stalledThread?.lastCommitAt).toBe(priorStalled?.lastCommitAt);
      expect(stalledThread?.latestSubject).toBe(priorStalled?.latestSubject);
      expect(skippedThread?.observedAt).toBe(groundedAt.toISOString());
      expect(skippedThread?.lastCommitAt).toBe(priorSkipped?.lastCommitAt);

      // The skipped repository stays labelled possibly out of date through the
      // existing staleness-note channel, while the cleanly-read one does not.
      const note = answerQuestion(`status of ${skipped.name}`);
      expect(note.answer).toContain("possibly stale");
      expect(note.answer).not.toContain(clean.name);
    } finally {
      if (previousRoots === undefined) delete process.env.FLYD_WORK_ROOTS;
      else process.env.FLYD_WORK_ROOTS = previousRoots;
      rmSync(workRoot, { recursive: true, force: true });
    }
  });

  it("production path: worktrees of one repository dedupe and keep prior subjects when a sweep stalls", async () => {
    const coreCwd = "/Users/george/Documents/core";
    const groundedAt = new Date(Date.now() - 60_000);

    const workRoot = join(process.cwd(), `.flyd-test-repos-${Date.now()}`);
    const emptyDiscovery = join(workRoot, "empty-discovery");
    const previousRoots = process.env.FLYD_WORK_ROOTS;
    process.env.FLYD_WORK_ROOTS = emptyDiscovery;

    try {
      const reposRoot = join(workRoot, "workspace");
      mkdirSync(reposRoot, { recursive: true });

      const wedgedRoot = join(reposRoot, "wedged");
      mkdirSync(wedgedRoot, { recursive: true });
      initRepo(wedgedRoot, "2020-01-01T00:00:00Z");
      addRepository(wedgedRoot, "wedged");

      const xMain = join(reposRoot, "x");
      mkdirSync(xMain, { recursive: true });
      initRepo(xMain);
      addRepository(xMain, "x");
      const xWorktree = join(reposRoot, "x-wt");
      execSync(`git worktree add ${xWorktree}`, { cwd: xMain });
      addRepository(xWorktree, "x");

      const grounded = await buildPresentModelBelief({ now: groundedAt, coreCwd });
      expect(grounded.revisedAt).toBe(groundedAt.toISOString());
      const before = readPresentModel();
      expect(before).not.toBeNull();
      expect([...before!.primaryThreads, ...before!.secondaryThreads]).toHaveLength(1);

      const ordered = listRepositories();
      expect(ordered).toHaveLength(3);
      expect(ordered[2].root).toBe(wedgedRoot);
      const worktreeRoots = new Set([xMain, xWorktree]);
      expect(worktreeRoots.has(ordered[0].root)).toBe(true);
      expect(worktreeRoots.has(ordered[1].root)).toBe(true);
      const cleanWorktree = ordered[0];

      writeFileSync(join(cleanWorktree.root, "second.txt"), "second\n");
      execSync("git add second.txt", { cwd: cleanWorktree.root });
      execSync('git commit -m "Second commit"', { cwd: cleanWorktree.root });

      const read: GitRead = (args, cwd) => {
        if (cwd === wedgedRoot) throw new RepositoryReadStalledError(args, cwd);
        return defaultGitRead(args, cwd);
      };
      const sweepSpy = vi
        .spyOn(repositoryIntelligence, "observeKnownRepositories")
        .mockImplementation(() => observeAllRepos(read));

      const later = new Date();
      const updated = await buildPresentModelBelief({ now: later, coreCwd });
      sweepSpy.mockRestore();

      expect(repositoryReadsAreStalled()).toBe(true);
      const after = readPresentModel();
      expect(updated.revisedAt).toBe(later.toISOString());
      expect(after?.revisedAt).toBe(later.toISOString());

      const threads = [...(after?.primaryThreads ?? []), ...(after?.secondaryThreads ?? [])];
      const priorX = [...(before?.primaryThreads ?? []), ...(before?.secondaryThreads ?? [])].find(
        (t) => t.name === "X",
      );

      expect(threads).toHaveLength(1);
      expect(threads[0].name).toBe("X");
      expect(threads[0].latestSubject).toBe(priorX?.latestSubject);
    } finally {
      if (previousRoots === undefined) delete process.env.FLYD_WORK_ROOTS;
      else process.env.FLYD_WORK_ROOTS = previousRoots;
      rmSync(workRoot, { recursive: true, force: true });
    }
  });

  it("production path: worktrees after a mid-order stalled sweep stay one project with prior subjects", async () => {
    const coreCwd = "/Users/george/Documents/core";
    const groundedAt = new Date(Date.now() - 60_000);

    const workRoot = join(process.cwd(), `.flyd-test-repos-${Date.now()}`);
    const emptyDiscovery = join(workRoot, "empty-discovery");
    const previousRoots = process.env.FLYD_WORK_ROOTS;
    process.env.FLYD_WORK_ROOTS = emptyDiscovery;

    try {
      const reposRoot = join(workRoot, "workspace");
      mkdirSync(reposRoot, { recursive: true });

      // listRepositories() orders by last_activity_at DESC, which comes from
      // commit author dates here, so the wedged repo lands BETWEEN a
      // cleanly-observed lead repo and both worktrees of X.
      const leadRoot = join(reposRoot, "lead");
      mkdirSync(leadRoot, { recursive: true });
      initRepo(leadRoot, new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
      addRepository(leadRoot, "lead");

      const wedgedRoot = join(reposRoot, "wedged");
      mkdirSync(wedgedRoot, { recursive: true });
      initRepo(wedgedRoot, new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString());
      addRepository(wedgedRoot, "wedged");

      const xMain = join(reposRoot, "x");
      mkdirSync(xMain, { recursive: true });
      initRepo(xMain, new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString());
      addRepository(xMain, "x");
      const xWorktree = join(reposRoot, "x-wt");
      execSync(`git worktree add ${xWorktree}`, { cwd: xMain });
      addRepository(xWorktree, "x");

      const grounded = await buildPresentModelBelief({ now: groundedAt, coreCwd });
      expect(grounded.revisedAt).toBe(groundedAt.toISOString());
      const before = readPresentModel();
      expect(before).not.toBeNull();
      const priorX = [...(before?.primaryThreads ?? []), ...(before?.secondaryThreads ?? [])].find(
        (t) => t.name === "X",
      );
      expect(priorX?.latestSubject).toBe("Initial commit");
      expect([...(before?.primaryThreads ?? []), ...(before?.secondaryThreads ?? [])]).toHaveLength(3);

      const ordered = listRepositories();
      expect(ordered).toHaveLength(4);
      expect(ordered[0].root).toBe(leadRoot);
      expect(ordered[1].root).toBe(wedgedRoot);
      const worktreeRoots = new Set([xMain, xWorktree]);
      expect(worktreeRoots.has(ordered[2].root)).toBe(true);
      expect(worktreeRoots.has(ordered[3].root)).toBe(true);

      writeFileSync(join(leadRoot, "second.txt"), "second\n");
      execSync("git add second.txt", { cwd: leadRoot });
      execSync('git commit -m "Second commit"', { cwd: leadRoot });

      const read: GitRead = (args, cwd) => {
        if (cwd === wedgedRoot) throw new RepositoryReadStalledError(args, cwd);
        return defaultGitRead(args, cwd);
      };
      const sweepSpy = vi
        .spyOn(repositoryIntelligence, "observeKnownRepositories")
        .mockImplementation(() => observeAllRepos(read));

      const later = new Date();
      const updated = await buildPresentModelBelief({ now: later, coreCwd });
      sweepSpy.mockRestore();

      expect(repositoryReadsAreStalled()).toBe(true);
      const after = readPresentModel();
      expect(updated.revisedAt).toBe(later.toISOString());
      expect(after?.revisedAt).toBe(later.toISOString());

      const xThreads = [...(after?.primaryThreads ?? []), ...(after?.secondaryThreads ?? [])].filter(
        (t) => t.name === "X",
      );
      expect(xThreads).toHaveLength(1);
      expect(xThreads[0].latestSubject).toBe(priorX?.latestSubject);
      expect(after?.primaryThreads.filter((t) => t.name === "X")).toHaveLength(1);
    } finally {
      if (previousRoots === undefined) delete process.env.FLYD_WORK_ROOTS;
      else process.env.FLYD_WORK_ROOTS = previousRoots;
      rmSync(workRoot, { recursive: true, force: true });
    }
  });

  it("production path: main checkout stays deduped with its worktree when the worktree holds the newest commit and the wedged repo sorts before both members", async () => {
    const coreCwd = "/Users/george/Documents/core";
    const groundedAt = new Date(Date.now() - 60_000);

    const workRoot = join(process.cwd(), `.flyd-test-repos-${Date.now()}`);
    const emptyDiscovery = join(workRoot, "empty-discovery");
    const previousRoots = process.env.FLYD_WORK_ROOTS;
    process.env.FLYD_WORK_ROOTS = emptyDiscovery;

    try {
      const reposRoot = join(workRoot, "workspace");
      mkdirSync(reposRoot, { recursive: true });

      const now = Date.now();
      const leadRoot = join(reposRoot, "lead");
      mkdirSync(leadRoot, { recursive: true });
      initRepo(leadRoot, new Date(now - 60 * 60 * 1000).toISOString());
      addRepository(leadRoot, "lead");

      const wedgedRoot = join(reposRoot, "wedged");
      mkdirSync(wedgedRoot, { recursive: true });
      initRepo(wedgedRoot, new Date(now - 2 * 60 * 60 * 1000).toISOString());
      addRepository(wedgedRoot, "wedged");

      const xMain = join(reposRoot, "x");
      mkdirSync(xMain, { recursive: true });
      initRepo(xMain, new Date(now - 4 * 60 * 60 * 1000).toISOString());
      addRepository(xMain, "x");
      const xWorktree = join(reposRoot, "x-wt");
      execSync(`git worktree add ${xWorktree}`, { cwd: xMain });
      addRepository(xWorktree, "x");

      const wtCommitAt = new Date(now - 3 * 60 * 60 * 1000).toISOString();
      writeFileSync(join(xWorktree, "wt.txt"), "wt\n");
      execSync("git add wt.txt", { cwd: xWorktree });
      execSync('git commit -m "Second commit"', {
        cwd: xWorktree,
        env: { ...process.env, GIT_AUTHOR_DATE: wtCommitAt, GIT_COMMITTER_DATE: wtCommitAt },
      });

      const grounded = await buildPresentModelBelief({ now: groundedAt, coreCwd });
      expect(grounded.revisedAt).toBe(groundedAt.toISOString());
      const before = readPresentModel();
      expect(before).not.toBeNull();
      const priorX = [...(before!.primaryThreads), ...(before!.secondaryThreads)].find((t) => t.name === "X");
      expect(priorX?.latestSubject).toBe("Second commit");
      expect([...(before!.primaryThreads), ...(before!.secondaryThreads)]).toHaveLength(3);

      const ordered = listRepositories();
      expect(ordered).toHaveLength(4);
      expect(ordered[0].root).toBe(leadRoot);
      expect(ordered[1].root).toBe(wedgedRoot);
      const worktreeRoots = new Set([xMain, xWorktree]);
      expect(worktreeRoots.has(ordered[2].root)).toBe(true);
      expect(worktreeRoots.has(ordered[3].root)).toBe(true);

      const thirdAt = new Date(now - 30 * 60 * 1000).toISOString();
      writeFileSync(join(leadRoot, "third.txt"), "third\n");
      execSync("git add third.txt", { cwd: leadRoot });
      execSync('git commit -m "Third commit"', {
        cwd: leadRoot,
        env: { ...process.env, GIT_AUTHOR_DATE: thirdAt, GIT_COMMITTER_DATE: thirdAt },
      });

      const read: GitRead = (args, cwd) => {
        if (cwd === wedgedRoot) throw new RepositoryReadStalledError(args, cwd);
        return defaultGitRead(args, cwd);
      };
      const sweepSpy = vi
        .spyOn(repositoryIntelligence, "observeKnownRepositories")
        .mockImplementation(() => observeAllRepos(read));

      const later = new Date();
      const updated = await buildPresentModelBelief({ now: later, coreCwd });
      sweepSpy.mockRestore();

      expect(repositoryReadsAreStalled()).toBe(true);
      const after = readPresentModel();
      expect(updated.revisedAt).toBe(later.toISOString());
      expect(after?.revisedAt).toBe(later.toISOString());

      const xThreads = [...(after?.primaryThreads ?? []), ...(after?.secondaryThreads ?? [])].filter(
        (t) => t.name === "X",
      );
      expect(xThreads).toHaveLength(1);
      expect(xThreads[0].latestSubject).toBe("Second commit");
      expect(after?.primaryThreads.filter((t) => t.name === "X")).toHaveLength(1);
    } finally {
      if (previousRoots === undefined) delete process.env.FLYD_WORK_ROOTS;
      else process.env.FLYD_WORK_ROOTS = previousRoots;
      rmSync(workRoot, { recursive: true, force: true });
    }
  });

  it("production path: main checkout stays deduped with its worktree when the worktree holds the newest commit and the wedged repo sorts between them", async () => {
    const coreCwd = "/Users/george/Documents/core";
    const groundedAt = new Date(Date.now() - 60_000);

    const workRoot = join(process.cwd(), `.flyd-test-repos-${Date.now()}`);
    const emptyDiscovery = join(workRoot, "empty-discovery");
    const previousRoots = process.env.FLYD_WORK_ROOTS;
    process.env.FLYD_WORK_ROOTS = emptyDiscovery;

    try {
      const reposRoot = join(workRoot, "workspace");
      mkdirSync(reposRoot, { recursive: true });

      const now = Date.now();
      const xMain = join(reposRoot, "x");
      mkdirSync(xMain, { recursive: true });
      initRepo(xMain, new Date(now - 3 * 60 * 60 * 1000).toISOString());
      addRepository(xMain, "x");
      const xWorktree = join(reposRoot, "x-wt");
      execSync(`git worktree add ${xWorktree}`, { cwd: xMain });
      addRepository(xWorktree, "x");

      const wtCommitAt = new Date(now - 60 * 60 * 1000).toISOString();
      writeFileSync(join(xWorktree, "wt.txt"), "wt\n");
      execSync("git add wt.txt", { cwd: xWorktree });
      execSync('git commit -m "Second commit"', {
        cwd: xWorktree,
        env: { ...process.env, GIT_AUTHOR_DATE: wtCommitAt, GIT_COMMITTER_DATE: wtCommitAt },
      });

      const wedgedRoot = join(reposRoot, "wedged");
      mkdirSync(wedgedRoot, { recursive: true });
      initRepo(wedgedRoot, new Date(now - 2 * 60 * 60 * 1000).toISOString());
      addRepository(wedgedRoot, "wedged");

      const grounded = await buildPresentModelBelief({ now: groundedAt, coreCwd });
      expect(grounded.revisedAt).toBe(groundedAt.toISOString());
      const before = readPresentModel();
      expect(before).not.toBeNull();
      const priorX = [...(before!.primaryThreads), ...(before!.secondaryThreads)].find((t) => t.name === "X");
      expect(priorX?.latestSubject).toBe("Second commit");
      expect([...(before!.primaryThreads), ...(before!.secondaryThreads)]).toHaveLength(2);

      const ordered = listRepositories();
      expect(ordered).toHaveLength(3);
      expect(ordered[0].root).toBe(xWorktree);
      expect(ordered[1].root).toBe(wedgedRoot);
      expect(ordered[2].root).toBe(xMain);

      const thirdAt = new Date(now - 30 * 60 * 1000).toISOString();
      writeFileSync(join(xWorktree, "third.txt"), "third\n");
      execSync("git add third.txt", { cwd: xWorktree });
      execSync('git commit -m "Third commit"', {
        cwd: xWorktree,
        env: { ...process.env, GIT_AUTHOR_DATE: thirdAt, GIT_COMMITTER_DATE: thirdAt },
      });

      const read: GitRead = (args, cwd) => {
        if (cwd === wedgedRoot) throw new RepositoryReadStalledError(args, cwd);
        return defaultGitRead(args, cwd);
      };
      const sweepSpy = vi
        .spyOn(repositoryIntelligence, "observeKnownRepositories")
        .mockImplementation(() => observeAllRepos(read));

      const later = new Date();
      const updated = await buildPresentModelBelief({ now: later, coreCwd });
      sweepSpy.mockRestore();

      expect(repositoryReadsAreStalled()).toBe(true);
      const after = readPresentModel();
      expect(updated.revisedAt).toBe(later.toISOString());
      expect(after?.revisedAt).toBe(later.toISOString());

      const xThreads = [...(after?.primaryThreads ?? []), ...(after?.secondaryThreads ?? [])].filter(
        (t) => t.name === "X",
      );
      expect(xThreads).toHaveLength(1);
      expect(xThreads[0].latestSubject).toBe("Second commit");
      expect(after?.primaryThreads.filter((t) => t.name === "X")).toHaveLength(1);
    } finally {
      if (previousRoots === undefined) delete process.env.FLYD_WORK_ROOTS;
      else process.env.FLYD_WORK_ROOTS = previousRoots;
      rmSync(workRoot, { recursive: true, force: true });
    }
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
