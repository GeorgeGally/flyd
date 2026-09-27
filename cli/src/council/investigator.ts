import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR, RAW_DIR } from "../lib/config.js";
import { parse } from "../lib/frontmatter.js";
import { readUserProfile } from "../lib/user-profile.js";
import { applyMemoryOps, localDay, readMemoryEntries, type MemoryOp } from "./memory-store.js";
import { profileSections } from "../runtime/room-context.js";

// Backstage and unhurried: where Flyd knows little about George, it goes and
// looks — in his own calendar, reminders, captures, and past conversations —
// rather than waiting to be told. Findings land in curated memory with their
// source, never in USER.md (George's own words), and nothing is said about
// it: Flyd simply knows him a little better next time.

/** Sections of George's life a good aide should know; thin ones get investigated. */
const LIFE_AREAS: Array<{ area: string; profile?: string; probes: string[] }> = [
  { area: "the people in his life (family, partner, friends, collaborators) and how he relates to them", profile: "People", probes: ["family", "friend", "partner", "dinner with", "birthday"] },
  { area: "his routines and rhythms (sleep, exercise, work hours, weekends)", profile: "Routines", probes: ["gym", "run", "routine", "morning", "weekend"] },
  { area: "what he is aiming for this year, in work and life", profile: "Goals", probes: ["goal", "want to", "plan", "this year", "dream"] },
  { area: "what he loves outside work (music, art, places, food, ideas)", probes: ["love", "favourite", "music", "art", "listening to"] },
  { area: "how he likes to be supported and spoken to", profile: "How to be with me", probes: ["annoying", "prefer", "don't like", "stop", "i like when"] },
];

export function investigatorDir(): string {
  return process.env.FLYD_INVESTIGATOR_DIR?.trim() || join(FLYD_DIR, "council", "investigator");
}

interface InvestigatorState { lastRunAt?: string; lastArea?: number }

function readState(dir: string): InvestigatorState {
  try { return JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as InvestigatorState; } catch { return {}; }
}

function writeState(state: InvestigatorState, dir: string): void {
  const path = join(dir, "state.json");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(`${path}.tmp`, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

/** The thinnest life area next, rotating so no area is starved. */
export function nextArea(profile: string | null, memoryTexts: string[], lastArea = -1): number {
  const sections = profile ? profileSections(profile) : new Map<string, string[]>();
  const known = (index: number) => {
    const area = LIFE_AREAS[index];
    const inProfile = area.profile ? (sections.get(area.profile) ?? []).length : 0;
    const inMemory = memoryTexts.filter((text) => area.probes.some((probe) => text.toLowerCase().includes(probe))).length;
    return inProfile * 2 + inMemory;
  };
  const order = LIFE_AREAS.map((_, index) => index).sort((a, b) => known(a) - known(b) || a - b);
  return order.find((index) => index !== lastArea) ?? order[0];
}

export interface InvestigatorDependencies {
  complete(prompt: string): Promise<string>;
  /** Evidence sources; each returns plain text and may fail. */
  calendar?: (from: string, days: number) => Promise<string>;
  reminders?: () => Promise<string>;
  recall?: (query: string) => Promise<string>;
  /** What George's other assistants (Hermes, OpenClaw) learned about him. */
  otherAssistants?: () => Promise<string>;
  now?: () => Date;
  dir?: string;
  force?: boolean;
}

export function investigatorPrompt(area: string, known: string, evidence: string[], today: string): string {
  return [
    "You are the part of Flyd that quietly gets to know George better, from his own data. Nobody will see your notes except Flyd.",
    `Today is ${today}. Focus: ${area}.`,
    "",
    "What Flyd already knows:",
    known || "(very little)",
    "",
    "Evidence from George's own calendar, reminders, notes and conversations:",
    ...evidence.map((item, index) => `[e${index + 1}] ${item}`),
    "",
    "Write down only what the evidence clearly supports and a close friend would genuinely know about the focus area — or core facts about who he is (where he lives, his timezone, how his mind works, what he loves).",
    "- Facts about George himself only. Nothing about Flyd, its features, or how George talks to Flyd.",
    "- One plain sentence per fact, under 25 words, with the evidence ids it rests on.",
    "- No guesses about health, money, or relationships beyond what is stated. No work tasks or project status — that is tracked elsewhere.",
    "- Skip anything Flyd already knows. Zero facts is a fine answer.",
    "- section: People for people in his life; Who he is for core facts about him (location, timezone, interests, how his mind works, how he wants to be written to and helped — e.g. phrasings he dislikes); Facts for anything else.",
    "",
    'Reply with JSON only: {"facts": [{"section": "People|Who he is|Facts", "text": "...", "sources": ["e1"]}]}',
  ].join("\n");
}

export function parseFindings(text: string, evidenceCount: number): MemoryOp[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { facts?: Array<Record<string, unknown>> };
    return (parsed.facts ?? []).slice(0, 8).flatMap((fact) => {
      const text = String(fact.text ?? "").replace(/\s+/g, " ").trim();
      const sources = Array.isArray(fact.sources) ? fact.sources.map(String).filter((id) => /^e\d+$/.test(id) && Number(id.slice(1)) <= evidenceCount) : [];
      if (!text || text.length > 220 || sources.length === 0) return [];
      const section = fact.section === "People" || fact.section === "Who he is" ? fact.section : "Facts";
      return [{ op: "add" as const, section, text, tier: "aging" as const, sources: sources.map((id) => `investigator:${id}`) }];
    });
  } catch {
    return [];
  }
}

const RUN_EVERY_MS = 20 * 60 * 60 * 1000;

export interface InvestigationResult {
  status: "disabled" | "not_due" | "no_evidence" | "done";
  area?: string;
  added?: number;
}

/** One unhurried investigation into the thinnest area of George's life. */
export async function investigate(deps: InvestigatorDependencies): Promise<InvestigationResult> {
  if (process.env.FLYD_INVESTIGATOR === "0") return { status: "disabled" };
  const now = (deps.now ?? (() => new Date()))();
  const dir = deps.dir ?? investigatorDir();
  const state = readState(dir);
  if (!deps.force && state.lastRunAt && now.getTime() - Date.parse(state.lastRunAt) < RUN_EVERY_MS) return { status: "not_due" };

  let profile: string | null = null;
  try { profile = readUserProfile(); } catch { profile = null; }
  const memory = readMemoryEntries();
  const index = nextArea(profile, memory.map((entry) => entry.text), state.lastArea ?? -1);
  const area = LIFE_AREAS[index];

  const evidence: string[] = [];
  const add = (label: string, text: string | undefined) => {
    for (const line of (text ?? "").split("\n").map((item) => item.trim()).filter(Boolean).slice(0, 25)) evidence.push(`${label}: ${line.slice(0, 200)}`);
  };
  const back = new Date(now.getTime() - 30 * 86_400_000);
  await Promise.all([
    deps.calendar?.(localDay(back), 31).then((text) => add("calendar (past month)", text)).catch(() => undefined),
    deps.calendar?.(localDay(now), 31).then((text) => add("calendar (next month)", text)).catch(() => undefined),
    area.profile === "People" || area.profile === "Routines" ? deps.reminders?.().then((text) => add("reminders", text)).catch(() => undefined) : undefined,
    ...area.probes.slice(0, 3).map((probe) => deps.recall?.(probe).then((text) => add(`his notes on "${probe}"`, text)).catch(() => undefined)),
    deps.otherAssistants?.().then((text) => {
      for (const note of text.split(/\n\s*§\s*\n|\n{2,}/).map((item) => item.replace(/\s+/g, " ").trim()).filter((item) => item.length > 20).slice(0, 40)) {
        evidence.push(`what his other assistant learned: ${note.slice(0, 400)}`);
      }
    }).catch(() => undefined),
  ]);
  const useful = evidence.filter((line) => !/No calendar events|No open reminders|Error/i.test(line));
  writeState({ lastRunAt: now.toISOString(), lastArea: index }, dir);
  if (useful.length === 0) return { status: "no_evidence", area: area.area };

  const known = [
    ...(profile ? [...profileSections(profile).values()].flat() : []),
    ...memory.map((entry) => entry.text),
  ].slice(0, 120).map((line) => `- ${line}`).join("\n");
  const ops = parseFindings(await deps.complete(investigatorPrompt(area.area, known, useful.slice(0, 80), localDay(now))), useful.length);
  const receipt = ops.length ? applyMemoryOps(ops, { now }) : null;
  return { status: "done", area: area.area, added: receipt ? receipt.added : 0 };
}


// Everything George ever fed Flyd — profile exports, notes, past
// conversations — read once, in batches, for what it says about him. The
// Librarian only curates what arrives after it started; this closes the gap.

const BACKFILL_BATCH = 12;

interface BackfillState { done: string[]; finishedAt?: string }

function readBackfill(dir: string): BackfillState {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "backfill.json"), "utf8")) as Partial<BackfillState>;
    return { done: parsed.done ?? [], ...(parsed.finishedAt ? { finishedAt: parsed.finishedAt } : {}) };
  } catch { return { done: [] }; }
}

/** Captures not yet read, oldest first; George's words only from conversations. */
export function unreadCaptures(done: Set<string>, rawDir = RAW_DIR, limit = BACKFILL_BATCH): Array<{ id: string; text: string }> {
  if (!existsSync(rawDir)) return [];
  const files = readdirSync(rawDir)
    .filter((name) => name.endsWith(".md") && !name.startsWith("runtime-event") && !done.has(name))
    .map((name) => ({ name, mtime: statSync(join(rawDir, name)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name));
  const out: Array<{ id: string; text: string }> = [];
  for (const { name } of files) {
    if (out.length >= limit) break;
    try {
      let body = parse(readFileSync(join(rawDir, name), "utf8")).body.trim();
      if (name.startsWith("conversation-")) {
        body = body.split(/\n(?=\*\*(?:George|Flyd)\*\*)/).filter((part) => part.startsWith("**George**")).map((part) => part.replace("**George**", "George:").trim()).join("\n");
      }
      out.push({ id: name, text: body.slice(0, 2_500) });
    } catch {
      out.push({ id: name, text: "" });
    }
  }
  return out;
}

export async function backfillArchive(deps: Pick<InvestigatorDependencies, "complete" | "now" | "dir"> & { rawDir?: string }): Promise<{ status: "disabled" | "finished" | "done"; read: number; added: number }> {
  if (process.env.FLYD_INVESTIGATOR === "0") return { status: "disabled", read: 0, added: 0 };
  const dir = deps.dir ?? investigatorDir();
  const state = readBackfill(dir);
  if (state.finishedAt) return { status: "finished", read: 0, added: 0 };
  const now = (deps.now ?? (() => new Date()))();
  const batch = unreadCaptures(new Set(state.done), deps.rawDir);
  const save = (next: BackfillState) => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, "backfill.json.tmp"), JSON.stringify(next), { encoding: "utf8", mode: 0o600 });
    renameSync(join(dir, "backfill.json.tmp"), join(dir, "backfill.json"));
  };
  if (batch.length === 0) {
    save({ ...state, finishedAt: now.toISOString() });
    return { status: "finished", read: 0, added: 0 };
  }
  const evidence = batch.filter((item) => item.text.length >= 20).map((item) => `from ${item.id}: ${item.text}`);
  let added = 0;
  if (evidence.length) {
    let profile: string | null = null;
    try { profile = readUserProfile(); } catch { profile = null; }
    const known = [
      ...(profile ? [...profileSections(profile).values()].flat() : []),
      ...readMemoryEntries().map((entry) => entry.text),
    ].slice(0, 150).map((line) => `- ${line}`).join("\n");
    const ops = parseFindings(await deps.complete(investigatorPrompt(
      "anything these notes reveal about who George is, the people in his life, what he loves, how his mind works, and how he likes to be spoken to and helped",
      known, evidence, localDay(now),
    )), evidence.length);
    if (ops.length) added = applyMemoryOps(ops, { now }).added;
  }
  save({ done: [...state.done, ...batch.map((item) => item.id)] });
  return { status: "done", read: batch.length, added };
}
