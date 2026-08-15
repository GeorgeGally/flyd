import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectProjectContext } from "../project-context.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "flyd-project-context-"));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("collectProjectContext", () => {
  it("collects AGENTS.md and package.json within the grant boundary", () => {
    const { root, cleanup } = fixture();
    try {
      writeFileSync(join(root, "AGENTS.md"), "Always run the linter.\n", "utf8");
      writeFileSync(join(root, "package.json"), '{"name":"app"}\n', "utf8");
      writeFileSync(join(root, "README.md"), "x".repeat(2_000), "utf8");

      const blocks = collectProjectContext(root, [ root ]);

      expect(blocks.map((block) => block.file)).toEqual([ "AGENTS.md", "package.json", "README.md" ]);
      expect(blocks.find((block) => block.file === "AGENTS.md")!.content).toBe("Always run the linter.\n");
      expect(blocks.find((block) => block.file === "package.json")!.content).toBe('{"name":"app"}\n');
      expect(blocks.find((block) => block.file === "README.md")!.content.length).toBe(1_500);
    } finally {
      cleanup();
    }
  });

  it("returns no blocks when none of the five files exist", () => {
    const { root, cleanup } = fixture();
    try {
      expect(collectProjectContext(root, [ root ])).toEqual([]);
      expect(collectProjectContext(root)).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("walks parents within the grant boundary and stops beyond it", () => {
    const { root, cleanup } = fixture();
    try {
      const subdir = join(root, "packages", "cli");
      mkdirSync(subdir, { recursive: true });
      writeFileSync(join(root, "AGENTS.md"), "root conventions\n", "utf8");
      writeFileSync(join(subdir, "AGENTS.md"), "sub conventions\n", "utf8");
      writeFileSync(join(root, "MEMORY.md"), "memory\n", "utf8");

      const withinBoundary = collectProjectContext(subdir, [ root ]);
      expect(withinBoundary.map((block) => block.file)).toEqual([ "AGENTS.md", "MEMORY.md" ]);
      expect(withinBoundary.find((block) => block.file === "AGENTS.md")!.content).toBe("sub conventions\n");

      const bounded = collectProjectContext(subdir, [ join(root, "packages") ]);
      expect(bounded.some((block) => block.file === "MEMORY.md")).toBe(false);
      expect(bounded.find((block) => block.file === "AGENTS.md")!.content).toBe("sub conventions\n");
    } finally {
      cleanup();
    }
  });

  it("does not read a symlinked conventions file pointing outside the boundary", () => {
    const { root, cleanup } = fixture();
    try {
      const outside = mkdtempSync(join(tmpdir(), "flyd-project-context-outside-"));
      writeFileSync(join(outside, "AGENTS.md"), "outside instructions\n", "utf8");
      symlinkSync(join(outside, "AGENTS.md"), join(root, "AGENTS.md"));

      expect(collectProjectContext(root, [ root ])).toEqual([]);
      expect(collectProjectContext(root)).toHaveLength(1);
      rmSync(outside, { recursive: true, force: true });
    } finally {
      cleanup();
    }
  });

  it("slices long files to their per-file cap", () => {
    const { root, cleanup } = fixture();
    try {
      writeFileSync(join(root, "SOUL.md"), "y".repeat(5_000), "utf8");
      const blocks = collectProjectContext(root, [ root ]);
      expect(blocks.find((block) => block.file === "SOUL.md")!.content.length).toBe(2_500);
    } finally {
      cleanup();
    }
  });
});