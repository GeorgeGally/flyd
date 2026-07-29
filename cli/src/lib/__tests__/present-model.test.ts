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

describe("buildPresentModel", () => {
  it("assembles repository and active task when both sources succeed", async () => {
    const deps: PresentModelDependencies = {
      inspectRepository: async () => fakeRepository,
      findActiveTask: async () => ({
        taskKey: "task-1",
        projectName: "flyd",
        status: "running",
        intendedOutcome: "fix memory recall",
        updatedAt: "2026-07-29T00:00:00.000Z",
      }),
      now: () => new Date("2026-07-29T00:00:00.000Z"),
    };

    const model = await buildPresentModel("/Users/george/flyd", deps);

    expect(model.repository).toEqual(fakeRepository);
    expect(model.activeTask?.projectName).toBe("flyd");
    expect(model.gaps).toEqual([]);
  });

  it("records a gap instead of throwing when repository inspection fails", async () => {
    const deps: PresentModelDependencies = {
      inspectRepository: async () => {
        throw new Error("not a git repo");
      },
      findActiveTask: async () => null,
      now: () => new Date(),
    };

    const model = await buildPresentModel("/tmp/not-a-repo", deps);

    expect(model.repository).toBeNull();
    expect(model.gaps).toContain("repository_state_unavailable");
  });

  it("records a gap instead of throwing when the task store fails", async () => {
    const deps: PresentModelDependencies = {
      inspectRepository: async () => fakeRepository,
      findActiveTask: async () => {
        throw new Error("connection refused");
      },
      now: () => new Date(),
    };

    const model = await buildPresentModel("/Users/george/flyd", deps);

    expect(model.activeTask).toBeNull();
    expect(model.gaps).toContain("task_state_unavailable");
  });

  it("does not record a gap when there is legitimately no active task", async () => {
    const deps: PresentModelDependencies = {
      inspectRepository: async () => fakeRepository,
      findActiveTask: async () => null,
      now: () => new Date(),
    };

    const model = await buildPresentModel("/Users/george/flyd", deps);

    expect(model.activeTask).toBeNull();
    expect(model.gaps).not.toContain("task_state_unavailable");
  });

  it("times out the task lookup instead of hanging", async () => {
    const deps: PresentModelDependencies = {
      inspectRepository: async () => fakeRepository,
      findActiveTask: () => new Promise(() => {}), // never resolves
      now: () => new Date(),
    };

    const model = await buildPresentModel("/Users/george/flyd", deps);

    expect(model.activeTask).toBeNull();
    expect(model.gaps).toContain("task_state_unavailable");
  }, 3000);
});
