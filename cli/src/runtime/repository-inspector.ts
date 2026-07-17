import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import type { RepositorySnapshot } from "./types.js";

const execFileAsync = promisify(execFile);
export type CommandRunner = (command: string, args: string[]) => Promise<string>;

export class RepositoryInspectionError extends Error {}

const defaultRunner: CommandRunner = async (command, args) => {
  const { stdout } = await execFileAsync(command, args, { encoding: "utf8", timeout: 5_000 });
  return stdout;
};

function repositoryName(remote: string | null, root: string): string {
  if (!remote) return root.split("/").filter(Boolean).at(-1) ?? root;
  const match = remote.match(/(?:github\.com[:/])([^/]+\/[^/]+?)(?:\.git)?$/) ?? remote.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match?.[1] ?? remote.split("/").at(-1)?.replace(/\.git$/, "") ?? root;
}

async function optional(run: CommandRunner, args: string[]): Promise<string | null> {
  try {
    return (await run("git", args)).trim() || null;
  } catch {
    return null;
  }
}

export async function inspectRepository(cwd = process.cwd(), run: CommandRunner = defaultRunner): Promise<RepositorySnapshot> {
  let root: string;
  try {
    root = (await run("git", ["-C", cwd, "rev-parse", "--show-toplevel"])).trim();
  } catch (error) {
    throw new RepositoryInspectionError(`Flyd coding work requires a Git repository: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!root) throw new RepositoryInspectionError("Flyd could not determine the Git repository root");

  const [remote, branch, head, statusOutput] = await Promise.all([
    optional(run, ["-C", root, "remote", "get-url", "origin"]),
    optional(run, ["-C", root, "branch", "--show-current"]),
    optional(run, ["-C", root, "rev-parse", "HEAD"]),
    run("git", ["-C", root, "status", "--porcelain=v1", "--untracked-files=all"]).catch(() => ""),
  ]);
  if (!head) throw new RepositoryInspectionError("Flyd could not read the repository HEAD");

  const normalizedStatus = statusOutput?.trimEnd() ?? "";
  const statusLines = normalizedStatus ? normalizedStatus.split("\n") : [];
  return {
    root,
    name: repositoryName(remote, root),
    remote,
    branch: branch ?? "detached",
    head,
    dirty: statusLines.length > 0,
    statusLines,
    statusDigest: createHash("sha256").update(normalizedStatus || "clean").digest("hex"),
  };
}
