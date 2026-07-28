import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUNDLE_BOILERPLATE,
  BUNDLE_CHAR_BUDGET,
  readContextBundles,
} from "../context-bundles.js";
import { serialize } from "../frontmatter.js";

const tempDirs: string[] = [];

function makeContextDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "flyd-ctx-"));
  tempDirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, `${name}.md`), serialize({ generated: "2026-07-28T00:00:00Z" }, body), "utf8");
  }
  return dir;
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("readContextBundles", () => {
  it("returns an empty list when the context directory does not exist", () => {
    expect(readContextBundles("/nonexistent/flyd-context")).toEqual([]);
  });

  it("returns bundle bodies and skips missing files", () => {
    const dir = makeContextDir({
      current_identity: "# Current Identity\n\nGeorge is a creative technologist.",
    });
    const bundles = readContextBundles(dir);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].name).toBe("current_identity");
    expect(bundles[0].body).toContain("George is a creative technologist.");
  });

  it("skips bundles that contain the empty marker", () => {
    const dir = makeContextDir({
      current_identity: "# Current Identity\n\nNo compiled context.",
      active_projects: "# Active Projects\n\nBuilding flyd overlay.",
    });
    const bundles = readContextBundles(dir);
    expect(bundles.map((b) => b.name)).toEqual(["active_projects"]);
  });

  it("strips the machine-generated boilerplate line", () => {
    const dir = makeContextDir({
      current_identity: `# Current Identity\n\n${BUNDLE_BOILERPLATE}\n\nGeorge builds overlays.`,
    });
    const bundles = readContextBundles(dir);
    expect(bundles[0].body).not.toContain(BUNDLE_BOILERPLATE);
    expect(bundles[0].body).toContain("George builds overlays.");
  });

  it("stops accumulating once the total char budget is exhausted", () => {
    const big = "x".repeat(3000);
    const dir = makeContextDir({
      current_identity: big,
      current_constraints: big,
      active_projects: big,
      recent_history: big,
    });
    const bundles = readContextBundles(dir);
    const total = bundles.reduce((sum, b) => sum + b.body.length, 0);
    expect(total).toBeLessThanOrEqual(BUNDLE_CHAR_BUDGET);
    expect(bundles.length).toBeLessThan(4);
  });

  it("reads bundles in identity-first priority order", () => {
    const dir = makeContextDir({
      recent_history: "History.",
      current_identity: "Identity.",
      active_projects: "Projects.",
    });
    const bundles = readContextBundles(dir);
    expect(bundles.map((b) => b.name)).toEqual(["current_identity", "active_projects", "recent_history"]);
  });
});
