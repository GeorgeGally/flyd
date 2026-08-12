import { readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, basename } from "node:path";

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

function repoName(root: string): string {
  return basename(root);
}

function gitOutput(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

function snapshotRepo(root: string, foregroundPath?: string): BriefRepo {
  const branch = gitOutput(root, ["branch", "--show-current"]) || "detached";
  const statusOut = gitOutput(root, ["status", "--porcelain"]);
  const dirty = statusOut !== null && statusOut !== "";
  const lastCommitRelative = gitOutput(root, ["log", "-1", "--format=%cr"]);
  const isForeground = foregroundPath !== undefined
    ? root === findGitRoot(foregroundPath)
    : false;

  return {
    root,
    name: repoName(root),
    branch,
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

export function refreshRepoRegistry(foregroundPath?: string): BriefRepo[] {
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
  const repos = roots.map((root) => snapshotRepo(root, foregroundPath));

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
    if (r.isForeground) return `${r.name} ←`;
    const status = r.dirty ? `${r.branch} · dirty` : r.branch;
    const time = r.lastCommitRelative ? ` · ${r.lastCommitRelative}` : "";
    return `${r.name} (${status}${time})`;
  });
  // ponytail: show max 5 repos
  return `  ${parts.slice(0, 5).join("  ")}` + (repos.length > 5 ? `  +${repos.length - 5} more` : "");
}

export function crossRepoContext(repos: BriefRepo[]): string {
  if (repos.length <= 1) return "";
  const active = repos.filter((r) => r.dirty || r.lastCommitRelative);
  if (active.length === 0) return "";
  const lines = active.map((r) => {
    const marker = r.isForeground ? " ← foreground" : "";
    const dirty = r.dirty ? " (dirty)" : "";
    const time = r.lastCommitRelative ? ` last commit ${r.lastCommitRelative}` : "";
    return `- ${r.name} (${r.branch})${dirty}${time}${marker}`;
  });
  return `\nGeorge's active repositories:\n${lines.join("\n")}`;
}
