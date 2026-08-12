import { readdirSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join, basename } from "node:path";

function execGit(root: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["-C", root, ...args], {
      encoding: "utf8" as BufferEncoding,
      timeout: 3000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      if (error) { resolve(null); return; }
      resolve((stdout as string).trim() || null);
    });
  });
}

export interface BriefRepo {
  root: string;
  name: string;
  branch: string;
  dirty: boolean;
  lastCommitRelative: string | null;
  isForeground: boolean;
}

function workRoots(): string[] {
  const env = (process.env.FLYD_WORK_ROOTS || "").split(",").map((p) => p.trim()).filter(Boolean);
  if (env.length > 0) return env;
  return [
    join(homedir(), "Documents"),
    join(homedir(), "Dev"),
    join(homedir(), "Projects"),
    join(homedir(), "Code"),
  ];
}

// ponytail: scan depth 3, skip noise dirs
function scanForRepos(roots: string[]): string[] {
  const found = new Set<string>();
  const skip = new Set(["node_modules", ".git", "dist", "build", ".cache", "vendor", "__pycache__"]);

  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      walk(root, 3, found, skip);
    } catch {
      // permission denied, non-dir — skip
    }
  }
  return [...found];
}

function walk(dir: string, depth: number, found: Set<string>, skip: Set<string>): void {
  if (depth <= 0) return;
  if (existsSync(join(dir, ".git"))) {
    found.add(dir);
    return; // don't recurse into repo internals
  }
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || skip.has(entry.name) || entry.name.startsWith(".")) continue;
    walk(join(dir, entry.name), depth - 1, found, skip);
  }
}

async function snapshotRepo(root: string, foregroundPath?: string): Promise<BriefRepo> {
  const [branch, statusOut, lastCommitRelative] = await Promise.all([
    execGit(root, ["branch", "--show-current"]),
    execGit(root, ["status", "--porcelain"]),
    execGit(root, ["log", "-1", "--format=%cr"]),
  ]);
  const dirty = statusOut !== null && statusOut !== "";
  const isForeground = foregroundPath !== undefined
    ? root === findGitRoot(foregroundPath)
    : false;

  return {
    root,
    name: basename(root),
    branch: branch || "detached",
    dirty,
    lastCommitRelative,
    isForeground,
  };
}

function findGitRoot(path: string): string | null {
  let current = path;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = current.substring(0, current.lastIndexOf("/"));
    if (!parent || parent === current) break;
    current = parent;
  }
  return null;
}

let cachedRepos: BriefRepo[] | null = null;
let cachedAt = 0;
const TTL_MS = 30_000;

export function clearRepoRegistry(): void {
  cachedRepos = null;
  cachedAt = 0;
}

export async function refreshRepoRegistry(foregroundPath?: string): Promise<BriefRepo[]> {
  const now = Date.now();
  if (cachedRepos && (now - cachedAt) < TTL_MS) {
    return cachedRepos.map((r) => ({
      ...r,
      isForeground: foregroundPath !== undefined
        ? r.root === findGitRoot(foregroundPath)
        : r.isForeground,
    }));
  }

  const roots = scanForRepos(workRoots());
  const repos = await Promise.all(roots.map((root) => snapshotRepo(root, foregroundPath)));

  repos.sort((a, b) => {
    if (a.isForeground !== b.isForeground) return a.isForeground ? -1 : 1;
    if (a.dirty !== b.dirty) return a.dirty ? -1 : 1;
    return 0;
  });

  cachedRepos = repos;
  cachedAt = now;
  return repos;
}

export function crossRepoLine(repos: BriefRepo[]): string {
  if (repos.length <= 1) return "";
  const parts = repos.map((r) => {
    if (r.isForeground) return `${safe(r.name)} ←`;
    const status = r.dirty ? `${safe(r.branch)} · dirty` : safe(r.branch);
    const time = r.lastCommitRelative ? ` · ${safe(r.lastCommitRelative)}` : "";
    return `${safe(r.name)} (${status}${time})`;
  });
  // ponytail: show max 5 repos
  return `  ${parts.slice(0, 5).join("  ")}` + (repos.length > 5 ? `  +${repos.length - 5} more` : "");
}

// ponytail: strip unlikely branch chars for prompt safety
function safe(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, "").slice(0, 64);
}

export function crossRepoContext(repos: BriefRepo[]): string {
  if (repos.length <= 1) return "";
  const lines = repos.map((r) => {
    const marker = r.isForeground ? " ← foreground" : "";
    const dirty = r.dirty ? " (dirty)" : "";
    const time = r.lastCommitRelative ? ` last commit ${safe(r.lastCommitRelative)}` : "";
    return `- ${safe(r.name)}: ${r.root} (${safe(r.branch)})${dirty}${time}${marker}`;
  });
  return `\nGeorge's repositories:\n${lines.join("\n")}`;
}
