import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

function source(relativePath: string): string {
  return readFileSync(join(here, "..", relativePath), "utf8");
}

describe("Repository Intelligence boundary", () => {
  it("keeps foreground current-work free of direct git process execution", () => {
    const currentWork = source("work-intelligence/current-work.ts");
    expect(currentWork).toContain("repository-intelligence.js");
    expect(currentWork).not.toMatch(/child_process|node:child_process/);
    expect(currentWork).not.toMatch(/execSync|execFileSync/);
  });

  it("keeps Present work-hypothesis free of direct git process execution", () => {
    const engine = source("work/work-hypothesis/engine.ts");
    expect(engine).toContain("repository-intelligence.js");
    expect(engine).not.toMatch(/child_process|node:child_process/);
    expect(engine).not.toMatch(/execSync|execFileSync/);
    expect(engine).not.toContain("../lib/recent-commits.js");
  });
});
