import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { lieselPublicOrigin } from "./board-shots.js";

// Liesel, the design board server, does not need to run all the time. A card's
// "Open board" button goes through Flyd's own /open-board/<key> page: it says
// "One moment, opening the board", asks Liesel whether it answers, starts it
// when it is down (the same command George uses, detached, logging to
// ~/.easel/server.log), waits until it serves that board, then opens it. A
// board Liesel no longer knows is said plainly. Never more than one Liesel:
// anything already answering on the port counts as running, and one start at a
// time is shared by every page waiting on it.

export const LIESEL_PORT = 4747;
export const LIESEL_LOCAL_ORIGIN = `http://127.0.0.1:${LIESEL_PORT}`;

const KEY = /^[A-Za-z0-9_-]{6,64}$/;
/** A link to a board on this Mac's Liesel, on loopback or its public (tailnet) origin. */
const BOARD_ON_PORT = new RegExp(`^https?:\\/\\/[^/\\s]+:${LIESEL_PORT}\\/board\\/([A-Za-z0-9_-]{6,64})(?:[/?#]|[.;:,]*$)`, "i");

/** A board's key, from a link to it on loopback or the tailnet origin, or undefined. Pure. */
export function boardKeyOf(url: string | undefined): string | undefined {
  return url ? BOARD_ON_PORT.exec(url.trim())?.[1] : undefined;
}

export function isBoardKey(key: string): boolean {
  return KEY.test(key);
}

/** Flyd's page that opens a board, starting Liesel first when it is down. Pure. */
export function openBoardHref(key: string): string {
  return `/open-board/${encodeURIComponent(key)}`;
}

/** A card link as Flyd shows it: a Liesel board goes through Flyd's opener, anything else is unchanged. Pure. */
export function viaOpener<T extends { label: string; url: string }>(link: T): T {
  const key = boardKeyOf(link.url);
  return key ? { ...link, label: "Open board", url: openBoardHref(key) } : link;
}

/** A board as he reads it, by its own name: "DIR start control" reads "DIR start control board". Pure. */
export function boardTitle(name: string): string {
  const said = name.trim().replace(/\s+/g, " ");
  return /\bboard$/i.test(said) ? said : `${said} board`;
}

/** Where a board opens: on this Mac, and on the address the phone reaches. Pure. */
export function boardUrls(key: string, publicOrigin = lieselPublicOrigin()): { local: string; public: string } {
  const path = `/board/${encodeURIComponent(key)}`;
  return { local: `${LIESEL_LOCAL_ORIGIN}${path}`, public: `${publicOrigin}${path}` };
}

const EASEL_HOME = join(homedir(), ".easel");

/**
 * The board a project keeps in its own `.liesel` folder, by key, from Liesel's
 * saved state: `~/Documents/cap5/.liesel/board.json` is cap5's board. A board
 * Liesel has ended is not offered. Undefined when there is none.
 */
export class ProjectBoards {
  private cache?: { mtimeMs: number; boards: Map<string, string> };

  constructor(private readonly stateFile = join(EASEL_HOME, "state.json")) {}

  keyFor(repo: string | undefined): string | undefined {
    const name = repo?.trim().split("/").pop();
    if (!name) return undefined;
    return this.boards().get(name.toLowerCase());
  }

  private boards(): Map<string, string> {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(this.stateFile).mtimeMs;
    } catch {
      return new Map();
    }
    if (this.cache?.mtimeMs === mtimeMs) return this.cache.boards;
    const boards = new Map<string, string>();
    try {
      const sessions = (JSON.parse(readFileSync(this.stateFile, "utf8")) as { sessions?: Record<string, { key?: string; file?: string; status?: string }> }).sessions ?? {};
      for (const [id, session] of Object.entries(sessions)) {
        const key = session.key ?? id;
        const project = /\/([^/]+)\/\.liesel\/board\.json$/.exec(session.file ?? "")?.[1];
        if (project && session.status !== "ended" && isBoardKey(key)) boards.set(project.toLowerCase(), key);
      }
    } catch {
      // A state file mid-write reads as none; the next change is read again.
    }
    this.cache = { mtimeMs, boards };
    return boards;
  }
}

/**
 * Each board's own name, by key, as its `board.json` names it ("DIR start control"),
 * from Liesel's saved state. Read only; a board with no name, or a file that cannot be
 * read, has none. Each file is read again only when it changes.
 */
export class BoardNames {
  private files?: { mtimeMs: number; byKey: Map<string, string> };
  private readonly names = new Map<string, { mtimeMs: number; name?: string }>();

  constructor(private readonly stateFile = join(EASEL_HOME, "state.json")) {}

  nameOf(key: string): string | undefined {
    const file = this.boardFiles().get(key);
    if (!file) return undefined;
    let mtimeMs: number;
    try {
      mtimeMs = statSync(file).mtimeMs;
    } catch {
      return undefined;
    }
    const cached = this.names.get(file);
    if (cached?.mtimeMs === mtimeMs) return cached.name;
    let name: string | undefined;
    try {
      const said = (JSON.parse(readFileSync(file, "utf8")) as { name?: unknown }).name;
      name = typeof said === "string" && said.trim() ? said.trim().slice(0, 80) : undefined;
    } catch {
      name = undefined;
    }
    this.names.set(file, { mtimeMs, ...(name ? { name } : {}) });
    return name;
  }

  private boardFiles(): Map<string, string> {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(this.stateFile).mtimeMs;
    } catch {
      return new Map();
    }
    if (this.files?.mtimeMs === mtimeMs) return this.files.byKey;
    const byKey = new Map<string, string>();
    try {
      const sessions = (JSON.parse(readFileSync(this.stateFile, "utf8")) as { sessions?: Record<string, { key?: string; file?: string }> }).sessions ?? {};
      for (const [id, session] of Object.entries(sessions)) {
        const key = session.key ?? id;
        if (isBoardKey(key) && typeof session.file === "string" && session.file.endsWith(".json")) byKey.set(key, session.file);
      }
    } catch {
      // A state file mid-write reads as none; the next change is read again.
    }
    this.files = { mtimeMs, byKey };
    return byKey;
  }
}

/** What Liesel said about a board: it serves it, it does not know it, or nothing answered. */
export type BoardAnswer = "ready" | "missing" | "down";

export interface LieselOptions {
  /** Asks Liesel for a board; by default a GET on loopback with a short timeout. */
  probe?: (key: string) => Promise<BoardAnswer>;
  /** Starts Liesel detached; by default its own server command from ~/Documents/easel. Never real under vitest. */
  start?: () => void;
  /** How long to wait for a started Liesel to serve the board. */
  waitMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** The outcome of opening a board: ready, a board that is gone, or a Liesel that would not start. */
export type OpenOutcome = { state: "ready"; started: boolean } | { state: "missing" } | { state: "failed"; reason: string };

export class LieselLauncher {
  private starting?: Promise<void>;

  constructor(private readonly options: LieselOptions = {}) {}

  /** Opens a board: asks Liesel, starts it once when nothing answers, waits until it serves the board. */
  async open(key: string): Promise<OpenOutcome> {
    if (!isBoardKey(key)) return { state: "missing" };
    const probe = this.options.probe ?? probeBoard;
    const first = await probe(key);
    if (first === "ready") return { state: "ready", started: false };
    if (first === "missing") return { state: "missing" };
    try {
      this.startOnce();
    } catch (error) {
      return { state: "failed", reason: error instanceof Error ? error.message : String(error) };
    }
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const deadline = Date.now() + (this.options.waitMs ?? 30_000);
    const pollMs = this.options.pollMs ?? 400;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      const answer = await probe(key);
      if (answer === "ready") return { state: "ready", started: true };
      if (answer === "missing") return { state: "missing" };
    }
    return { state: "failed", reason: "Liesel did not answer in time" };
  }

  /** One start shared by every page waiting on it; a later open may start it again once that start has had its time. */
  private startOnce(): void {
    if (this.starting) return;
    const start = this.options.start ?? (process.env.VITEST ? () => { throw new Error("no real Liesel under vitest"); } : startLiesel);
    start();
    this.starting = new Promise<void>((resolve) => setTimeout(resolve, this.options.waitMs ?? 30_000).unref?.());
    void this.starting.then(() => { this.starting = undefined; });
  }
}

/** Asks loopback Liesel for a board: 2xx is ready, 404 is a board it does not know, no answer is down. */
export async function probeBoard(key: string, timeoutMs = 1500): Promise<BoardAnswer> {
  try {
    const response = await fetch(boardUrls(key).local, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 404 || response.status === 410) return "missing";
    // Any other answer means a server is on the port: Liesel is up, so a second one is never started.
    return "ready";
  } catch {
    return "down";
  }
}

/** Where Liesel lives and the address it also listens on for the phone; both can be overridden. */
export function lieselCommand(env: NodeJS.ProcessEnv = process.env): { cwd: string; args: string[]; log: string } {
  const cwd = env.FLYD_LIESEL_DIR?.trim() || join(homedir(), "Documents", "easel");
  const also = env.FLYD_LIESEL_ALSO_LISTEN?.trim() ?? "100.78.155.0";
  return {
    cwd,
    args: [join(cwd, "bin", "liesel-server.js"), "server", "--port", String(LIESEL_PORT), ...(also ? ["--also-listen", also] : [])],
    log: join(EASEL_HOME, "server.log"),
  };
}

/** Starts Liesel detached with Core's own node (a GUI launch has no PATH to find one), logging to ~/.easel/server.log. */
export function startLiesel(): void {
  const { cwd, args, log } = lieselCommand();
  if (!existsSync(args[0]!)) throw new Error(`Liesel is not at ${cwd}`);
  mkdirSync(EASEL_HOME, { recursive: true });
  const out = openSync(log, "a");
  try {
    const child = spawn(process.execPath, args, { cwd, detached: true, stdio: ["ignore", out, out] });
    child.on("error", () => undefined);
    child.unref();
  } finally {
    closeSync(out);
  }
}
