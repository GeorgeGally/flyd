import { describe, expect, it, vi } from "vitest";
import { resolveRequestedRepositoryRoots } from "../repository-roots.js";
import type { RepositorySnapshot } from "../types.js";

function repository(root: string): RepositorySnapshot {
  return {
    root, name: root.split("/").at(-1) ?? root, remote: null, branch: "main", head: "abc",
    dirty: false, statusLines: [], statusDigest: "clean",
  };
}

describe("requested repository roots", () => {
  it("finds quoted and plain local repositories while preserving the primary root first", async () => {
    const inspect = vi.fn(async (path?: string) => {
      if (path?.startsWith("/Users/george/code/shared library")) return repository("/Users/george/code/shared library");
      if (path?.startsWith("/Users/george/code/website")) return repository("/Users/george/code/website");
      throw new Error("not a repository");
    });

    await expect(resolveRequestedRepositoryRoots(
      "Update `/Users/george/code/shared library` and /Users/george/code/website for the release",
      "/Users/george/code/flyd",
      inspect,
    )).resolves.toEqual([
      "/Users/george/code/flyd",
      "/Users/george/code/shared library",
      "/Users/george/code/website",
    ]);
  });

  it("ignores invalid paths and collapses files inside the primary repository", async () => {
    const inspect = vi.fn(async (path?: string) => {
      if (path?.startsWith("/Users/george/code/flyd")) return repository("/Users/george/code/flyd");
      throw new Error("not a repository");
    });

    await expect(resolveRequestedRepositoryRoots(
      "Review /missing/repo and /Users/george/code/flyd/app/models/task.rb",
      "/Users/george/code/flyd",
      inspect,
    )).resolves.toEqual([ "/Users/george/code/flyd" ]);
  });
});
