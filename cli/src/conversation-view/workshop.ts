import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";

// What the fleet has made for him to look at, outside the conversation: Lavish
// review boards still open (a board firstmate opened for the new decks), and
// finished deliverables a task left in firstmate's data/<task>/ (a deck's PDF
// and HTML). The right column shows both as artefacts without anyone naming
// them in a reply. Read from disk, cached briefly: the column re-renders often.

const CACHE_MS = 15_000;
/** A deliverable older than this is done with, not something to look at now. */
export const DELIVERABLE_DAYS = 3;
// Bounds on the read, not on what he sees: the column shows a few and a "Show all" for the rest.
export const MAX_DELIVERABLES = 16;
export const MAX_BOARDS = 8;
const TITLE_BYTES = 16 * 1024;
const ASSET_BYTES = 256 * 1024;

export interface ReviewBoard {
  key: string;
  /** The board's own URL on the Lavish server. */
  url: string;
  /** The HTML file the board reviews. */
  file: string;
  title: string;
  /** The firstmate task the file belongs to, when it sits under data/<task>/. */
  task?: string;
}

export interface Deliverable {
  id: string;
  title: string;
  task: string;
  /** The file to open: the PDF when there is one, else the HTML. */
  open: string;
  /** The HTML to frame, when there is one. */
  html?: string;
  kinds: Array<"pdf" | "html">;
  mtimeMs: number;
  /** A screenshot the task saved beside the page (`<name>.png` or `<name>-desktop.png`), which leads the card. */
  shot?: string;
  /** Local test servers the page loads its styles and images from; once one stops, the page shows nothing. */
  assets?: string[];
}

export function defaultLavishState(): string {
  return join(homedir(), ".lavish-axi", "state.json");
}

/** The <title> of an HTML file, from its head only. */
export function htmlTitle(file: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const buffer = Buffer.alloc(TITLE_BYTES);
    const read = readSync(fd, buffer, 0, TITLE_BYTES, 0);
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(buffer.subarray(0, read).toString("utf8"))?.[1];
    return title?.replace(/\s+/g, " ").trim() || undefined;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The loopback origins an HTML file loads from (`http://127.0.0.1:8110/`), read from its first part only. */
export function loopbackAssets(file: string): string[] {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const buffer = Buffer.alloc(ASSET_BYTES);
    const read = readSync(fd, buffer, 0, ASSET_BYTES, 0);
    const text = buffer.subarray(0, read).toString("utf8");
    const origins = new Set<string>();
    for (const match of text.matchAll(/(?:src|href)\s*=\s*["']?(https?):\/\/(127\.0\.0\.1|localhost):(\d{2,5})\//gi)) {
      origins.add(`${match[1]!.toLowerCase()}://127.0.0.1:${match[3]}/`);
    }
    return [...origins];
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function humanize(stem: string): string {
  const words = stem.replace(/[-_]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : stem;
}

function taskOf(file: string, dataDir: string): string | undefined {
  const parent = dirname(file);
  return dirname(parent) === dataDir ? basename(parent) : undefined;
}

/** Lavish boards still open, newest first. Pure over the state file's text. */
export function openBoards(stateText: string, dataDir: string, cap = MAX_BOARDS): ReviewBoard[] {
  let sessions: Record<string, { key?: unknown; url?: unknown; file?: unknown; status?: unknown }>;
  try {
    sessions = (JSON.parse(stateText) as { sessions?: typeof sessions }).sessions ?? {};
  } catch {
    return [];
  }
  return Object.values(sessions)
    .filter((session) => session.status === "open" && typeof session.url === "string" && typeof session.file === "string" && /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(session.url))
    .reverse()
    .slice(0, cap)
    .map((session) => {
      const file = session.file as string;
      const task = taskOf(file, dataDir);
      return {
        key: typeof session.key === "string" ? session.key : basename(session.url as string),
        url: session.url as string,
        file,
        title: htmlTitle(file) ?? humanize(task ?? basename(file, extname(file))),
        ...(task ? { task } : {}),
      };
    });
}

/**
 * Finished PDFs and HTML pages directly inside data/<task>/, touched in the
 * last few days, newest first. A deck's PDF and HTML with the same name are
 * one deliverable; a page a review board shows is the board's, not another card.
 */
export function recentDeliverables(dataDir: string, now: number, skip: Set<string> = new Set(), cap = MAX_DELIVERABLES): Deliverable[] {
  const since = now - DELIVERABLE_DAYS * 24 * 60 * 60_000;
  const found = new Map<string, Deliverable>();
  let tasks: string[];
  try {
    tasks = readdirSync(dataDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name);
  } catch {
    return [];
  }
  for (const task of tasks) {
    const dir = join(dataDir, task);
    try {
      // A task untouched for days holds nothing new; skip reading it.
      if (statSync(dir).mtimeMs < since) continue;
      const names = readdirSync(dir);
      const pictures = new Set(names.filter((name) => extname(name).toLowerCase() === ".png"));
      for (const name of names) {
        const kind = extname(name).toLowerCase() === ".pdf" ? "pdf" : extname(name).toLowerCase() === ".html" ? "html" : null;
        if (!kind || name.startsWith(".")) continue;
        const path = join(dir, name);
        if (skip.has(path)) continue;
        const mtimeMs = statSync(path).mtimeMs;
        if (mtimeMs < since) continue;
        const stem = join(dir, basename(name, extname(name)));
        const entry = found.get(stem) ?? { id: `file:${stem}`, title: "", task, open: path, kinds: [], mtimeMs };
        entry.kinds.push(kind);
        entry.mtimeMs = Math.max(entry.mtimeMs, mtimeMs);
        const own = [`${basename(name, extname(name))}.png`, `${basename(name, extname(name))}-desktop.png`].find((picture) => pictures.has(picture));
        if (own) entry.shot = join(dir, own);
        if (kind === "pdf") entry.open = path;
        else {
          entry.html = path;
          if (!entry.kinds.includes("pdf")) entry.open = path;
        }
        found.set(stem, entry);
      }
    } catch {
      // A task directory that vanished mid-read: nothing to show from it.
    }
  }
  // Saves of one page at several moments (before, after, a probe) are one card: the newest.
  const seen = new Set<string>();
  return [...found.values()]
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((entry): Deliverable => {
      const assets = entry.html ? loopbackAssets(entry.html) : [];
      return {
        ...entry,
        kinds: [...new Set(entry.kinds)].sort().reverse() as Deliverable["kinds"],
        title: (entry.html ? htmlTitle(entry.html) : undefined) ?? humanize(basename(entry.open, extname(entry.open))),
        ...(assets.length ? { assets } : {}),
      };
    })
    .filter((entry) => {
      const key = `${entry.task}\0${entry.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, cap);
}

/** Boards and deliverables from disk, re-read at most every few seconds. */
export class Workshop {
  private cached: { at: number; boards: ReviewBoard[]; deliverables: Deliverable[] } | undefined;

  constructor(
    private readonly dataDir: () => string,
    private readonly stateFile: () => string = defaultLavishState,
    private readonly now: () => number = Date.now,
  ) {}

  current(): { boards: ReviewBoard[]; deliverables: Deliverable[] } {
    const at = this.now();
    if (this.cached && at - this.cached.at < CACHE_MS) return this.cached;
    const dataDir = this.dataDir();
    let stateText = "";
    try {
      stateText = readFileSync(this.stateFile(), "utf8");
    } catch {
      // No Lavish on this machine, or never run: no boards.
    }
    const boards = openBoards(stateText, dataDir);
    const deliverables = recentDeliverables(dataDir, at, new Set(boards.map((board) => board.file)));
    this.cached = { at, boards, deliverables };
    return this.cached;
  }
}
