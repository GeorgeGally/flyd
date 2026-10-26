// Which raw notes a newer note replaced. Raw captures stay immutable; this
// ledger is what stops an old value coming back as current. It is written when
// a note is saved (the newer note names what it replaces, judged once by a
// model) and read on every search: a replaced note is left out unless the
// question looks back in time. Age alone never retires a note — "I lived in
// Cape Town" stays true however old it is.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { FLYD_DIR, RAW_DIR } from "./config.js";
import { parse } from "./frontmatter.js";
import { extractKeywords } from "./retrieval.js";

export interface Replacement {
  /** The raw note (path relative to the raw archive) that replaced it. */
  by: string;
  at: string;
  /** What changed, in a few words. */
  why?: string;
}

export function supersededPath(): string {
  return join(FLYD_DIR, "memory-superseded.json");
}

export function readSuperseded(path = supersededPath()): Record<string, Replacement> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, Replacement>;
  } catch {
    return {};
  }
}

export function markSuperseded(replaced: Record<string, Replacement>, path = supersededPath()): void {
  if (!Object.keys(replaced).length) return;
  const ledger = { ...readSuperseded(path), ...replaced };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(ledger, null, 1), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

/** Words that ask about how things were, when a replaced note is the answer. */
const LOOKING_BACK = /\b(?:before|previously|used? to|back when|history|historical|earlier|originally|was it|what was|last time|changed? from)\b/i;

export function looksBack(query: string): boolean {
  return LOOKING_BACK.test(query);
}

/** Drop notes a newer note replaced, unless the question looks back. */
export function withoutReplaced<T extends { path: string; source?: string }>(entries: T[], query: string, ledger = readSuperseded()): T[] {
  if (looksBack(query) || !Object.keys(ledger).length) return entries;
  return entries.filter((entry) => entry.source === "wiki" || !ledger[entry.path]);
}

export interface SupersedeDependencies {
  /** Raw notes sharing these words, best first: paths relative to the raw archive. */
  search(keywords: string[]): Promise<Array<{ path: string }>>;
  /** One model call; returns its reply. */
  complete(prompt: string): Promise<string>;
  rawDir?: string;
  ledgerPath?: string;
  now?: Date;
}

const CANDIDATES = 6;

export function supersedePrompt(note: string, older: Array<{ id: number; at: string; text: string }>): string {
  return [
    "George just saved a new note to his memory. Decide which of the older notes it replaces.",
    "A note is replaced only when it is about the same thing and the new note says that thing changed: a new value, a new place, a new plan, no longer true.",
    "Not replaced: a note that is still true beside the new one, a note about the past that stays true (\"I lived in Cape Town\"), a note on a related but different thing, or anything you are unsure of.",
    "Most of the time nothing is replaced.",
    'Reply with JSON only: {"replaced": [{"id": 1, "why": "a few words on what changed"}]}',
    "",
    `New note (${new Date().toISOString().slice(0, 10)}):\n${note.slice(0, 1500)}`,
    "",
    "Older notes:",
    ...older.map((item) => `[${item.id}] (${item.at}) ${item.text.slice(0, 600)}`),
  ].join("\n");
}

/**
 * After a note is saved: find the few older notes on the same subject and
 * record those it replaces. Best effort — a failure leaves the ledger as it was.
 */
export async function supersedeOnCapture(notePath: string, text: string, deps: SupersedeDependencies): Promise<Record<string, Replacement>> {
  const rawDir = deps.rawDir ?? RAW_DIR;
  const self = basename(notePath);
  const keywords = extractKeywords(text).slice(0, 8);
  if (!keywords.length) return {};
  const ledger = readSuperseded(deps.ledgerPath);
  const found = await deps.search(keywords);
  const older = found
    .map((hit) => hit.path)
    .filter((path, index, all) => path !== self && all.indexOf(path) === index && !ledger[path] && path < self)
    .slice(0, CANDIDATES)
    .flatMap((path, index) => {
      const full = join(rawDir, path);
      if (!existsSync(full)) return [];
      const parsed = parse(readFileSync(full, "utf8"));
      const body = parsed.body.trim();
      return body ? [{ id: index + 1, path, at: String(parsed.metadata.timestamp ?? path.slice(0, 10)), text: body }] : [];
    });
  if (!older.length) return {};
  const reply = await deps.complete(supersedePrompt(text, older));
  const match = reply.match(/\{[\s\S]*\}/);
  if (!match) return {};
  let parsed: { replaced?: Array<{ id?: unknown; why?: unknown }> };
  try { parsed = JSON.parse(match[0]) as typeof parsed; } catch { return {}; }
  const at = (deps.now ?? new Date()).toISOString();
  const replaced: Record<string, Replacement> = {};
  for (const item of parsed.replaced ?? []) {
    const hit = older.find((candidate) => candidate.id === Number(item.id));
    if (!hit) continue;
    replaced[hit.path] = { by: self, at, ...(typeof item.why === "string" && item.why.trim() ? { why: item.why.trim().slice(0, 160) } : {}) };
  }
  markSuperseded(replaced, deps.ledgerPath);
  return replaced;
}

/** The live wiring: lexical raw search and Flyd's own model. Never under test. */
export function supersedeInBackground(notePath: string, text: string): void {
  if (process.env.VITEST || process.env.FLYD_SUPERSEDE === "0") return;
  void (async () => {
    const [{ searchLexical }, { query }, { QMD_RAW_COLLECTION }, { mergeSearchResults }] = await Promise.all([
      import("./qmd.js"), import("./llm.js"), import("./retrieval.js"), import("./brain-retrieval.js"),
    ]);
    await supersedeOnCapture(notePath, text, {
      // Lexical search ANDs its words: one word at a time, merged, finds notes that share most of them.
      search: async (keywords) => mergeSearchResults(await Promise.all(keywords.slice(0, 5).map((word) => searchLexical(word, QMD_RAW_COLLECTION, 10)))),
      complete: (prompt) => query(prompt, undefined, undefined, undefined, undefined, { json: true }),
    });
  })().catch(() => undefined);
}
