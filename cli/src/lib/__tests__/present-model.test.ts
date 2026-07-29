import { describe, expect, it } from "vitest";
import { buildPresentModel, type PresentModelDependencies } from "../present-model.js";
import type { RepositorySnapshot } from "../../runtime/types.js";

const fakeRepository: RepositorySnapshot = {
  root: "/Users/george/flyd",
  name: "flyd",
  remote: "origin",
  branch: "main",
  head: "abc123",
  dirty: true,
  statusLines: ["M cli/src/resolve.ts"],
  statusDigest: "digest",
};

const fakeCommits = [
  { hash: "aaa", shortHash: "aaa", subject: "fix(memory): gate currentness", committedAt: "2026-07-29T00:00:00.000Z" },
];

const baseDeps: PresentModelDependencies = {
  inspectRepository: async () => fakeRepository,
  findActiveTask: async () => null,
  getRecentCommits: async () => [],
  now: () => new Date("2026-07-29T00:00:00.000Z"),
};

describe("buildPresentModel", () => {
  it("assembles repository, active task, and recent commits when all sources succeed", async () => {
    const deps: PresentModelDependencies = {
      ...baseDeps,
      findActiveTask: async () => ({
        taskKey: "task-1",
        projectName: "flyd",
        status: "running",
        intendedOutcome: "fix memory recall",
        updatedAt: "2026-07-29T00:00:00.000Z",
      }),
      getRecentCommits: async () => fakeCommits,
    };

    const model = await buildPresentModel("/Users/george/flyd", deps);

    expect(model.repository).toEqual(fakeRepository);
    expect(model.activeTask?.projectName).toBe("flyd");
    expect(model.recentCommits).toEqual(fakeCommits);
    expect(model.gaps).toEqual([]);
  });

  it("records a gap instead of throwing when repository inspection fails", async () => {
    const deps: PresentModelDependencies = {
      ...baseDeps,
      inspectRepository: async () => {
        throw new Error("not a git repo");
      },
    };

    const model = await buildPresentModel("/tmp/not-a-repo", deps);

    expect(model.repository).toBeNull();
    expect(model.gaps).toContain("repository_state_unavailable");
  });

  it("does not attempt a commit lookup when the repository is unavailable", async () => {
    const getRecentCommits = async (): Promise<never[]> => {
      throw new Error("should not be called");
    };
    const deps: PresentModelDependencies = {
      ...baseDeps,
      inspectRepository: async () => {
        throw new Error("not a git repo");
      },
      getRecentCommits,
    };

    const model = await buildPresentModel("/tmp/not-a-repo", deps);

    expect(model.recentCommits).toEqual([]);
    expect(model.gaps).not.toContain("recent_commits_unavailable");
  });

  it("records a gap instead of throwing when the task store fails", async () => {
    const deps: PresentModelDependencies = {
      ...baseDeps,
      findActiveTask: async () => {
        throw new Error("connection refused");
      },
    };

    const model = await buildPresentModel("/Users/george/flyd", deps);

    expect(model.activeTask).toBeNull();
    expect(model.gaps).toContain("task_state_unavailable");
  });

  it("does not record a gap when there is legitimately no active task", async () => {
    const model = await buildPresentModel("/Users/george/flyd", baseDeps);

    expect(model.activeTask).toBeNull();
    expect(model.gaps).not.toContain("task_state_unavailable");
  });

  it("times out the task lookup instead of hanging", async () => {
    const deps: PresentModelDependencies = {
      ...baseDeps,
      findActiveTask: () => new Promise(() => {}), // never resolves
    };

    const model = await buildPresentModel("/Users/george/flyd", deps);

    expect(model.activeTask).toBeNull();
    expect(model.gaps).toContain("task_state_unavailable");
  }, 3000);

  it("records a gap instead of throwing when the commit log fails", async () => {
    const deps: PresentModelDependencies = {
      ...baseDeps,
      getRecentCommits: async () => {
        throw new Error("git log failed");
      },
    };

    const model = await buildPresentModel("/Users/george/flyd", deps);

    expect(model.recentCommits).toEqual([]);
    expect(model.gaps).toContain("recent_commits_unavailable");
  });

  it("passes the requested commit limit through to getRecentCommits", async () => {
    let receivedLimit: number | undefined;
    const deps: PresentModelDependencies = {
      ...baseDeps,
      getRecentCommits: async (_root, limit) => {
        receivedLimit = limit;
        return fakeCommits;
      },
    };

    await buildPresentModel("/Users/george/flyd", deps, 15);

    expect(receivedLimit).toBe(15);
  });
});
