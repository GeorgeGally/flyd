import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname, platform } from "node:os";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";

// The Machines tab: the computer Flyd runs on, read locally, and every saved
// machine, read over `ssh <alias>`. Readings are one fixed script and nothing
// else: nothing typed on the page reaches a shell, and the script only reads.
// A machine is saved as a name and an alias; keys, users and ports stay in the
// SSH config. Each machine is read on its own, so a dead one only marks its own
// row. Readings live in memory.

export interface SavedMachine {
  name: string;
  alias: string;
}

/** Bytes. */
export interface MachineUsage {
  used: number;
  total: number;
}

export interface MachineProcess {
  name: string;
  /** Percent of one core, added up across the processes of that name. */
  cpu: number;
  memory: number;
}

export interface MachineReading {
  cores?: number;
  /** One, five and fifteen minutes. */
  load?: [number, number, number];
  memory?: MachineUsage;
  swap?: MachineUsage;
  disk?: MachineUsage;
  running: MachineProcess[];
}

export interface MachineRow {
  id: string;
  name: string;
  alias?: string;
  local: boolean;
  state: "checking" | "online" | "offline";
  reading?: MachineReading;
  /** Why an offline machine is offline, in plain words. */
  reason?: string;
  seenAt?: string;
}

export const FIRST_MACHINES: SavedMachine[] = [
  { name: "PC", alias: "radarboy3k" },
  { name: "Server", alias: "85.155.185.63" },
];

const NAME_MAX = 60;
const ALIAS_MAX = 120;
const CONNECT_TIMEOUT_SECONDS = 5;
const READ_TIMEOUT_MS = 10_000;
const FRESH_MS = 20_000;
const OUTPUT_MAX = 256 * 1024;
const ERROR_MAX = 8 * 1024;
const RUNNING_MAX = 5;
/** Outside the alias grammar, so no saved machine can share the local row. */
const LOCAL_ID = "@local";

/** What a read runs, on Linux and macOS alike. Sent as sh's stdin, so a remote login shell of any kind runs it the same. */
export const READ_SCRIPT = `export LC_ALL=C PATH=/usr/bin:/bin:/usr/sbin:/sbin:$PATH
echo @@cores; getconf _NPROCESSORS_ONLN
echo @@uptime; uptime
echo @@memory; if [ -r /proc/meminfo ]; then cat /proc/meminfo; else sysctl -n hw.memsize; vm_stat; sysctl -n vm.swapusage; fi
echo @@disk; if [ -d /System/Volumes/Data ]; then df -kP /System/Volumes/Data; else df -kP /; fi
echo @@running; ps -A -o pcpu= -o pmem= -o comm= | sort -rn | head -n 60
echo @@end
`;

// The read's own commands, which ps catches mid-run.
const OWN_COMMANDS = new Set(["ps", "sort", "head", "sh"]);

/** An alias can never read as an ssh option: it starts with a letter, digit or user, and holds no spaces or shell characters. */
export function validAlias(alias: string): boolean {
  return alias.length <= ALIAS_MAX && /^(?:[A-Za-z0-9_][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9._-]*$/.test(alias);
}

/** The whole ssh command line. Never prompts, forwards nothing, and runs no LocalCommand or RemoteCommand from the config. */
export function sshArgs(alias: string): string[] {
  if (!validAlias(alias)) throw new Error("not an SSH host alias");
  const options = ["BatchMode=yes", `ConnectTimeout=${CONNECT_TIMEOUT_SECONDS}`, "ConnectionAttempts=1", "ControlMaster=no",
    "ClearAllForwardings=yes", "PermitLocalCommand=no", "RemoteCommand=none", "LogLevel=ERROR"];
  return ["-T", "-x", "-a", ...options.flatMap((option) => ["-o", option]), "--", alias, "sh -s"];
}

function sectionsOf(output: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let open: string[] | undefined;
  for (const line of output.split(/\r?\n/)) {
    const marker = /^@@(\w+)$/.exec(line.trim());
    if (marker) sections.set(marker[1]!, (open = []));
    else open?.push(line);
  }
  return sections;
}

function linuxMemory(lines: string[]): { memory?: MachineUsage; swap?: MachineUsage } {
  const kb = (key: string): number | undefined => {
    const found = lines.map((line) => new RegExp(`^${key}:\\s+(\\d+)`).exec(line)).find(Boolean);
    return found ? Number(found[1]) * 1024 : undefined;
  };
  const [total, available, swapTotal, swapFree] = [kb("MemTotal"), kb("MemAvailable"), kb("SwapTotal"), kb("SwapFree")];
  return {
    ...(total !== undefined && available !== undefined ? { memory: { used: total - available, total } } : {}),
    ...(swapTotal !== undefined && swapFree !== undefined ? { swap: { used: swapTotal - swapFree, total: swapTotal } } : {}),
  };
}

function macBytes(amount: string, unit: string): number {
  return Number(amount) * { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[unit as "K" | "M" | "G"];
}

function macMemory(lines: string[]): { memory?: MachineUsage; swap?: MachineUsage } {
  const text = lines.join("\n");
  const total = Number(/^\s*(\d+)\s*$/m.exec(text)?.[1]);
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  const pages = (label: string): number => Number(new RegExp(`^${label}:\\s+(\\d+)`, "m").exec(text)?.[1] ?? 0);
  const used = (pages("Pages active") + pages("Pages wired down") + pages("Pages occupied by compressor")) * pageSize;
  const swap = /total = ([\d.]+)([KMG])\s+used = ([\d.]+)([KMG])/.exec(text);
  return {
    ...(total && pageSize ? { memory: { used: Math.min(used, total), total } } : {}),
    ...(swap ? { swap: { used: macBytes(swap[3]!, swap[4]!), total: macBytes(swap[1]!, swap[2]!) } } : {}),
  };
}

function diskOf(lines: string[]): MachineUsage | undefined {
  const row = lines.map((line) => /(\d+)\s+(\d+)\s+\d+\s+\d+%\s+\/.*$/.exec(line)).find(Boolean);
  return row ? { used: Number(row[2]) * 1024, total: Number(row[1]) * 1024 } : undefined;
}

function runningOf(lines: string[]): MachineProcess[] {
  const byName = new Map<string, MachineProcess>();
  for (const line of lines) {
    const row = /^\s*([\d.]+)\s+([\d.]+)\s+(.+?)\s*$/.exec(line);
    if (!row) continue;
    // macOS gives the whole path, spaces and all; Linux gives a short name that may hold a slash.
    const command = row[3]!.startsWith("/") ? row[3]!.slice(row[3]!.lastIndexOf("/") + 1) : row[3]!;
    const name = command.replace(/\p{Cc}/gu, "").slice(0, 40);
    if (!name || OWN_COMMANDS.has(name)) continue;
    const seen = byName.get(name) ?? { name, cpu: 0, memory: 0 };
    byName.set(name, { name, cpu: seen.cpu + Number(row[1]), memory: seen.memory + Number(row[2]) });
  }
  return [...byName.values()].sort((a, b) => b.cpu - a.cpu || b.memory - a.memory).slice(0, RUNNING_MAX)
    .map((process) => ({ ...process, cpu: Math.round(process.cpu * 10) / 10, memory: Math.round(process.memory * 10) / 10 }));
}

/** The read's output as a reading, or null when it stopped short or held nothing Flyd can use. Anything printed before the first marker is ignored. Pure. */
export function parseReading(output: string): MachineReading | null {
  const sections = sectionsOf(output);
  if (!sections.has("end")) return null;
  const cores = Number((sections.get("cores") ?? [])[0]);
  const load = /load averages?:\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec((sections.get("uptime") ?? []).join(" "));
  const memoryLines = sections.get("memory") ?? [];
  const { memory, swap } = memoryLines.some((line) => line.startsWith("MemTotal:")) ? linuxMemory(memoryLines) : macMemory(memoryLines);
  const disk = diskOf(sections.get("disk") ?? []);
  if (!load && !memory && !disk) return null;
  return {
    ...(cores > 0 ? { cores } : {}),
    ...(load ? { load: [Number(load[1]), Number(load[2]), Number(load[3])] as [number, number, number] } : {}),
    ...(memory ? { memory } : {}),
    ...(swap ? { swap } : {}),
    ...(disk ? { disk } : {}),
    running: runningOf(sections.get("running") ?? []),
  };
}

/** Why a machine could not be read. The raw error stays out of the page: it can carry a server's banner. */
export function offlineReason(error: string, timedOut: boolean, missing = false): string {
  if (missing) return "SSH is not installed here.";
  if (timedOut) return "It did not answer.";
  if (/permission denied|too many authentication/i.test(error)) return "SSH could not log in. Check the key for this machine.";
  if (/could not resolve hostname|name or service not known|nodename nor servname/i.test(error)) return "SSH does not know this name.";
  if (/host key verification failed|host key .* changed/i.test(error)) return "SSH does not trust this machine yet. Connect once from a terminal.";
  return "It did not answer.";
}

interface Capture {
  output: string;
  error: string;
  code: number | null;
  timedOut: boolean;
  missing: boolean;
}

/** One command with the read script on its stdin. Settles by the deadline whatever the command does. */
function capture(file: string, args: string[], timeoutMs: number): Promise<Capture> {
  return new Promise((resolve) => {
    let output = "";
    let error = "";
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    const settle = (result: Pick<Capture, "code" | "timedOut" | "missing">) => {
      clearTimeout(timer);
      resolve({ output, error, ...result });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle({ code: null, timedOut: true, missing: false });
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { if (output.length < OUTPUT_MAX) output += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { if (error.length < ERROR_MAX) error += chunk.toString("utf8"); });
    child.on("error", (cause: NodeJS.ErrnoException) => settle({ code: null, timedOut: false, missing: cause.code === "ENOENT" }));
    child.on("close", (code) => settle({ code, timedOut: false, missing: false }));
    child.stdin.on("error", () => {});
    child.stdin.end(READ_SCRIPT);
  });
}

interface Cell {
  busy: boolean;
  readAt: number;
  reading?: MachineReading;
  reason?: string;
  seenAt?: string;
}

interface Target {
  id: string;
  name: string;
  alias?: string;
}

export interface MachinesOptions {
  /** Where the list is saved. */
  path?: string;
  /** The ssh program. */
  ssh?: string;
  timeoutMs?: number;
  freshMs?: number;
  /** The first list, used until a change saves one. */
  first?: SavedMachine[];
  localName?: string;
}

const shortHost = (): string => hostname().split(".")[0] ?? "";

/** The list and the latest reading of each machine. Asking for the view starts any read that is due and never waits for one. */
export class MachinesBoard {
  private readonly cells = new Map<string, Cell>();
  private readonly path: string;

  constructor(private readonly options: MachinesOptions = {}) {
    this.path = options.path ?? join(FLYD_DIR, "machines.json");
  }

  saved(): SavedMachine[] {
    return this.stored().machines;
  }

  /** What the list holds. Only a missing file means nothing is saved yet; `whole` is false when some of the file could not be used, so it must not be saved over. */
  private stored(): { machines: SavedMachine[]; whole: boolean } {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.path, "utf8"));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") return { machines: [], whole: false };
      // The computer Flyd is on is already the local row.
      return { machines: (this.options.first ?? FIRST_MACHINES).filter((machine) => machine.alias.toLowerCase() !== shortHost().toLowerCase()), whole: true };
    }
    const entries = (raw as { machines?: unknown } | null)?.machines;
    if (!Array.isArray(entries)) return { machines: [], whole: false };
    const machines = entries.flatMap((entry: { name?: unknown; alias?: unknown }) =>
      typeof entry?.name === "string" && entry.name.trim() && typeof entry.alias === "string" && validAlias(entry.alias)
        ? [{ name: entry.name.trim().slice(0, NAME_MAX), alias: entry.alias }] : []);
    return { machines, whole: machines.length === entries.length };
  }

  /** Saves a new machine, or says why not. */
  add(name: string, alias: string): { error?: string } {
    const named = name.replace(/\s+/g, " ").trim();
    const host = alias.trim();
    if (!named) return { error: "Give the machine a name." };
    if (named.length > NAME_MAX) return { error: "That name is too long." };
    if (!validAlias(host)) return { error: "That is not an SSH host alias. Use the name from your SSH config, like studio or george@studio." };
    const { machines, whole } = this.stored();
    if (!whole) return { error: `Flyd could not read all of ${this.path}, so it left the file alone. Fix it, then add the machine again.` };
    if (machines.some((machine) => machine.alias.toLowerCase() === host.toLowerCase())) return { error: "That machine is already on the list." };
    this.save([...machines, { name: named, alias: host }]);
    return {};
  }

  view(): { machines: MachineRow[] } {
    const local: Target = { id: LOCAL_ID, name: this.options.localName ?? (platform() === "darwin" ? "Mac" : shortHost()) };
    const targets: Target[] = [local, ...this.saved().map(({ name, alias }) => ({ id: alias, name, alias }))];
    const listed = new Set(targets.map((target) => target.id));
    for (const id of this.cells.keys()) if (!listed.has(id)) this.cells.delete(id);
    return { machines: targets.map((target) => this.row(target)) };
  }

  private row(target: Target): MachineRow {
    const cell = this.cells.get(target.id) ?? { busy: false, readAt: 0 };
    this.cells.set(target.id, cell);
    if (!cell.busy && Date.now() - cell.readAt >= (this.options.freshMs ?? FRESH_MS)) void this.read(target, cell);
    const state = cell.reason ? "offline" : cell.reading ? "online" : "checking";
    return {
      id: target.id, name: target.name, local: !target.alias, state,
      ...(target.alias ? { alias: target.alias } : {}),
      ...(state === "online" ? { reading: cell.reading } : {}),
      ...(cell.reason ? { reason: cell.reason } : {}),
      ...(cell.seenAt ? { seenAt: cell.seenAt } : {}),
    };
  }

  private async read(target: Target, cell: Cell): Promise<void> {
    cell.busy = true;
    const timeoutMs = this.options.timeoutMs ?? READ_TIMEOUT_MS;
    const result = await (target.alias ? capture(this.options.ssh ?? "ssh", sshArgs(target.alias), timeoutMs) : capture("sh", ["-s"], timeoutMs));
    const reading = result.code === 0 ? parseReading(result.output) : null;
    cell.busy = false;
    cell.readAt = Date.now();
    if (reading) {
      cell.reading = reading;
      cell.seenAt = new Date().toISOString();
      delete cell.reason;
    } else {
      delete cell.reading;
      cell.reason = offlineReason(result.error, result.timedOut, result.missing);
    }
  }

  private save(machines: SavedMachine[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const next = `${this.path}.${process.pid}.tmp`;
    writeFileSync(next, `${JSON.stringify({ machines }, null, 2)}\n`, { mode: 0o600 });
    renameSync(next, this.path);
  }
}
