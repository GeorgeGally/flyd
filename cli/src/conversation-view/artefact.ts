import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { firstmateHome } from "../lib/firstmate-home.js";
import type { ArtefactVoice, Said, VoiceItem } from "./artefact-voice.js";
import type { ShowItem, ShowKind } from "./show.js";

// Flyd's artefact: the panel's content, built from four inputs — firstmate's
// fleet snapshot (the authoritative "everything going on"), Flyd's own memory,
// the news, and Flyd's taste. Firstmate's snapshot is read from its bearings
// script; when it cannot be read the panel says so plainly rather than
// inventing a feed. Everything here is bounded, cached and fails soft.

export interface ArtefactRow {
  choices?: string[];
  references?: Array<{ label: string; url: string }>;
  context?: string;
  label: string;
  /** The plain-language next step or state, whole. */
  detail?: string;
  repo?: string;
  url?: string;
  /** A word or two for its state: "merged", "checks green", "paused". */
  status?: string;
  /** Firstmate's task id, so its screenshots and full title can be found. */
  task?: string;
  /** When the task last reported, as an ISO time. */
  at?: string;
  /** Screenshots the task saved, as paths under its data directory. */
  shots?: string[];
  /** Flyd's own words for it, once its model has said them. */
  said?: Said;
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
  /** Work a worker finished that has not landed yet. */
  ready: ArtefactRow[];
  /** Work that landed recently. */
  landed: ArtefactRow[];
  /** Work that stopped: paused, failed, or gone quiet. */
  held: ArtefactRow[];
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
  /** Work landed on each of the last seven days, oldest first. */
  landedByDay?: DayCount[];
}

export interface DayCount {
  /** YYYY-MM-DD. */
  day: string;
  count: number;
}

export const EMPTY_ARTEFACT: ArtefactInputs = { memories: [], news: [], taste: [] };

const FLEET_UNAVAILABLE = (reason: string): FleetArtefact => ({ unavailable: reason, calls: [], live: [], ready: [], landed: [], held: [], next: [] });

/** How many of each kind the artefact shows; the section says how many more there are. */
export const ARTEFACT_LIMITS = { call: 4, live: 4, ready: 4, landed: 4, waiting: 4, next: 3 } as const;

const str = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object") : [];
const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const PR_URL = /https:\/\/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)\b/g;

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

/** Firstmate's run notes, said plainly: no run ids, no harness words, PRs by number. Pure. */
export function plainStep(doing: string): string {
  let line = str(doing)
    .replace(/\s*(?:·\s*)?\brun:\s*[0-9A-Z]{8,}…?/g, "")
    .replace(/\b(\d+) MERGED\b/g, "#$1 merged");
  line = line
    .replace(PR_URL, (_url, _repo: string, number: string) => (line.includes(`#${number} `) ? "" : `#${number}`))
    .replace(/\s*https?:\/\/\S*…/g, "…")
    .replace(/\s+\|\s+/g, "; ")
    .replace(/\s+([;,.])/g, "$1")
    .replace(/[;,]\s*…$/, "…")
    .replace(/\s*[·|;]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const said: Array<[RegExp, string]> = [
    [/^harness busy\b.*$/i, "Working on it now"],
    [/^harness state unavailable\b.*$/i, "No word from the worker"],
    [/^run passed: PR open\b.*$/i, "PR open; its checks passed"],
    [/^run failed\b.*$/i, "The run failed"],
    [/^run cancelled\b.*$/i, "The run was cancelled before a verdict"],
    [/^ready in branch\b/i, "Ready on branch"],
  ];
  for (const [pattern, plain] of said) {
    if (pattern.test(line)) {
      line = line.replace(pattern, plain);
      break;
    }
  }
  return capitalise(line);
}

/** A word or two for where finished work stands. Pure. */
export function readyStatus(doing: string): string {
  if (/\bmerged\b/i.test(doing)) return "merged";
  if (/\b(?:checks?|tests?|ci)\b[^.;]*\bgreen\b|\bgreen\b/i.test(doing)) return "checks green";
  if (/\bPR\b|\/pull\/\d+/.test(doing)) return "PR open";
  if (/\bbranch\b/i.test(doing)) return "on its branch";
  return "done";
}

/** firstmate's bearings JSON → the small model the panel needs. Pure. */
export function parseBearings(raw: unknown): FleetArtefact {
  if (!raw || typeof raw !== "object") return FLEET_UNAVAILABLE("it was not valid JSON");
  const data = raw as Record<string, unknown>;
  const schema = str(data.schema);
  if (schema && !schema.startsWith("fm-bearings")) return FLEET_UNAVAILABLE(`unexpected schema ${schema}`);
  const recorded = new Map(rows(data.recorded_prs).map((row) => [str(row.id), httpUrl(row.url)]));
  const flight = rows(data.in_flight).map((row) => {
    const doing = str(row.doing);
    const url = recorded.get(str(row.id)) ?? doing.match(PR_URL)?.[0];
    return {
      state: str(row.state),
      kind: str(row.kind),
      doing,
      row: {
        label: str(row.name) || str(row.id),
        ...(str(row.id) ? { task: str(row.id) } : {}),
        ...(doing ? { detail: plainStep(doing) } : {}),
        ...(str(row.repo) ? { repo: str(row.repo) } : {}),
        ...(url ? { url } : {}),
      } as ArtefactRow,
    };
  }).filter((entry) => entry.row.label);
  const inState = (...states: string[]) => flight.filter((entry) => states.includes(entry.state));
  const finished = inState("done").map((entry) => ({ ...entry.row, status: entry.kind === "scout" ? "report available" : readyStatus(entry.doing) }));
  const HELD: Record<string, string> = { failed: "failed", unknown: "no word", paused: "paused" };
  return {
    ...(str(data.generated) ? { generated: str(data.generated) } : {}),
    calls: rows(data.decisions_open).map((row) => ({ label: str(row.summary) || str(row.id), ...(str(row.id) ? { task: str(row.id) } : {}) })).filter((row) => row.label),
    live: inState("working").map((entry) => entry.row),
    ready: finished.filter((row) => row.status !== "merged"),
    landed: [
      ...finished.filter((row) => row.status === "merged"),
      ...rows(data.landed)
        .map((row) => {
          const url = httpUrl(row.artifact);
          const repo = url?.match(/github\.com\/[\w.-]+\/([\w.-]+)\/pull\//)?.[1];
          return {
            label: str(row.what) || str(row.id),
            ...(str(row.id) ? { task: str(row.id) } : {}),
            ...(repo ? { repo } : {}),
            ...(url ? { url } : {}),
            status: "landed",
          };
        })
        .filter((row) => row.label),
    ],
    held: (["failed", "unknown", "paused"] as const).flatMap((state) => inState(state).map((entry) => ({ ...entry.row, status: HELD[state]! }))),
    next: rows(data.gates)
      .map((row) => {
        const blocked = str(row.blocked_by);
        return {
          label: str(row.title) || str(row.id),
          ...(str(row.id) ? { task: str(row.id) } : {}),
          status: blocked && blocked !== "-" ? `blocked by ${blocked}` : "queued",
        };
      })
      .filter((row) => row.label),
  };
}

export interface BacklogEntry {
  title: string;
  repo?: string;
  notes?: string;
  /** Why a hold is open: for a captain hold, the concrete ask. */
  hold?: string;
  /** The day it finished, for done items. */
  finished?: string;
}

/** Firstmate stores a hold's reason as `fm-hold-v1:<base64>`; its plain words, or nothing when it does not decode. Pure. */
export function holdReason(value: string): string {
  const marked = /^fm-hold-v1:([A-Za-z0-9+/]*={0,2})$/.exec(value.trim());
  if (!marked) return value.startsWith("fm-hold-v1:") ? "" : value;
  try {
    const bytes = Buffer.from(marked[1]!, "base64");
    if (bytes.toString("base64") !== marked[1]) return "";
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

/** Firstmate's backlog.md rows by task id: the full title bearings shortens. Pure. */
export function parseBacklog(markdown: string): Map<string, BacklogEntry> {
  const entries = new Map<string, BacklogEntry>();
  let current: BacklogEntry | undefined;
  for (const line of markdown.split("\n")) {
    const row = /^- \[([ x])\] ([\w.-]+) - (.+)$/.exec(line.trim());
    if (!row) {
      if (current && /^\s+\S/.test(line)) current.notes = ((current.notes ?? "") + " " + line.trim()).trim().slice(0, 2000);
      else if (/^#/.test(line)) current = undefined;
      continue;
    }
    let rest = row[3]!;
    const tags = new Map<string, string>();
    for (let tag = /\s*\(([\w-]+):? ([^()]*)\)\s*$/.exec(rest); tag; tag = /\s*\(([\w-]+):? ([^()]*)\)\s*$/.exec(rest)) {
      tags.set(tag[1]!.toLowerCase(), tag[2]!.trim());
      rest = rest.slice(0, tag.index);
    }
    const title = rest
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\bdata\/\S+/g, "")
      .replace(/\(\s*\)/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) continue;
    const finished = [tags.get("merged"), tags.get("done"), tags.get("landed")].find((value) => value && /^\d{4}-\d{2}-\d{2}/.test(value));
    const hold = holdReason(tags.get("hold") ?? "");
    current = {
      title,
      ...(tags.get("repo") ? { repo: tags.get("repo") } : {}),
      ...(hold ? { hold } : {}),
      ...(row[1] === "x" && finished ? { finished: finished.slice(0, 10) } : {}),
    };
    entries.set(row[2]!, current);
  }
  return entries;
}

/** Bearings' shortened line, said whole when the backlog has it. */
function wholeLabel(label: string, full: string): string {
  if (!label.endsWith("…")) return label;
  const kept = label.slice(0, -1).trimEnd().toLowerCase();
  return full.toLowerCase().startsWith(kept.slice(0, Math.min(kept.length, 24))) ? full : label;
}

export interface TaskExtra {
  at?: string;
  shots?: string[];
  /** The task's own last status note, whole. */
  note?: string;
}

const NOTE_CHARS = 180;

/** A worker's status line as one plain sentence: no state prefix, no file paths. Pure. */
export function statusNote(line: string): string {
  const note = str(line)
    .replace(/^[a-z-]+(?:\s*\[[^\]]*\])*\s*:\s*/i, "")
    .replace(/[;,]?\s*(?:screenshots?|shots?|proof|report)?\s*(?:at\s+)?(?:\/private|\/Users|\/tmp|~)\/[^\s;,]+/gi, "")
    .replace(/\s+([;,.])/g, "$1")
    .trim();
  const plain = plainStep(note);
  if (plain.length <= NOTE_CHARS) return plain;
  // Long notes end at a clause, never mid-word.
  const cut = plain.slice(0, NOTE_CHARS);
  const clause = Math.max(cut.lastIndexOf("; "), cut.lastIndexOf(". "));
  return clause > 60 ? cut.slice(0, clause) : cut.replace(/\s+\S*$/, "");
}

/** Bearings' rows with the backlog's full words, last-report times and screenshots. Pure. */
export function enrichFleet(fleet: FleetArtefact, backlog: Map<string, BacklogEntry>, extras: Map<string, TaskExtra> = new Map()): FleetArtefact {
  const enrich = (row: ArtefactRow, call = false): ArtefactRow => {
    const entry = row.task ? backlog.get(row.task) : undefined;
    const extra = row.task ? extras.get(row.task) : undefined;
    let next: ArtefactRow = { ...row };
    if (entry && call) next = { ...next, label: entry.title, ...(entry.hold ? { detail: entry.hold } : {}) };
    else if (entry) next = { ...next, label: wholeLabel(row.label, entry.title) };
    if (entry?.repo) next.repo = entry.repo;
    if (call && entry?.hold) {
      next.choices = decisionChoices(entry.hold);
      next.references = [...new Set(entry.hold.match(/https?:\/\/[^\s,)]+/g) ?? [])].map((url) => ({ label: /\/session\//.test(url) ? "Open design review" : "Open reference", url }));
    }
    if (next.repo) {
      const related = [...backlog].filter(([task, other]) => task !== row.task && other.repo === next.repo);
      next.context = related.slice(-6).map(([task, other]) => `${other.finished ? `Finished ${other.finished}` : "Still open"}: ${other.title}. ${other.notes ?? ""} ${extras.get(task)?.note ?? ""}`).join("\n").slice(0, 2400);
    }
    if (extra?.at) next.at = extra.at;
    if (extra?.note && next.detail && !call) next.detail = wholeLabel(next.detail, extra.note);
    if (extra?.shots?.length) next.shots = extra.shots;
    return next;
  };
  if (fleet.unavailable) return fleet;
  return {
    ...fleet,
    calls: fleet.calls.map((row) => enrich(row, true)),
    live: fleet.live.map((row) => enrich(row)),
    ready: fleet.ready.map((row) => enrich(row)),
    landed: fleet.landed.map((row) => enrich(row)),
    held: fleet.held.map((row) => enrich(row)),
    next: fleet.next.map((row) => enrich(row)),
  };
}

export function decisionChoices(question: string): string[] {
  const choices = [...question.matchAll(/(?:^|:\s*|,\s*)(\d+)\s+(.+?)(?=,\s*\d+\s+|,?\s+or a mix\b|$)/g)]
    .map((match) => match[2]!.replace(/\s*\([^)]*\)/g, "").replace(/[.,;]+$/, "").trim());
  return choices.length >= 2 && choices.length <= 8 ? choices : [];
}

/** How much landed on each of the last seven days, from the backlog's finish dates. Pure. */
export function landedByDay(backlog: Map<string, BacklogEntry>, now: number): DayCount[] {
  const days: DayCount[] = [];
  for (let back = 6; back >= 0; back -= 1) {
    days.push({ day: new Date(now - back * 86_400_000).toISOString().slice(0, 10), count: 0 });
  }
  for (const entry of backlog.values()) {
    const day = days.find((slot) => slot.day === entry.finished);
    if (day) day.count += 1;
  }
  return days;
}

const IMAGE = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
export const SHOTS_PER_TASK = 3;

/** The screenshots worth showing from a task's files: "after" shots first, then the newest. Pure. */
export function pickShots(files: Array<{ path: string; mtime: number }>): string[] {
  const images = files.filter((file) => IMAGE.has(extname(file.path).toLowerCase()));
  const score = (path: string) => (/\bafter\b|after[-_]/i.test(path) ? 0 : /\bbefore\b|before[-_]/i.test(path) ? 2 : 1);
  return [...images]
    .sort((a, b) => score(a.path) - score(b.path) || b.mtime - a.mtime)
    .slice(0, SHOTS_PER_TASK)
    .map((file) => file.path);
}

/** A commitment older than this is not news to him. */
const MEMORY_FRESH_MS = 7 * 86_400_000;

/** The one line Flyd carries from its own memory: the newest open commitment still fresh. Pure. */
export function memoryHighlights(markdown: string, now = Date.now()): string[] {
  const section = markdown.split(/^##\s+Commitments\s*$/m)[1]?.split(/^##\s+/m)[0];
  if (!section) return [];
  const lines = section
    .split("\n")
    .filter((entry) => {
      const noted = /<!--p:(\d{4}-\d{2}-\d{2})-->/.exec(entry)?.[1];
      return !noted || now - Date.parse(noted) < MEMORY_FRESH_MS;
    })
    .map((entry) => entry.replace(/<!--[\s\S]*?-->/g, "").trim())
    .filter((entry) => entry.startsWith("- "));
  const line = lines.at(-1);
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

/** The rows of one kind the artefact shows: work with screenshots first, then the fleet's order. Pure. */
export function shownRows(list: ArtefactRow[] | undefined, limit: number): ArtefactRow[] {
  return [...(list ?? [])].sort((a, b) => (b.shots?.length ? 1 : 0) - (a.shots?.length ? 1 : 0)).slice(0, limit);
}

/** How many of each kind the fleet holds, before the artefact's limits. Pure. */
export function fleetCounts(fleet: FleetArtefact | undefined): Partial<Record<ShowKind, number>> {
  if (!fleet || fleet.unavailable) return {};
  return {
    call: fleet.calls.length,
    live: fleet.live.length,
    ready: fleet.ready.filter((row) => row.status !== "report available").length,
    landed: fleet.landed.length,
    waiting: fleet.held.length,
    next: fleet.next.length,
  };
}

export interface ComposeOptions {
  /** His own name for a repository's project, when Flyd knows it. */
  project?: (repo: string) => string | undefined;
}

/** Where the page loads a task's screenshot from; the server serves only listed ones. */
export function shotSrc(task: string, file: string): string {
  return `/api/artefact-shot?task=${encodeURIComponent(task)}&file=${encodeURIComponent(file)}`;
}

/** "Flyd: drag and drop…" under the Flyd project reads "Drag and drop…". */
function withoutProject(label: string, names: string[]): string {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const bare = label.replace(new RegExp(`^${escaped}\\s*:\\s+`, "i"), "");
    if (bare !== label && bare) return capitalise(bare);
  }
  return label;
}

/** Compose the panel's items from the four inputs, in priority order. Pure. */
export function composeArtefact(inputs: ArtefactInputs, options: ComposeOptions = {}): ShowItem[] {
  const items: ShowItem[] = [];
  const add = (kind: ShowKind, id: string, headline: string, why: string, extra: Partial<ShowItem> = {}): void => {
    if (!headline) return;
    items.push({ id: `${kind}:${id}`, kind, headline, why, ...extra });
  };
  const withLink = (url: string | undefined): Partial<ShowItem> => (url ? { links: [{ label: linkLabel(url), url }] } : {});
  const fromRow = (kind: ShowKind, id: string, row: ArtefactRow): void => {
    const project = row.repo ? options.project?.(row.repo) ?? row.repo : undefined;
    const names = [project, row.repo].filter((name): name is string => Boolean(name));
    const detail = row.said?.line || row.detail;
    const sourceHeadline = withoutProject(row.label, names);
    add(kind, id, row.said?.headline ?? (row.status === "report available" ? `Earlier report: ${sourceHeadline}` : sourceHeadline), "", {
      ...(kind === "call" && row.task ? { decision: { task: row.task, question: row.detail ?? row.label, choices: row.choices ?? [] } } : {}),
      ...(detail ? { detail } : {}),
      ...(row.at ? { at: row.at } : {}),
      ...(row.task && row.shots?.length
        ? { shots: row.shots.map((file) => ({ src: shotSrc(row.task!, file), label: file.split("/").pop()! })) }
        : {}),
      ...(row.status ? { status: row.status } : {}),
      ...(project ? { project } : {}),
      ...withLink(row.url),
      ...(row.references?.length ? { links: [...(row.url ? [{ label: linkLabel(row.url), url: row.url }] : []), ...row.references] } : {}),
    });
  };
  const rowsOf = (kind: keyof typeof ARTEFACT_LIMITS, list: ArtefactRow[] | undefined): void => {
    shownRows(list, ARTEFACT_LIMITS[kind]).forEach((row, index) => fromRow(row.status === "report available" ? "news" : kind, `${kind}-${row.task ?? index}`, row));
  };

  const fleet = inputs.fleet;
  if (fleet?.unavailable) add("news", "fleet-unavailable", `Firstmate's fleet snapshot is unreadable: ${fleet.unavailable}.`, "fleet status unknown");
  rowsOf("call", fleet?.calls);
  rowsOf("live", fleet?.live);
  rowsOf("ready", fleet?.ready);
  rowsOf("landed", fleet?.landed);
  rowsOf("waiting", fleet?.held);
  rowsOf("next", fleet?.next);
  inputs.memories.slice(0, 1).forEach((line, index) => add("news", `memory-${index}`, line, "from your memory"));
  inputs.news.slice(0, 1).forEach((item, index) => add("news", `news-${index}`, item.title, item.why || "from the news", withLink(item.url)));
  return items;
}

const VOICED: Array<[keyof Pick<FleetArtefact, "calls" | "live" | "ready" | "landed" | "held">, keyof typeof ARTEFACT_LIMITS, string]> = [
  ["calls", "call", "needs you"],
  ["live", "live", "under way"],
  ["ready", "ready", "waiting to land"],
  ["landed", "landed", "landed"],
  ["held", "waiting", "held up"],
];

function voiceItem(row: ArtefactRow, kind: string): VoiceItem {
  return {
    kind: row.status === "report available" ? "report available" : kind,
    title: row.label,
    ...(row.detail ? { detail: row.detail } : {}),
    ...(row.status ? { status: row.status } : {}),
    ...(row.repo ? { project: row.repo } : {}),
    ...(row.context ? { context: row.context } : {}),
  };
}

/** The rows the artefact can show, each with Flyd's words when it has them; and the rows still unsaid. */
export function withVoice(
  fleet: FleetArtefact,
  said: (item: VoiceItem) => Said | undefined,
): { fleet: FleetArtefact; unsaid: VoiceItem[] } {
  if (fleet.unavailable) return { fleet, unsaid: [] };
  const next: FleetArtefact = { ...fleet };
  const unsaid: VoiceItem[] = [];
  for (const [field, limit, kind] of VOICED) {
    const shown = new Set(shownRows(fleet[field], ARTEFACT_LIMITS[limit]));
    next[field] = fleet[field].map((row) => {
      if (!shown.has(row)) return row;
      const item = voiceItem(row, kind);
      const words = said(item);
      if (!words) unsaid.push(item);
      const showing = words;
      return showing ? { ...row, said: showing } : row;
    });
  }
  return { fleet: next, unsaid };
}

function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 120) || "no reason given";
}

/** Runs the bearings script and reads the other three inputs. Bounded; never throws. */
export class ArtefactFeed {
  private inputs: ArtefactInputs = EMPTY_ARTEFACT;
  /** Screenshots the page may load, by task: only files listed here are ever served. */
  private shots = new Map<string, Set<string>>();
  private timer?: NodeJS.Timeout;
  private refreshing = false;
  private generation = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly options: {
      home?: string;
      memoryFile?: string;
      newsFile?: string;
      tasteFile?: string;
      /** Flyd's model, to say each row in its own words. */
      voice?: ArtefactVoice;
      intervalMs?: number;
      timeoutMs?: number;
    } = {},
  ) {}

  current(): ArtefactInputs {
    return this.inputs;
  }

  onRefresh(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Under vitest the real firstmate home and Flyd dir are never read. */
  private paths() {
    const home = this.options.home ?? firstmateHome();
    return {
      home,
      backlog: join(home, "data", "backlog.md"),
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

  /** The absolute path of a screenshot the artefact listed, or null for anything else. */
  shotPath(task: string, file: string): string | null {
    if (!this.shots.get(task)?.has(file)) return null;
    return join(this.paths().home, "data", task, file);
  }

  /** Each task's last report time and its screenshots, newest "after" shots first. Bounded. */
  private async extras(tasks: string[]): Promise<Map<string, TaskExtra>> {
    const { home } = this.paths();
    const extras = new Map<string, TaskExtra>();
    await Promise.all(tasks.filter((task) => /^[\w.-]+$/.test(task) && !task.startsWith(".")).map(async (task) => {
      const extra: TaskExtra = {};
      const status = join(home, "state", `${task}.status`);
      try {
        extra.at = (await stat(status)).mtime.toISOString();
        const last = (await readFile(status, "utf8")).trim().split("\n").at(-1) ?? "";
        if (last) extra.note = statusNote(last);
      } catch {
        // No status file: no time or note to show.
      }
      const dir = join(home, "data", task);
      try {
        const names = (await readdir(dir, { recursive: true })).slice(0, 400);
        const files = await Promise.all(names
          .filter((name) => IMAGE.has(extname(name).toLowerCase()) && name.split(sep).length <= 3)
          .map(async (name) => ({ path: relative(dir, join(dir, name)).split(sep).join("/"), mtime: (await stat(join(dir, name))).mtimeMs })));
        const shots = pickShots(files);
        if (shots.length) extra.shots = shots;
      } catch {
        // No data directory: no screenshots.
      }
      if (extra.at || extra.shots) extras.set(task, extra);
    }));
    return extras;
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const { backlog, memory, news, taste } = this.paths();
      const [bearings, backlogText, memoryText, newsText, tasteText] = await Promise.all([
        this.readFleet(),
        ArtefactFeed.text(backlog),
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
      const entries = parseBacklog(backlogText);
      const tasks = [...new Set([bearings.calls, bearings.live, bearings.ready, bearings.landed, bearings.held, bearings.next]
        .flat().map((row) => row.task).filter((task): task is string => Boolean(task)))];
      const extras = await this.extras(tasks);
      this.shots = new Map([...extras].map(([task, extra]) => [task, new Set(extra.shots ?? [])]));
      const enriched = enrichFleet(bearings, entries, extras);
      const voice = this.options.voice;
      const generation = ++this.generation;
      const { fleet, unsaid } = voice ? this.voiced(voice, enriched) : { fleet: enriched, unsaid: [] };
      this.inputs = {
        fleet,
        ...(bearings.unavailable ? {} : { landedByDay: landedByDay(entries, Date.now()) }),
        memories: memoryHighlights(memoryText),
        news: newsHighlights(newsRaw),
        taste: tasteHighlights(tasteText),
      };
      for (const listener of this.listeners) listener();
      if (voice && unsaid.length) void this.say(voice, enriched, unsaid, generation);
    } finally {
      this.refreshing = false;
    }
  }

  /** Asks Flyd's model for the rows it has not said yet, then shows its words. */
  private async say(voice: ArtefactVoice, enriched: FleetArtefact, unsaid: VoiceItem[], generation: number): Promise<void> {
    if (!(await voice.request(unsaid))) return;
    if (generation === this.generation) {
      this.inputs = { ...this.inputs, fleet: this.voiced(voice, enriched).fleet };
      for (const listener of this.listeners) listener();
    }
  }

  private voiced(voice: ArtefactVoice, enriched: FleetArtefact): { fleet: FleetArtefact; unsaid: VoiceItem[] } {
    return withVoice(enriched, (item) => voice.said(item));
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
