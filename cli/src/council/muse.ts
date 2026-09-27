import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { openAdvisories, readAdvisories, sameIdea, updateAdvisoryStatus, type Advisory } from "./advisors.js";
import { localDay, memoryPaths, readMemoryEntries, searchDailyNotes, type MemoryEntry } from "./memory-store.js";
import { latestEdition, recentFlashes } from "./scout.js";

/** Today's Scout stories and must-know flashes, so the Muse can raise one when a conversation touches it. */
function storyNotes(): string[] {
  const edition = latestEdition();
  const stories = edition ? edition.items.map((item) => `Story (${edition.date}): ${item.title} — ${item.why} ${item.url}`) : [];
  return [...recentFlashes().map((item) => `Must-know: ${item.title} — ${item.why} ${item.url}`), ...stories];
}

// The Muse waits in the wings. After each turn it looks at what George said
// and what Flyd answered, weighs what the council knows — the Librarian's
// memory and the Critic's and Strategist's advisories — and speaks only when
// it has something that genuinely helps right now. Silence is the default:
// most turns cost nothing because nothing relevant is found.

export const UNPROMPTED_ADVISORIES_PER_DAY = 2;

export interface MuseCandidate {
  kind: "advisory" | "memory" | "note";
  id: string;
  text: string;
  score: number;
  advisory?: Advisory;
}

const STOP = new Set(["the", "and", "for", "that", "this", "with", "you", "your", "are", "was", "what", "have", "has", "but", "not", "can", "about", "just", "from", "they", "them", "then", "there", "will", "would", "should", "could", "how", "why", "when", "where", "who", "its", "it's", "i'm", "george", "flyd", "does", "did", "our", "out", "all", "any", "get", "got", "let", "make", "need", "want", "like", "now", "today"]);

export function keyTerms(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9$€£.+-]+/).map((term) => term.replace(/^[.+-]+|[.+-]+$/g, "")).filter((term) => term.length > 2 && !STOP.has(term)));
}

function overlap(terms: Set<string>, text: string): number {
  let hits = 0;
  for (const term of keyTerms(text)) if (terms.has(term)) hits += 1;
  return hits;
}

/** Deterministic, local candidate search — no model call. */
export function museCandidates(
  message: string,
  answer: string,
  sources: { advisories: Advisory[]; memory: MemoryEntry[]; notes: string[] },
): MuseCandidate[] {
  const terms = keyTerms(message);
  if (terms.size === 0) return [];
  const answerTerms = keyTerms(answer);
  const candidates: MuseCandidate[] = [];
  for (const advisory of sources.advisories) {
    const topicHits = advisory.topics.filter((topic) => [...keyTerms(topic)].some((term) => terms.has(term))).length;
    const score = topicHits * 2 + overlap(terms, advisory.text) + (advisory.urgency === "high" ? 1 : 0);
    // An advisory must be about what George is talking about, not merely share words with it.
    if (topicHits >= 1 && score >= 3) candidates.push({ kind: "advisory", id: advisory.id, text: `${advisory.text}${advisory.whyNow ? ` (why now: ${advisory.whyNow})` : ""}`, score, advisory });
  }
  for (const entry of sources.memory) {
    const score = overlap(terms, entry.text);
    // Memory the answer already used adds nothing.
    if (score >= 2 && overlap(answerTerms, entry.text) < score) {
      candidates.push({ kind: "memory", id: entry.id, text: `${entry.text} (${entry.section}, confirmed ${entry.date})`, score });
    }
  }
  for (const note of sources.notes) {
    const score = overlap(terms, note);
    if (score >= 2) candidates.push({ kind: "note", id: note.slice(0, 24), text: note, score: score - 0.5 });
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 5);
}

export function musePrompt(message: string, answer: string, candidates: MuseCandidate[], today: string): string {
  return [
    "You are the Muse: George's friend and personal aide, sitting quietly beside his conversation with Flyd.",
    "You speak up only when you can genuinely help him right now — a relevant thing he told Flyd before, a commitment or deadline this touches, a risk or an opportunity his advisors spotted.",
    `Today is ${today}.`,
    "",
    `George just said: """${message.slice(0, 1_500)}"""`,
    `Flyd answered: """${answer.slice(0, 1_500)}"""`,
    "",
    "What the council knows that might bear on this:",
    ...candidates.map((candidate) => `- [${candidate.kind}:${candidate.id}] ${candidate.text}`),
    "",
    "Rules:",
    "- If none of it clearly helps with THIS moment, or Flyd's answer already covered it, reply exactly NONE.",
    "- The note must serve George's immediate goal in this message. A cross-project idea or opportunity that pulls his attention elsewhere — however good — is NONE right now.",
    "- Otherwise reply with one or two short, warm, plain sentences addressed to George — no preamble, no labels, no bullet points.",
    "- Be measured: raise a concern calmly and constructively; never nag, never moralise.",
    "- End with the id you used in square brackets, e.g. [advisory:ab12cd34].",
  ].join("\n");
}

export function parseMuseReply(text: string): { note: string; ref?: string } | null {
  const trimmed = text.trim();
  if (!trimmed || /^none\b/i.test(trimmed)) return null;
  const ref = trimmed.match(/\[(advisory|memory|note):([^\]]+)\]\s*$/);
  const note = trimmed.replace(/\s*\[(?:advisory|memory|note):[^\]]+\]\s*$/, "").trim();
  if (!note || note.length > 500) return null;
  return { note, ...(ref ? { ref: `${ref[1]}:${ref[2]}` } : {}) };
}

interface MuseState { day: string; unprompted: number }

function museStatePath(): string {
  return join(process.env.FLYD_COUNCIL_DIR?.trim() || join(FLYD_DIR, "council"), "muse-state.json");
}

function readMuseState(today: string, path = museStatePath()): MuseState {
  try {
    const state = JSON.parse(readFileSync(path, "utf8")) as MuseState;
    return state.day === today ? state : { day: today, unprompted: 0 };
  } catch {
    return { day: today, unprompted: 0 };
  }
}

export interface MuseDependencies {
  complete(prompt: string): Promise<string>;
  now?: () => Date;
  /** Refs already surfaced in this conversation, so the Muse never repeats itself. */
  alreadySaid?: Set<string>;
}

export interface MuseNote {
  note: string;
  ref?: string;
  advisory?: Advisory;
}

export async function consultMuse(message: string, answer: string, deps: MuseDependencies): Promise<MuseNote | null> {
  const now = (deps.now ?? (() => new Date()))();
  const today = localDay(now);
  const state = readMuseState(today);
  const advisoriesAllowed = state.unprompted < UNPROMPTED_ADVISORIES_PER_DAY;
  const said = deps.alreadySaid ?? new Set<string>();
  // Variety: nothing that repeats a point George saw in the last week or waved away.
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const recentlyRaised = readAdvisories().filter((advisory) =>
    advisory.status === "dismissed" || (advisory.shownAt !== undefined && Date.parse(advisory.shownAt) >= weekAgo));
  const fresh = openAdvisories(now).filter((advisory) => !recentlyRaised.some((raised) => sameIdea(raised, advisory)));
  const candidates = museCandidates(message, answer, {
    advisories: advisoriesAllowed ? fresh : [],
    memory: readMemoryEntries(memoryPaths()),
    notes: [
      ...searchDailyNotes(message),
      ...storyNotes(),
    ],
  }).filter((candidate) => !said.has(`${candidate.kind}:${candidate.id}`));
  if (candidates.length === 0) return null;

  const reply = parseMuseReply(await deps.complete(musePrompt(message, answer, candidates, today)));
  if (!reply) return null;
  const used = candidates.find((candidate) => reply.ref === `${candidate.kind}:${candidate.id}`);
  if (reply.ref) said.add(reply.ref);
  if (used?.advisory) {
    updateAdvisoryStatus(used.advisory.id, "shown", now);
    const path = museStatePath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify({ day: today, unprompted: state.unprompted + 1 }), { encoding: "utf8", mode: 0o600 });
  }
  return { note: reply.note, ...(reply.ref ? { ref: reply.ref } : {}), ...(used?.advisory ? { advisory: used.advisory } : {}) };
}
