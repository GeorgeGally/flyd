import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { firstmateHome } from "../lib/firstmate-home.js";
import type { ShowItem, ShowKind } from "./show.js";

// Flyd's artefact: the panel's content, built from four inputs — firstmate's
// fleet snapshot (the authoritative "everything going on"), Flyd's own memory,
// the news, and Flyd's taste. Firstmate's snapshot is read from its bearings
// script; when it cannot be read the panel says so plainly rather than
// inventing a feed. Everything here is bounded, cached and fails soft.

export interface ArtefactRow {
  label: string;
  detail?: string;
  repo?: string;
  url?: string;
}

export interface FleetArtefact {
  /** When firstmate generated the snapshot, as it reported. */
  generated?: string;
  /** A plain reason the snapshot could not be read; never a made-up feed. */
  unavailable?: string;
  /** Captain holds: calls only he can make. */
  calls: ArtefactRow[];
  /** Work moving right now. */
  live: ArtefactRow[];
  /** Work that landed recently. */
  landed: ArtefactRow[];
  /** Queued next. */
  next: ArtefactRow[];
}

export interface ArtefactNews {
  title: string;
  url?: string;
  why?: string;
}

/** The four inputs, already read and bounded. */
export interface ArtefactInputs {
  fleet?: FleetArtefact;
  memories: string[];
  news: ArtefactNews[];
  /** Top taste rules: they shape wording; shown only when nothing else exists. */
  taste: string[];
}

export const EMPTY_ARTEFACT: ArtefactInputs = { memories: [], news: [], taste: [] };

const FLEET_UNAVAILABLE = (reason: string): FleetArtefact => ({ unavailable: reason, calls: [], live: [], landed: [], next: [] });

const str = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object") : [];

function linkLabel(url: string): string {
  const pr = url.match(/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)/);
  if (pr) return `${pr[1]} #${pr[2]}`;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function httpUrl(value: unknown): string | undefined {
  const url = str(value);
  return /^https?:\/\//.test(url) ? url : undefined;
}

/** firstmate's bearings JSON → the small model the panel needs. Pure. */
export function parseBearings(raw: unknown): FleetArtefact {
  if (!raw || typeof raw !== "object") return FLEET_UNAVAILABLE("it was not valid JSON");
  const data = raw as Record<string, unknown>;
  const schema = str(data.schema);
  if (schema && !schema.startsWith("fm-bearings")) return FLEET_UNAVAILABLE(`unexpected schema ${schema}`);
  return {
    ...(str(data.generated) ? { generated: str(data.generated) } : {}),
    calls: rows(data.decisions_open).map((row) => ({ label: str(row.summary) || str(row.id) })).filter((row) => row.label),
    live: rows(data.in_flight)
      .filter((row) => ["working", "paused"].includes(str(row.state)))
      .map((row) => ({ label: str(row.name) || str(row.id), detail: str(row.doing) || undefined, repo: str(row.repo) || undefined }))
      .filter((row) => row.label),
    landed: rows(data.landed).map((row) => ({ label: str(row.what) || str(row.id), url: httpUrl(row.artifact) })).filter((row) => row.label),
    next: rows(data.gates)
      .map((row) => {
        const blocked = str(row.blocked_by);
        return { label: str(row.title) || str(row.id), ...(blocked && blocked !== "-" ? { detail: `blocked by ${blocked}` } : {}) };
      })
      .filter((row) => row.label),
  };
}

/** The one line Flyd carries from its own memory: the newest open commitment. Pure. */
export function memoryHighlights(markdown: string): string[] {
  const section = markdown.split(/^##\s+Commitments\s*$/m)[1];
  if (!section) return [];
  const line = section
    .split("\n")
    .map((entry) => entry.replace(/<!--[\s\S]*?-->/g, "").trim())
    .find((entry) => entry.startsWith("- "));
  return line ? [line.slice(2).trim()] : [];
}

/** The newest relevant item from the scout edition. Pure. */
export function newsHighlights(raw: unknown): ArtefactNews[] {
  if (!raw || typeof raw !== "object") return [];
  const items = rows((raw as Record<string, unknown>).items).filter((item) => str(item.kind) === "relevant" || !str(item.kind));
  return items.slice(0, 1).map((item) => ({ title: str(item.title), url: httpUrl(item.url), why: str(item.why) || undefined })).filter((item) => item.title);
}

export function tasteHighlights(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((line) => /^- /.test(line))
    .map((line) => line.replace(/<!--[\s\S]*?-->/g, "").slice(2).trim())
    .filter(Boolean)
    .slice(0, 3);
}

/** Compose the panel's items from the four inputs, in priority order. Pure. */
export function composeArtefact(inputs: ArtefactInputs): ShowItem[] {
  const items: ShowItem[] = [];
  const add = (kind: ShowKind, id: string, headline: string, why: string, extra: Partial<ShowItem> = {}): void => {
    if (!headline) return;
    items.push({ id: `${kind}:${id}`, kind, headline, why, ...extra });
  };
  const take = <T>(list: T[] | undefined, count: number): T[] => (list ?? []).slice(0, count);
  const withLink = (url: string | undefined): Partial<ShowItem> => (url ? { links: [{ label: linkLabel(url), url }] } : {});
  const clipTo = (text: string | undefined): string => {
    const line = str(text);
    return line.length <= 96 ? line : `${line.slice(0, 96).replace(/\s+\S*$/, "")}…`;
  };

  const fleet = inputs.fleet;
  if (fleet?.unavailable) add("news", "fleet-unavailable", `Firstmate's fleet snapshot is unreadable: ${fleet.unavailable}.`, "fleet status unknown");
  take(fleet?.calls, 2).forEach((row, index) => add("call", `call-${index}`, row.label, ""));
  take(fleet?.live, 2).forEach((row, index) => add("live", `live-${index}`, row.label, clipTo(row.detail) || "in flight", row.repo ? { project: row.repo } : {}));
  take(fleet?.landed, 1).forEach((row, index) => add("landed", `landed-${index}`, row.label, "", withLink(row.url)));
  take(fleet?.next, 1).forEach((row, index) => add("waiting", `next-${index}`, row.label, clipTo(row.detail) || "next up"));
  take(inputs.memories, 1).forEach((line, index) => add("news", `memory-${index}`, line, "from your memory"));
  take(inputs.news, 1).forEach((item, index) => add("news", `news-${index}`, item.title, clipTo(item.why) || "from the news", withLink(item.url)));
  return items;
}

function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 120) || "no reason given";
}

/** Runs the bearings script and reads the other three inputs. Bounded; never throws. */
export class ArtefactFeed {
  private inputs: ArtefactInputs = EMPTY_ARTEFACT;
  private timer?: NodeJS.Timeout;
  private refreshing = false;

  constructor(
    private readonly options: {
      home?: string;
      memoryFile?: string;
      newsFile?: string;
      tasteFile?: string;
      intervalMs?: number;
      timeoutMs?: number;
    } = {},
  ) {}

  current(): ArtefactInputs {
    return this.inputs;
  }

  /** Under vitest the real firstmate home and Flyd dir are never read. */
  private paths() {
    const home = this.options.home ?? firstmateHome();
    return {
      home,
      memory: this.options.memoryFile ?? join(FLYD_DIR, "MEMORY.md"),
      news: this.options.newsFile ?? join(FLYD_DIR, "scout", "edition-latest.json"),
      taste: this.options.tasteFile ?? join(FLYD_DIR, "TASTE.md"),
    };
  }

  private static async text(file: string): Promise<string> {
    try {
      return await readFile(file, "utf8");
    } catch {
      return "";
    }
  }

  private async readFleet(): Promise<FleetArtefact> {
    const script = join(this.paths().home, "bin", "fm-bearings-snapshot.sh");
    const timeout = this.options.timeoutMs ?? 20_000;
    try {
      const out = await new Promise<string>((resolve, reject) => {
        execFile(script, ["--json"], { timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        });
      });
      return parseBearings(JSON.parse(out));
    } catch (error) {
      return FLEET_UNAVAILABLE(reason(error));
    }
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const { memory, news, taste } = this.paths();
      const [fleet, memoryText, newsText, tasteText] = await Promise.all([
        this.readFleet(),
        ArtefactFeed.text(memory),
        ArtefactFeed.text(news),
        ArtefactFeed.text(taste),
      ]);
      let newsRaw: unknown;
      try {
        newsRaw = JSON.parse(newsText);
      } catch {
        newsRaw = undefined;
      }
      this.inputs = {
        fleet,
        memories: memoryHighlights(memoryText),
        news: newsHighlights(newsRaw),
        taste: tasteHighlights(tasteText),
      };
    } finally {
      this.refreshing = false;
    }
  }

  /** Start the background refresh; a no-op under vitest. */
  start(): void {
    if (process.env.VITEST || this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.options.intervalMs ?? 120_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
