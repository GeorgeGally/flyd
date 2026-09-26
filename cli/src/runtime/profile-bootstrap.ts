import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { RAW_DIR } from "../lib/config.js";
import { parse } from "../lib/frontmatter.js";
import { PROFILE_SECTIONS, type ProfileSection } from "../lib/user-profile.js";

// Draft George's profile from what he has already told Flyd: his captures and
// what he said in conversations. Flyd had 500+ notes and still knew nothing
// about him as a person, because nothing ever distilled them.

export interface ProfileFact {
  section: ProfileSection;
  fact: string;
}

export interface BootstrapDependencies {
  /** Model call that returns raw text (JSON expected). */
  complete(prompt: string): Promise<string>;
  rawDir?: string;
  maxChars?: number;
  chunkChars?: number;
}

/** Newest-first George-authored text: captures, plus only George's lines from conversation indexes. */
export function collectGeorgeText(rawDir = RAW_DIR, maxChars = 160_000): string[] {
  if (!existsSync(rawDir)) return [];
  const files = readdirSync(rawDir)
    .filter((name) => name.endsWith(".md") && !name.startsWith("runtime-event"))
    .map((name) => ({ name, mtime: statSync(join(rawDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const pieces: string[] = [];
  let total = 0;
  for (const { name } of files) {
    let body: string;
    try {
      body = parse(readFileSync(join(rawDir, name), "utf8")).body;
    } catch {
      continue;
    }
    if (name.startsWith("conversation-")) {
      // Only what George said is evidence about George.
      body = body.split("\n").filter((line) => /^\s*-\s*\d{4}-\d{2}-\d{2}T/.test(line)).map((line) => line.replace(/^\s*-\s*\S+:\s*/, "- ")).join("\n");
    }
    const text = body.replace(/\s+\n/g, "\n").trim();
    if (text.length < 25) continue;
    const clipped = text.slice(0, 3_000);
    pieces.push(`[${name.replace(/\.md$/, "")}] ${clipped}`);
    total += clipped.length;
    if (total >= maxChars) break;
  }
  return pieces;
}

export function chunkPieces(pieces: string[], chunkChars: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length > chunkChars) {
      chunks.push(current);
      current = "";
    }
    current += `${piece}\n\n`;
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

const SECTION_LIST = PROFILE_SECTIONS.join(", ");

function extractionPrompt(notes: string): string {
  return [
    "Below are George's own notes and things he said to his assistant, newest first.",
    "Extract DURABLE facts about George as a person that a chief of staff would want to know: identity, where he lives, his work and businesses, the people in his life (names + relationship), preferences and tastes, routines, goals, and constraints.",
    "Rules: only facts clearly stated or strongly implied by George himself; skip software implementation details, one-off tasks, and anything speculative; prefer the newest statement when notes conflict; write each fact as one short third-person sentence; never include secrets, passwords, or account numbers.",
    `Sections: ${SECTION_LIST}.`,
    'Reply with JSON only: {"facts": [{"section": "<one of the sections>", "fact": "<short sentence>"}]} — at most 25 facts; [] if nothing qualifies.',
    "--- notes ---",
    notes,
  ].join("\n");
}

function consolidationPrompt(facts: ProfileFact[]): string {
  return [
    "These facts about George were extracted from different batches of his notes (earlier batches are newer).",
    "Merge duplicates, drop anything trivial or implementation-level, resolve contradictions in favour of the first (newest) version, and keep the 40 most useful facts for a personal assistant.",
    `Sections: ${SECTION_LIST}.`,
    'Reply with JSON only: {"facts": [{"section": "...", "fact": "..."}]}',
    JSON.stringify(facts),
  ].join("\n");
}

export function parseFacts(text: string): ProfileFact[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { facts?: Array<{ section?: unknown; fact?: unknown }> };
    return (parsed.facts ?? []).flatMap((item) => {
      const fact = String(item.fact ?? "").replace(/\s+/g, " ").trim();
      const section = PROFILE_SECTIONS.find((name) => name.toLowerCase() === String(item.section ?? "").toLowerCase());
      return fact && section && fact.length <= 300 ? [{ section, fact }] : [];
    });
  } catch {
    return [];
  }
}

export async function draftProfileFromMemory(deps: BootstrapDependencies): Promise<{ facts: ProfileFact[]; sources: number }> {
  const pieces = collectGeorgeText(deps.rawDir, deps.maxChars);
  if (pieces.length === 0) return { facts: [], sources: 0 };
  const chunks = chunkPieces(pieces, deps.chunkChars ?? 40_000);
  const perChunk = await Promise.all(chunks.map(async (chunk) => {
    try {
      return parseFacts(await deps.complete(extractionPrompt(chunk)));
    } catch {
      return [];
    }
  }));
  const extracted = perChunk.flat();
  if (extracted.length === 0) return { facts: [], sources: pieces.length };
  const consolidated = chunks.length > 1 ? parseFacts(await deps.complete(consolidationPrompt(extracted))) : extracted;
  return { facts: (consolidated.length ? consolidated : extracted).slice(0, 40), sources: pieces.length };
}
