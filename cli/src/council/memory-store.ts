import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";

// Tiered, curated memory (after firstmate's stow tiers and Letta's core vs
// deferred memory). Scripts own the mechanics here; the Archivist only
// proposes operations.
//
//   USER.md            who George is — pinned, never decays (lib/user-profile.ts)
//   MEMORY.md          standing facts, decisions, commitments — always in context
//     - aging:      <!--a:YYYY-MM-DD--> must be re-proven within 30 days
//     - perishable: <!--p:YYYY-MM-DD--> names its own expiry; stale after 7 days
//   memory/YYYY-MM-DD.md  daily notes — searched on demand, never injected
//   memory-archive.md     cold tier — retired entries with provenance, never deleted

export type Tier = "aging" | "perishable";

export const MEMORY_SECTIONS = ["Who he is", "Lately", "Commitments", "Decisions", "Projects", "People", "Facts"] as const;
export type MemorySection = (typeof MEMORY_SECTIONS)[number];

export interface MemoryEntry {
  id: string;
  section: string;
  text: string;
  tier: Tier;
  /** Last-reinforced local date, YYYY-MM-DD. */
  date: string;
}

export interface MemoryPaths {
  memory: string;
  archive: string;
  dailyDir: string;
  sources: string;
}

export function memoryPaths(dir = process.env.FLYD_MEMORY_DIR?.trim() || FLYD_DIR): MemoryPaths {
  return {
    memory: join(dir, "MEMORY.md"),
    archive: join(dir, "memory-archive.md"),
    dailyDir: join(dir, "memory"),
    sources: join(dir, "memory-sources.json"),
  };
}

export const AGING_DAYS = 30;
export const PERISHABLE_DAYS = 7;
/** Hard ceiling so MEMORY.md stays a map, not a journal. */
export const MEMORY_BUDGET_CHARS = 16_000;

/** Under budget pressure, what a friend would forget first: project detail before who George is. */
const EVICTION_ORDER = ["Projects", "Facts", "Decisions", "Commitments", "Lately", "People", "Who he is"];

export function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function entryId(text: string): string {
  return createHash("sha1").update(text.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex").slice(0, 6);
}

const ENTRY = /^- (.+?)\s*<!--([ap]):(\d{4}-\d{2}-\d{2})-->\s*$/;

export function parseMemory(text: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  let section = "Facts";
  for (const line of text.split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      section = heading[1];
      continue;
    }
    const entry = line.match(ENTRY);
    if (entry) {
      entries.push({ id: entryId(entry[1]), section, text: entry[1], tier: entry[2] === "p" ? "perishable" : "aging", date: entry[3] });
    }
  }
  return entries;
}

export function renderMemory(entries: MemoryEntry[]): string {
  const sections = [...MEMORY_SECTIONS, ...new Set(entries.map((entry) => entry.section).filter((name) => !(MEMORY_SECTIONS as readonly string[]).includes(name)))];
  const body = sections.flatMap((section) => {
    const inSection = entries.filter((entry) => entry.section === section);
    if (inSection.length === 0) return [];
    return [`## ${section}`, ...inSection.map((entry) => `- ${entry.text} <!--${entry.tier === "perishable" ? "p" : "a"}:${entry.date}-->`), ""];
  });
  return [
    "# Flyd memory",
    "",
    "<!-- Curated by Flyd's Librarian. Standing facts, decisions, and commitments about George's world.",
    "Edit freely; the markers record tier and last-confirmed date. Retired entries go to memory-archive.md. -->",
    "",
    ...body,
  ].join("\n").replace(/\n+$/, "\n");
}

export function readMemoryEntries(paths = memoryPaths()): MemoryEntry[] {
  return existsSync(paths.memory) ? parseMemory(readFileSync(paths.memory, "utf8")) : [];
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function readSources(paths: MemoryPaths): Record<string, string[]> {
  try {
    return JSON.parse(readFileSync(paths.sources, "utf8")) as Record<string, string[]>;
  } catch {
    return {};
  }
}

function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000);
}

export function staleEntries(entries: MemoryEntry[], now: Date): MemoryEntry[] {
  const today = localDay(now);
  return entries.filter((entry) => daysBetween(entry.date, today) >= (entry.tier === "perishable" ? PERISHABLE_DAYS : AGING_DAYS));
}

export type MemoryOp =
  | { op: "add"; section: string; text: string; tier?: Tier; sources?: string[] }
  | { op: "update"; id: string; text: string; sources?: string[] }
  | { op: "reinforce"; id: string; sources?: string[] }
  | { op: "archive"; id: string; reason: string }
  | { op: "daily_note"; text: string; sources?: string[] };

export interface ApplyReceipt {
  added: number;
  updated: number;
  reinforced: number;
  archived: number;
  notes: number;
  rejected: string[];
}

/**
 * Apply proposed operations. Unknown ids, empty text, and duplicates are
 * rejected rather than guessed; retiring an entry always archives it with
 * provenance. Entries left stale long past their clock retire on their own so
 * memory cannot grow without bound when curation stalls.
 */
export function applyMemoryOps(ops: MemoryOp[], options: { now?: Date; paths?: MemoryPaths } = {}): ApplyReceipt {
  const now = options.now ?? new Date();
  const paths = options.paths ?? memoryPaths();
  const today = localDay(now);
  const entries = readMemoryEntries(paths);
  const sources = readSources(paths);
  const receipt: ApplyReceipt = { added: 0, updated: 0, reinforced: 0, archived: 0, notes: 0, rejected: [] };
  const archived: Array<{ entry: MemoryEntry; reason: string }> = [];
  const notes: string[] = [];
  const byId = () => new Map(entries.map((entry, index) => [entry.id, index]));
  const addSources = (id: string, more?: string[]) => {
    if (!more?.length) return;
    sources[id] = [...new Set([...(sources[id] ?? []), ...more])].slice(-12);
  };

  for (const op of ops) {
    const index = "id" in op ? byId().get(op.id) : undefined;
    switch (op.op) {
      case "add": {
        const text = op.text?.replace(/\s+/g, " ").trim();
        if (!text) { receipt.rejected.push("add: empty text"); break; }
        const id = entryId(text);
        if (byId().has(id)) { receipt.rejected.push(`add: duplicate of [${id}]`); break; }
        const section = (MEMORY_SECTIONS as readonly string[]).find((name) => name.toLowerCase() === String(op.section ?? "").toLowerCase()) ?? "Facts";
        entries.push({ id, section, text, tier: op.tier === "perishable" ? "perishable" : "aging", date: today });
        addSources(id, op.sources);
        receipt.added += 1;
        break;
      }
      case "update": {
        const text = op.text?.replace(/\s+/g, " ").trim();
        if (index === undefined || !text) { receipt.rejected.push(`update: unknown [${op.id}] or empty text`); break; }
        const previous = entries[index];
        const next = { ...previous, id: entryId(text), text, date: today };
        entries[index] = next;
        sources[next.id] = [...(sources[previous.id] ?? []), ...(op.sources ?? [])].slice(-12);
        if (next.id !== previous.id) delete sources[previous.id];
        archived.push({ entry: previous, reason: `superseded by [${next.id}]` });
        receipt.updated += 1;
        break;
      }
      case "reinforce": {
        if (index === undefined) { receipt.rejected.push(`reinforce: unknown [${op.id}]`); break; }
        entries[index] = { ...entries[index], date: today };
        addSources(op.id, op.sources);
        receipt.reinforced += 1;
        break;
      }
      case "archive": {
        if (index === undefined) { receipt.rejected.push(`archive: unknown [${op.id}]`); break; }
        const [entry] = entries.splice(index, 1);
        archived.push({ entry, reason: op.reason || "retired" });
        receipt.archived += 1;
        break;
      }
      case "daily_note": {
        const text = op.text?.replace(/\s+/g, " ").trim();
        if (!text) { receipt.rejected.push("daily_note: empty text"); break; }
        notes.push(`- ${text}${op.sources?.length ? ` (${op.sources.join(", ")})` : ""}`);
        receipt.notes += 1;
        break;
      }
      default:
        receipt.rejected.push(`unknown op ${JSON.stringify(op).slice(0, 60)}`);
    }
  }

  // Backstop decay: twice past its clock and still unconfirmed means retire.
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const limit = (entry.tier === "perishable" ? PERISHABLE_DAYS : AGING_DAYS) * 2;
    if (daysBetween(entry.date, today) >= limit) {
      archived.push({ entry, reason: `unconfirmed for ${limit}+ days` });
      entries.splice(index, 1);
      receipt.archived += 1;
    }
  }

  // Budget: retire the least essential, oldest-confirmed entries until MEMORY.md fits.
  const rank = (entry: MemoryEntry) => { const index = EVICTION_ORDER.indexOf(entry.section); return index === -1 ? 0 : index; };
  while (renderMemory(entries).length > MEMORY_BUDGET_CHARS && entries.length > 0) {
    const oldest = entries.reduce((a, b) => (rank(b) < rank(a) || (rank(b) === rank(a) && b.date < a.date) ? b : a));
    entries.splice(entries.indexOf(oldest), 1);
    archived.push({ entry: oldest, reason: "over memory budget (oldest confirmation)" });
    receipt.archived += 1;
  }

  atomicWrite(paths.memory, renderMemory(entries));
  atomicWrite(paths.sources, `${JSON.stringify(sources, null, 2)}\n`);
  if (archived.length) {
    mkdirSync(dirname(paths.archive), { recursive: true, mode: 0o700 });
    appendFileSync(paths.archive, [
      `\n## ${now.toISOString()} archivist`,
      ...archived.map(({ entry, reason }) => `- ${entry.text} — ${entry.section}, ${entry.tier}, last confirmed ${entry.date}; ${reason}`),
      "",
    ].join("\n"), { encoding: "utf8", mode: 0o600 });
  }
  if (notes.length) {
    mkdirSync(paths.dailyDir, { recursive: true, mode: 0o700 });
    appendFileSync(join(paths.dailyDir, `${today}.md`), `${notes.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  }
  return receipt;
}

/** MEMORY.md for prompts: entries only, markers stripped. */
export function memoryPromptText(paths = memoryPaths()): string | null {
  const entries = readMemoryEntries(paths);
  if (entries.length === 0) return null;
  return MEMORY_SECTIONS
    .map((section) => {
      const inSection = entries.filter((entry) => entry.section === section);
      return inSection.length ? `## ${section}\n${inSection.map((entry) => `- ${entry.text}`).join("\n")}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Daily notes matching any query term, newest first — on-demand recall, never injected. */
export function searchDailyNotes(query: string, paths = memoryPaths(), limit = 12): string[] {
  if (!existsSync(paths.dailyDir)) return [];
  const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 2);
  if (terms.length === 0) return [];
  const hits: string[] = [];
  for (const file of readdirSync(paths.dailyDir).filter((name) => name.endsWith(".md")).sort().reverse()) {
    for (const line of readFileSync(join(paths.dailyDir, file), "utf8").split("\n")) {
      if (line.startsWith("- ") && terms.some((term) => line.toLowerCase().includes(term))) {
        hits.push(`${file.replace(/\.md$/, "")}: ${line.slice(2)}`);
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}
