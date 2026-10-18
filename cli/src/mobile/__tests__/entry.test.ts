import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("bootstraps the public CLI against service HOME, not a repository-local .flyd", () => {
  const root = mkdtempSync(join(tmpdir(), "flyd-mobile-entry-")), home = join(root, "home"), cwd = join(root, "project");
  mkdirSync(home); mkdirSync(join(cwd, ".flyd"), { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete env.FLYD_DIR;
  try {
    const output = execFileSync(process.execPath, ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("src/entry.ts"), "mobile", "pair"], { cwd, env, encoding: "utf8", timeout: 15_000 });
    expect(output).toContain("one use");
    expect(existsSync(join(home, ".flyd", "mobile", "auth.sqlite"))).toBe(true);
    expect(readdirSync(join(cwd, ".flyd"))).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
