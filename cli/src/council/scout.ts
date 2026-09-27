import { execFile } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { FLYD_DIR } from "../lib/config.js";
import { readUserProfile } from "../lib/user-profile.js";
import { RssAdapter } from "../evidence/adapters/rss.js";
import { localDay, memoryPromptText } from "./memory-store.js";

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
  addedBy: "seed" | "evolution" | "george";
  addedAt: string;
  note?: string;
}

export interface ScoutCandidate { id: string; title: string; url: string; source: string; sourceId: string; summary: string; published?: string; engagement?: string; topic: string }
export type ItemKind = "must" | "relevant" | "rabbit_hole";
export interface EditionItem { n: number; title: string; url: string; source: string; sourceId?: string; topic: string; why: string; kind: ItemKind | "wildcard" }
export interface Edition { date: string; generatedAt: string; topics: string[]; items: EditionItem[] }
export interface ScoutFeedback { at: string; verdict: "more" | "less"; title: string; topic: string; source: string; sourceId?: string; why: string }

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
  "Bitcoin & Crypto Art": ["ordinals", "CryptoArt", "GenerativeOrdinals"],
  "AI Art": ["StableDiffusion", "comfyui", "aivideo"],
  "Creative Coding": ["creativecoding", "generative", "p5js", "touchdesigner", "vjing"],
  "Hardware Hacking": ["esp32", "cyberDeck", "synthdiy"],
  "AI & ML": ["LocalLLaMA", "generativeAI"],
  "Internet & Web": ["InternetIsBeautiful", "selfhosted"],
  "Startups": ["SideProject", "indiehackers"],
  "Deep Cuts": ["ReverseEngineering", "HobbyDrama"],
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

function newSource(kind: SourceKind, name: string, target: string, category: string | undefined, status: SourceStatus, addedBy: ScoutSource["addedBy"], now: Date, note?: string): ScoutSource {
  return { id: sourceId(kind, target), kind, name, target, ...(category ? { category } : {}), status, shown: 0, likes: 0, dislikes: 0, failures: 0, addedBy, addedAt: now.toISOString(), ...(note ? { note } : {}) };
}

export function seedSources(now = new Date()): ScoutSource[] {
  return [
    ...SEED_RSS.map(([name, url, category]) => newSource("rss", name, url, category, "active", "seed", now)),
    ...Object.entries(SEED_SUBREDDITS).flatMap(([category, subs]) => subs.map((sub) => newSource("reddit", `r/${sub}`, sub, category, "active", "seed", now))),
    ...RESERVE_RSS.map(([name, url, category]) => newSource("rss", name, url, category, "reserve", "seed", now)),
  ];
}

export function readSources(dir = scoutDir(), now = new Date()): ScoutSource[] {
  const path = join(dir, "sources.json");
  if (!existsSync(path)) {
    const seeded = seedSources(now);
    atomicWrite(path, `${JSON.stringify(seeded, null, 2)}\n`);
    return seeded;
  }
  return readJson<ScoutSource[]>(path, []);
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
const REDDIT_SPACING_MS = 10_000;
/** One patient retry after a 429 before giving up on Reddit for this run. */
const REDDIT_RETRY_AFTER_MS = 45_000;

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
      source: String(item.source ?? "web"),
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
      "Choose today's edition: at most 6 items he would genuinely want to know.",
      "The test for each: would this change a decision, unblock a project, or spark an idea for George this week? Popularity alone is not a reason. Skip off-topic, promotional, low-effort, repeated, or merely keyword-matching items.",
      "kind: 'must' (affects an active project/decision now — use rarely), 'relevant', or exactly one 'rabbit_hole' (deep, weird, inspiring; not a news article).",
    ];
  return [
    "You are Flyd's Scout, curating for George. Be opinionated: curate, don't list.",
    `Today is ${context.today}.`,
    ...task,
    "'why' is one plain sentence to George saying why it matters to HIM (name the project, decision, or interest) — not a summary.",
    "Source fit is how much he has liked a source before (0.5 = unknown); use it as a tiebreaker, not a rule.",
    'Reply with JSON only: {"picks": [{"index": 0, "kind": "must|relevant|rabbit_hole", "why": "..."}]} — {"picks": []} if nothing clears the bar.',
    `--- George's taste (he wrote the seed; it evolves with his feedback) ---\n${context.taste}`,
    `--- Profile ---\n${context.profile ?? "(empty)"}`,
    `--- Memory (active projects, decisions, commitments) ---\n${context.memory ?? "(empty)"}`,
    `--- His feedback on past picks ---\n${feedbackDigest(context.feedback)}`,
    `--- Candidates ---\n${list}`,
  ].join("\n\n");
}

export function parsePicks(text: string, candidates: ScoutCandidate[], max = 6): EditionItem[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Scout ranker returned no JSON");
  const parsed = JSON.parse(match[0]) as { picks?: Array<{ index?: unknown; kind?: unknown; why?: unknown }> };
  const items: EditionItem[] = [];
  let rabbitHoles = 0;
  for (const pick of parsed.picks ?? []) {
    const candidate = candidates[Number(pick.index)];
    if (!candidate || items.some((item) => item.url === candidate.url)) continue;
    let kind: ItemKind = pick.kind === "must" ? "must" : pick.kind === "rabbit_hole" || pick.kind === "wildcard" ? "rabbit_hole" : "relevant";
    if (kind === "rabbit_hole" && rabbitHoles++ > 0) kind = "relevant";
    items.push({ n: items.length + 1, title: candidate.title, url: candidate.url, source: candidate.source, sourceId: candidate.sourceId, topic: candidate.topic, why: String(pick.why ?? "").trim(), kind });
    if (items.length >= max) break;
  }
  return items;
}

function seenUrls(dir: string): Set<string> {
  return new Set(readJsonl<{ url: string }>(join(dir, "seen.jsonl")).map((item) => item.url));
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

function recordFailures(sources: ScoutSource[], failed: string[]): ScoutSource[] {
  return sources.map((source) => {
    if (failed.includes(source.id)) {
      const failures = source.failures + 1;
      // A source that keeps failing is paused, not deleted; evolve may revive it.
      return { ...source, failures, ...(failures >= 5 ? { status: "paused" as const, note: "paused after 5 consecutive fetch failures" } : {}) };
    }
    return source.status === "active" ? { ...source, failures: 0 } : source;
  });
}

export async function planInitialTopics(complete: (prompt: string) => Promise<string>, now: Date): Promise<ScoutSource[]> {
  const prompt = [
    "Plan 4 web/social search topics for George's daily news, based on what he is actively building and deciding.",
    "Each topic is 2-5 words, specific, the way people talk about it online (e.g. 'AI parenting apps funding', 'bitcoin ordinals generative art'). Avoid generic topics.",
    'Reply with JSON only: {"topics": [{"topic": "...", "why": "<one line>"}]}',
    `--- Profile ---\n${readUserProfile() ?? "(empty)"}`,
    `--- Memory ---\n${memoryPromptText() ?? "(empty)"}`,
  ].join("\n\n");
  try {
    const parsed = JSON.parse((await complete(prompt)).match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { topics?: Array<{ topic?: unknown; why?: unknown }> };
    return (parsed.topics ?? []).slice(0, 4).flatMap((item) => {
      const topic = String(item.topic ?? "").replace(/\s+/g, " ").trim();
      return topic && topic.length <= 60 ? [newSource("topic", topic, topic, "Your projects", "active", "evolution", now, String(item.why ?? ""))] : [];
    });
  } catch {
    return [];
  }
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
  redditSpacingMs?: number;
}

export interface ScoutRunResult {
  skipped?: "already_today" | "no_sources" | "locked";
  edition?: Edition;
  failedTopics: string[];
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
    sources = [...sources, ...await planInitialTopics(deps.complete, now)];
    writeSources(sources, dir);
  }

  const { candidates, failed } = await gatherCandidates(sources, { fetchFn: deps.fetchFn, fetchTopicFn: deps.fetchTopicFn, includeTopics: true, now, ...(deps.redditSpacingMs !== undefined ? { redditSpacingMs: deps.redditSpacingMs } : {}) });
  sources = recordFailures(sources, failed);
  const seen = seenUrls(dir);
  const fresh = candidates.filter((candidate, index) => !seen.has(candidate.url) && candidates.findIndex((other) => other.url === candidate.url) === index).slice(0, 150);
  const items = fresh.length ? parsePicks(await deps.complete(rankPrompt(fresh, rankContext(dir, now, sources, "edition"))), fresh) : [];

  // Exposure counts toward fitness: a source that keeps being shown but never liked fades.
  sources = sources.map((source) => ({ ...source, shown: source.shown + items.filter((item) => item.sourceId === source.id).length }));
  writeSources(sources, dir);
  const edition: Edition = { date: today, generatedAt: now.toISOString(), topics: [...new Set(items.map((item) => item.topic))], items };
  atomicWrite(join(dir, "editions", `${today}.json`), `${JSON.stringify(edition, null, 2)}\n`);
  atomicWrite(join(dir, "edition-latest.json"), `${JSON.stringify(edition, null, 2)}\n`);
  appendJsonl(join(dir, "seen.jsonl"), items.map((item) => ({ url: item.url, date: today })));
  return { edition, failedTopics: failed };
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
  const { candidates, failed } = await gatherCandidates(sources, { fetchFn: deps.fetchFn, includeTopics: false, now, redditLimit: 5, ...(deps.redditSpacingMs !== undefined ? { redditSpacingMs: deps.redditSpacingMs } : {}) });
  sources = recordFailures(sources, failed);
  writeSources(sources, dir);
  const seen = seenUrls(dir);
  const watched = new Set(readJsonl<{ url: string }>(join(dir, "watched.jsonl")).map((item) => item.url));
  const fresh = candidates.filter((candidate, index) => !seen.has(candidate.url) && !watched.has(candidate.url) && candidates.findIndex((other) => other.url === candidate.url) === index).slice(0, 80);
  // Everything examined is remembered so the watch never re-reads the same item.
  appendJsonl(join(dir, "watched.jsonl"), fresh.map((candidate) => ({ url: candidate.url, date: today })));
  if (fresh.length === 0) return [];

  const musts = parsePicks(await deps.complete(rankPrompt(fresh, rankContext(dir, now, sources, "watch"))), fresh, 2).filter((item) => item.kind === "must");
  if (musts.length === 0) return [];
  const flashes = readJsonl<EditionItem & { date: string }>(join(dir, "flash.jsonl"));
  const notifiedToday = flashes.filter((flash) => flash.date === today && (flash as { notified?: boolean }).notified).length;
  const rows = musts.map((item, index) => ({ ...item, date: today, notified: Boolean(deps.notify) && notifiedToday + index < WATCH_NOTIFICATIONS_PER_DAY }));
  for (const row of rows.filter((item) => item.notified)) await deps.notify!(`Flyd Scout — ${row.source}`, `${row.title}: ${row.why}`).catch(() => undefined);
  appendJsonl(join(dir, "flash.jsonl"), rows);
  appendJsonl(join(dir, "seen.jsonl"), rows.map((item) => ({ url: item.url, date: today })));
  return musts;
}

/** Recent must-know items the Muse may raise in conversation. */
export function recentFlashes(dir = scoutDir(), now = new Date()): EditionItem[] {
  const cutoff = localDay(new Date(now.getTime() - 3 * 86_400_000));
  return readJsonl<EditionItem & { date: string }>(join(dir, "flash.jsonl")).filter((flash) => flash.date >= cutoff);
}

/** George's verdict on an edition item: shapes source fitness, ranking, and the next evolution. */
export function recordScoutFeedback(n: number, verdict: "more" | "less", dir = scoutDir(), now = new Date()): EditionItem | null {
  const item = latestEdition(dir)?.items.find((entry) => entry.n === n);
  if (!item) return null;
  appendJsonl(join(dir, "feedback.jsonl"), [{ at: now.toISOString(), verdict, title: item.title, topic: item.topic, source: item.source, ...(item.sourceId ? { sourceId: item.sourceId } : {}), why: item.why }]);
  if (item.sourceId) {
    writeSources(readSources(dir, now).map((source) => source.id !== item.sourceId ? source : {
      ...source,
      likes: source.likes + (verdict === "more" ? 1 : 0),
      dislikes: source.dislikes + (verdict === "less" ? 1 : 0),
    }), dir);
  }
  return item;
}

// ── Evolution ──────────────────────────────────────────────────────────────

export interface EvolutionChange { kind: "paused" | "added" | "revived" | "taste"; detail: string }

export function evolvePrompt(sources: ScoutSource[], feedback: ScoutFeedback[], taste: string, profile: string | null, memory: string | null, today: string): string {
  const table = sources.filter((source) => source.status !== "reserve").map((source) =>
    `- ${source.id} [${source.status}] fit ${fitness(source).toFixed(2)} (shown ${source.shown}, more ${source.likes}, less ${source.dislikes})`).join("\n");
  return [
    "You are evolving Flyd's Scout so George's news gets better every week.",
    `Today is ${today}.`,
    "1. Propose up to 3 NEW sources grown from what he liked and from his active projects: subreddits (just the name), RSS/Atom feed URLs you are confident exist, or last30days search topics (2-5 words, specific). Also propose 1 exploratory source outside his current mix that his taste suggests he'd love.",
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
 * Weekly mutation: pause sources that keep missing, breed new ones from what
 * worked, try one from the reserve, and revise the taste profile. Every
 * change is logged and shown to George in the next briefing.
 */
export async function evolveScout(deps: ScoutDependencies): Promise<EvolutionChange[]> {
  const now = (deps.now ?? (() => new Date()))();
  const dir = deps.dir ?? scoutDir();
  let sources = readSources(dir, now);
  const changes: EvolutionChange[] = [];

  sources = sources.map((source) => {
    if (source.status === "active" && source.shown >= MIN_EXPOSURE_TO_PRUNE && fitness(source) < PRUNE_BELOW) {
      changes.push({ kind: "paused", detail: `${source.name} (fit ${fitness(source).toFixed(2)} after ${source.shown} shown)` });
      return { ...source, status: "paused" as const, note: `paused by evolution ${localDay(now)}` };
    }
    return source;
  });

  // Exploration: one untried reserve feed each cycle.
  const reserve = sources.find((source) => source.status === "reserve");
  if (reserve) {
    sources = sources.map((source) => source.id === reserve.id ? { ...source, status: "active" as const, note: "exploring from reserve" } : source);
    changes.push({ kind: "revived", detail: `trying ${reserve.name}` });
  }

  const taste = readTaste(dir);
  const feedback = readFeedback(dir);
  try {
    const reply = await deps.complete(evolvePrompt(sources, feedback, taste, readUserProfile(), memoryPromptText(), localDay(now)));
    const parsed = JSON.parse(reply.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { add?: Array<Record<string, unknown>>; taste?: string; taste_change?: string };
    for (const raw of (parsed.add ?? []).slice(0, 4)) {
      const kind = String(raw.kind) as SourceKind;
      const target = String(raw.target ?? "").trim().replace(/^r\//i, "");
      if (!["reddit", "rss", "topic"].includes(kind) || !target) continue;
      if (kind === "rss" && !/^https:\/\//.test(target)) continue;
      if (kind === "reddit" && !/^[A-Za-z0-9_]{2,40}$/.test(target)) continue;
      const id = sourceId(kind, target);
      const existing = sources.find((source) => source.id === id);
      if (existing) continue;
      sources.push(newSource(kind, String(raw.name ?? (kind === "reddit" ? `r/${target}` : target)), target, String(raw.category ?? "") || undefined, "active", "evolution", now, String(raw.why ?? "")));
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

export function evolutionDue(now = new Date(), dir = scoutDir()): boolean {
  const last = readJson<{ lastEvolvedAt?: string }>(join(dir, "evolution-state.json"), {}).lastEvolvedAt;
  return !last || now.getTime() - Date.parse(last) >= 7 * 86_400_000;
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

/** The background tick: evolve weekly, edition daily, watch every few hours. */
export async function scoutTick(deps: ScoutDependencies): Promise<string[]> {
  const now = (deps.now ?? (() => new Date()))();
  const dir = deps.dir ?? scoutDir();
  const log: string[] = [];
  const result = await withLock(dir, async () => {
    if (evolutionDue(now, dir) && readFeedback(dir).length > 0) {
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
