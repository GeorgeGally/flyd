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
}

export function advisorPrompt(advisor: AdvisorName, input: AdvisorInput): string {
  const turns = input.recentTurns.map((turn) => `[j:${turn.id}] ${turn.at.slice(0, 10)} George: ${turn.user.slice(0, 600)}`).join("\n");
  return [
    PERSONA[advisor],
    `Today is ${input.today}.`,
    "",
    "Rules:",
    "- Most of the time the right answer is nothing. Only raise what is genuinely worth George's attention.",
    "- At most 3 advisories. Each must cite evidence ids you were shown ([j:…] turns or memory lines quoted verbatim).",
    "- Do not repeat an open advisory; do not restate facts he obviously knows.",
    "- 'why_now' says why this matters in the next days, not in general.",
    "- 'expires' is the date after which the advisory is no longer useful (YYYY-MM-DD).",
    "- 'topics' are 2-5 lowercase keywords (people, project names, places) that would make this relevant in a conversation.",
    "- urgency 'high' only for something that will cost him if not handled within ~48 hours.",
    "",
    'Reply with JSON only: {"advisories": [{"text": "...", "why_now": "...", "evidence": ["..."], "confidence": "low|medium|high", "urgency": "low|normal|high", "topics": ["..."], "expires": "YYYY-MM-DD"}]}',
    "",
    `--- George's profile ---\n${input.profile ?? "(empty)"}`,
    `--- Memory ---\n${input.memory ?? "(empty)"}`,
    `--- Librarian's notes from this pass ---\n${input.observations.map((note) => `- ${note}`).join("\n") || "(none)"}`,
    `--- Recent conversation (George's side) ---\n${turns || "(none)"}`,
    `--- Already open (do not repeat) ---\n${input.open.map((advisory) => `- [${advisory.advisor}] ${advisory.text}`).join("\n") || "(none)"}`,
  ].join("\n");
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
  return (parsed.advisories ?? []).slice(0, 3).flatMap((raw) => {
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

/** Ask both advisors in parallel; store new, non-duplicate advisories. */
export async function runAdvisors(input: Omit<AdvisorInput, "open" | "today">, deps: AdvisorDependencies): Promise<Advisory[]> {
  const now = (deps.now ?? (() => new Date()))();
  const path = deps.path ?? advisoriesPath();
  // Expire stale advisories first so they neither block nor resurface.
  const today = localDay(now);
  const all = readAdvisories(path).map((advisory) => advisory.status === "open" && advisory.expires < today ? { ...advisory, status: "expired" as const } : advisory);
  writeAdvisories(all, path);
  const open = all.filter((advisory) => advisory.status === "open");
  const known = new Set(all.map((advisory) => advisory.id));
  const results = await Promise.all((["critic", "strategist"] as const).map(async (advisor) => {
    try {
      return parseAdvisories(advisor, await deps.complete(advisorPrompt(advisor, { ...input, open, today })), now);
    } catch {
      return [];
    }
  }));
  const fresh = results.flat().filter((advisory) => !known.has(advisory.id));
  if (fresh.length) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    appendFileSync(path, fresh.map((advisory) => JSON.stringify(advisory)).join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
  }
  return fresh;
}
