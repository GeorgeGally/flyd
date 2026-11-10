import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "./config.js";

// The state of play, project by project, as firstmate last reported it.
//
// Firstmate's round-ups to George ("DIR — more videos landed, station ID
// started, four still in progress; Flyd — bug card fix under way") are neither
// a decision only he can make nor an independently verified result, so the
// executive gate keeps them backstage and Flyd never knew the state of his
// work. They are read here instead: each project's newest report is kept, and
// Flyd tells George in a line per project rather than relaying the wall of
// text. A report is staff evidence of where the work stands, never a verified
// claim and never written into his memory.

/** One of his projects, by the name Flyd uses and the other names it goes by. */
export interface PlayProject { name: string; aliases?: string[] }

export type PlayState = "landed" | "needs_you" | "stuck" | "moving";

export interface PlayItem {
  /** What the item is about: "More videos and GIFs". */
  label: string;
  state: PlayState;
  /** How many pieces of work the item names: "Still in progress: a, b, c and d" is four. */
  count: number;
  /** The item's own words, sub-points left out. */
  text: string;
}

export interface ProjectPlay {
  project: string;
  /** When firstmate said it. ISO. */
  at: string;
  /** The transcript message it came from. */
  source: string;
  items: PlayItem[];
  /** Flyd's line for him: "DIR: more videos and GIFs landed; station ID between sets and 4 more under way." */
  line: string;
  /** Flyd has told him this one (in a briefing). */
  told?: boolean;
}

interface StateFile {
  projects: Record<string, ProjectPlay>;
}

/** A report older than this is history, not the state of play. */
export const FRESH_MS = 36 * 3600_000;
/** A report this recent when first read is news to tell him; older ones only set the state. */
const NEWS_MS = 6 * 3600_000;
const MAX_HEADER_CHARS = 40;
const MAX_LINE_CHARS = 160;

const BULLET = /^(\s*)(?:[-*•+]|\d+[.)])\s+(.*)$/;
const LANDED = /\b(?:landed|merged|pushed|shipped|released|deployed|(?:is|are|now|went) live|in main|on main|done)\b/i;
const NOT_YET = /\b(?:not|no|never|yet|will|once|until|waiting|now deploying|deploying|about to|ready to)\b/i;
const NEEDS_YOU = /\b(?:needs? (?:you|your)|your (?:call|decision|answer|ok|go-ahead)|waiting (?:on|for) you|over to you|you (?:need|have) to|(?:you|george) (?:to |must |should )?decide)\b/i;
const STUCK = /\b(?:blocked|stuck|failed|failing|can(?:no|['’])t (?:reach|get|finish|proceed)|gave up)\b/i;
const MOVING = /\b(?:started|starting|under way|underway|in progress|working|deploying|building|running|fixing|queued|next)\b/i;

export function defaultStateOfPlayFile(): string {
  return join(FLYD_DIR, "view", "state-of-play.json");
}

function stripMarks(line: string): string {
  return line.replace(/^#{1,6}\s+/, "").replace(/\*\*|__|`/g, "").replace(/:\s*$/, "").trim();
}

/**
 * A line that heads a section: short, no sentence of its own. `project` is set
 * when it names one of his projects (any heading counts when no names are known).
 */
function headerOf(line: string, names: PlayProject[]): { project?: string } | undefined {
  if (!line.trim() || BULLET.test(line) || /^\s/.test(line)) return undefined;
  const bare = stripMarks(line);
  if (!bare || bare.length > MAX_HEADER_CHARS || /[.!?]$/.test(bare)) return undefined;
  if (!names.length) return { project: bare };
  const lower = bare.toLowerCase();
  const project = names.find((name) => [name.name, ...(name.aliases ?? [])].some((alias) => alias.toLowerCase() === lower));
  return project ? { project: project.name } : {};
}

/** The state one status clause states, checked strongest first. */
function stateOf(clause: string): PlayState | undefined {
  if (STUCK.test(clause) && !/\bno longer\b|\bunblocked\b/i.test(clause)) return "stuck";
  if (NEEDS_YOU.test(clause)) return "needs_you";
  if (LANDED.test(clause) && !NOT_YET.test(clause.replace(/\(.*?\)/g, ""))) return "landed";
  if (MOVING.test(clause)) return "moving";
  return undefined;
}

/** "Still in progress: the slow start, the fix (now deploying), the previews, and the request page" names four. */
function countOf(label: string, rest: string): number {
  if (!/^(?:still |also )?(?:in progress|under way|underway|still going|ongoing|pending|open)$/i.test(label.replace(/^still\s+/i, "still ").trim())) return 1;
  const parts = rest.replace(/\(.*?\)/g, "").replace(/\.\s*$/, "").split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1 && !/^and\b/i.test(parts.at(-1)!)) parts.push(...parts.pop()!.split(/\s+and\s+/));
  return Math.max(1, parts.length);
}

function itemOf(text: string): PlayItem | undefined {
  const clean = stripMarks(text);
  const colon = clean.indexOf(":");
  const label = colon > 0 && colon <= 60 ? clean.slice(0, colon).trim() : (clean.split(/[.;]/)[0] ?? clean).trim();
  const rest = colon > 0 && colon <= 60 ? clean.slice(colon + 1).trim() : "";
  // The status is what follows the label ("Fix for the failing previews: landed"); a label that is itself a status ("Still in progress: a, b") speaks when that says none.
  const state = stateOf((rest || label).split(/[.;]/)[0] ?? "") ?? (rest ? stateOf(label) : undefined);
  if (!state) return undefined;
  return { label, state, count: countOf(label, rest), text: clean };
}

/**
 * A round-up's sections, by project: each a heading line with the top-level
 * points under it. Nothing when the reply is not a round-up of where work
 * stands (fewer than two points with a state). Pure.
 */
export function parseStateReport(text: string, names: PlayProject[] = []): { project: string; items: PlayItem[] }[] {
  const sections: { project: string; items: PlayItem[] }[] = [];
  let current: { project: string; items: PlayItem[] } | undefined;
  for (const line of text.replace(/```[\s\S]*?(?:```|$)/g, "").split("\n")) {
    const header = headerOf(line, names);
    if (header) {
      // A heading that names no project of his ends the section above it.
      current = header.project ? { project: header.project, items: [] } : undefined;
      if (current) sections.push(current);
      continue;
    }
    const bullet = line.match(BULLET);
    if (!bullet) continue;
    // Sub-points are detail: the item above carries the state.
    if (!current || bullet[1]!.length > 0) continue;
    const item = itemOf(bullet[2]!);
    if (item) current.items.push(item);
  }
  const kept = sections.filter((section) => section.items.length);
  return kept.reduce((total, section) => total + section.items.length, 0) >= 2 ? kept : [];
}

function lowerFirst(text: string): string {
  // "DIR", "GIFs", "16:9" keep their case; "More videos" reads "more videos".
  return /^[A-Z][a-z]/.test(text) ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

function joined(parts: string[]): string {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** Flyd's one line for a project: what landed, what needs him, what is stuck, then what is still moving. Pure. */
export function playLine(project: string, items: PlayItem[]): string {
  const of = (state: PlayState) => items.filter((item) => item.state === state);
  const parts: string[] = [];
  const named = (list: PlayItem[], limit = 2) => list.slice(0, limit).map((item) => lowerFirst(item.label));
  const landed = of("landed");
  if (landed.length) parts.push(`${joined(named(landed))}${landed.length > 2 ? ` and ${landed.length - 2} more` : ""} landed`);
  const needs = of("needs_you");
  if (needs.length) parts.push(`${joined(named(needs))} need${needs.length === 1 && needs[0]!.count === 1 ? "s" : ""} you`);
  const stuck = of("stuck");
  if (stuck.length) parts.push(`${joined(named(stuck))} ${stuck.length === 1 ? "is" : "are"} stuck`);
  const moving = of("moving");
  if (moving.length) {
    const single = moving.filter((item) => item.count === 1);
    const shown = named(single);
    const rest = moving.reduce((total, item) => total + item.count, 0) - shown.length;
    const words = [...shown, ...(rest > 0 ? [`${rest} ${shown.length ? "more" : rest === 1 ? "thing" : "things"}`] : [])];
    parts.push(`${joined(words)} under way`);
  }
  const line = `${project}: ${parts.join("; ")}.`;
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS - 1).trimEnd()}…` : line;
}

export class StateOfPlay {
  constructor(private readonly file = defaultStateOfPlayFile()) {}

  private load(): StateFile {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<StateFile>;
      return { projects: parsed.projects && typeof parsed.projects === "object" ? parsed.projects : {} };
    } catch {
      return { projects: {} };
    }
  }

  private save(state: StateFile): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, this.file);
  }

  /**
   * Read one of firstmate's replies. Each project it reports on takes its newest
   * report; reading the same message again changes nothing. Returns Flyd's
   * projects when the report is news to tell him (said in the last few hours), else none.
   */
  record(message: { id: string; text: string; timestamp?: string }, names: PlayProject[] = [], now = Date.now()): ProjectPlay[] {
    const sections = parseStateReport(message.text, names);
    if (!sections.length) return [];
    const state = this.load();
    const at = message.timestamp && !Number.isNaN(Date.parse(message.timestamp)) ? new Date(message.timestamp).toISOString() : new Date(now).toISOString();
    const news: ProjectPlay[] = [];
    for (const section of sections) {
      const key = section.project.toLowerCase();
      const previous = state.projects[key];
      if (previous && (previous.at > at || previous.source === message.id)) continue;
      const line = playLine(section.project, section.items);
      const play: ProjectPlay = { project: section.project, at, source: message.id, items: section.items, line };
      state.projects[key] = play;
      news.push(play);
    }
    if (!news.length) return [];
    this.save(state);
    return now - Date.parse(at) <= NEWS_MS ? news : [];
  }

  /** What is current and Flyd has not yet told him. */
  untold(now = Date.now()): ProjectPlay[] {
    return this.current(now).filter((play) => !play.told);
  }

  /** He has heard these: a briefing told him. */
  markTold(plays: ProjectPlay[]): void {
    if (!plays.length) return;
    const state = this.load();
    for (const play of plays) {
      const kept = state.projects[play.project.toLowerCase()];
      if (kept && kept.source === play.source) kept.told = true;
    }
    this.save(state);
  }

  /** Each project's latest state, newest first, while it is still current. */
  current(now = Date.now()): ProjectPlay[] {
    return Object.values(this.load().projects)
      .filter((play) => now - Date.parse(play.at) <= FRESH_MS)
      .sort((a, b) => b.at.localeCompare(a.at));
  }
}

/** How a notification about these is filed: his call, a blocker, or finished work. Pure. */
export function playKind(plays: ProjectPlay[]): "decision" | "blocker" | "deliverable" | undefined {
  const states = new Set(plays.flatMap((play) => play.items.map((item) => item.state)));
  if (states.has("needs_you")) return "decision";
  if (states.has("stuck")) return "blocker";
  // Work only under way is not news to ring him with; the briefing carries it.
  return states.has("landed") ? "deliverable" : undefined;
}

/** The state of play for Flyd's own context, a line per project; empty when nothing is current. */
export function stateOfPlayBlock(file?: string, now = Date.now()): string {
  // Tests never read his real state of play into a prompt.
  if (!file && process.env.VITEST) return "";
  file ??= defaultStateOfPlayFile();
  let plays: ProjectPlay[] = [];
  try { plays = new StateOfPlay(file).current(now); } catch { return ""; }
  if (!plays.length) return "";
  const lines = plays.slice(0, 8).map((play) => `- ${play.line}`);
  return `\n<state-of-play>\nWhere George's work stands, as his staff last reported it (their word, not verified; tell him in your own short words when it bears on what he asks):\n${lines.join("\n")}\n</state-of-play>\n`;
}
