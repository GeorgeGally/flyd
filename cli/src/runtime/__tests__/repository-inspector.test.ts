import { describe, expect, it, vi } from "vitest";
import { inspectRepository, RepositoryInspectionError } from "../repository-inspector.js";

describe("inspectRepository", () => {
  it("uses the git root and returns a stable current-state snapshot", async () => {
    const run = vi.fn(async (_command: string, args: string[]) => {
      const operation = args.slice(2).join(" ");
      if (operation === "rev-parse --show-toplevel") return "/work/flyd\n";
      if (operation === "remote get-url origin") return "git@github.com:GeorgeGally/flyd.git\n";
      if (operation === "branch --show-current") return "main\n";
      if (operation === "rev-parse HEAD") return "abc123\n";
      if (operation === "status --porcelain=v1 --untracked-files=all") return " M cli/src/index.ts\n?? note.md\n";
      throw new Error(`unexpected git call: ${operation}`);
    });

    const snapshot = await inspectRepository("/work/flyd/cli", run);

    expect(snapshot).toMatchObject({
      root: "/work/flyd",
      name: "GeorgeGally/flyd",
      remote: "git@github.com:GeorgeGally/flyd.git",
      branch: "main",
      head: "abc123",
      dirty: true,
    });
    expect(snapshot.statusLines).toEqual([" M cli/src/index.ts", "?? note.md"]);
    expect(snapshot.statusDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(run).toHaveBeenCalledWith("git", ["-C", "/work/flyd/cli", "rev-parse", "--show-toplevel"]);
  });

  it("fails clearly outside a git repository", async () => {
    const run = vi.fn(async () => { throw new Error("not a git repository"); });

    await expect(inspectRepository("/tmp", run)).rejects.toBeInstanceOf(RepositoryInspectionError);
  });
});
