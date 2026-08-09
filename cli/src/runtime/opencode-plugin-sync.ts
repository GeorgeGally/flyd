import { randomUUID } from "crypto";
import { access, mkdir, readFile, rename, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";
import { FLYD_APPLICATION_ROOT, FLYD_DIR } from "../lib/config.js";

interface OpenCodePluginSyncOptions {
  sourcePath?: string;
  destinationPath?: string;
  repoRoot?: string;
  repoRootPath?: string;
}

export interface OpenCodePluginSyncResult {
  status: "updated" | "current" | "not_installed" | "source_missing";
  destinationPath: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

export async function syncInstalledOpenCodePlugin(
  options: OpenCodePluginSyncOptions = {},
): Promise<OpenCodePluginSyncResult> {
  const sourcePath = options.sourcePath
    ?? join(FLYD_APPLICATION_ROOT, "cli", "plugins", "flyd-capture.ts");
  const destinationPath = options.destinationPath
    ?? join(homedir(), ".config", "opencode", "plugins", "flyd-capture.ts");
  const repoRoot = options.repoRoot ?? FLYD_APPLICATION_ROOT.replace(/\/+$/, "");
  const repoRootPath = options.repoRootPath ?? join(FLYD_DIR, "overlay", "repo-root");

  if (!await exists(sourcePath)) return { status: "source_missing", destinationPath };
  if (!await exists(destinationPath)) return { status: "not_installed", destinationPath };

  const [ source, installed ] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readFile(destinationPath, "utf8"),
  ]);
  await atomicWrite(repoRootPath, `${repoRoot}\n`);
  if (source === installed) return { status: "current", destinationPath };

  await atomicWrite(destinationPath, source);
  return { status: "updated", destinationPath };
}
