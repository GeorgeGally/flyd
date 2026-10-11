import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { parseTaste, type TasteProfile, type TasteRule } from "../council/taste.js";
import { projectId } from "../council/projects.js";
import type { ConversationMessage } from "./types.js";

// What Flyd remembers, for the right column: the taste rules and captures that
// apply to what we are talking about, and what it is taking in while we talk.
// Read-only over Flyd's own stores (TASTE.md, raw captures, MEMORY.md); nothing
// here learns, edits or forgets. The column's pure half (composeMemory) takes
// what the reader read and the conversation, and always gives the same column.

export type MemoryKind = "taste" | "capture" | "memory";

export interface RailMemory {
  id: string;
  kind: MemoryKind;
  /** The memory in plain words, short. */
  title: string;
  /** Where it holds and how sure Flyd is: "GNM · seen 4 times". */
  line?: string;
  /** The whole item, opened in place. */
  detail?: string;
  /** When it landed, ISO. */
  at?: string;
}

export interface RailMemories {
  /** The project the memories are picked for, as he names it. */
  project?: string;
  /** What Flyd holds that applies here. */
  remembers: RailMemory[];
  /** What Flyd took in during this conversation, newest first. */
  remembering: RailMemory[];
}

/** A capture he asked Flyd to keep (~/.flyd/raw), as the column needs it. */
export interface Capture {
  file: string;
  project?: string;
  projectPath?: string;
  /** ISO. */
  at?: string;
  text: string;
}

/** A curated line of Flyd's MEMORY.md. */
export interface MemoryEntry {
  section: string;
  text: string;
  /** YYYY-MM-DD it was last confirmed. */
  date?: string;
}

export interface MemoryProject {
  id?: string;
  name: string;
  repos: string[];
}

export interface MemoryInputs {
  taste: TasteProfile;
  captures: Capture[];
  entries: MemoryEntry[];
  /** When the reader first saw a memory change while it watched, by memory id. */
  noticed?: Record<string, string>;
}

export const MAX_REMEMBERS = 6;
export const MAX_REMEMBERING = 6;
const MAX_TITLE = 160;
const MAX_DETAIL = 4_000;
/** Captures he made himself; agent observations and runtime events are not his to read here. */
const CAPTURE_SOURCES = new Set(["cli", "flyd-cli"]);

const slugOf = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const base = (path: string) => path.replace(/\/+$/, "").split("/").pop()!.toLowerCase();
/** "GNM (Good Neighbours Market)" as "GNM". */
const shortName = (name: string) => name.replace(/\s*\(.*\)\s*$/, "").trim() || name;
const words = (text: string) => text.replace(/\s+/g, " ").trim();

function clip(text: string, max: number): string {
  const flat = words(text);
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The names a project goes by in conversation: its name, its short name, its repos' folders. */
function namesOf(project: MemoryProject): string[] {
  return [...new Set([project.name, shortName(project.name), ...project.repos.map(base)].map((name) => name.trim()).filter((name) => name.length >= 3))];
}

/** The project we are talking about: the newest message that names one. Pure. */
export function conversationProject(messages: ConversationMessage[], projects: MemoryProject[], scan = 12): MemoryProject | undefined {
  for (let index = messages.length - 1; index >= Math.max(0, messages.length - scan); index -= 1) {
    const text = messages[index]!.text;
    let best: { project: MemoryProject; at: number } | undefined;
    for (const project of projects) {
      for (const name of namesOf(project)) {
        const at = new RegExp(`(?:^|[^\\w-])${escapeRegExp(name)}(?![\\w-])`, "i").exec(text)?.index;
        if (at !== undefined && (!best || at < best.at)) best = { project, at };
      }
    }
    if (best) return best.project;
  }
  return undefined;
}

function idOf(project: MemoryProject): string {
  return project.id ?? projectId(project.name);
}

/** Whether a capture was made about this project: its folder, or the repo it names. */
function captureFor(capture: Capture, project: MemoryProject): boolean {
  const path = capture.projectPath?.replace(/\/+$/, "");
  if (path && project.repos.some((repo) => { const root = repo.replace(/\/+$/, ""); return path === root || path.startsWith(`${root}/`); })) return true;
  const named = capture.project ? base(capture.project) : "";
  return Boolean(named) && (named === idOf(project) || project.repos.some((repo) => base(repo) === named) || slugOf(shortName(project.name)) === named);
}

/** A taste rule told to agents: one he wrote, a principle, or one seen more than once. */
function told(rule: TasteRule): boolean {
  return rule.count !== 1 || rule.principle === true;
}

function times(count: number): string {
  return count === 0 ? "his own words" : count === 1 ? "seen once" : `seen ${count} times`;
}

function tasteMemory(rule: TasteRule, profile: TasteProfile): RailMemory {
  const where = rule.scope === "personal" ? "Everywhere" : shortName(profile.names[rule.scope] ?? rule.scope);
  const quotes = rule.evidence.map((item) => `“${words(item.quote)}”${item.date ? ` — ${item.date}` : ""}`);
  return {
    id: `taste:${rule.id}`,
    kind: "taste",
    title: clip(rule.text, MAX_TITLE),
    line: `Taste · ${where} · ${times(rule.count)}`,
    detail: [words(rule.text), ...(quotes.length ? ["", "Learned from:", ...quotes] : [])].join("\n"),
    ...(rule.last ? { at: rule.last } : {}),
  };
}

function captureMemory(capture: Capture, projects: MemoryProject[]): RailMemory {
  const owner = projects.find((project) => captureFor(capture, project));
  // Only his own project names: a repo he has not made a project of goes unnamed.
  const where = owner ? shortName(owner.name) : undefined;
  return {
    id: `capture:${capture.file}`,
    kind: "capture",
    title: clip(capture.text, MAX_TITLE),
    line: ["Capture", where].filter(Boolean).join(" · "),
    ...(capture.text.length > MAX_TITLE ? { detail: capture.text.slice(0, MAX_DETAIL) } : {}),
    ...(capture.at ? { at: capture.at } : {}),
  };
}

export function entryId(entry: MemoryEntry): string {
  return `memory:${slugOf(entry.text).slice(0, 80)}`;
}

function entryMemory(entry: MemoryEntry): RailMemory {
  return {
    id: entryId(entry),
    kind: "memory",
    title: clip(entry.text, MAX_TITLE),
    line: `Memory · ${entry.section}`,
    ...(entry.text.length > MAX_TITLE ? { detail: entry.text } : {}),
    ...(entry.date ? { at: entry.date } : {}),
  };
}

/** His words in this conversation, flattened, to find the corrections a rule was learned from. */
function saidHere(messages: ConversationMessage[]): Array<{ text: string; at?: string }> {
  return messages.filter((message) => message.role === "user").map((message) => ({ text: words(message.text).toLowerCase(), ...(message.timestamp ? { at: message.timestamp } : {}) }));
}

/** When this conversation began, from its first dated message. */
function startOf(messages: ConversationMessage[]): number | undefined {
  const times = messages.map((message) => (message.timestamp ? Date.parse(message.timestamp) : NaN)).filter((at) => !Number.isNaN(at));
  return times.length ? Math.min(...times) : undefined;
}

/**
 * The column's memory section. Remembers: the taste rules that hold here (this
 * project's first, then his strongest everywhere rules), this project's newest
 * captures and the memory lines that name it. Remembering now: rules learned
 * from his words in this conversation, captures made since it began, and
 * anything the reader saw change while it watched, newest first. Pure.
 */
export function composeMemory(inputs: MemoryInputs, messages: ConversationMessage[], projects: MemoryProject[] = []): RailMemories {
  const project = conversationProject(messages, projects);
  const profile = inputs.taste;
  const noticed = inputs.noticed ?? {};
  const said = saidHere(messages);
  const start = startOf(messages);

  const remembering = new Map<string, RailMemory>();
  const landed = (memory: RailMemory, at: string | undefined) => {
    if (!remembering.has(memory.id)) remembering.set(memory.id, { ...memory, ...(at ? { at } : {}) });
  };
  for (const rule of profile.rules) {
    const quoted = rule.evidence
      .map((item) => words(item.quote).toLowerCase())
      .filter((quote) => quote.length >= 8)
      .map((quote) => said.find((line) => line.text.includes(quote)))
      .find(Boolean);
    const seen = noticed[`taste:${rule.id}`];
    if (quoted || seen) landed(tasteMemory(rule, profile), seen ?? quoted?.at);
  }
  for (const capture of inputs.captures) {
    const at = capture.at ? Date.parse(capture.at) : NaN;
    if (start !== undefined && !Number.isNaN(at) && at >= start) landed(captureMemory(capture, projects), capture.at);
  }
  for (const entry of inputs.entries) {
    const seen = noticed[entryId(entry)];
    if (seen) landed(entryMemory(entry), seen);
  }
  const now = [...remembering.values()]
    .sort((a, b) => (Date.parse(b.at ?? "") || 0) - (Date.parse(a.at ?? "") || 0))
    .slice(0, MAX_REMEMBERING);

  const shown = new Set(now.map((memory) => memory.id));
  const pid = project ? idOf(project) : undefined;
  const strongest = (rules: TasteRule[]) => [...rules].sort((a, b) => b.count - a.count || (b.last ?? "").localeCompare(a.last ?? ""));
  const projectRules = pid ? strongest(profile.rules.filter((rule) => rule.scope === pid)) : [];
  const everywhere = strongest(profile.rules.filter((rule) => rule.scope === "personal" && told(rule)));
  const captures = project ? inputs.captures.filter((capture) => captureFor(capture, project)).sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")) : [];
  const named = project
    ? inputs.entries.filter((entry) => namesOf(project).some((name) => new RegExp(`(?:^|[^\\w-])${escapeRegExp(name)}(?![\\w-])`, "i").test(entry.text)))
    : [];
  const remembers: RailMemory[] = [];
  const add = (memory: RailMemory) => {
    if (remembers.length < MAX_REMEMBERS && !shown.has(memory.id)) {
      shown.add(memory.id);
      remembers.push(memory);
    }
  };
  // Project taste and captures lead; his everywhere taste fills what is left, keeping room for the project's own.
  projectRules.slice(0, 3).forEach((rule) => add(tasteMemory(rule, profile)));
  captures.slice(0, 2).forEach((capture) => add(captureMemory(capture, projects)));
  named.slice(-1).forEach((entry) => add(entryMemory(entry)));
  everywhere.forEach((rule) => add(tasteMemory(rule, profile)));

  return { ...(project ? { project: shortName(project.name) } : {}), remembers, remembering: now };
}

// ── Reading Flyd's stores ───────────────────────────────────────────────────

/** A raw capture's frontmatter and body. Pure. */
export function parseCapture(file: string, markdown: string): (Capture & { source?: string }) | null {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(markdown);
  if (!match) return null;
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const field = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (field) meta[field[1]!] = field[2]!.trim();
  }
  const text = match[2]!.trim();
  if (!text) return null;
  const stamp = meta.timestamp ?? meta.occurred_at;
  // "2026-10-10 17:37:34" is his local clock.
  const at = stamp ? new Date(stamp.includes("T") ? stamp : stamp.replace(" ", "T")) : undefined;
  return {
    file,
    text,
    ...(meta.source ? { source: meta.source } : {}),
    ...(meta.project ? { project: meta.project } : {}),
    ...(meta.project_path ? { projectPath: meta.project_path } : {}),
    ...(at && !Number.isNaN(at.getTime()) ? { at: at.toISOString() } : {}),
  };
}

/** MEMORY.md's curated lines, by section, markers read and removed. Pure. */
export function parseMemoryFile(markdown: string): MemoryEntry[] {
  const out: MemoryEntry[] = [];
  let section = "";
  for (const line of markdown.replace(/<!--(?![a-z]:\d)[\s\S]*?-->/g, "").split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      section = heading[1]!;
      continue;
    }
    if (!section || !line.startsWith("- ")) continue;
    const date = /<!--[a-z]:(\d{4}-\d{2}-\d{2})-->/.exec(line)?.[1];
    const text = line.slice(2).replace(/<!--[\s\S]*?-->/g, "").trim();
    if (text) out.push({ section, text, ...(date ? { date } : {}) });
  }
  return out;
}

export interface MemoryReaderOptions {
  dir?: string;
  /** How often to look for new memories while someone is watching. */
  pollMs?: number;
  /** How many of the newest captures to keep in view. */
  captures?: number;
  now?: () => number;
}

/**
 * Reads Flyd's memory stores when they change, and notices what changes while
 * it watches: a new taste rule, a rule seen again, a new line in MEMORY.md.
 * The first read is the baseline; nothing in it counts as remembered now.
 */
export class MemoryReader {
  private readonly dir: string;
  private readonly pollMs: number;
  private readonly keep: number;
  private readonly now: () => number;
  private stamp = "";
  private inputs: MemoryInputs = { taste: { rules: [], vetoed: [], names: {} }, captures: [], entries: [] };
  private readonly parsed = new Map<string, Capture | null>();
  private signatures: Map<string, string> | null = null;
  private readonly noticed: Record<string, string> = {};
  private readonly listeners = new Set<() => void>();
  private timer: NodeJS.Timeout | undefined;

  constructor(options: MemoryReaderOptions = {}) {
    this.dir = options.dir ?? FLYD_DIR;
    this.pollMs = options.pollMs ?? 15_000;
    this.keep = options.captures ?? 200;
    this.now = options.now ?? Date.now;
  }

  private mtime(path: string): number {
    try {
      return statSync(path).mtimeMs;
    } catch {
      return 0;
    }
  }

  private text(path: string): string {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return "";
    }
  }

  /** The newest of his own captures, parsed once each: the archive never changes a written file. */
  private readCaptures(): Capture[] {
    const raw = join(this.dir, "raw");
    let names: string[];
    try {
      names = readdirSync(raw).filter((name) => name.endsWith(".md") && /^\d{4}-\d{2}-\d{2}/.test(name)).sort().slice(-this.keep);
    } catch {
      return [];
    }
    const out: Capture[] = [];
    for (const name of names) {
      if (!this.parsed.has(name)) {
        const capture = parseCapture(name, this.text(join(raw, name)));
        this.parsed.set(name, capture && CAPTURE_SOURCES.has(capture.source ?? "") ? { file: capture.file, text: capture.text, ...(capture.project ? { project: capture.project } : {}), ...(capture.projectPath ? { projectPath: capture.projectPath } : {}), ...(capture.at ? { at: capture.at } : {}) } : null);
      }
      const capture = this.parsed.get(name);
      if (capture) out.push(capture);
    }
    return out;
  }

  /** Re-reads the stores when any of them changed; returns whether anything did. */
  refresh(): boolean {
    const taste = join(this.dir, "TASTE.md");
    const memory = join(this.dir, "MEMORY.md");
    const stamp = [this.mtime(taste), this.mtime(memory), this.mtime(join(this.dir, "raw"))].join(":");
    if (stamp === this.stamp) return false;
    this.stamp = stamp;
    const profile = parseTaste(this.text(taste));
    const entries = parseMemoryFile(this.text(memory));
    const signatures = new Map<string, string>([
      ...profile.rules.map((rule): [string, string] => [`taste:${rule.id}`, `${rule.count}|${rule.text}`]),
      ...entries.map((entry): [string, string] => [entryId(entry), entry.text]),
    ]);
    if (this.signatures) {
      const at = new Date(this.now()).toISOString();
      for (const [id, signature] of signatures) if (this.signatures.get(id) !== signature) this.noticed[id] = at;
    }
    this.signatures = signatures;
    this.inputs = { taste: profile, captures: this.readCaptures(), entries, noticed: { ...this.noticed } };
    return true;
  }

  current(): MemoryInputs {
    if (!this.signatures) this.refresh();
    return this.inputs;
  }

  /** Calls back when a memory lands; polls only while someone listens. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    if (!this.timer) {
      this.current();
      this.timer = setInterval(() => {
        if (this.refresh()) for (const each of this.listeners) each();
      }, this.pollMs);
      this.timer.unref?.();
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    };
  }
}
