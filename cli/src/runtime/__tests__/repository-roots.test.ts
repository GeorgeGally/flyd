import { describe, expect, it, vi } from "vitest";
import { resolveRequestedReadRoots, resolveRequestedRepositoryRoots } from "../repository-roots.js";
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

  it("classifies existing files outside the primary repository as external roots", async () => {
    const { mkdtemp, mkdir, writeFile } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const root = await mkdtemp(join(tmpdir(), "flyd-repo-roots-"));
    await mkdir(join(root, "notes"));
    await writeFile(join(root, "notes", "draft.md"), "x", "utf8");
    const inspect = vi.fn(async () => { throw new Error("not a repository"); });
    const result = await resolveRequestedReadRoots(
      `Update ${join(root, "notes", "draft.md")}`,
      "/Users/george/code/flyd",
      inspect,
    );
    expect(result.repositoryRoots).toEqual([ "/Users/george/code/flyd" ]);
    expect(result.externalRoots).toEqual([ join(root, "notes", "draft.md") ]);
  });

  it("does not mint external roots for sensitive credential files", async () => {
    const { mkdtemp, mkdir, writeFile } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const root = await mkdtemp(join(tmpdir(), "flyd-repo-roots-"));
    await mkdir(join(root, ".ssh"));
    await writeFile(join(root, ".ssh", "config"), "Host *\n", "utf8");
    await writeFile(join(root, "notes.md"), "x", "utf8");
    const inspect = vi.fn(async () => { throw new Error("not a repository"); });
    const result = await resolveRequestedReadRoots(
      `Update ${join(root, ".ssh", "config")} and ${join(root, "notes.md")}`,
      "/Users/george/code/flyd",
      inspect,
    );
    expect(result.externalRoots).toEqual([ join(root, "notes.md") ]);
  });
});
