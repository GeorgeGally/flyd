import { execFile } from "node:child_process";
import { realpath } from "fs/promises";
import { mkdir, mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { verificationCommandsForRepository, withRunningNodeFirst } from "../verification-commands.js";

const execFileAsync = promisify(execFile);

describe("verification runs on Flyd's own Node", () => {
  it("prefixes commands so the running Node wins even after a login shell rebuilds PATH", async () => {
    const command = withRunningNodeFirst("node -p process.execPath");
    expect(command).toContain(JSON.stringify(dirname(process.execPath)));
    const { stdout } = await execFileAsync("/bin/bash", [ "-lc", command ]);
    const reported = stdout.trim().split("\n").at(-1) ?? "";
    expect(await realpath(reported)).toBe(await realpath(process.execPath));
  });
});

describe("repository verification commands", () => {
  it("discovers Rails and nested CLI checks without trusting model prose", async () => {
    const root = await mkdtemp(join(tmpdir(), "flyd-verification-commands-"));
    await mkdir(join(root, "bin"));
    await mkdir(join(root, "test"));
    await mkdir(join(root, "cli"));
    await writeFile(join(root, "bin/rails"), "#!/bin/sh\n");
    await writeFile(join(root, "cli/package.json"), JSON.stringify({
      scripts: { test: "vitest run", lint: "tsc --noEmit", build: "tsc" },
    }));

    await expect(verificationCommandsForRepository(root)).resolves.toEqual([
      "git diff --check",
      "bin/rails test",
      "npm --prefix cli test",
      "npm --prefix cli run lint",
      "npm --prefix cli run build",
    ]);
  });

  it("uses the active Flyd Core profile instead of legacy Rails checks", async () => {
    const root = await mkdtemp(join(tmpdir(), "flyd-verification-commands-"));
    await mkdir(join(root, "bin"));
    await mkdir(join(root, "test"));
    await mkdir(join(root, "cli", "src"), { recursive: true });
    await mkdir(join(root, "mac-adapter"));
    await writeFile(join(root, "bin/rails"), "#!/bin/sh\n");
    await writeFile(join(root, "cli", "src", "server.ts"), "export {};\n");
    await writeFile(join(root, "mac-adapter", "Package.swift"), "// swift-tools-version: 5.9\n");
    await writeFile(join(root, "cli/package.json"), JSON.stringify({
      scripts: { test: "vitest run", lint: "tsc --noEmit", build: "tsc" },
    }));

    await expect(verificationCommandsForRepository(root)).resolves.toEqual([
      "git diff --check",
      "npm --prefix cli test",
      "npm --prefix cli run lint",
      "npm --prefix cli run build",
    ]);
  });
});
