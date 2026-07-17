import { execFile as nodeExecFile } from "child_process";
import { createHash } from "crypto";
import { mkdir, stat } from "fs/promises";
import { homedir } from "os";
import { join, resolve } from "path";
import { promisify } from "util";

const execFileAsync = promisify(nodeExecFile);

export interface ManagedWorktree {
  path: string;
  branchName: string;
  baseHead: string;
}

type GitRunner = (args: string[]) => Promise<string>;

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("Worktree identifier must contain a letter or number");
  return normalized.slice(0, 48);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export class GitWorktreeManager {
  readonly managedRoot: string;
  private readonly runGit: GitRunner;

  constructor(input: { managedRoot?: string; runGit?: GitRunner } = {}) {
    this.managedRoot = resolve(input.managedRoot ?? join(homedir(), ".flyd", "runtime", "worktrees"));
    this.runGit = input.runGit ?? (async (args) => {
      const { stdout } = await execFileAsync("git", args, { encoding: "utf8", timeout: 30_000 });
      return stdout;
    });
  }

  pathFor(taskKey: string, assignmentKey: string): string {
    const path = resolve(this.managedRoot, slug(taskKey), slug(assignmentKey));
    if (!path.startsWith(`${this.managedRoot}/`)) throw new Error("Managed worktree path escaped its root");
    return path;
  }

  branchFor(taskKey: string, assignmentKey: string): string {
    const digest = createHash("sha256").update(`${taskKey}:${assignmentKey}`).digest("hex").slice(0, 8);
    return `flyd/${slug(taskKey).slice(0, 8)}/${slug(assignmentKey).slice(0, 8)}-${digest}`;
  }

  async prepare(input: {
    repositoryRoot: string;
    taskKey: string;
    assignmentKey: string;
    baseHead: string;
  }): Promise<ManagedWorktree> {
    const path = this.pathFor(input.taskKey, input.assignmentKey);
    const branchName = this.branchFor(input.taskKey, input.assignmentKey);
    if (await exists(path)) {
      try {
        const [root, branch] = await Promise.all([
          this.runGit([ "-C", path, "rev-parse", "--show-toplevel" ]),
          this.runGit([ "-C", path, "branch", "--show-current" ]),
        ]);
        if (resolve(root.trim()) !== path || branch.trim() !== branchName) {
          throw new Error("mismatch");
        }
        return { path, branchName, baseHead: input.baseHead };
      } catch {
        throw new Error(`Flyd refuses to reuse an unrelated directory at ${path}`);
      }
    }

    await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
    await this.runGit([
      "-C", resolve(input.repositoryRoot),
      "worktree", "add", "-b", branchName, path, input.baseHead,
    ]);
    return { path, branchName, baseHead: input.baseHead };
  }

  async remove(repositoryRoot: string, worktree: ManagedWorktree, force = false): Promise<void> {
    const args = [ "-C", resolve(repositoryRoot), "worktree", "remove" ];
    if (force) args.push("--force");
    args.push(worktree.path);
    await this.runGit(args);
  }
}
