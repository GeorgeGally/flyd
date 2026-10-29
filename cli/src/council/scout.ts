import { sourceLabel } from "../lib/source-label.js";
export { sourceLabel };
import { execFile } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { FLYD_DIR } from "../lib/config.js";
import { readUserProfile } from "../lib/user-profile.js";
import { RssAdapter } from "../evidence/adapters/rss.js";
import type { ActivityRecord } from "../conversation-view/activity.js";
import { classifyMedia, mixInspiration, workFocusFromProjects, type InspirationItem, type MediaKind, type WorkFocus } from "./inspiration.js";
import { gatherInspiration, markShown, readShown } from "./inspiration-sources.js";
import { localDay, memoryPromptText } from "./memory-store.js";
import { liveProjects } from "./projects.js";

// The Scout: what's happening in the world that George would want to know —
// found, ranked for him, delivered before he asks, and evolving.
//
//   Sources are a population: RSS feeds, subreddits, and last30days topics,
//   each with a fitness (Beta(likes+1, dislikes+1), plus exposure). Weak
//   sources are paused; new ones are bred from what he liked and from an
//   untried reserve. A living taste profile — seeded from George's own
//   curator prompt — is revised from his feedback. (Mechanics are scripts;
//   judgment is the model.)
//
//   Daily: an edition for the morning brief. Every few hours: a cheap watch
//   over feeds; a must-know item is pushed to him (capped) and handed to the
//   Muse. Popularity is only a weak prior.

const execFileAsync = promisify(execFile);

export type SourceKind = "rss" | "reddit" | "topic";
export type SourceStatus = "active" | "paused" | "reserve";

export interface ScoutSource {
  id: string;
  kind: SourceKind;
  name: string;
  /** Feed URL (rss), subreddit name (reddit), or search topic (topic). */
  target: string;
  category?: string;
  status: SourceStatus;
  shown: number;
  likes: number;
  dislikes: number;
  failures: number;
  lastFetchedAt?: string;
  /** When the source was last paused (fetch failures, evolution, or a topic replan). */
  pausedAt?: string;
  addedBy: "seed" | "evolution" | "george";
  addedAt: string;
  note?: string;
}

export interface ScoutCandidate { id: string; title: string; url: string; source: string; sourceId: string; summary: string; published?: string; engagement?: string; topic: string }
export type ItemKind = "must" | "relevant" | "rabbit_hole";
export interface EditionItem {
  n: number; title: string; url: string; source: string; sourceId?: string; topic: string; why: string; kind: ItemKind | "wildcard";
  media?: MediaKind; figure?: string; quote?: string; attribution?: string; mediaUrl?: string;
}
export interface Edition { date: string; generatedAt: string; topics: string[]; items: EditionItem[] }
export interface ScoutFeedback { at: string; verdict: "more" | "less"; title: string; topic: string; source: string; sourceId?: string; why: string }

/** How many picks a daily brief aims for; the model curates within this, a quiet day may be lean. */
export const BRIEF_MIN = 10;
export const BRIEF_MAX = 14;

export function scoutDir(): string {
  return process.env.FLYD_SCOUT_DIR?.trim() || join(FLYD_DIR, "scout");
}

export function last30daysScript(): string {
  return process.env.FLYD_LAST30DAYS_SCRIPT?.trim()
    || process.env.LAST30DAYS_SCRIPT?.trim()
    || join(homedir(), ".flyd", "vendor", "last30days-skill", "skills", "last30days", "scripts", "last30days.py");
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function readJson<T>(path: string, fallback: T): T {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; }
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as T]; } catch { return []; }
  });
}

function appendJsonl(path: string, rows: unknown[]): void {
  if (rows.length === 0) return;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
}

// ── Seeds: George's own Hermes curator (his taste, his feeds) ─────────────

export const SEED_TASTE = [
  "George lives at the intersection of crypto art, generative art, and creative tech — and he is building several products.",
  "Favour: on-chain art innovations (Ordinals, generative, 1/1s), generative art, creative coding, AI art experiments, new creative tools and techniques, projects and experiments over news, internet archaeology, deep dives, obscure media, protocol history — and anything that bears on his active projects.",
  "Avoid: generic world news, politics, crypto price speculation, PFP/NFT market talk, BTC price news unless genuinely unusual.",
  "Be opinionated: curate, don't list. One rabbit hole a day — deep, weird, inspiring, not a news article.",
].join("\n");

const SEED_SUBREDDITS: Record<string, string[]> = {
  "Bitcoin & Crypto Art": ["ordinals", "Bitcoin", "CryptoArt", "GenerativeOrdinals"],
  "AI Art": ["StableDiffusion", "comfyui", "aivideo", "Deforum"],
  "Creative Coding": ["creativecoding", "generative", "p5js", "touchdesigner", "vjing", "vibecoding"],
  "Hardware Hacking": ["hardwarehacking", "esp32", "cyberDeck", "synthdiy"],
  "AI & ML": ["LocalLLaMA", "generativeAI"],
  "Internet & Web": ["InternetIsBeautiful", "selfhosted", "DataHoarder"],
  "Startups": ["SideProject", "indiehackers", "SaaS"],
  "Deep Cuts": ["ReverseEngineering", "HobbyDrama", "electronics", "AskHistorians"],
};

const SEED_RSS: Array<[string, string, string]> = [
  ["Simon Willison", "https://simonwillison.net/atom/everything/", "AI & ML"],
  ["Waxy.org", "https://waxy.org/feed/", "Internet & Web"],
  ["Import AI", "https://importai.substack.com/feed", "AI & ML"],
  ["Interconnected", "https://interconnected.org/home/feed", "Creative Tech"],
  ["Hackaday", "https://hackaday.com/blog/feed/", "Hardware Hacking"],
  ["Ars Technica", "https://feeds.arstechnica.com/arstechnica/index", "Technology"],
];

/** Untried feeds the evolve step can explore (from the old Discovery catalogue). */
const RESERVE_RSS: Array<[string, string, string]> = [
  ["Information Is Beautiful", "https://feeds.feedburner.com/InformationIsBeautiful", "Design"],
  ["FlowingData", "https://flowingdata.com/feed", "Data visualisation"],
  ["Core77", "https://feeds.feedburner.com/core77/blog", "Design"],
  ["Smashing Magazine", "https://www.smashingmagazine.com/feed/", "Design"],
  ["Fast Company", "https://www.fastcompany.com/latest/rss?truncated=false", "Design"],
  ["TechCrunch", "https://techcrunch.com/feed/", "Startups"],
  ["Creative Applications", "https://www.creativeapplications.net/feed/", "Creative Tech"],
  ["The Verge", "https://www.theverge.com/rss/index.xml", "Technology"],
];

function sourceId(kind: SourceKind, target: string): string {
  return `${kind}:${target.toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
}

/** A subreddit is always shown as r/<name>, however it was added. */
function redditName(target: string): string {
  return `r/${target.replace(/^\/?r\//i, "")}`;
}

function newSource(kind: SourceKind, name: string, target: string, category: string | undefined, status: SourceStatus, addedBy: ScoutSource["addedBy"], now: Date, note?: string): ScoutSource {
  return { id: sourceId(kind, target), kind, name, target, ...(category ? { category } : {}), status, shown: 0, likes: 0, dislikes: 0, failures: 0, addedBy, addedAt: now.toISOString(), ...(note ? { note } : {}) };
}

export function seedSources(now = new Date()): ScoutSource[] {
  return [
    ...SEED_RSS.map(([name, url, category]) => newSource("rss", name, url, category, "active", "seed", now)),
    ...Object.entries(SEED_SUBREDDITS).flatMap(([category, subs]) => subs.map((sub) => newSource("reddit", redditName(sub), sub, category, "active", "seed", now))),
    ...RESERVE_RSS.map(([name, url, category]) => newSource("rss", name, url, category, "reserve", "seed", now)),
  ];
}

/** Union today's defaults into George's managed population, additively, without reordering his own. */
function withSeedDefaults(sources: ScoutSource[], now: Date): ScoutSource[] {
  const have = new Set(sources.map((source) => source.id));
  return [...sources, ...seedSources(now).filter((source) => !have.has(source.id))];
}

export function readSources(dir = scoutDir(), now = new Date()): ScoutSource[] {
  const path = join(dir, "sources.json");
  if (!existsSync(path)) {
    const seeded = seedSources(now);
    atomicWrite(path, `${JSON.stringify(seeded, null, 2)}\n`);
    return seeded;
  }
  const stored = readJson<ScoutSource[] | null>(path, null);
  if (!Array.isArray(stored)) return [];
  // Subreddits added before names were normalised keep their target but read as r/<name>.
  const named = stored.map((source) => source.kind === "reddit" && source.name !== redditName(source.target) ? { ...source, name: redditName(source.target) } : source);
  const merged = withSeedDefaults(named, now);
  if (merged.length !== stored.length || named.some((source, index) => source !== stored[index])) atomicWrite(path, `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

export function writeSources(sources: ScoutSource[], dir = scoutDir()): void {
  atomicWrite(join(dir, "sources.json"), `${JSON.stringify(sources, null, 2)}\n`);
}

export function readTaste(dir = scoutDir()): string {
  try { return readFileSync(join(dir, "taste.md"), "utf8").trim() || SEED_TASTE; } catch { return SEED_TASTE; }
}

/** Posterior mean of "George wants this source" — the ranking prior and the pruning signal. */
export function fitness(source: Pick<ScoutSource, "likes" | "dislikes" | "shown">): number {
  // Showing an item he neither praised nor rejected is weak negative evidence.
  const ignored = Math.max(0, source.shown - source.likes - source.dislikes);
  return (1 + source.likes) / (2 + source.likes + source.dislikes + ignored * 0.25);
}

export function readFeedback(dir = scoutDir()): ScoutFeedback[] {
  return readJsonl<ScoutFeedback>(join(dir, "feedback.jsonl"));
}

export function latestEdition(dir = scoutDir()): Edition | null {
  return readJson<Edition | null>(join(dir, "edition-latest.json"), null);
}

/** Topic sources are last30days searches; kept for compatibility with the topic planner view. */
export function readTopics(dir = scoutDir()): { plannedAt: string | null; topics: Array<{ topic: string; why: string; pinned?: boolean }> } {
  const sources = existsSync(join(dir, "sources.json")) ? readJson<ScoutSource[]>(join(dir, "sources.json"), []) : [];
  const topics = sources.filter((source) => source.kind === "topic" && source.status === "active");
  return { plannedAt: topics[0]?.addedAt ?? null, topics: topics.map((source) => ({ topic: source.target, why: source.note ?? "" })) };
}

function feedbackDigest(feedback: ScoutFeedback[]): string {
  const recent = feedback.slice(-30);
  if (recent.length === 0) return "(no feedback yet)";
  return recent.map((item) => `- ${item.verdict === "more" ? "MORE like" : "LESS like"}: ${item.title} [${item.topic}, ${item.source}]`).join("\n");
}

// ── Fetching ───────────────────────────────────────────────────────────────

// A bot marker in the user agent gets a 403 block page from Reddit.
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
// Reddit gives an anonymous reader one feed per minute (x-ratelimit-reset ≈ 60s), so space them past that.
const REDDIT_SPACING_MS = 61_000;
/** Subreddits one run visits (oldest-fetched first); the 3-hourly watches rotate through the rest. */
export const REDDIT_PER_RUN = 5;
/** One patient retry after a 429 before giving up on Reddit for this run. */
const REDDIT_RETRY_AFTER_MS = 61_000;

class RateLimited extends Error {}

async function fetchFeed(url: string, source: ScoutSource, fetchFn: typeof fetch, now: Date): Promise<ScoutCandidate[]> {
  const guarded: typeof fetch = async (input, init) => {
    const response = await fetchFn(input, { ...init, headers: { Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.1", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    if (response.status === 429) throw new RateLimited(`rate limited by ${new URL(String(input)).host}`);
    return response;
  };
  const items = await new RssAdapter({ fetchFn: guarded, now: () => now }).read({ locator: url });
  const cutoff = now.getTime() - 4 * 86_400_000;
  return items.flatMap((item) => {
    const link = item.locator ?? "";
    const title = (item.title ?? "").replace(/\s+/g, " ").trim();
    if (!link || !title) return [];
    const published = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
    if (Number.isFinite(published) && published < cutoff) return [];
    return [{
      id: link, url: link, title, source: source.name, sourceId: source.id, topic: source.category ?? source.name,
      summary: item.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 280),
      ...(item.publishedAt ? { published: item.publishedAt.slice(0, 10) } : {}),
    }];
  }).slice(0, 12);
}

export function parseLast30days(stdout: string, topic: string, sourceIdValue = sourceId("topic", topic)): ScoutCandidate[] {
  const parsed = JSON.parse(stdout) as {
    results?: Array<{ candidate_id?: string; url?: string; title?: string; summary?: string; source?: string; published_at?: string; engagement?: Record<string, number> }>;
  };
  return (parsed.results ?? []).flatMap((item) => {
    const url = String(item.url ?? item.candidate_id ?? "");
    const title = String(item.title ?? "").replace(/\s+/g, " ").trim();
    if (!url || !title) return [];
    const engagement = item.engagement ? Object.entries(item.engagement).map(([key, value]) => `${value} ${key}`).join(", ") : undefined;
    return [{
      id: url, url, title, topic, sourceId: sourceIdValue,
      source: sourceLabel(String(item.source ?? "web"), String(item.url ?? "")),
      summary: String(item.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 280),
      ...(item.published_at ? { published: item.published_at } : {}),
      ...(engagement ? { engagement } : {}),
    }];
  }).slice(0, 25);
}

export async function fetchTopic(topic: string, script = last30daysScript()): Promise<ScoutCandidate[]> {
  if (!existsSync(script)) throw new Error(`last30days engine not found at ${script}`);
  const { stdout } = await execFileAsync("python3", [script, topic, "--emit=json"], { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
  return parseLast30days(stdout, topic);
}

export interface FetchOptions {
  fetchFn?: typeof fetch;
  fetchTopicFn?: (topic: string) => Promise<ScoutCandidate[]>;
  includeTopics: boolean;
  now: Date;
  /** Subreddits to visit this run (the watch rotates a few at a time). */
  redditLimit?: number;
  /** Spacing between Reddit requests; tests pass 0. */
  redditSpacingMs?: number;
}

/** Fetch every active source: feeds in parallel (bounded), topic searches sequentially. Records failures. */
export async function gatherCandidates(sources: ScoutSource[], options: FetchOptions): Promise<{ candidates: ScoutCandidate[]; failed: string[] }> {
  const fetchFn = options.fetchFn ?? fetch;
  const failed: string[] = [];
  const candidates: ScoutCandidate[] = [];
  // Publisher feeds in parallel; Reddit one at a time, politely, stopping at the first rate limit.
  const queue = sources.filter((source) => source.status === "active" && source.kind === "rss");
  const workers = Array.from({ length: 6 }, async () => {
    for (let source = queue.shift(); source; source = queue.shift()) {
      try {
        candidates.push(...await fetchFeed(source.target, source, fetchFn, options.now));
      } catch (error) {
        if (!(error instanceof RateLimited)) failed.push(source.id);
      }
    }
  });
  const reddit = (async () => {
    const subs = sources.filter((source) => source.status === "active" && source.kind === "reddit")
      .sort((a, b) => (Date.parse(a.lastFetchedAt ?? "1970-01-01") - Date.parse(b.lastFetchedAt ?? "1970-01-01")))
      .slice(0, options.redditLimit ?? Infinity);
    for (const [index, source] of subs.entries()) {
      if (index > 0 && (options.redditSpacingMs ?? REDDIT_SPACING_MS) > 0) await new Promise((resolve) => setTimeout(resolve, options.redditSpacingMs ?? REDDIT_SPACING_MS));
      const url = `https://www.reddit.com/r/${source.target}/.rss`;
      try {
        let items: ScoutCandidate[];
        try {
          items = await fetchFeed(url, source, fetchFn, options.now);
        } catch (error) {
          if (!(error instanceof RateLimited) || (options.redditSpacingMs ?? REDDIT_SPACING_MS) === 0) throw error;
          await new Promise((resolve) => setTimeout(resolve, REDDIT_RETRY_AFTER_MS));
          items = await fetchFeed(url, source, fetchFn, options.now);
        }
        candidates.push(...items);
        source.lastFetchedAt = options.now.toISOString();
      } catch (error) {
        if (error instanceof RateLimited) break;
        failed.push(source.id);
      }
    }
  })();
  await Promise.all([...workers, reddit]);
  if (options.includeTopics) {
    const fetchTopicFn = options.fetchTopicFn ?? ((topic: string) => fetchTopic(topic));
    // Topic searches are slow: take the fittest few.
    const topics = sources.filter((source) => source.status === "active" && source.kind === "topic").sort((a, b) => fitness(b) - fitness(a)).slice(0, 4);
    for (const source of topics) {
      try { candidates.push(...(await fetchTopicFn(source.target)).map((candidate) => ({ ...candidate, sourceId: source.id }))); } catch { failed.push(source.id); }
    }
  }
  return { candidates, failed };
}

// ── Ranking ────────────────────────────────────────────────────────────────

export function rankPrompt(
  candidates: ScoutCandidate[],
  context: { taste: string; profile: string | null; memory: string | null; feedback: ScoutFeedback[]; fitnessBySource: Record<string, number>; today: string; mode: "edition" | "watch" },
): string {
  const list = candidates.map((candidate, index) => {
    const prior = context.fitnessBySource[candidate.sourceId];
    return `[${index}] (${candidate.source}${prior !== undefined ? ` · source fit ${prior.toFixed(2)}` : ""}${candidate.published ? ` · ${candidate.published}` : ""}${candidate.engagement ? ` · ${candidate.engagement}` : ""}) ${candidate.title}${candidate.summary && candidate.summary !== candidate.title ? ` — ${candidate.summary}` : ""}`;
  }).join("\n");
  const task = context.mode === "watch"
    ? [
      "This is a quiet background watch, not an edition. Almost always the answer is no picks.",
      "Pick an item ONLY if George would genuinely want to know it today, unprompted: it directly affects one of his active projects, commitments, or decisions (a competitor move, a platform/API change, a deadline-relevant event), or it is an exceptional find squarely in his taste.",
      "Mark such items kind 'must'. At most 2.",
    ]
    : [
      `Curate George's full daily briefing — a good curator's dozen or so, not a shortlist of two. Aim for around ${BRIEF_MIN}–${BRIEF_MAX} picks on a day that supports it; a quiet day is honestly fewer, never padded.`,
      "Sections, in this order: (1) Bitcoin & Crypto Art first — real on-chain art (Ordinals, generative, 1/1s, innovations). (2) Creative Tech / AI Art — what people are actually building: new tools, techniques, creative coding, AI art experiments, projects over news. (3) Everything else worth knowing — the weird, niche and interesting, best first. (4) Exactly one rabbit_hole — the single most interesting deep, weird or inspiring link, not a news article.",
      "kind: 'must' for genuinely novel or important (Hot), 'relevant' for worth a look, 'rabbit_hole' for the one deep pick (exactly one).",
      "Be opinionated: curate, don't list, and mark a 'Skip' by omitting it. Write 'why' as one sharp sentence in your own voice on why this is worth his time, grounded in what the item actually says — never a stretch to his projects and never generic filler ('could inspire your work', 'can enhance your process'). Never a sentence that only names the item itself ('The thread itself.', 'Worth a read.'): say a real fact from it, or leave 'why' empty.",
      "Skip generic world or mainstream tech news, politics, crypto price talk and PFP/NFT market chatter: they do not clear the bar however fresh they are. Every pick must carry a working link.",
      `Spread it across his sources: at most ${EDITION_PER_SOURCE} picks from any one source (the name in brackets), so no single feed dominates.`,
    ];
  return [
    "You are Flyd's Scout, curating for George. Be opinionated: curate, don't list.",
    `Today is ${context.today}.`,
    ...task,
    "'why' is one sharp, opinionated sentence on why this is worth his time, grounded in what the item actually says — never a stretch to his projects and never filler.",
    "Source fit is how much he has liked a source before (0.5 = unknown); use it as a tiebreaker, not a rule.",
    'Reply with JSON only: {"picks": [{"index": 0, "kind": "must|relevant|rabbit_hole", "why": "..."}]} — {"picks": []} if nothing clears the bar.',
    `--- George's taste (he wrote the seed; it evolves with his feedback) ---\n${context.taste}`,
    `--- Profile ---\n${context.profile ?? "(empty)"}`,
    `--- Memory (active projects, decisions, commitments) ---\n${context.memory ?? "(empty)"}`,
    `--- His feedback on past picks ---\n${feedbackDigest(context.feedback)}`,
    `--- Candidates ---\n${list}`,
  ].join("\n\n");
}

export function parsePicks(text: string, candidates: ScoutCandidate[], max = BRIEF_MAX, perSource = Infinity): EditionItem[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Scout ranker returned no JSON");
  const parsed = JSON.parse(match[0]) as { picks?: Array<{ index?: unknown; kind?: unknown; why?: unknown }> };
  const items: EditionItem[] = [];
  let rabbitHoles = 0;
  for (const pick of parsed.picks ?? []) {
    const candidate = candidates[Number(pick.index)];
    if (!candidate || items.some((item) => item.url === candidate.url)) continue;
    // One prolific feed never fills the brief on its own.
    if (items.filter((item) => item.sourceId === candidate.sourceId).length >= perSource) continue;
    let kind: ItemKind = pick.kind === "must" ? "must" : pick.kind === "rabbit_hole" || pick.kind === "wildcard" ? "rabbit_hole" : "relevant";
    if (kind === "rabbit_hole" && rabbitHoles++ > 0) kind = "relevant";
    items.push({ n: items.length + 1, title: candidate.title, url: candidate.url, source: candidate.source, sourceId: candidate.sourceId, topic: candidate.topic, why: String(pick.why ?? "").trim(), kind });
    if (items.length >= max) break;
  }
  return items;
}

/** Every source's first item, then every source's second, and so on, so a cap on candidates never starves the sources that arrive last. */
export function interleaveBySource(candidates: ScoutCandidate[]): ScoutCandidate[] {
  const bySource = new Map<string, ScoutCandidate[]>();
  for (const candidate of candidates) bySource.set(candidate.sourceId, [...(bySource.get(candidate.sourceId) ?? []), candidate]);
  const lists = [...bySource.values()];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  return Array.from({ length: longest }, (_, round) => lists.flatMap((list) => (round < list.length ? [list[round]!] : []))).flat();
}

function seenUrls(dir: string): Set<string> {
  return new Set(readJsonl<{ url: string }>(join(dir, "seen.jsonl")).map((item) => item.url));
}

/** Picks one source may have in a daily edition. */
export const EDITION_PER_SOURCE = 3;

// The pool: what the 3-hourly watches fetched since the last edition. Reddit
// rate-limits a burst of subreddit reads, so the morning edition cannot fetch
// every subreddit itself; it ranks from everything the day's watches already
// gathered as well as its own fetch. Short-lived: an edition empties it, and
// nothing older than two days is kept.
const POOL_FILE = "pool.jsonl";
const POOL_MAX_AGE_MS = 2 * 86_400_000;
type PooledCandidate = ScoutCandidate & { pooledAt: string };

function freshPool(dir: string, now: Date): PooledCandidate[] {
  const cutoff = now.getTime() - POOL_MAX_AGE_MS;
  return readJsonl<PooledCandidate>(join(dir, POOL_FILE)).filter((entry) => Date.parse(entry.pooledAt) >= cutoff && Boolean(entry.url) && Boolean(entry.sourceId));
}

function writePool(dir: string, entries: PooledCandidate[]): void {
  atomicWrite(join(dir, POOL_FILE), entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
}

/** Keep a watch's candidates for the next edition. */
export function poolCandidates(candidates: ScoutCandidate[], dir = scoutDir(), now = new Date()): void {
  if (candidates.length === 0) return;
  const kept = freshPool(dir, now);
  const have = new Set(kept.map((entry) => entry.url));
  writePool(dir, [...kept, ...candidates.filter((candidate) => !have.has(candidate.url)).map((candidate) => ({ ...candidate, pooledAt: now.toISOString() }))]);
}

/** Pooled candidates gathered since `since` (the last edition), newest first, none older than two days. */
export function readPool(dir = scoutDir(), now = new Date(), since?: string): ScoutCandidate[] {
  const from = since ? Date.parse(since) : NaN;
  return freshPool(dir, now)
    .filter((entry) => !Number.isFinite(from) || Date.parse(entry.pooledAt) >= from)
    .reverse()
    .map(({ pooledAt: _pooledAt, ...candidate }) => candidate);
}

function clearPool(dir: string, upTo: Date): void {
  if (!existsSync(join(dir, POOL_FILE))) return;
  writePool(dir, freshPool(dir, upTo).filter((entry) => Date.parse(entry.pooledAt) > upTo.getTime()));
}

function rankContext(dir: string, now: Date, sources: ScoutSource[], mode: "edition" | "watch") {
  return {
    taste: readTaste(dir),
    profile: readUserProfile(),
    memory: memoryPromptText(),
    feedback: readFeedback(dir),
    fitnessBySource: Object.fromEntries(sources.map((source) => [source.id, fitness(source)])),
    today: localDay(now),
    mode,
  };
}

const FAILURE_PAUSE_NOTE = "paused after 5 consecutive fetch failures";

function recordFailures(sources: ScoutSource[], failed: string[], now: Date): ScoutSource[] {
  return sources.map((source) => {
    if (failed.includes(source.id)) {
      const failures = source.failures + 1;
      // A source that keeps failing is paused, not deleted; it gets a retry later (reviveFailedSources).
      return { ...source, failures, ...(failures >= 5 ? { status: "paused" as const, note: FAILURE_PAUSE_NOTE, pausedAt: now.toISOString() } : {}) };
    }
    return source.status === "active" ? { ...source, failures: 0 } : source;
  });
}

const RETRY_PAUSED_AFTER_MS = 3 * 86_400_000;

/**
 * A source paused for fetch failures (a Reddit block, a feed outage) gets one
 * retry once it has rested a few days: back to active, one failure from being
 * paused again. Sources paused for low fitness stay paused — that was taste.
 */
export function reviveFailedSources(sources: ScoutSource[], now = new Date()): { sources: ScoutSource[]; revived: ScoutSource[] } {
  const revived: ScoutSource[] = [];
  const next = sources.map((source) => {
    if (source.status !== "paused" || source.note !== FAILURE_PAUSE_NOTE) return source;
    const since = Date.parse(source.pausedAt ?? source.lastFetchedAt ?? source.addedAt);
    if (Number.isFinite(since) && now.getTime() - since < RETRY_PAUSED_AFTER_MS) return source;
    const retry = { ...source, status: "active" as const, failures: 4, note: `retrying after pause ${localDay(now)}` };
    revived.push(retry);
    return retry;
  });
  return { sources: next, revived };
}

/** Topics George added or liked are kept; planned ones are replaced each evolution. */
function keepsTopic(source: ScoutSource): boolean {
  return source.addedBy === "george" || source.likes > 0;
}

/** Search topics from George's taste — the world he follows, not the internals of his own code. */
export async function planTopics(
  complete: (prompt: string) => Promise<string>,
  now: Date,
  options: { taste?: string; keep?: string[]; count?: number; feedback?: ScoutFeedback[] } = {},
): Promise<ScoutSource[]> {
  const count = options.count ?? 4;
  if (count <= 0) return [];
  const prompt = [
    `Plan ${count} web/social search topics for George's daily news: things he would enjoy reading about, drawn from his taste below.`,
    "Topics are about the scenes, crafts, tools and communities in his taste (e.g. 'bitcoin ordinals generative art', 'touchdesigner audio reactive visuals', 'esp32 cyberdeck builds') — not the internal workings of the products he is building.",
    "Never use implementation phrases from his own code (e.g. 'hybrid search query rewriting', 'browsing taste signal capture'). Each topic is 2-5 words, specific, the way people talk about it online. Avoid generic topics.",
    ...(options.keep?.length ? [`Already searching (do not repeat): ${options.keep.join(", ")}`] : []),
    'Reply with JSON only: {"topics": [{"topic": "...", "why": "<one line>"}]}',
    `--- George's taste ---\n${options.taste ?? SEED_TASTE}`,
    `--- His feedback on past picks ---\n${feedbackDigest(options.feedback ?? [])}`,
    `--- Profile ---\n${readUserProfile() ?? "(empty)"}`,
  ].join("\n\n");
  try {
    const parsed = JSON.parse((await complete(prompt)).match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { topics?: Array<{ topic?: unknown; why?: unknown }> };
    const keep = new Set((options.keep ?? []).map((topic) => topic.toLowerCase()));
    return (parsed.topics ?? []).flatMap((item) => {
      const topic = String(item.topic ?? "").replace(/\s+/g, " ").trim();
      return topic && topic.length <= 60 && !keep.has(topic.toLowerCase())
        ? [newSource("topic", topic, topic, "Your interests", "active", "evolution", now, String(item.why ?? ""))]
        : [];
    }).slice(0, count);
  } catch {
    return [];
  }
}

export async function planInitialTopics(complete: (prompt: string) => Promise<string>, now: Date, dir = scoutDir()): Promise<ScoutSource[]> {
  return planTopics(complete, now, { taste: readTaste(dir) });
}

// ── Edition, watch, feedback ───────────────────────────────────────────────

export interface ScoutDependencies {
  complete(prompt: string): Promise<string>;
  fetchFn?: typeof fetch;
  fetchTopicFn?: (topic: string) => Promise<ScoutCandidate[]>;
  now?: () => Date;
  dir?: string;
  force?: boolean;
  notify?: (title: string, message: string) => Promise<void>;
  /** Records the day's brief with Flyd's activity feed, so its card opens to the whole brief. */
  record?: (edition: Edition) => void;
  redditSpacingMs?: number;
  /** Live projects and jobs the deck should lean toward. Tests pass this; production reads his projects. */
  focus?: WorkFocus[];
  /** Extra finds (stats, pictures, quotes, threads). Tests pass them; production gathers a cached set. */
  inspiration?: InspirationItem[];
}

export interface ScoutRunResult {
  skipped?: "already_today" | "no_sources" | "locked";
  edition?: Edition;
  failedTopics: string[];
}

function blendEdition(ranked: EditionItem[], extras: InspirationItem[], focus: WorkFocus[], now: Date, dir: string): EditionItem[] {
  const byUrl = new Map(ranked.map((item) => [item.url, item]));
  const articles: InspirationItem[] = ranked.map((item) => ({
    url: item.url,
    title: item.title,
    source: item.source,
    sourceId: item.sourceId ?? item.source,
    summary: item.why,
    media: classifyMedia({ url: item.url, title: item.title, summary: item.why }),
    published: now.toISOString(),
  }));
  const mixed = mixInspiration([...articles, ...extras], focus, { now: now.getTime(), seen: seenUrls(dir), lastShown: readShown(dir) });
  const must = mixed.filter((item) => byUrl.get(item.url)?.kind === "must");
  const rest = mixed.filter((item) => byUrl.get(item.url)?.kind !== "must");
  return [...must, ...rest].map((item, index) => {
    const prior = byUrl.get(item.url);
    const media = item.media === "article" ? undefined : item.media;
    const base: EditionItem = prior
      ? { ...prior, ...(media ? { media } : {}) }
      : {
          n: index + 1, title: item.title, url: item.url, source: item.source, sourceId: item.sourceId,
          topic: item.match ?? item.source, why: item.summary.slice(0, 280), kind: "relevant",
          ...(media ? { media } : {}),
        };
    return {
      ...base,
      n: index + 1,
      ...(item.figure ? { figure: item.figure } : {}),
      ...(item.quote ? { quote: item.quote } : {}),
      ...(item.attribution ? { attribution: item.attribution } : {}),
      ...(item.mediaUrl ? { mediaUrl: item.mediaUrl } : {}),
    };
  });
}

/** Build today's edition from every active source, ranked for George. */
export async function runScout(deps: ScoutDependencies): Promise<ScoutRunResult> {
  const now = (deps.now ?? (() => new Date()))();
  const dir = deps.dir ?? scoutDir();
  const today = localDay(now);
  if (!deps.force && latestEdition(dir)?.date === today) return { skipped: "already_today", failedTopics: [] };
  let sources = readSources(dir, now);
  if (!sources.some((source) => source.status === "active")) return { skipped: "no_sources", failedTopics: [] };
  if (!sources.some((source) => source.kind === "topic")) {
    // First run: search topics come from what George is actually doing.
    sources = [...sources, ...await planInitialTopics(deps.complete, now, dir)];
    writeSources(sources, dir);
  }

  // Everything the watches fetched since the last edition, plus this run's own fetch.
  const pooled = readPool(dir, now, latestEdition(dir)?.generatedAt);
  const gathered = await gatherCandidates(sources, { fetchFn: deps.fetchFn, fetchTopicFn: deps.fetchTopicFn, includeTopics: true, now, redditLimit: REDDIT_PER_RUN, ...(deps.redditSpacingMs !== undefined ? { redditSpacingMs: deps.redditSpacingMs } : {}) });
  const { failed } = gathered;
  const candidates = [...gathered.candidates, ...pooled];
  sources = recordFailures(sources, failed, now);
  const seen = seenUrls(dir);
  const fresh = interleaveBySource(candidates.filter((candidate, index) => !seen.has(candidate.url) && candidates.findIndex((other) => other.url === candidate.url) === index)).slice(0, 150);
  const ranked = fresh.length ? parsePicks(await deps.complete(rankPrompt(fresh, rankContext(dir, now, sources, "edition"))), fresh, BRIEF_MAX, EDITION_PER_SOURCE) : [];
  const focus = deps.focus ?? (process.env.VITEST ? [] : workFocusFromProjects(liveProjects()));
  let extras = deps.inspiration ?? [];
  if (!deps.inspiration && !process.env.VITEST) {
    try { extras = await gatherInspiration(dir, focus, { now, fetchImpl: deps.fetchFn }); } catch { extras = []; }
  }
  const items = extras.length ? blendEdition(ranked, extras, focus, now, dir) : ranked;
  const rotating = items.filter((item) => item.media).map((item) => item.url);
  if (rotating.length) markShown(dir, rotating, now);

  // Exposure counts toward fitness: a source that keeps being shown but never liked fades.
  sources = sources.map((source) => ({ ...source, shown: source.shown + items.filter((item) => item.sourceId === source.id).length }));
  writeSources(sources, dir);
  const edition: Edition = { date: today, generatedAt: now.toISOString(), topics: [...new Set(items.map((item) => item.topic))], items };
  atomicWrite(join(dir, "editions", `${today}.json`), `${JSON.stringify(edition, null, 2)}\n`);
  atomicWrite(join(dir, "edition-latest.json"), `${JSON.stringify(edition, null, 2)}\n`);
  appendJsonl(join(dir, "seen.jsonl"), items.map((item) => ({ url: item.url, date: today })));
  clearPool(dir, now);
  if (items.length) deps.record?.(edition);
  return { edition, failedTopics: failed };
}

/** The day's edition as an activity record, so its card can open to the whole brief. */
export function editionActivityRecord(edition: Edition): ActivityRecord {
  return {
    key: "scout-edition",
    kind: "news",
    title: "Put together today's news",
    line: `${edition.items.length} ${edition.items.length === 1 ? "story" : "stories"} from your sources.`,
    stories: edition.items.map(({ title, url, why, source, kind, media, figure, quote, attribution }) => ({
      title, url, kind, ...(why ? { gist: why } : {}), ...(source ? { source } : {}),
      ...(media && media !== "article" ? { media } : {}),
      ...(figure ? { figure } : {}),
      ...(quote ? { quote } : {}),
      ...(attribution ? { attribution } : {}),
    })),
    state: "done",
    at: edition.generatedAt,
  };
}

export const WATCH_NOTIFICATIONS_PER_DAY = 1;

/**
 * Pre-emptive watch: feeds only (cheap), new items only, and almost always
 * silent. A must-know item is pushed to George (capped) and kept for the Muse.
 */
export async function watchScout(deps: ScoutDependencies): Promise<EditionItem[]> {
  const now = (deps.now ?? (() => new Date()))();
  const dir = deps.dir ?? scoutDir();
  const today = localDay(now);
  let sources = readSources(dir, now);
  const { candidates, failed } = await gatherCandidates(sources, { fetchFn: deps.fetchFn, includeTopics: false, now, redditLimit: REDDIT_PER_RUN, ...(deps.redditSpacingMs !== undefined ? { redditSpacingMs: deps.redditSpacingMs } : {}) });
  sources = recordFailures(sources, failed, now);
  writeSources(sources, dir);
  const seen = seenUrls(dir);
  const watched = new Set(readJsonl<{ url: string }>(join(dir, "watched.jsonl")).map((item) => item.url));
  const fresh = interleaveBySource(candidates.filter((candidate, index) => !seen.has(candidate.url) && !watched.has(candidate.url) && candidates.findIndex((other) => other.url === candidate.url) === index)).slice(0, 80);
  // Everything examined is remembered so the watch never re-reads the same item.
  appendJsonl(join(dir, "watched.jsonl"), fresh.map((candidate) => ({ url: candidate.url, date: today })));
  // …and kept for the next edition, which ranks from it.
  poolCandidates(fresh, dir, now);
  if (fresh.length === 0) return [];

  const musts = parsePicks(await deps.complete(rankPrompt(fresh, rankContext(dir, now, sources, "watch"))), fresh, 2).filter((item) => item.kind === "must");
  if (musts.length === 0) return [];
  const flashes = readJsonl<EditionItem & { date: string }>(join(dir, "flash.jsonl"));
  const notifiedToday = flashes.filter((flash) => flash.date === today && (flash as { notified?: boolean }).notified).length;
  const rows = musts.map((item, index) => ({ ...item, date: today, notified: Boolean(deps.notify) && notifiedToday + index < WATCH_NOTIFICATIONS_PER_DAY }));
  for (const row of rows.filter((item) => item.notified)) await deps.notify!("Flyd", `${row.title} — ${row.why}`).catch(() => undefined);
  appendJsonl(join(dir, "flash.jsonl"), rows);
  appendJsonl(join(dir, "seen.jsonl"), rows.map((item) => ({ url: item.url, date: today })));
  return musts;
}

/** Recent must-know items the Muse may raise in conversation. */
export function recentFlashes(dir = scoutDir(), now = new Date()): EditionItem[] {
  const cutoff = localDay(new Date(now.getTime() - 3 * 86_400_000));
  return readJsonl<EditionItem & { date: string }>(join(dir, "flash.jsonl")).filter((flash) => flash.date >= cutoff);
}

/** What George can rate: an item number in today's brief, a story link (brief or flash, past week), or a source id. */
export type ScoutFeedbackTarget = number | string | { n?: number; url?: string; sourceId?: string };
export type RatedScoutItem = Pick<EditionItem, "title" | "source" | "topic" | "why"> & { url?: string; sourceId?: string };

function ratedItem(target: ScoutFeedbackTarget, dir: string, now: Date): EditionItem | undefined {
  const text = typeof target === "string" ? target.trim() : "";
  const n = typeof target === "number" ? target : typeof target === "object" ? target.n : /^\d+$/.test(text) ? Number(text) : undefined;
  const url = typeof target === "object" ? target.url : /^https?:\/\//i.test(text) ? text : undefined;
  if (url) {
    const recent = [
      latestEdition(dir),
      ...Array.from({ length: 7 }, (_, days) => readJson<Edition | null>(join(dir, "editions", `${localDay(new Date(now.getTime() - days * 86_400_000))}.json`), null)),
    ].flatMap((edition) => edition?.items ?? []);
    return [...recent, ...recentFlashes(dir, now)].find((entry) => entry.url === url);
  }
  return n === undefined ? undefined : latestEdition(dir)?.items.find((entry) => entry.n === n);
}

/**
 * George's more/less verdict — from `flyd scout more|less N`, chat, or a view
 * button. Shapes source fitness, ranking, the taste profile and the next
 * evolution. Returns what was rated, or null when nothing matched.
 */
export function recordScoutFeedback(target: ScoutFeedbackTarget, verdict: "more" | "less", dir = scoutDir(), now = new Date()): RatedScoutItem | null {
  const item = ratedItem(target, dir, now);
  const wantedSource = item?.sourceId
    ?? (item ? undefined : typeof target === "object" ? target.sourceId : typeof target === "string" ? target.trim() : undefined);
  const sources = readSources(dir, now);
  const source = wantedSource ? sources.find((entry) => entry.id === wantedSource) : undefined;
  const rated: RatedScoutItem | null = item
    ?? (source ? { title: source.name, source: source.name, topic: source.category ?? source.name, why: "", sourceId: source.id } : null);
  if (!rated) return null;
  appendJsonl(join(dir, "feedback.jsonl"), [{ at: now.toISOString(), verdict, title: rated.title, topic: rated.topic, source: rated.source, ...(rated.sourceId ? { sourceId: rated.sourceId } : {}), why: rated.why }]);
  if (source) {
    writeSources(sources.map((entry) => entry.id !== source.id ? entry : {
      ...entry,
      likes: entry.likes + (verdict === "more" ? 1 : 0),
      dislikes: entry.dislikes + (verdict === "less" ? 1 : 0),
    }), dir);
  }
  return rated;
}

// ── Evolution ──────────────────────────────────────────────────────────────

export interface EvolutionChange { kind: "paused" | "added" | "revived" | "taste" | "topics"; detail: string }

export function evolvePrompt(sources: ScoutSource[], feedback: ScoutFeedback[], taste: string, profile: string | null, memory: string | null, today: string): string {
  const table = sources.filter((source) => source.status !== "reserve").map((source) =>
    `- ${source.id} [${source.status}] fit ${fitness(source).toFixed(2)} (shown ${source.shown}, more ${source.likes}, less ${source.dislikes})`).join("\n");
  return [
    "You are evolving Flyd's Scout so George's news gets better every week.",
    `Today is ${today}.`,
    "1. Propose up to 3 NEW sources grown from what he liked and from his taste (the world he follows, never implementation phrases from his own code): subreddits (just the name), RSS/Atom feed URLs you are confident exist, or last30days search topics (2-5 words, specific). Also propose 1 exploratory source outside his current mix that his taste suggests he'd love.",
    "2. Revise his taste profile: keep his voice and structure; sharpen what he favours/avoids using only evidence from his feedback. Small, specific edits. If feedback is thin, return the taste unchanged.",
    'Reply with JSON only: {"add": [{"kind": "reddit|rss|topic", "name": "...", "target": "...", "category": "...", "why": "..."}], "taste": "<full revised taste profile>", "taste_change": "<one line summarising what changed, or empty>"}',
    `--- Current taste ---\n${taste}`,
    `--- Sources and fitness ---\n${table}`,
    `--- His feedback ---\n${feedbackDigest(feedback)}`,
    `--- Profile ---\n${profile ?? "(empty)"}`,
    `--- Memory ---\n${memory ?? "(empty)"}`,
  ].join("\n\n");
}

const MIN_EXPOSURE_TO_PRUNE = 6;
const PRUNE_BELOW = 0.3;

/**
 * Daily mutation: pause sources that keep missing, breed new ones from what
 * worked, try one from the reserve, and revise the taste profile. Every
 * change is logged and shown to George in the next briefing.
 */
export async function evolveScout(deps: ScoutDependencies): Promise<EvolutionChange[]> {
  const now = (deps.now ?? (() => new Date()))();
  const dir = deps.dir ?? scoutDir();
  let sources = readSources(dir, now);
  const changes: EvolutionChange[] = [];

  sources = sources.map((source) => {
    // Silence is not a verdict: only a source George has marked down can be paused for missing.
    if (source.status === "active" && source.dislikes > 0 && source.shown >= MIN_EXPOSURE_TO_PRUNE && fitness(source) < PRUNE_BELOW) {
      changes.push({ kind: "paused", detail: `${source.name}: you passed on most of the ${source.shown} stories it brought` });
      return { ...source, status: "paused" as const, note: `paused by evolution ${localDay(now)}`, pausedAt: now.toISOString() };
    }
    return source;
  });

  // Counted before revival: a source on its one retry may well fail again.
  const pausedFeeds = sources.filter((source) => source.status === "paused" && source.kind !== "topic").length;

  // Failure-paused sources that have rested get one more try.
  const revival = reviveFailedSources(sources, now);
  sources = revival.sources;
  for (const source of revival.revived) changes.push({ kind: "revived", detail: `retrying ${source.name}` });

  // Exploration: one untried reserve feed each cycle, up to three while feeds or subreddits sit paused.
  for (const reserve of sources.filter((source) => source.status === "reserve").slice(0, Math.max(1, Math.min(3, pausedFeeds)))) {
    sources = sources.map((source) => source.id === reserve.id ? { ...source, status: "active" as const, note: "exploring from reserve" } : source);
    changes.push({ kind: "revived", detail: `trying ${reserve.name}` });
  }

  const taste = readTaste(dir);
  const feedback = readFeedback(dir);

  // Replan search topics from his taste: keep the ones he added or liked, replace the rest.
  const activeTopics = sources.filter((source) => source.kind === "topic" && source.status === "active");
  const kept = activeTopics.filter(keepsTopic);
  const planned = await planTopics(deps.complete, now, { taste, feedback, keep: kept.map((source) => source.target), count: 4 - kept.length });
  if (planned.length) {
    const plannedIds = new Set(planned.map((source) => source.id));
    sources = sources.map((source) => {
      // A topic planned again is reactivated rather than duplicated.
      if (plannedIds.has(source.id)) return { ...source, status: "active" as const, note: planned.find((topic) => topic.id === source.id)?.note };
      if (source.kind === "topic" && source.status === "active" && !keepsTopic(source)) {
        return { ...source, status: "paused" as const, note: `replanned ${localDay(now)}`, pausedAt: now.toISOString() };
      }
      return source;
    });
    sources.push(...planned.filter((topic) => !sources.some((source) => source.id === topic.id)));
    changes.push({ kind: "topics", detail: `now searching ${planned.map((topic) => topic.target).join(", ")}` });
  }
  try {
    const reply = await deps.complete(evolvePrompt(sources, feedback, taste, readUserProfile(), memoryPromptText(), localDay(now)));
    const parsed = JSON.parse(reply.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { add?: Array<Record<string, unknown>>; taste?: string; taste_change?: string };
    for (const raw of (parsed.add ?? []).slice(0, NEW_SOURCES_PER_EVOLUTION)) {
      const kind = String(raw.kind) as SourceKind;
      const target = String(raw.target ?? "").trim().replace(/^r\//i, "");
      if (!["reddit", "rss", "topic"].includes(kind) || !target) continue;
      if (kind === "rss" && !/^https:\/\//.test(target)) continue;
      if (kind === "reddit" && !/^[A-Za-z0-9_]{2,40}$/.test(target)) continue;
      const id = sourceId(kind, target);
      const existing = sources.find((source) => source.id === id);
      if (existing) continue;
      sources.push(newSource(kind, kind === "reddit" ? redditName(target) : String(raw.name ?? target), target, String(raw.category ?? "") || undefined, "active", "evolution", now, String(raw.why ?? "")));
      changes.push({ kind: "added", detail: `${kind === "reddit" ? "r/" : ""}${target}${raw.why ? ` — ${String(raw.why)}` : ""}` });
    }
    const revised = String(parsed.taste ?? "").trim();
    if (revised && revised !== taste && revised.length >= 80 && revised.length <= 4_000) {
      atomicWrite(join(dir, "taste.md"), `${revised}\n`);
      appendJsonl(join(dir, "taste-history.jsonl"), [{ at: now.toISOString(), previous: taste }]);
      changes.push({ kind: "taste", detail: String(parsed.taste_change ?? "taste profile refined from feedback").trim() || "taste profile refined from feedback" });
    }
  } catch {
    // Mutation by the model is best-effort; deterministic pruning still stands.
  }
  writeSources(sources, dir);
  atomicWrite(join(dir, "evolution-state.json"), JSON.stringify({ lastEvolvedAt: now.toISOString() }));
  appendJsonl(join(dir, "evolution.jsonl"), [{ at: now.toISOString(), changes, unread: true }]);
  return changes;
}

export const EVOLVE_EVERY_MS = 20 * 60 * 60 * 1000;
/** New sources one evolution may add: a few a day, so the edition keeps its footing. */
export const NEW_SOURCES_PER_EVOLUTION = 2;

export function evolutionDue(now = new Date(), dir = scoutDir()): boolean {
  const last = readJson<{ lastEvolvedAt?: string }>(join(dir, "evolution-state.json"), {}).lastEvolvedAt;
  // Daily: Flyd keeps looking for new sources as it learns who George is, not once a week.
  return !last || now.getTime() - Date.parse(last) >= EVOLVE_EVERY_MS;
}

/** Unread evolution notes for the briefing ("Scout adjusted: …"); marks them read. */
export function takeEvolutionNotes(dir = scoutDir()): string[] {
  const path = join(dir, "evolution.jsonl");
  const rows = readJsonl<{ at: string; changes: EvolutionChange[]; unread?: boolean }>(path);
  const unread = rows.filter((row) => row.unread && row.changes.length);
  if (unread.length === 0) return [];
  atomicWrite(path, rows.map((row) => JSON.stringify({ ...row, unread: false })).join("\n") + "\n");
  return unread.flatMap((row) => row.changes.map((change) => `${change.kind}: ${change.detail}`)).slice(0, 5);
}

// ── Scheduling ─────────────────────────────────────────────────────────────

export function formatEdition(edition: Edition | null): string[] {
  if (!edition || edition.items.length === 0) return [];
  return edition.items.map((item) => `${item.n}. ${item.kind === "rabbit_hole" || item.kind === "wildcard" ? "🐇 " : item.kind === "must" ? "❗ " : ""}${item.title} — ${item.why} (${item.source}) ${item.url}`);
}

/** Edition once a day after 06:00, so the 08:00 brief carries it. */
export function scoutDue(now = new Date(), dir = scoutDir()): boolean {
  if (process.env.FLYD_SCOUT === "0" || now.getHours() < 6) return false;
  return latestEdition(dir)?.date !== localDay(now);
}

const WATCH_EVERY_MS = 3 * 60 * 60 * 1000;

export function watchDue(now = new Date(), dir = scoutDir()): boolean {
  if (process.env.FLYD_SCOUT === "0" || now.getHours() < 7 || now.getHours() >= 23) return false;
  const last = readJson<{ lastWatchAt?: string }>(join(dir, "watch-state.json"), {}).lastWatchAt;
  return !last || now.getTime() - Date.parse(last) >= WATCH_EVERY_MS;
}

const STALE_LOCK_MS = 30 * 60 * 1000;

async function withLock<T>(dir: string, fn: () => Promise<T>): Promise<T | "locked"> {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, "scout.lock");
  try {
    closeSync(openSync(lock, "wx"));
  } catch {
    try {
      if (Date.now() - statSync(lock).mtimeMs <= STALE_LOCK_MS) return "locked";
      unlinkSync(lock);
      closeSync(openSync(lock, "wx"));
    } catch {
      return "locked";
    }
  }
  try {
    return await fn();
  } finally {
    try { unlinkSync(lock); } catch { /* gone */ }
  }
}

export async function runScoutLocked(deps: ScoutDependencies): Promise<ScoutRunResult> {
  const result = await withLock(deps.dir ?? scoutDir(), () => runScout(deps));
  return result === "locked" ? { skipped: "locked", failedTopics: [] } : result;
}

/** The background tick: evolve and edition daily, watch every few hours. */
export async function scoutTick(deps: ScoutDependencies): Promise<string[]> {
  const now = (deps.now ?? (() => new Date()))();
  const dir = deps.dir ?? scoutDir();
  const log: string[] = [];
  const result = await withLock(dir, async () => {
    if (process.env.FLYD_SCOUT === "0") return;
    // Failure-paused sources get their retry without waiting for the daily evolution.
    const revival = reviveFailedSources(readSources(dir, now), now);
    if (revival.revived.length) {
      writeSources(revival.sources, dir);
      log.push(`retrying ${revival.revived.map((source) => source.name).join(", ")}`);
    }
    // Daily, with or without feedback: look for new sources, revive, explore the reserve, replan topics, refine taste.
    if (evolutionDue(now, dir)) {
      const changes = await evolveScout(deps);
      log.push(`evolved: ${changes.map((change) => change.kind).join(", ") || "no changes"}`);
    }
    if (scoutDue(now, dir)) {
      const run = await runScout(deps);
      log.push(`edition: ${run.edition?.items.length ?? 0} items${run.failedTopics.length ? `, ${run.failedTopics.length} sources failed` : ""}`);
    } else if (watchDue(now, dir)) {
      const musts = await watchScout(deps);
      atomicWrite(join(dir, "watch-state.json"), JSON.stringify({ lastWatchAt: now.toISOString() }));
      log.push(`watch: ${musts.length} must-know`);
    }
  });
  if (result === "locked") log.push("locked");
  return log;
}
