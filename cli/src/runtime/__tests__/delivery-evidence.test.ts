import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assessDelivery, assessLiveDelivery, gitContainsCommit, resolveBuildCommit } from "../delivery-evidence.js";

const TEST_PORT = 14821;
const CORE_URL = `http://127.0.0.1:${TEST_PORT}`;

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  }).trim();
}

function commit(repo: string, content: string): string {
  writeFileSync(join(repo, "core.ts"), content, "utf8");
  git(repo, "add", "core.ts");
  git(repo, "commit", "-q", "-m", content);
  return git(repo, "rev-parse", "HEAD");
}

function makeRepo(root: string): string {
  const repo = join(root, "flyd");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q");
  return repo;
}

describe("delivery evidence", () => {
  it("keeps an unmerged pull request unknown even when the running build has its commit", () => {
    const sha = "a".repeat(40);
    expect(assessDelivery({ merged: false, mergeCommitSha: sha, changedPaths: ["cli/src/server.ts"] }, { buildCommit: sha }, () => true))
      .toEqual({ attribution: "unknown", completed: false });
  });

  it("keeps a merged adapter change unknown because the Core build does not prove the app binary", () => {
    const sha = "a".repeat(40);
    expect(assessDelivery({ merged: true, mergeCommitSha: sha, changedPaths: ["cli/src/server.ts"] }, { buildCommit: sha }, () => true))
      .toEqual({ attribution: "direct_verified", completed: true });
    expect(assessDelivery({ merged: true, mergeCommitSha: sha, changedPaths: ["mac-adapter/Sources/main.swift"] }, { buildCommit: sha }, () => true))
      .toEqual({ attribution: "unknown", completed: false });
  });

  it("stamps no build commit while tracked source differs from HEAD", () => {
    const root = mkdtempSync(join(tmpdir(), "flyd-build-stamp-"));
    try {
      const repo = makeRepo(root);
      const head = commit(repo, "one");
      expect(resolveBuildCommit(repo)).toBe(head);
      writeFileSync(join(repo, "core.ts"), "uncommitted edit", "utf8");
      expect(resolveBuildCommit(repo)).toBeNull();
      expect(resolveBuildCommit(join(root, "not-a-repo"))).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("delivery evidence against the running Core", () => {
  let testRoot = "";
  let repo = "";
  let previousHome: string | undefined;
  let earlierMerge = "";
  let runningBuild = "";

  beforeAll(async () => {
    testRoot = mkdtempSync(join(tmpdir(), "flyd-delivery-e2e-"));
    previousHome = process.env.HOME;
    process.env.HOME = testRoot;
    mkdirSync(join(testRoot, ".flyd", "overlay"), { recursive: true });
    repo = makeRepo(testRoot);
    earlierMerge = commit(repo, "earlier fix");
    runningBuild = commit(repo, "running build");
    const server = await import("../../server.js");
    await server.startServer(TEST_PORT, "127.0.0.1", { sourceDir: repo });
  }, 30_000);

  afterAll(async () => {
    const server = await import("../../server.js");
    await server.stopServer();
    process.env.HOME = previousHome;
    rmSync(testRoot, { recursive: true, force: true });
  });

  it("assesses a merged Flyd PR as missed/unknown while the running build lacks its commit", async () => {
    const laterMerge = commit(repo, "merged after Core started");
    await expect(fetch(`${CORE_URL}/health`).then((res) => res.json())).resolves.toMatchObject({ buildCommit: runningBuild });
    await expect(assessLiveDelivery({ merged: true, mergeCommitSha: laterMerge, changedPaths: ["cli/src/server.ts"] }, CORE_URL, gitContainsCommit(repo)))
      .resolves.toEqual({ attribution: "unknown", completed: false });
  });

  it("assesses a merged PR completed once the running build contains its commit", async () => {
    await expect(assessLiveDelivery({ merged: true, mergeCommitSha: earlierMerge, changedPaths: ["cli/src/server.ts"] }, CORE_URL, gitContainsCommit(repo)))
      .resolves.toEqual({ attribution: "direct_verified", completed: true });
    await expect(assessLiveDelivery({ merged: true, mergeCommitSha: runningBuild, changedPaths: ["cli/src/server.ts"] }, CORE_URL, gitContainsCommit(repo)))
      .resolves.toEqual({ attribution: "direct_verified", completed: true });
  });

  it("assesses unknown when the running Core cannot be reached", async () => {
    await expect(assessLiveDelivery({ merged: true, mergeCommitSha: earlierMerge, changedPaths: ["cli/src/server.ts"] }, "http://127.0.0.1:1", gitContainsCommit(repo)))
      .resolves.toEqual({ attribution: "unknown", completed: false });
  });
});
