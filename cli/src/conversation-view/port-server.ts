import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

// Which server answers on a local port: the process listening there, how it
// was started, and the folder it serves. Read-only: lsof and ps, never a
// signal or a write. Asked so the right column can say "php -S serving
// ~/Documents/good_neighbours" under a preview, and notice when that changes.

export interface PortServer {
  pid: number;
  /** How it was started, short: "php -S", "python -m http.server", "node vite". */
  command: string;
  /** The folder it serves: php's -t, http.server's --directory, else its working folder. */
  folder?: string;
}

export type PortLookup = (port: number) => Promise<PortServer | null>;

const TIMEOUT_MS = 1_500;

function tool(name: string): string {
  for (const dir of ["/usr/sbin", "/usr/bin", "/bin"]) if (existsSync(`${dir}/${name}`)) return `${dir}/${name}`;
  return name;
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: TIMEOUT_MS, maxBuffer: 256 * 1024 }, (_error, stdout) => resolve(String(stdout ?? "")));
  });
}

/** The first pid in lsof's field output ("p123\ncphp\n…"). Pure. */
export function pidFromLsof(output: string): number | null {
  const match = /^p(\d+)$/m.exec(output);
  return match ? Number(match[1]) : null;
}

/** The value of the first "n" field in lsof's field output: the cwd's path. Pure. */
export function nameFromLsof(output: string): string | undefined {
  return /^n(.+)$/m.exec(output)?.[1];
}

function base(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? path;
}

/** The value after a flag: "-t DIR", "-tDIR", "--directory=DIR". */
function flag(args: string[], names: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    for (const name of names) {
      if (arg === name) return args[index + 1];
      if (name.startsWith("--") && arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
      if (!name.startsWith("--") && arg.startsWith(name) && arg.length > name.length) return arg.slice(name.length);
    }
  }
  return undefined;
}

/** How the server was started, and the folder it serves, from its command line. Pure. */
export function describeServer(commandLine: string, cwd?: string): Omit<PortServer, "pid"> {
  const args = commandLine.trim().split(/\s+/).filter(Boolean);
  const program = base(args[0] ?? "").replace(/\d+(?:\.\d+)*$/, "") || "server";
  const absolute = (path: string | undefined): string | undefined => {
    if (!path) return undefined;
    if (path.startsWith("/")) return path.replace(/\/+$/, "") || "/";
    return cwd ? `${cwd.replace(/\/+$/, "")}/${path.replace(/^\.\/?/, "")}`.replace(/\/+$/, "") : path;
  };
  const folder = (served?: string) => {
    const path = absolute(served) ?? cwd;
    return path ? { folder: path } : {};
  };
  if (program === "php" && args.includes("-S")) return { command: "php -S", ...folder(flag(args, ["-t"])) };
  const module = flag(args, ["-m"]);
  if (program === "python" && module) return { command: `python -m ${module}`, ...folder(flag(args, ["--directory", "-d"])) };
  if (["node", "bun", "deno", "npx", "ruby"].includes(program)) {
    const script = args.slice(1).find((arg) => !arg.startsWith("-"));
    return { command: script ? `${program} ${base(script).replace(/\.(?:m?js|cjs|ts)$/, "")}` : program, ...folder() };
  }
  return { command: program, ...folder() };
}

/** The server listening on a loopback port, or null when nothing listens there. */
export const lookupPortServer: PortLookup = async (port) => {
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return null;
  const lsof = tool("lsof");
  const pid = pidFromLsof(await run(lsof, ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"]));
  if (pid === null) return null;
  const [commandLine, cwdFields] = await Promise.all([
    run(tool("ps"), ["-ww", "-o", "command=", "-p", String(pid)]),
    run(lsof, ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]),
  ]);
  if (!commandLine.trim()) return null;
  return { pid, ...describeServer(commandLine, nameFromLsof(cwdFields)) };
};

/** One server as one identity: a different process, command or folder is a different server. */
export function sameServer(a: PortServer | null | undefined, b: PortServer | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.pid === b.pid && a.command === b.command && a.folder === b.folder;
}
