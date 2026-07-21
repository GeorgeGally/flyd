import { createHash } from "crypto";
import { execFile as nodeExecFile } from "child_process";
import { mkdtemp, readdir, realpath, rm } from "fs/promises";
import { tmpdir } from "os";
import { delimiter, join, resolve } from "path";
import { promisify } from "util";

const execFileAsync = promisify(nodeExecFile);

export function filesOutsideScope(changedFiles: string[], declaredFileScope: string[]): string[] {
  return changedFiles.filter((file) => !declaredFileScope.some((scope) => (
    scope === "." || file === scope || file.startsWith(`${scope}/`)
  )));
}

export interface VerificationCommandResult {
  command: string;
  executable: string;
  args: string[];
  exitStatus: number;
  stdout: string;
  stderr: string;
  outputDigest: string;
}

export interface VerifiedWorkerResult {
  passed: boolean;
  worktreePath: string;
  baseHead: string;
  head: string;
  changedFiles: string[];
  patch: string;
  patchDigest: string;
  commands: VerificationCommandResult[];
}

function splitCommand(command: string): { executable: string; args: string[] } {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | "\"" | null = null;
  let escaped = false;
  for (const character of command.trim()) {
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      continue;
    }
    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }
    if (";|&><\n\r".includes(character)) {
      throw new Error(`Verification command contains an unsupported shell operator: ${command}`);
    }
    if (/\s/.test(character)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }
    token += character;
  }
  if (escaped || quote) throw new Error(`Verification command has an unterminated escape or quote: ${command}`);
  if (token) tokens.push(token);
  if (!tokens[0]) throw new Error("Verification command cannot be empty");
  return { executable: tokens[0], args: tokens.slice(1) };
}

async function runVerificationCommand(
  cwd: string,
  command: string,
  timeoutMs: number,
): Promise<VerificationCommandResult> {
  const { executable, args } = splitCommand(command);
  let stdout = "";
  let stderr = "";
  let exitStatus = 0;
  const home = await mkdtemp(join(tmpdir(), "flyd-verify-home-"));
  try {
    if (process.platform !== "darwin") throw new Error("Verification sandbox is unavailable on this platform");
    const canonical = async (path: string) => realpath(resolve(path)).catch(() => resolve(path));
    const runtimeRoots = await Promise.all(
      (process.env.PATH ?? "").split(delimiter).filter(Boolean).map((path) => canonical(path)),
    );
    const allowedWorktree = await canonical(cwd);
    const allowedHome = await canonical(home);
    const systemTemporaryRoot = await canonical(tmpdir());
    const systemRoots = [
      "/System", "/Library", "/usr", "/bin", "/sbin", "/dev", "/private/etc",
      "/private/var/db", "/private/var/run", "/opt/homebrew",
    ];
    const allowReads = [allowedWorktree, allowedHome, ...systemRoots, ...runtimeRoots]
      .map((path) => `(allow file-read* (subpath ${JSON.stringify(path)}))`);
    const profile = [
      "(version 1)",
      "(allow default)",
      "(deny network*)",
      "(deny file-read* (subpath \"/Users\"))",
      "(deny file-read* (subpath \"/Volumes\"))",
      "(deny file-read* (subpath \"/private/tmp\"))",
      `(deny file-read* (subpath ${JSON.stringify(systemTemporaryRoot)}))`,
      "(deny file-write*)",
      ...allowReads,
      `(allow file-write* (subpath ${JSON.stringify(allowedWorktree)}))`,
      `(allow file-write* (subpath ${JSON.stringify(allowedHome)}))`,
      "(allow file-write* (subpath \"/dev\"))",
      "(allow file-write* (subpath \"/private/var/run\"))",
    ].join("\n");
    const result = await execFileAsync("/usr/bin/sandbox-exec", [ "-p", profile, executable, ...args ], {
      cwd,
      env: {
        PATH: process.env.PATH,
        LANG: process.env.LANG,
        LC_ALL: process.env.LC_ALL,
        TMPDIR: home,
        HOME: home,
      },
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string };
    stdout = failure.stdout ?? "";
    stderr = failure.stderr ?? failure.message;
    exitStatus = typeof failure.code === "number" ? failure.code : 1;
  } finally {
    await rm(home, { recursive: true, force: true });
  }
  return {
    command,
    executable,
    args,
    exitStatus,
    stdout,
    stderr,
    outputDigest: createHash("sha256").update(`${stdout}\n${stderr}`).digest("hex"),
  };
}

async function assertNoEscapingSymlinks(root: string, directory = root): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = await realpath(path).catch(() => null);
      if (!target || (target !== root && !target.startsWith(`${root}/`))) {
        throw new Error(`Verification worktree contains an escaping symlink: ${path}`);
      }
      continue;
    }
    if (entry.isDirectory() && entry.name !== ".git") await assertNoEscapingSymlinks(root, path);
  }
}

export async function verifyWorkerResult(input: {
  worktreePath: string;
  baseHead: string;
  commands: string[];
  commandTimeoutMs?: number;
  requireChanges?: boolean;
  requireUnchanged?: boolean;
}): Promise<VerifiedWorkerResult> {
  const canonicalWorktree = await realpath(resolve(input.worktreePath));
  await assertNoEscapingSymlinks(canonicalWorktree);
  const commands: VerificationCommandResult[] = [];
  for (const command of input.commands) {
    commands.push(await runVerificationCommand(input.worktreePath, command, input.commandTimeoutMs ?? 15 * 60 * 1000));
  }

  await execFileAsync("git", [ "-C", input.worktreePath, "add", "-N", "--", "." ], {
    encoding: "utf8",
    timeout: 10_000,
  });
  const [{ stdout: head }, { stdout: names }, { stdout: patch }] = await Promise.all([
    execFileAsync("git", [ "-C", input.worktreePath, "rev-parse", "HEAD" ], { encoding: "utf8", timeout: 5_000 }),
    execFileAsync("git", [ "-C", input.worktreePath, "diff", "--name-only", "--relative", input.baseHead, "--" ], { encoding: "utf8", timeout: 10_000 }),
    execFileAsync("git", [ "-C", input.worktreePath, "diff", "--binary", "--full-index", input.baseHead, "--" ], {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 50 * 1024 * 1024,
    }),
  ]);
  const changedFiles = names.trim() ? names.trim().split("\n").sort() : [];
  return {
    passed: commands.every((command) => command.exitStatus === 0) &&
      (!input.requireChanges || changedFiles.length > 0) &&
      (!input.requireUnchanged || changedFiles.length === 0),
    worktreePath: input.worktreePath,
    baseHead: input.baseHead,
    head: head.trim(),
    changedFiles,
    patch,
    patchDigest: createHash("sha256").update(patch).digest("hex"),
    commands,
  };
}
