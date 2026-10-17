import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import type { Evidence } from "../crew/self-improve.js";
import { journalDir, readJournalSince } from "./journal.js";
import { requirement, reviewSaid, voiceRules, type RequirementId, type Said, type Shortfall, type Surface, type VoiceRules } from "./chief-of-staff.js";

// Flyd reading its own words back against the chief-of-staff standard
// (council/chief-of-staff.ts). Everything George was shown — chat answers,
// the window's answers and relayed updates, agenda results, status lines and
// notifications — is reviewed once; each shortfall is kept as a verdict with
// the offending words and the requirement it broke. The daily improver reads
// them as evidence (crew/self-improve.ts), and `flyd scorecard` says calmly
// how Flyd is doing.

export interface Verdict extends Pick<Said, "interactionClass" | "taskState" | "evidenceRefs"> {
  id: string;
  /** When George was shown it. */
  at: string;
  reviewedAt: string;
  surface: Surface;
  /** Where it was read from: journal, ask, relay, artefact, agenda, status, notification. */
  source: string;
  text: string;
  asked?: string;
  shortfalls: Shortfall[];
  /** Caught before display: George never saw it as written. */
  held?: true;
}

interface ReviewState {
  lastRunAt?: string;
  reviewed: string[];
}

interface Captured extends Said {
  at: string;
  source: string;
}

const MAX_PER_RUN = 40;
const FIRST_LOOK_DAYS = 7;
const TEXT_CHARS = 600;
const VERDICTS_MAX_BYTES = 2_000_000;
const VERDICTS_KEEP = 3_000;

export function selfReviewDir(): string {
  return process.env.FLYD_SELF_REVIEW_DIR?.trim() || join(FLYD_DIR, "self-review");
}

function keyOf(surface: Surface, text: string): string {
  return createHash("sha256").update(`${surface}\0${text.replace(/\s+/g, " ").trim()}`).digest("hex").slice(0, 16);
}

function readJson<T>(path: string): T | undefined {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return undefined; }
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line) as T]; } catch { return []; }
  });
}

function append(path: string, rows: unknown[]): void {
  if (!rows.length) return;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(path, rows.map((row) => `${JSON.stringify(row)}\n`).join(""), { encoding: "utf8", mode: 0o600 });
}

function reviewContext(said: Said): Pick<Said, "interactionClass" | "taskState" | "evidenceRefs" | "tools" | "toolsUnknown"> {
  return {
    ...(said.interactionClass ? { interactionClass: said.interactionClass } : {}),
    ...(said.taskState ? { taskState: said.taskState } : {}),
    ...(said.evidenceRefs ? { evidenceRefs: said.evidenceRefs } : {}),
    ...(said.tools ? { tools: said.tools } : {}),
    ...(said.toolsUnknown ? { toolsUnknown: true } : {}),
  };
}

const noted = new Set<string>();

/**
 * Keeps something George was shown that no other store keeps (status lines,
 * notifications), for the next review. Status repeats on every refresh, so
 * each text is kept once per process. Never throws.
 */
export function noteSaid(said: Said, dir = selfReviewDir()): void {
  const text = said.text.replace(/\s+/g, " ").trim();
  if (!text || process.env.FLYD_SELF_REVIEW === "0") return;
  const key = keyOf(said.surface, text);
  if (noted.has(key)) return;
  if (noted.size > 2_000) noted.clear();
  noted.add(key);
  try {
    append(join(dir, "said.jsonl"), [{ at: new Date().toISOString(), surface: said.surface, text: text.slice(0, 2_000), ...(said.asked ? { asked: said.asked.slice(0, 500) } : {}), source: said.surface, ...reviewContext(said) }]);
  } catch { /* review is best effort */ }
}

/** A text the screen kept from George, recorded as its verdict straight away. */
export function recordHeld(said: Said & { source: string }, shortfalls: Shortfall[], dir = selfReviewDir(), now = new Date()): void {
  if (process.env.FLYD_SELF_REVIEW === "0") return;
  try {
    append(join(dir, "verdicts.jsonl"), [{
      id: keyOf(said.surface, said.text), at: now.toISOString(), reviewedAt: now.toISOString(), surface: said.surface, source: said.source,
      text: said.text.slice(0, TEXT_CHARS), ...(said.asked ? { asked: said.asked.slice(0, 200) } : {}), shortfalls, held: true, ...reviewContext(said),
    } satisfies Verdict]);
  } catch { /* review is best effort */ }
}

/** A window reply's header ("[Captain is replying from Flyd …]") is plumbing, not his words. */
function hisWords(text: string): string {
  return text.replace(/^\[[^\]]*\]\s*/, "").trim();
}

export interface ReviewSources {
  flydDir?: string;
  dir?: string;
  since: string;
}

/** Everything George was shown since `since`, from every store that keeps it. */
export function collectSaid(sources: ReviewSources): Captured[] {
  const flydDir = sources.flydDir ?? FLYD_DIR;
  const { since } = sources;
  const out: Captured[] = [];

  for (const turn of readJournalSince(since, sources.flydDir ? join(flydDir, "journal") : journalDir())) {
    if (turn.assistant.trim()) out.push({ at: turn.at, surface: "chat", source: `journal:${turn.id}`, text: turn.assistant, asked: turn.user, ...(turn.tools?.length ? { tools: turn.tools } : {}) });
  }

  const asks = join(flydDir, "view", "asks");
  if (existsSync(asks)) {
    for (const name of readdirSync(asks).filter((file) => file.endsWith(".json"))) {
      const ask = readJson<{ id?: string; at?: string; text?: string; answer?: string; answeredAt?: string; interactionClass?: Said["interactionClass"] }>(join(asks, name));
      const at = ask?.answeredAt ?? ask?.at;
      if (!ask?.answer?.trim() || !at || at <= since) continue;
      out.push({ at, surface: "chat", source: `ask:${ask.id ?? name}`, text: ask.answer, asked: hisWords(ask.text ?? ""), ...(ask.interactionClass ? { interactionClass: ask.interactionClass } : {}), toolsUnknown: true });
    }
  }

  const relays = readJson<Record<string, { text?: string; at?: string }>>(join(flydDir, "view", "interpretations.json")) ?? {};
  for (const [key, relay] of Object.entries(relays)) {
    if (relay.text?.trim() && relay.at && relay.at > since) out.push({ at: relay.at, surface: "relay", source: `relay:${key}`, text: relay.text });
  }

  const cards = readJson<Record<string, { headline?: string; line?: string; at?: string }>>(join(flydDir, "view", "artefact-voice.json")) ?? {};
  for (const [key, card] of Object.entries(cards)) {
    const text = [card.headline, card.line].filter(Boolean).join(" ");
    if (text && card.at && card.at > since) out.push({ at: card.at, surface: "relay", source: `artefact:${key}`, text });
  }

  for (const row of readJsonl<{ id?: string; itemId?: string; at?: string; task?: string; status?: string; result?: string }>(join(flydDir, "inbox.jsonl"))) {
    if (row.status === "ok" && row.result?.trim() && row.at && row.at > since) {
      out.push({ at: row.at, surface: "chat", source: `agenda:${row.id ?? row.itemId ?? row.at}`, text: row.result, asked: row.task, toolsUnknown: true });
    }
  }

  for (const row of readJsonl<Captured>(join(sources.dir ?? selfReviewDir(), "said.jsonl"))) {
    if (row.text && row.at > since) out.push(row.surface === "notification" ? { ...row, toolsUnknown: true } : row);
  }
  return out;
}

function readState(dir: string): ReviewState {
  const state = readJson<Partial<ReviewState>>(join(dir, "state.json"));
  return { reviewed: state?.reviewed ?? [], ...(state?.lastRunAt ? { lastRunAt: state.lastRunAt } : {}) };
}

function writeState(state: ReviewState, dir: string): void {
  const path = join(dir, "state.json");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ ...state, reviewed: state.reviewed.slice(-5_000) })}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function trimVerdicts(dir: string): void {
  const path = join(dir, "verdicts.jsonl");
  try {
    if (statSync(path).size <= VERDICTS_MAX_BYTES) return;
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean).slice(-VERDICTS_KEEP);
    writeFileSync(path, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  } catch { /* nothing to trim */ }
}

/**
 * Newest first, taking turns across sources: the work cards are re-said
 * every few minutes and would otherwise fill every pass, leaving chat,
 * status lines and notifications unread.
 */
function interleaved<T>(items: T[], sourceOf: (item: T) => string): T[] {
  const queues = new Map<string, T[]>();
  for (const item of items) {
    const queue = queues.get(sourceOf(item)) ?? [];
    queue.push(item);
    queues.set(sourceOf(item), queue);
  }
  const out: T[] = [];
  while (out.length < items.length) {
    for (const queue of queues.values()) {
      const next = queue.shift();
      if (next) out.push(next);
    }
  }
  return out;
}

export interface ReviewDependencies {
  flydDir?: string;
  dir?: string;
  now?: () => Date;
  /** Test seam; defaults to the checks plus Jev (council/chief-of-staff.ts reviewSaid). */
  review?: (said: Said, rules: VoiceRules) => Promise<Shortfall[]>;
  rules?: VoiceRules;
  limit?: number;
}

export interface ReviewResult {
  status: "disabled" | "reviewed";
  reviewed: number;
  shortfalls: number;
}

/** One review pass over what George was shown since the last one, newest first, bounded. */
export async function runReplyReview(deps: ReviewDependencies = {}): Promise<ReviewResult> {
  if (process.env.FLYD_SELF_REVIEW === "0") return { status: "disabled", reviewed: 0, shortfalls: 0 };
  const now = (deps.now ?? (() => new Date()))();
  const dir = deps.dir ?? selfReviewDir();
  const state = readState(dir);
  const since = state.lastRunAt
    ? new Date(Date.parse(state.lastRunAt) - 86_400_000).toISOString()
    : new Date(now.getTime() - FIRST_LOOK_DAYS * 86_400_000).toISOString();
  const reviewed = new Set(state.reviewed);
  const fresh = new Map<string, Captured>();
  for (const item of collectSaid({ flydDir: deps.flydDir, dir, since }).sort((a, b) => b.at.localeCompare(a.at))) {
    const key = keyOf(item.surface, item.text);
    if (!reviewed.has(key) && !fresh.has(key)) fresh.set(key, item);
  }
  const batch = interleaved([...fresh.entries()], ([, item]) => item.source.split(":")[0]!).slice(0, deps.limit ?? MAX_PER_RUN);
  const rules = deps.rules ?? voiceRules();
  const review = deps.review ?? ((said: Said, voice: VoiceRules) => reviewSaid(said, { rules: voice }));
  const verdicts: Verdict[] = [];
  for (const [id, item] of batch) {
    const shortfalls = await review({ ...reviewContext(item), surface: item.surface, text: item.text, ...(item.asked ? { asked: item.asked } : {}) }, rules).catch(() => []);
    verdicts.push({
      id, at: item.at, reviewedAt: now.toISOString(), surface: item.surface, source: item.source,
      ...reviewContext(item), text: item.text.slice(0, TEXT_CHARS), ...(item.asked ? { asked: item.asked.slice(0, 200) } : {}), shortfalls,
    });
  }
  append(join(dir, "verdicts.jsonl"), verdicts);
  trimVerdicts(dir);
  // Only what was reviewed is spent; anything past the bound waits for the next pass.
  writeState({ lastRunAt: batch.length < fresh.size ? state.lastRunAt ?? since : now.toISOString(), reviewed: [...state.reviewed, ...batch.map(([id]) => id)] }, dir);
  return { status: "reviewed", reviewed: verdicts.length, shortfalls: verdicts.filter((verdict) => verdict.shortfalls.length).length };
}

export function readVerdicts(dir = selfReviewDir(), since?: string): Verdict[] {
  return readJsonl<Verdict>(join(dir, "verdicts.jsonl")).filter((verdict) => !since || verdict.at >= since);
}

/**
 * Self-review shortfalls as improver evidence: one item per broken
 * requirement, with its newest examples, so a week of placeholder lines is
 * one finding rather than forty. The id moves with the newest example, so a
 * fresh shortfall is fresh evidence once an older one has been acted on.
 */
export function reviewEvidence(since: string, dir = selfReviewDir()): Evidence[] {
  const byRequirement = new Map<RequirementId, Array<{ verdict: Verdict; shortfall: Shortfall }>>();
  for (const verdict of readVerdicts(dir, since)) {
    for (const shortfall of verdict.shortfalls) {
      const list = byRequirement.get(shortfall.requirement) ?? [];
      list.push({ verdict, shortfall });
      byRequirement.set(shortfall.requirement, list);
    }
  }
  const verdictEvidence = [...byRequirement.entries()].map(([id, hits]) => {
    hits.sort((a, b) => b.verdict.at.localeCompare(a.verdict.at));
    const newest = hits[0]!;
    const examples = hits.slice(0, 3).map(({ verdict, shortfall }) => `${verdict.surface}${verdict.held ? ", held before display" : ""}: "${shortfall.quote.slice(0, 160)}" (${shortfall.reason})`);
    const rule = requirement(id);
    return {
      id: `review:${id}:${newest.verdict.id}`,
      kind: "review" as const,
      at: newest.verdict.at,
      text: `Flyd's self-review: ${hits.length} thing${hits.length === 1 ? "" : "s"} George was shown broke "${rule.title}" (${rule.rule}) Newest: ${examples.join(" | ")}`.slice(0, 900),
    };
  });
  const sessions = readJsonl<{ at?: string; runtime?: string; outcome?: string }>(join(dir, "firstmate-session.jsonl"))
    .flatMap((attempt) => !attempt.at || attempt.at < since ? [] : [{
      id: `firstmate-session:${attempt.at}:${attempt.runtime}:${attempt.outcome}`,
      kind: "domain" as const,
      at: attempt.at,
      text: `FirstMate session launch via ${attempt.runtime ?? "unknown runtime"}: ${attempt.outcome ?? "unknown outcome"}.`,
    }]);
  return [...verdictEvidence, ...sessions];
}

const SURFACE_WORDS: Record<Surface, string> = { chat: "answer", status: "status line", notification: "notification", relay: "update" };

/** How Flyd is doing against the standard, in a few calm lines. */
export function scorecard(options: { dir?: string; now?: Date; days?: number } = {}): string {
  const now = options.now ?? new Date();
  const days = options.days ?? 7;
  const verdicts = readVerdicts(options.dir, new Date(now.getTime() - days * 86_400_000).toISOString());
  if (!verdicts.length) return `Nothing reviewed in the last ${days} days yet.\n`;
  const met = verdicts.filter((verdict) => !verdict.shortfalls.length).length;
  const lines = [`Last ${days} days: ${met} of ${verdicts.length} things you were shown met the standard (${Math.round((met / verdicts.length) * 100)}%).`];
  const counts = new Map<RequirementId, { count: number; newest: Verdict; shortfall: Shortfall }>();
  for (const verdict of verdicts) {
    for (const shortfall of verdict.shortfalls) {
      const seen = counts.get(shortfall.requirement);
      if (!seen) counts.set(shortfall.requirement, { count: 1, newest: verdict, shortfall });
      else {
        seen.count += 1;
        if (verdict.at > seen.newest.at) Object.assign(seen, { newest: verdict, shortfall });
      }
    }
  }
  if (counts.size) {
    lines.push("", "Where I fell short:");
    for (const [id, { count, newest, shortfall }] of [...counts.entries()].sort((a, b) => b[1].count - a[1].count)) {
      lines.push(`  ${requirement(id).title} · ${count}`);
      lines.push(`    “${shortfall.quote.slice(0, 110)}” (${SURFACE_WORDS[newest.surface]}, ${newest.at.slice(0, 10)}${newest.held ? ", kept from you" : ""})`);
    }
  }
  const held = verdicts.filter((verdict) => verdict.held).length;
  if (held) lines.push("", `${held} of those I caught before they reached you.`);
  lines.push("", "The standard: docs/product/flyd-chief-of-staff-standard.md");
  return `${lines.join("\n")}\n`;
}
