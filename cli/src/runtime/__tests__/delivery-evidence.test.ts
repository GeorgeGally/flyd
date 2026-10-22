import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assessDelivery, assessLiveDelivery } from "../delivery-evidence.js";

const TEST_PORT = 14821;
const CORE_URL = `http://127.0.0.1:${TEST_PORT}`;
const buildInfoPath = new URL("../../build-info.json", import.meta.url);
const mergedPullRequest = { merged: true, mergeCommitSha: "a".repeat(40) };

describe("delivery evidence", () => {
  it("keeps a merged pull request unknown until the running build contains its commit", () => {
    expect(assessDelivery(mergedPullRequest, { buildCommit: "b".repeat(40) })).toEqual({
      attribution: "unknown",
      completed: false,
    });
  });

  it("keeps an unmerged pull request unknown even when the running build has its commit", () => {
    expect(assessDelivery({ merged: false, mergeCommitSha: "a".repeat(40) }, { buildCommit: "a".repeat(40) }))
      .toMatchObject({ completed: false });
  });
});

describe("delivery evidence against the running Core", () => {
  let testRoot = "";
  let previousHome: string | undefined;

  beforeAll(async () => {
    expect(existsSync(buildInfoPath)).toBe(false);
    testRoot = mkdtempSync(join(tmpdir(), "flyd-delivery-e2e-"));
    previousHome = process.env.HOME;
    process.env.HOME = testRoot;
    mkdirSync(join(testRoot, ".flyd", "overlay"), { recursive: true });
    const server = await import("../../server.js");
    await server.startServer(TEST_PORT, "127.0.0.1");
  }, 30_000);

  afterAll(async () => {
    const server = await import("../../server.js");
    await server.stopServer();
    if (existsSync(buildInfoPath)) unlinkSync(buildInfoPath);
    process.env.HOME = previousHome;
    rmSync(testRoot, { recursive: true, force: true });
  });

  it("assesses a merged Flyd PR as missed/unknown while the running build lacks its commit", async () => {
    writeFileSync(buildInfoPath, JSON.stringify({ buildCommit: "b".repeat(40) }), "utf8");
    await expect(assessLiveDelivery(mergedPullRequest, CORE_URL))
      .resolves.toEqual({ attribution: "unknown", completed: false });

    unlinkSync(buildInfoPath);
    await expect(assessLiveDelivery(mergedPullRequest, CORE_URL))
      .resolves.toEqual({ attribution: "unknown", completed: false });
  });

  it("assesses the PR completed once the running build reports its commit", async () => {
    writeFileSync(buildInfoPath, JSON.stringify({ buildCommit: mergedPullRequest.mergeCommitSha }), "utf8");
    await expect(assessLiveDelivery(mergedPullRequest, CORE_URL))
      .resolves.toEqual({ attribution: "direct_verified", completed: true });
  });

  it("assesses unknown when the running Core cannot be reached", async () => {
    await expect(assessLiveDelivery(mergedPullRequest, "http://127.0.0.1:1"))
      .resolves.toEqual({ attribution: "unknown", completed: false });
  });
});
