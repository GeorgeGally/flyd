import { describe, expect, it } from "vitest";
import { assembleCandidates, isDirtyOnlyStale } from "../candidates.js";
import type { CandidateRepoInput } from "../types.js";

const NOW = new Date("2026-08-12T12:00:00.000Z");

function repo(partial: Partial<CandidateRepoInput> & Pick<CandidateRepoInput, "id" | "name" | "root">): CandidateRepoInput {
  return {
    isDirty: false,
    hasTasks: false,
    isForeground: false,
    ...partial,
  };
}

describe("assembleCandidates", () => {
  it("admits recent CleanX and Good Neighbours; excludes stale dirty aigc", () => {
    const threads = assembleCandidates({
      now: NOW,
      coreCwd: "/Users/george/Documents/flyd/cli",
      repos: [
        repo({
          id: "gn",
          name: "Good Neighbours",
          root: "/Users/george/Documents/Good Neighbours",
          lastCommitAt: "2026-08-12T10:00:00.000Z",
          isDirty: true,
        }),
        repo({
          id: "cleanx",
          name: "CleanX",
          root: "/Users/george/Documents/CleanX",
          lastCommitAt: "2026-08-12T09:00:00.000Z",
          isDirty: true,
        }),
        repo({
          id: "flyd",
          name: "flyd",
          root: "/Users/george/Documents/flyd",
          lastCommitAt: "2026-07-01T00:00:00.000Z",
          isDirty: true,
        }),
        repo({
          id: "aigc",
          name: "aigc",
          root: "/Users/george/Documents/aigc",
          lastCommitAt: "2025-09-01T00:00:00.000Z",
          isDirty: true,
        }),
        repo({
          id: "hashblocks",
          name: "hashblocks",
          root: "/Users/george/Documents/hashblocks",
          lastCommitAt: "2025-01-01T00:00:00.000Z",
          isDirty: true,
        }),
      ],
    });

    const names = threads.map((t) => t.name);
    expect(names).toContain("Good Neighbours");
    expect(names).toContain("CleanX");
    expect(names).not.toContain("aigc");
    expect(names).not.toContain("hashblocks");
    // flyd commit is >14d — dirty alone does not admit
    expect(names).not.toContain("flyd");
  });

  it("does not admit dirty-only stale repos as activity candidates", () => {
    const stale = repo({
      id: "aigc",
      name: "aigc",
      root: "/tmp/aigc",
      lastCommitAt: "2025-09-01T00:00:00.000Z",
      isDirty: true,
    });
    expect(isDirtyOnlyStale(stale, NOW)).toBe(true);
    expect(assembleCandidates({ repos: [stale], now: NOW })).toEqual([]);
  });

  it("collapses worktree pairs into one thread", () => {
    const threads = assembleCandidates({
      now: NOW,
      repos: [
        repo({
          id: "main",
          name: "flyd",
          root: "/Users/george/Documents/flyd",
          lastCommitAt: "2026-08-12T08:00:00.000Z",
          gitCommonDir: "/Users/george/Documents/flyd/.git",
        }),
        repo({
          id: "wt",
          name: "flyd",
          root: "/Users/george/Documents/flyd-wt",
          lastCommitAt: "2026-08-12T09:00:00.000Z",
          gitCommonDir: "/Users/george/Documents/flyd/.git",
          isDirty: true,
        }),
      ],
    });
    expect(threads).toHaveLength(1);
    expect(threads[0].root).toBe("/Users/george/Documents/flyd-wt");
    expect(threads[0].isDirty).toBe(true);
  });

  it("admits repos with open tasks even without recent commits", () => {
    const threads = assembleCandidates({
      now: NOW,
      repos: [
        repo({
          id: "legacy",
          name: "legacy",
          root: "/Users/george/Documents/legacy",
          lastCommitAt: "2025-01-01T00:00:00.000Z",
          hasTasks: true,
        }),
      ],
    });
    expect(threads).toHaveLength(1);
    expect(threads[0].signals).toContain("open_tasks");
  });

  it("marks demoted threads without excluding them from the candidate set", () => {
    const threads = assembleCandidates({
      now: NOW,
      demotions: ["flyd"],
      repos: [
        repo({
          id: "flyd",
          name: "flyd",
          root: "/Users/george/Documents/flyd",
          lastCommitAt: "2026-08-12T11:00:00.000Z",
        }),
      ],
    });
    expect(threads[0].demoted).toBe(true);
  });

  it("never admits ephemeral flyd-test temp roots", () => {
    const threads = assembleCandidates({
      now: NOW,
      repos: [
        repo({
          id: "junk",
          name: "flyd-test-z2eY2L",
          root: "/var/folders/xx/T/flyd-test-z2eY2L",
          lastCommitAt: "2026-08-12T11:00:00.000Z",
          isDirty: true,
        }),
        repo({
          id: "gn",
          name: "good_neighbours",
          root: "/Users/george/Documents/good_neighbours",
          lastCommitAt: "2026-08-12T10:00:00.000Z",
        }),
      ],
    });
    expect(threads.map((t) => t.name)).toEqual(["Good Neighbours"]);
  });
});
