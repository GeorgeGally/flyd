import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR, RAW_DIR } from "../lib/config.js";
import { parse } from "../lib/frontmatter.js";
import { addUserProfileFact, PROFILE_SECTIONS, readUserProfile } from "../lib/user-profile.js";
import { readJournalSince, type JournalTurn } from "./journal.js";
import {
  applyMemoryOps, localDay, MEMORY_SECTIONS, memoryPaths, readMemoryEntries, staleEntries,
  type ApplyReceipt, type MemoryOp, type MemoryPaths,
} from "./memory-store.js";

// The Librarian: Flyd's curator. It reads what George said (the journal) and
// wrote (captures) since its last pass, and keeps the memory he relies on
// current — recording corrections first, then preferences, facts,
// contradictions — citing sources and archiving rather than deleting.
// It proposes; memory-store.ts applies. (Letta's reflection subagent,
// Honcho's deductive dreamer, firstmate's /stow.)

export interface LibrarianState {
  journalCursor: string | null;
  captureCursorMs: number;
  lastRunAt: string | null;
  runs: number;
}

export function librarianStatePath(): string {
  return process.env.FLYD_LIBRARIAN_STATE?.trim() || join(FLYD_DIR, "council", "librarian-state.json");
}

export function readLibrarianState(path = librarianStatePath()): LibrarianState {
  try {
    return { journalCursor: null, captureCursorMs: 0, lastRunAt: null, runs: 0, ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { journalCursor: null, captureCursorMs: 0, lastRunAt: null, runs: 0 };
  }
}

function writeLibrarianState(state: LibrarianState, path = librarianStatePath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export interface CaptureNote {
  id: string;
  mtimeMs: number;
  text: string;
}

/** Captures George wrote since the cursor, oldest first (runtime events and conversation indexes excluded). */
export function collectNewCaptures(sinceMs: number, rawDir = RAW_DIR, limit = 40): CaptureNote[] {
  if (!existsSync(rawDir)) return [];
  const notes: CaptureNote[] = [];
  for (const name of readdirSync(rawDir)) {
    if (!name.endsWith(".md") || name.startsWith("runtime-event") || name.startsWith("conversation-")) continue;
    const path = join(rawDir, name);
    const mtimeMs = statSync(path).mtimeMs;
    if (mtimeMs <= sinceMs) continue;
    try {
      const body = parse(readFileSync(path, "utf8")).body.trim();
      if (body.length >= 20) notes.push({ id: `cap:${name.replace(/\.md$/, "")}`, mtimeMs, text: body.slice(0, 2_000) });
    } catch {
      // Unparseable capture: skip, never fatal.
    }
  }
  return notes.sort((a, b) => a.mtimeMs - b.mtimeMs).slice(0, limit);
}

export interface LibrarianInput {
  turns: JournalTurn[];
  captures: CaptureNote[];
  memory: ReturnType<typeof readMemoryEntries>;
  stale: ReturnType<typeof staleEntries>;
  profile: string | null;
  today: string;
}

export function librarianPrompt(input: LibrarianInput): string {
  const turns = input.turns.map((turn) =>
    `[j:${turn.id}] ${turn.at.slice(0, 16)}\nGeorge: ${turn.user.slice(0, 1_500)}\nFlyd: ${turn.assistant.slice(0, 800)}${turn.tools?.length ? `\n(tools: ${turn.tools.join("; ").slice(0, 300)})` : ""}`).join("\n\n");
  const captures = input.captures.map((note) => `[${note.id}] ${note.text}`).join("\n\n");
  const memory = input.memory.map((entry) => `[${entry.id}] (${entry.section}, ${entry.tier}, confirmed ${entry.date}) ${entry.text}`).join("\n");
  const stale = input.stale.map((entry) => `[${entry.id}] ${entry.text}`).join("\n");
  return [
    "You are Flyd's Librarian: the curator of George's memory. George is the only person you serve.",
    `Today is ${input.today}.`,
    "Read what happened since your last pass and keep his memory accurate, small, and current.",
    "",
    "Priorities, in order:",
    "1. Corrections and mistakes — George correcting Flyd or himself. Fix the stored fact at its source.",
    "2. Commitments and decisions — promises, deadlines, choices he made and why.",
    "3. Facts about his world — projects, people, places, standing arrangements.",
    "4. Contradictions — new evidence that conflicts with memory: update the old entry, never keep both.",
    "",
    "Rules:",
    "- Durable only. Skip one-off requests, moods, chit-chat, transient errors, and anything already stored.",
    "- One short sentence per entry (under ~25 words), in plain language a friend would use. No class, service, or file names — code details belong in the project's own docs, not George's memory.",
    "- Never record claims that a tool or feature 'does not work' — those harden into false refusals.",
    "- Convert relative dates to absolute ones.",
    "- Who George is (identity, preferences, people, routines, goals, constraints) goes to his profile via profile ops; everything else to memory.",
    "- Commitments with a date are perishable; standing facts and decisions are aging.",
    "- Cite sources with the [j:…] / [cap:…] ids you were shown. Do not invent ids.",
    "- For each STALE entry: reinforce it if today's evidence confirms it, archive it if superseded or done, otherwise leave it.",
    "- Fewer, better entries. When nothing qualifies, return empty lists.",
    "",
    `Memory sections: ${MEMORY_SECTIONS.join(", ")}. Profile sections: ${PROFILE_SECTIONS.join(", ")}.`,
    "",
    "Reply with JSON only:",
    '{"memory_ops": [ {"op":"add","section":"...","text":"...","tier":"aging|perishable","sources":["j:..."]} | {"op":"update","id":"...","text":"...","sources":[...]} | {"op":"reinforce","id":"...","sources":[...]} | {"op":"archive","id":"...","reason":"..."} | {"op":"daily_note","text":"...","sources":[...]} ],',
    ' "profile_ops": [ {"section":"...","fact":"..."} ],',
    ' "observations": ["<up to 5 short notes for George\'s advisors about what stands out: risks, patterns, momentum, loose ends>"] }',
    "",
    `--- George's profile ---\n${input.profile ?? "(empty)"}`,
    `--- Current memory ---\n${memory || "(empty)"}`,
    `--- Stale entries needing a decision ---\n${stale || "(none)"}`,
    `--- Conversation since last pass ---\n${turns || "(none)"}`,
    `--- New captures ---\n${captures || "(none)"}`,
  ].join("\n");
}

export interface LibrarianProposal {
  memoryOps: MemoryOp[];
  profileOps: Array<{ section: string; fact: string }>;
  observations: string[];
}

export function parseLibrarianProposal(text: string): LibrarianProposal {
  const empty: LibrarianProposal = { memoryOps: [], profileOps: [], observations: [] };
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return empty;
  try {
    const parsed = JSON.parse(match[0]) as { memory_ops?: unknown[]; profile_ops?: unknown[]; observations?: unknown[] };
    return {
      memoryOps: (parsed.memory_ops ?? []).filter((op): op is MemoryOp => typeof op === "object" && op !== null && typeof (op as { op?: unknown }).op === "string").slice(0, 30),
      profileOps: (parsed.profile_ops ?? []).flatMap((op) => {
        const record = op as { section?: unknown; fact?: unknown };
        return typeof record?.fact === "string" && record.fact.trim() ? [{ section: String(record.section ?? ""), fact: record.fact.trim() }] : [];
      }).slice(0, 10),
      observations: (parsed.observations ?? []).map(String).map((note) => note.trim()).filter(Boolean).slice(0, 5),
    };
  } catch {
    return empty;
  }
}

export interface LibrarianRunResult {
  skipped?: "nothing_new";
  turns: number;
  captures: number;
  memory?: ApplyReceipt;
  profileAdded: number;
  observations: string[];
}

export interface LibrarianDependencies {
  complete(prompt: string): Promise<string>;
  now?: () => Date;
  memoryPaths?: MemoryPaths;
  statePath?: string;
  journalDir?: string;
  rawDir?: string;
  addProfileFact?: (fact: string, section: string) => boolean;
  readProfile?: () => string | null;
}

/** One curation pass over everything new since the last one. */
export async function runLibrarian(deps: LibrarianDependencies): Promise<LibrarianRunResult> {
  const now = (deps.now ?? (() => new Date()))();
  const state = readLibrarianState(deps.statePath);
  const turns = readJournalSince(state.journalCursor, deps.journalDir, 120);
  const captures = collectNewCaptures(state.captureCursorMs, deps.rawDir);
  const paths = deps.memoryPaths ?? memoryPaths();
  const memory = readMemoryEntries(paths);
  const stale = staleEntries(memory, now);
  if (turns.length === 0 && captures.length === 0 && stale.length === 0) {
    return { skipped: "nothing_new", turns: 0, captures: 0, profileAdded: 0, observations: [] };
  }
  const profile = (deps.readProfile ?? readUserProfile)();
  const reply = await deps.complete(librarianPrompt({
    turns, captures, memory, stale, profile, today: localDay(now),
  }));
  // An unparseable reply must not consume the slice: keep the cursors and retry next pass.
  if (!/\{[\s\S]*\}/.test(reply)) throw new Error("Librarian returned no JSON proposal; cursors kept for retry");
  const proposal = parseLibrarianProposal(reply);
  const receipt = applyMemoryOps(proposal.memoryOps, { now, paths });
  const addProfile = deps.addProfileFact
    ?? ((fact: string, section: string) => addUserProfileFact(fact, {
      section: PROFILE_SECTIONS.find((name) => name.toLowerCase() === section.toLowerCase()) ?? "Learned in conversation",
    }));
  const profileAdded = proposal.profileOps.filter(({ fact, section }) => addProfile(fact, section)).length;
  // Advance cursors only after a successful pass so a failed one is retried.
  writeLibrarianState({
    journalCursor: turns.at(-1)?.at ?? state.journalCursor,
    captureCursorMs: captures.at(-1)?.mtimeMs ?? state.captureCursorMs,
    lastRunAt: now.toISOString(),
    runs: state.runs + 1,
  }, deps.statePath);
  return { turns: turns.length, captures: captures.length, memory: receipt, profileAdded, observations: proposal.observations };
}
