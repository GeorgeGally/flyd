import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { FLYD_DIR } from "../lib/config.js";
import type { JournalTurn } from "./journal.js";
import { localDay } from "./memory-store.js";

// The Critic and the Strategist advise the Librarian. Both work for George:
// the Critic is a measured sceptic aimed at his blind spots, not at him; the
// Strategist looks for leverage and momentum. They write advisories — claims
// with evidence, confidence, and an expiry — that the Muse may raise when the
// moment is right. Silence is the default; most passes should produce nothing.

export type AdvisorName = "critic" | "strategist";
export type AdvisoryStatus = "open" | "shown" | "useful" | "dismissed" | "expired";

export interface Advisory {
  id: string;
  advisor: AdvisorName;
  /** The advice itself in one sentence of at most 30 words: what the card says. */
  headline?: string;
  text: string;
  whyNow: string;
  evidence: string[];
  confidence: "low" | "medium" | "high";
  urgency: "low" | "normal" | "high";
  topics: string[];
  createdAt: string;
  expires: string;
  status: AdvisoryStatus;
  shownAt?: string;
}

export function advisoriesPath(): string {
  return process.env.FLYD_ADVISORIES_PATH?.trim() || join(FLYD_DIR, "council", "advisories.jsonl");
}

export function readAdvisories(path = advisoriesPath()): Advisory[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as Advisory]; } catch { return []; }
  });
}

function writeAdvisories(advisories: Advisory[], path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, advisories.map((advisory) => JSON.stringify(advisory)).join("\n") + (advisories.length ? "\n" : ""), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

/** Open advisories that have not expired, newest first. */
export function openAdvisories(now = new Date(), path = advisoriesPath()): Advisory[] {
  const today = localDay(now);
  return readAdvisories(path).filter((advisory) => advisory.status === "open" && advisory.expires >= today).reverse();
}

/** Open advisories kept per advisor: a short, sharp list beats a backlog of worries. */
export const MAX_OPEN_PER_ADVISOR = 4;

function topicSet(advisory: Advisory): Set<string> {
  return new Set(advisory.topics.flatMap((topic) => topic.split(/[\s-]+/)).filter((word) => word.length > 2));
}

/** Two advisories are the same idea when most of their topics overlap. */
export function sameIdea(a: Advisory, b: Advisory): boolean {
  const left = topicSet(a);
  const right = topicSet(b);
  if (left.size === 0 || right.size === 0) return false;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size) >= 0.6;
}

const URGENCY_RANK = { high: 3, normal: 2, low: 1 } as const;
const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 } as const;

function worth(advisory: Advisory): number {
  return URGENCY_RANK[advisory.urgency] * 10 + CONFIDENCE_RANK[advisory.confidence] * 3 + Date.parse(advisory.createdAt) / 1e13;
}

/**
 * Keep the open list short and distinct: of advisories making the same point,
 * only the strongest stays open; beyond the per-advisor cap, the weakest
 * retire. Retired advisories are marked expired, never deleted.
 */
export function pruneAdvisories(advisories: Advisory[]): { kept: Advisory[]; retired: number } {
  const open = advisories.filter((advisory) => advisory.status === "open").sort((a, b) => worth(b) - worth(a));
  const keep = new Set<string>();
  const perAdvisor: Record<string, number> = {};
  for (const advisory of open) {
    const duplicate = open.some((other) => keep.has(other.id) && sameIdea(other, advisory));
    if (duplicate || (perAdvisor[advisory.advisor] ?? 0) >= MAX_OPEN_PER_ADVISOR) continue;
    keep.add(advisory.id);
    perAdvisor[advisory.advisor] = (perAdvisor[advisory.advisor] ?? 0) + 1;
  }
  let retired = 0;
  const kept = advisories.map((advisory) => {
    if (advisory.status !== "open" || keep.has(advisory.id)) return advisory;
    retired += 1;
    return { ...advisory, status: "expired" as const };
  });
  return { kept, retired };
}

export function pruneAdvisoryStore(path = advisoriesPath()): number {
  const { kept, retired } = pruneAdvisories(readAdvisories(path));
  if (retired) writeAdvisories(kept, path);
  return retired;
}

export function updateAdvisoryStatus(id: string, status: AdvisoryStatus, now = new Date(), path = advisoriesPath()): Advisory | null {
  const advisories = readAdvisories(path);
  const index = advisories.findIndex((advisory) => advisory.id === id);
  if (index === -1) return null;
  advisories[index] = { ...advisories[index], status, ...(status === "shown" ? { shownAt: now.toISOString() } : {}) };
  writeAdvisories(advisories, path);
  return advisories[index];
}

const PERSONA: Record<AdvisorName, string> = {
  critic: [
    "You are George's Critic: a measured, fair-minded sceptic who is firmly on his side.",
    "Your job is to protect him from his blind spots, not to judge him. Look for:",
    "- commitments or deadlines that are slipping or collide with each other;",
    "- decisions resting on thin or outdated evidence, or contradicting what he said before;",
    "- over-commitment: more open threads than attention;",
    "- things he keeps deferring or circling without deciding;",
    "- risks he has not named (money, reputation, health, relationships, security).",
    "Be specific and calm. Name the evidence. Suggest the smallest step that would reduce the risk.",
  ].join("\n"),
  strategist: [
    "You are George's Strategist: an optimistic, practical ally.",
    "Look for:",
    "- leverage: work in one project that would unlock another;",
    "- patterns worth doubling down on (what is working, where momentum is);",
    "- opportunities he mentioned once and let drop;",
    "- the single move that would unblock the most;",
    "- ways his stated goals and his actual time line up — or could.",
    "Be concrete: name the move, the evidence, and why now.",
  ].join("\n"),
};

export interface AdvisorInput {
  profile: string | null;
  memory: string | null;
  recentTurns: JournalTurn[];
  observations: string[];
  open: Advisory[];
  today: string;
  /** His projects, one line each: what advice is grounded in. */
  projects?: string;
  /** His learned taste rules, one per line: how he is likely to react. */
  taste?: string;
}

/**
 * Both advisors in one call: the same reading of the same week, two voices kept apart.
 * One call instead of two reads the context once; each voice still answers on its own.
 */
export function advisorPrompt(input: AdvisorInput): string {
  const turns = input.recentTurns.map((turn) => `[j:${turn.id}] ${turn.at.slice(0, 10)} George: ${turn.user.slice(0, 600)}`).join("\n");
  return [
    "You answer as two advisors to George, one after the other. Keep their voices apart: each judges on its own, and neither softens the other.",
    "",
    `--- Advisor "critic" ---\n${PERSONA.critic}`,
    "",
    `--- Advisor "strategist" ---\n${PERSONA.strategist}`,
    "",
    `Today is ${input.today}.`,
    "",
    "Rules:",
    "- Most of the time the right answer is nothing. Only raise what George would thank you for within the week.",
    "- Never restate an open advisory in new words; if yours makes the same point, say nothing.",
    "- At most 2 advisories per advisor. Each must cite evidence ids you were shown ([j:…] turns or memory lines quoted verbatim).",
    "- Do not repeat an open advisory; do not restate facts he obviously knows.",
    "- 'headline' is the advice itself in one plain sentence of at most 30 words, the action first (\"Send the GNM vendor email today: the sponsor ask waits on it.\"). 'text' holds the full reasoning.",
    "- 'why_now' says why this matters in the next days, not in general.",
    "- 'expires' is the date after which the advisory is no longer useful (YYYY-MM-DD).",
    "- 'topics' are 2-5 lowercase keywords (people, project names, places) that would make this relevant in a conversation.",
    "- urgency 'high' only for something that will cost him if not handled within ~48 hours.",
    "- Advise George about his life, work, money and people. Never about Flyd itself (its voice, bugs, what it forgot): that is not his to fix.",
    "- Before you keep any advisory, look at it six ways and keep only what survives: the facts (is the evidence real and current?), the upside (what he gains), the risk (what could go wrong), another way (a better or cheaper move), his gut (how George himself will react, judged from his profile and taste), and the order (is this the next thing, or does something come first?).",
    "- The headline is one recommendation, never a list of those six. Name a risk or his likely reaction only when it changes the advice (\"Ship V2 Spindle: V6's numeral fights the type you prefer.\").",
    "",
    'Reply with JSON only, one list per advisor (an empty list is the usual answer): {"critic": [ADVISORY…], "strategist": [ADVISORY…]} where ADVISORY is {"headline": "...", "text": "...", "why_now": "...", "evidence": ["..."], "confidence": "low|medium|high", "urgency": "low|normal|high", "topics": ["..."], "expires": "YYYY-MM-DD"}',
    "",
    `--- George's profile ---\n${input.profile ?? "(empty)"}`,
    `--- Memory ---\n${input.memory ?? "(empty)"}`,
    `--- His projects ---\n${input.projects ?? "(none yet)"}`,
    `--- His taste (learned from his corrections and approvals) ---\n${input.taste ?? "(none yet)"}`,
    `--- Librarian's notes from this pass ---\n${input.observations.map((note) => `- ${note}`).join("\n") || "(none)"}`,
    `--- Recent conversation (George's side) ---\n${turns || "(none)"}`,
    `--- Already open (do not repeat) ---\n${input.open.map((advisory) => `- [${advisory.advisor}] ${advisory.text}`).join("\n") || "(none)"}`,
  ].join("\n");
}

/** At most this many words on an advice card. */
export const HEADLINE_WORDS = 30;

/** The card's one sentence: the advisor's headline, else the advice's first sentence, never past 30 words. Pure. */
export function adviceHeadline(headline: string, text: string): string {
  const sentence = (headline.replace(/\s+/g, " ").trim() || text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z"“])/)[0] || "").trim();
  const words = sentence.split(" ").filter(Boolean);
  if (words.length <= HEADLINE_WORDS) return sentence;
  return `${words.slice(0, HEADLINE_WORDS).join(" ").replace(/[\s,;:—–-]+$/, "")}…`;
}

export function parseAdvisories(advisor: AdvisorName, text: string, now: Date): Advisory[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed: { advisories?: Array<Record<string, unknown>> };
  try {
    parsed = JSON.parse(match[0]) as { advisories?: Array<Record<string, unknown>> };
  } catch {
    return [];
  }
  const today = localDay(now);
  const maxExpiry = localDay(new Date(now.getTime() + 30 * 86_400_000));
  return (parsed.advisories ?? []).slice(0, 2).flatMap((raw) => {
    const text = String(raw.text ?? "").replace(/\s+/g, " ").trim();
    const evidence = Array.isArray(raw.evidence) ? raw.evidence.map(String).filter(Boolean).slice(0, 6) : [];
    if (!text || evidence.length === 0) return [];
    const expiresRaw = String(raw.expires ?? "");
    const expires = /^\d{4}-\d{2}-\d{2}$/.test(expiresRaw) && expiresRaw >= today ? (expiresRaw > maxExpiry ? maxExpiry : expiresRaw) : localDay(new Date(now.getTime() + 7 * 86_400_000));
    const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
      (allowed as readonly string[]).includes(String(value)) ? (String(value) as T) : fallback;
    return [{
      id: createHash("sha1").update(`${advisor}:${text.toLowerCase()}`).digest("hex").slice(0, 8),
      advisor,
      headline: adviceHeadline(String(raw.headline ?? ""), text),
      text,
      whyNow: String(raw.why_now ?? "").trim(),
      evidence,
      confidence: pick(raw.confidence, ["low", "medium", "high"] as const, "low"),
      urgency: pick(raw.urgency, ["low", "normal", "high"] as const, "normal"),
      topics: Array.isArray(raw.topics) ? raw.topics.map((topic) => String(topic).toLowerCase().trim()).filter(Boolean).slice(0, 5) : [],
      createdAt: now.toISOString(),
      expires,
      status: "open" as const,
    }];
  });
}

export interface AdvisorDependencies {
  complete(prompt: string): Promise<string>;
  now?: () => Date;
  path?: string;
}

/** Ask both advisors in one call; store new, non-duplicate advisories. */
export async function runAdvisors(input: Omit<AdvisorInput, "open" | "today">, deps: AdvisorDependencies): Promise<Advisory[]> {
  const now = (deps.now ?? (() => new Date()))();
  const path = deps.path ?? advisoriesPath();
  // Expire stale advisories first so they neither block nor resurface.
  const today = localDay(now);
  const all = readAdvisories(path).map((advisory) => advisory.status === "open" && advisory.expires < today ? { ...advisory, status: "expired" as const } : advisory);
  writeAdvisories(all, path);
  const open = all.filter((advisory) => advisory.status === "open");
  const known = new Set(all.map((advisory) => advisory.id));
  let reply: Record<string, unknown> = {};
  try {
    reply = JSON.parse((await deps.complete(advisorPrompt({ ...input, open, today }))).match(/\{[\s\S]*\}/)?.[0] ?? "{}") as Record<string, unknown>;
  } catch {
    reply = {};
  }
  const results = (["critic", "strategist"] as const).map((advisor) =>
    Array.isArray(reply[advisor]) ? parseAdvisories(advisor, JSON.stringify({ advisories: reply[advisor] }), now) : []);
  const fresh = results.flat().filter((advisory) => !known.has(advisory.id));
  if (fresh.length) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    appendFileSync(path, fresh.map((advisory) => JSON.stringify(advisory)).join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
  }
  pruneAdvisoryStore(path);
  const stillOpen = new Set(readAdvisories(path).filter((advisory) => advisory.status === "open").map((advisory) => advisory.id));
  return fresh.filter((advisory) => stillOpen.has(advisory.id));
}
