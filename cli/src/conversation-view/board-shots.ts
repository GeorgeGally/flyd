import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";

// A picture of a Liesel board, so a card that asks him to look at one shows
// the board itself rather than only a link to it. The board already exists:
// Flyd opens it in a headless Chrome of its own (a throwaway profile, never his
// browser), takes one screen of it as he would see it on opening, and keeps it
// in ~/.flyd/view/board-shots. Nothing on the board is created, changed or
// rebuilt. One board at a time, each bounded by a timeout, and taken again
// once the picture is old, so the card follows the board as it moves on.

/** A board on this Mac's Liesel: its key, from a link to it. */
const BOARD_LINK = /^https?:\/\/(?:127\.0\.0\.1|localhost):4747\/board\/([A-Za-z0-9_-]{6,64})(?:[/?#]|[.;:,]*$)/i;

/** The board a link opens, or undefined for any other link. Pure. */
export function lieselBoardKey(url: string | undefined): string | undefined {
  return url ? BOARD_LINK.exec(url.trim())?.[1] : undefined;
}

/** Where the phone reaches this Mac's Liesel: its tailnet name. `FLYD_LIESEL_URL` overrides it. */
export const LIESEL_TAILNET_ORIGIN = "http://macbook-pro-3.tail46029c.ts.net:4747";

/** The origin a card's board link opens on, from `FLYD_LIESEL_URL` or the tailnet name. */
export function lieselPublicOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return (env.FLYD_LIESEL_URL?.trim() || LIESEL_TAILNET_ORIGIN).replace(/\/+$/, "");
}

const LOOPBACK_BOARD = /https?:\/\/(?:127\.0\.0\.1|localhost):4747(?=\/board\/)/gi;

/** A board link (or a line of text naming one) as the phone can open it: this Mac's loopback Liesel on its public origin. Pure. */
export function publicBoardUrl(text: string, origin = lieselPublicOrigin()): string {
  return text.replace(LOOPBACK_BOARD, origin);
}

/** Where the page loads a board's picture from; the server serves only boards it has pictured. */
export function boardShotSrc(key: string, version: number): string {
  return `/api/board-shot?board=${encodeURIComponent(key)}&v=${version}`;
}

const VIEW = { width: 1440, height: 900 };
const TIMEOUT_MS = 45_000;
/** A picture older than this is taken again the next time a card asks for it. */
const FRESH_MS = 30 * 60_000;
/** A board Chrome could not picture is not tried again for this long. */
const RETRY_MS = 10 * 60_000;
const MAX_QUEUE = 4;

const CHROMES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function chromePath(): string | undefined {
  const own = process.env.FLYD_CHROME;
  if (own) return existsSync(own) ? own : undefined;
  return CHROMES.find((path) => existsSync(path));
}

/** The headless Chrome arguments for one screen of a page: its own throwaway profile, no keychain, no window. Pure. */
export function captureArgs(url: string, png: string, profile: string): string[] {
  return [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--mute-audio",
    "--use-mock-keychain",
    "--password-store=basic",
    `--user-data-dir=${profile}`,
    `--window-size=${VIEW.width},${VIEW.height}`,
    "--virtual-time-budget=6000",
    `--screenshot=${png}`,
    url,
  ];
}

/** One screen of the board, written to `png`; false when there is no Chrome or it took no picture. */
export async function captureBoard(key: string, png: string, chrome = chromePath()): Promise<boolean> {
  if (!chrome) return false;
  const profile = mkdtempSync(join(tmpdir(), "flyd-board-"));
  try {
    await new Promise<void>((resolve) => {
      const child = spawn(chrome, captureArgs(`http://127.0.0.1:4747/board/${encodeURIComponent(key)}`, png, profile), { stdio: "ignore" });
      const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
      // Flyd stopping mid-picture takes its browser with it.
      const onExit = () => child.kill("SIGKILL");
      process.once("exit", onExit);
      const done = () => {
        clearTimeout(timer);
        process.off("exit", onExit);
        resolve();
      };
      child.once("error", done);
      child.once("exit", done);
    });
    return existsSync(png) && statSync(png).size > 0;
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

/** Pictures of Liesel boards, taken in the background and kept on disk. */
export class BoardShots {
  readonly root: string;
  private readonly queue: string[] = [];
  private readonly failedAt = new Map<string, number>();
  private running = false;
  private readonly listeners = new Set<() => void>();
  private readonly capture: (key: string, png: string) => Promise<boolean>;
  private readonly now: () => number;

  constructor(options: { root?: string; capture?: (key: string, png: string) => Promise<boolean>; now?: () => number } = {}) {
    this.root = options.root ?? join(FLYD_DIR, "view", "board-shots");
    this.capture = options.capture ?? ((key, png) => captureBoard(key, png));
    this.now = options.now ?? Date.now;
  }

  /** Called when a board's picture is taken, so the views can show it. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private file(key: string): string {
    return join(this.root, `${key}.png`);
  }

  /** The picture of a board and when it was taken, or null when there is none yet. */
  picture(key: string): { path: string; at: number } | null {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(key)) return null;
    try {
      const info = statSync(this.file(key));
      return info.size > 0 ? { path: this.file(key), at: Math.round(info.mtimeMs) } : null;
    } catch {
      return null;
    }
  }

  /** The board's picture as it stands; taken again in the background when it is missing or old. */
  want(key: string): { path: string; at: number } | null {
    const kept = this.picture(key);
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(key)) return kept;
    const stale = !kept || this.now() - kept.at > FRESH_MS;
    const resting = this.now() - (this.failedAt.get(key) ?? Number.NEGATIVE_INFINITY) < RETRY_MS;
    if (stale && !resting && !this.queue.includes(key)) {
      // A full queue lets its oldest go, to be asked for again on a later look.
      if (this.queue.length >= MAX_QUEUE) this.queue.shift();
      this.queue.push(key);
      void this.drain();
    }
    return kept;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let key = this.queue.shift(); key; key = this.queue.shift()) {
        mkdirSync(this.root, { recursive: true, mode: 0o700 });
        // Written beside the kept picture and moved over it: a card never loads half a picture.
        const fresh = join(this.root, `${key}.${process.pid}.tmp.png`);
        let taken = false;
        try {
          taken = await this.capture(key, fresh);
        } catch {
          taken = false;
        }
        if (taken) {
          renameSync(fresh, this.file(key));
          this.failedAt.delete(key);
          for (const listener of this.listeners) listener();
        } else {
          rmSync(fresh, { force: true });
          this.failedAt.set(key, this.now());
        }
      }
    } finally {
      this.running = false;
    }
  }
}
