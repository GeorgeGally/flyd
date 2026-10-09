import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// GHSA-vfj7-8cjw-p6xm: braces <=3.0.3 overflows the stack on deeply nested patterns and has no
// patched release, so cli/vendor/braces carries a depth guard and package.json overrides to it.
const cliDir = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const vendored = realpathSync(join(cliDir, "vendor/braces/index.js"));
const require = createRequire(join(cliDir, "package.json"));
const braces = require("braces");
const nested = (depth: number) => `${"{".repeat(depth)}a,b${"}".repeat(depth)}`;

describe("vendored braces depth guard", () => {
  it("is what qmd's glob path actually loads", () => {
    const fromQmd = createRequire(join(cliDir, "node_modules/@tobilu/qmd/package.json"));
    const fromFastGlob = createRequire(fromQmd.resolve("fast-glob"));
    const fromMicromatch = createRequire(fromFastGlob.resolve("micromatch"));
    expect(realpathSync(fromMicromatch.resolve("braces"))).toBe(vendored);
    expect(require("braces/package.json").version).toBe("3.0.4-flyd.0");
  });

  it("rejects deep nesting with a SyntaxError instead of exhausting the stack", () => {
    const attack = `${"{".repeat(3300)}${"}".repeat(3300)}`;
    for (const method of ["compile", "expand", "stringify", "parse"] as const) {
      expect(() => braces[method](attack)).toThrow(SyntaxError);
      expect(() => braces[method](nested(101))).toThrow("Nesting depth (101) exceeds max depth (100)");
      expect(() => braces[method](nested(100))).not.toThrow();
    }
  });

  it("guards ASTs handed straight to the walkers", () => {
    const root: { type: string; nodes: unknown[] } = { type: "root", nodes: [] };
    let current = root;
    for (let i = 0; i < 5000; i++) {
      const node = { type: "brace", nodes: [] as unknown[] };
      current.nodes.push(node);
      current = node;
    }
    expect(() => braces.compile(root)).toThrow(SyntaxError);
    expect(() => braces.expand(root)).toThrow(SyntaxError);
  });

  it("leaves ordinary patterns unchanged", () => {
    expect(braces("**/*.{md,ts}")).toEqual(["**/*.(md|ts)"]);
    expect(braces("a/{b,{c,d}}/e", { expand: true })).toEqual(["a/b/e", "a/c/e", "a/d/e"]);
    expect(braces.expand("file{1..3}")).toEqual(["file1", "file2", "file3"]);
  });
});
