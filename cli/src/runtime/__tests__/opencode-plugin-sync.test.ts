import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { syncInstalledOpenCodePlugin } from "../opencode-plugin-sync.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("OpenCode plugin sync", () => {
  it("updates an installed Flyd plugin and records the canonical repository root", async () => {
    const root = await mkdtemp(join(tmpdir(), "flyd-opencode-sync-"));
    directories.push(root);
    const sourcePath = join(root, "repo", "cli", "plugins", "flyd-capture.ts");
    const destinationPath = join(root, "config", "opencode", "plugins", "flyd-capture.ts");
    const repoRootPath = join(root, "flyd", "overlay", "repo-root");
    await mkdir(join(sourcePath, ".."), { recursive: true });
    await mkdir(join(destinationPath, ".."), { recursive: true });
    await writeFile(sourcePath, "new plugin\n", "utf8");
    await writeFile(destinationPath, "old plugin\n", "utf8");

    const result = await syncInstalledOpenCodePlugin({
      sourcePath,
      destinationPath,
      repoRoot: join(root, "repo"),
      repoRootPath,
    });

    expect(result).toEqual({ status: "updated", destinationPath });
    await expect(readFile(destinationPath, "utf8")).resolves.toBe("new plugin\n");
    await expect(readFile(repoRootPath, "utf8")).resolves.toBe(`${join(root, "repo")}\n`);
  });

  it("does not install the integration when the user has not installed it", async () => {
    const root = await mkdtemp(join(tmpdir(), "flyd-opencode-sync-missing-"));
    directories.push(root);
    const sourcePath = join(root, "repo", "flyd-capture.ts");
    const destinationPath = join(root, "config", "opencode", "plugins", "flyd-capture.ts");
    await mkdir(join(sourcePath, ".."), { recursive: true });
    await writeFile(sourcePath, "new plugin\n", "utf8");

    const result = await syncInstalledOpenCodePlugin({
      sourcePath,
      destinationPath,
      repoRoot: join(root, "repo"),
      repoRootPath: join(root, "flyd", "overlay", "repo-root"),
    });

    expect(result).toEqual({ status: "not_installed", destinationPath });
  });
});
