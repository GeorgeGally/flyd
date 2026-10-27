// Worth a look is a mix, not a ranking of articles. A context digest of his
// open jobs (no model, no embeddings) picks search terms. Sources are then
// interleaved under a per-type quota, deduped, and rotated by a persisted
// shown-log: unseen first, otherwise the oldest last_shown_at.

import { createHash } from "node:crypto";

export const MEDIA_KINDS = ["article", "stat", "gif", "video", "image", "quote", "thread"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export interface InspirationItem {
  url: string;
  title: string;
  source: string;
  sourceId: string;
  summary: string;
  media: MediaKind;
  published?: string;
  figure?: string;
  quote?: string;
  attribution?: string;
  /** Direct GIF or image bytes. The page never sees this; it gets a same-origin clip. */
  mediaUrl?: string;
  /** Set when the item shares words with a live project or job. */
  match?: string;
  obscure?: boolean;
}

export interface WorkFocus {
  id: string;
  title: string;
  detail: string;
}

export interface FocusProject {
  id: string;
  name: string;
  status: string;
  what?: string;
  now?: string;
  next?: string;
  facts?: string[];
}

/** A job as the column knows it: a project he is moving, with a next action. */
export interface FocusJob {
  title: string;
  project?: string;
  group?: string;
  next?: string;
}

export interface DigestTopic {
  name: string;
  weight: number;
}

export interface DigestBelief {
  topic: string;
  claim: string;
}

export interface ContextDigest {
  signature: string;
  profile: string;
  topics: DigestTopic[];
  beliefs: DigestBelief[];
  notes: string[];
  watchTerms: string[];
  /** At most six lines. Safe to put in front of a cheap expansion call. */
  promptContext: string;
}

export interface ContextMatch {
  topics: DigestTopic[];
  beliefs: DigestBelief[];
  notes: string[];
}

const MAINSTREAM = [
  "theverge.com", "techcrunch.com", "nytimes.com", "bbc.com", "bbc.co.uk", "cnn.com",
  "wired.com", "theguardian.com", "arstechnica.com", "reuters.com", "bloomberg.com",
  "wsj.com", "forbes.com", "businessinsider.com",
];

const STOP = new Set([
  "the", "and", "for", "are", "was", "not", "you", "but", "his", "her", "its", "our",
  "out", "all", "can", "has", "had", "did", "how", "who", "why", "any", "may", "per",
  "this", "that", "with", "from", "your", "have", "what", "about", "into", "they",
  "them", "their", "just", "been", "were", "will", "would", "could", "should", "than",
  "then", "also", "only", "over", "after", "before", "where", "which", "while",
  "there", "here", "some", "more", "most", "such", "each", "other", "news", "today",
  "item", "use", "only", "directly", "relevant",
]);

/** Sidebar quotas. News is the article seat; a thread is Reddit or HN. */
export const TYPE_QUOTA: Record<MediaKind, number> = {
  quote: 2,
  stat: 2,
  article: 4,
  thread: 2,
  image: 2,
  gif: 2,
  video: 2,
};

const TYPE_ORDER: MediaKind[] = ["quote", "stat", "article", "thread", "image", "gif", "video"];
const RECYCLE = new Set<MediaKind>(["quote", "stat", "image", "gif", "video"]);
const FRESH_MS = 14 * 86_400_000;
const QUALIFIERS = ["practice", "history", "tools", "notes", "field"];
const DEFAULT_PROFILE = "obscure creative tools";

export function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

export function isMainstream(url: string): boolean {
  const host = hostOf(url);
  return MAINSTREAM.some((name) => host === name || host.endsWith(`.${name}`));
}

export function classifyMedia(item: { url: string; title?: string; summary?: string }): MediaKind {
  const url = item.url.toLowerCase();
  if (/\.gif(\?|$)/.test(url)) return "gif";
  if (/youtube\.com|youtu\.be|vimeo\.com|\.(mp4|webm)(\?|$)/.test(url)) return "video";
  if (/\.(png|jpe?g|webp|avif)(\?|$)/.test(url)) return "image";
  if (/news\.ycombinator\.com\/item|reddit\.com\/r\/[^/]+\/comments\//.test(url)) return "thread";
  const text = `${item.title ?? ""} ${item.summary ?? ""}`;
  if (/\d/.test(item.title ?? "") && /\b(percent|survey|census|index|million|billion)\b/i.test(text)) return "stat";
  return "article";
}

/** Lowercase [a-z0-9]+ tokens, length at least 3, stopwords removed. */
export function lexicalTokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => word.length >= 3 && !STOP.has(word));
}

export function workFocusFromProjects(projects: FocusProject[]): WorkFocus[] {
  return projects
    .filter((project) => project.status === "active" || project.status === "launching" || project.status === "waiting")
    .map((project) => ({
      id: project.id,
      title: project.name,
      detail: [project.what, project.now, project.next, ...(project.facts ?? [])].filter((part): part is string => Boolean(part?.trim())).join(" "),
    }));
}

export function workFocusFromJobs(jobs: FocusJob[]): WorkFocus[] {
  return jobs
    .filter((job) => !job.group || job.group === "needs" || job.group === "working" || job.group === "waiting")
    .map((job) => ({
      id: (job.project || job.title).toLowerCase(),
      title: job.project || job.title,
      detail: [job.title, job.next].filter((part): part is string => Boolean(part?.trim())).join(" "),
    }));
}

/** Projects first, then jobs whose title is not already covered by a project name. */
export function workFocus(projects: FocusProject[], jobs: FocusJob[] = []): WorkFocus[] {
  const fromProjects = workFocusFromProjects(projects);
  const names = new Set(fromProjects.map((item) => item.title.toLowerCase()));
  return [...fromProjects, ...workFocusFromJobs(jobs).filter((job) => !names.has(job.title.toLowerCase()))];
}

export function focusTerm(focus: WorkFocus[]): string {
  const lead = focus.find((item) => item.title.trim());
  if (!lead) return DEFAULT_PROFILE;
  const words = lexicalTokens(`${lead.title} ${lead.detail}`).slice(0, 4);
  return words.join(" ") || lead.title.trim();
}

function fallbackDigest(): ContextDigest {
  return {
    signature: "default",
    profile: DEFAULT_PROFILE,
    topics: [{ name: DEFAULT_PROFILE, weight: 1 }],
    beliefs: [],
    notes: [],
    watchTerms: ["obscure", "creative", "tools"],
    promptContext: `Profile: ${DEFAULT_PROFILE}`,
  };
}

/** No model. Signature changes when his open jobs change, and that busts every downstream cache. */
export function buildDigest(focus: WorkFocus[], input: { profile?: string; beliefs?: DigestBelief[]; notes?: string[] } = {}): ContextDigest {
  try {
    const list = Array.isArray(focus) ? focus : [];
    const topics = list
      .map((item, index) => ({ name: item.title?.trim() ?? "", weight: Math.max(1, list.length - index) }))
      .filter((topic) => topic.name)
      .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
      .slice(0, 8);
    const beliefs = (input.beliefs?.length ? input.beliefs : list.flatMap((item) => {
      const claim = item.detail?.replace(/\s+/g, " ").trim().slice(0, 180) ?? "";
      return claim ? [{ topic: item.title?.trim() ?? "", claim }] : [];
    })).filter((belief) => belief.topic && belief.claim).slice(0, 24);
    const notes = (input.notes?.length ? input.notes : list.map((item) => item.detail ?? ""))
      .flatMap((text) => text.split(/(?<=[.!?])\s+/))
      .map((sentence) => sentence.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 80);
    const profile = (input.profile ?? list.map((item) => item.detail).find((detail) => detail?.trim()) ?? topics[0]?.name ?? DEFAULT_PROFILE)
      .replace(/\s+/g, " ").trim().slice(0, 360) || DEFAULT_PROFILE;
    const watchTerms = [...new Set([...topics.map((topic) => topic.name), ...beliefs.map((belief) => belief.topic)].flatMap(lexicalTokens))].slice(0, 10);
    const signature = createHash("sha256").update(JSON.stringify({
      profile: profile.length,
      topics: topics.map((topic) => [topic.name, topic.weight]),
      beliefs: beliefs.map((belief) => [belief.topic, belief.claim.length]),
      notes: notes.map((note) => note.length),
    })).digest("hex").slice(0, 16);
    const lines = [
      `Profile: ${profile}`,
      `Topics: ${topics.slice(0, 6).map((topic) => `${topic.name} (${topic.weight})`).join(", ") || DEFAULT_PROFILE}`,
      `Beliefs: ${beliefs.slice(0, 4).map((belief) => `${belief.topic}: ${belief.claim}`).join(" | ") || "none"}`,
      `Watch: ${watchTerms.slice(0, 8).join(", ") || DEFAULT_PROFILE}`,
    ];
    return { signature, profile, topics, beliefs, notes, watchTerms, promptContext: lines.slice(0, 6).join("\n") };
  } catch {
    return fallbackDigest();
  }
}

/** facts asks for two shared tokens; every other destination asks for one. Short text stays at one. */
export function minOverlap(tokenCount: number, destination = "news"): number {
  const destinationMin = destination === "facts" ? 2 : 1;
  const dynamic = tokenCount <= 2 ? 1 : Math.floor(tokenCount / 2);
  return Math.max(destinationMin, dynamic);
}

function shared(tokens: string[], haystack: Set<string>): number {
  return tokens.filter((token) => haystack.has(token)).length;
}

/** Lexical overlap only. A related idea with no shared token does not match. */
export function matchContext(text: string, digest: ContextDigest, destination = "news"): ContextMatch {
  try {
    const tokens = new Set(lexicalTokens(text));
    const topics = digest.topics.slice(0, 8)
      .map((topic) => {
        const name = topic.name.toLowerCase();
        const hits = [...tokens].filter((token) => name.includes(token)).length;
        return { topic, hits, score: hits + topic.weight };
      })
      .filter((row) => row.hits > 0)
      .sort((a, b) => b.score - a.score || b.topic.weight - a.topic.weight)
      .slice(0, 4)
      .map((row) => row.topic);
    const beliefs = digest.beliefs.slice(0, 24).filter((belief) => {
      const beliefTokens = lexicalTokens(`${belief.topic} ${belief.claim}`);
      return shared(beliefTokens, tokens) >= minOverlap(beliefTokens.length, destination);
    }).slice(0, 4);
    const notes = digest.notes.slice(0, 80).flatMap((sentence) => {
      const sentenceTokens = lexicalTokens(sentence);
      if (shared(sentenceTokens, tokens) < minOverlap(sentenceTokens.length, destination)) return [];
      return [sentence.slice(0, 200)];
    }).slice(0, 3);
    return { topics, beliefs, notes };
  } catch {
    return { topics: [], beliefs: [], notes: [] };
  }
}

/** Lines for a cheap prompt. The model is told to ignore context that is not relevant. */
export function relevanceBlock(query: string, digest: ContextDigest, destination: string): string {
  const match = matchContext(query, digest, destination);
  return [
    "Use the context below only if it is directly relevant.",
    `Query: ${query}`,
    `Destination: ${destination}`,
    digest.promptContext,
    match.topics.length ? `Matched topics: ${match.topics.map((topic) => topic.name).join(", ")}` : "",
    match.beliefs.length ? `Matched beliefs: ${match.beliefs.map((belief) => `${belief.topic}: ${belief.claim}`).join(" | ")}` : "",
    match.notes.length ? `Matched notes: ${match.notes.join(" | ")}` : "",
  ].filter(Boolean).slice(0, 12).join("\n");
}

const DESTINATION_GUIDE: Record<string, string> = {
  news: "a concrete recent event, not an explainer",
  stats: "something that would be measured, not a definition",
  facts: "a checkable claim",
  quotes: "a subject someone would be quoted on",
  images: "a physical subject, suitable for a landscape photo",
  gifs: "a visible action or reaction",
  videos: "a specific demo, talk, or clip",
  threads: "a discussion, complaint, or workaround",
};

export function expansionPrompt(query: string, digest: ContextDigest, destination = "news"): string {
  const guide = DESTINATION_GUIDE[destination] ?? DESTINATION_GUIDE.news;
  return [
    `Return JSON {"search_terms":["..."]} with exactly 2 search terms.`,
    "Each term is 2 to 5 words. Do not repeat the original query. No names of people unless the query already has them.",
    `The terms should find ${guide}, and also be usable for a picture, a number, and a short quote.`,
    relevanceBlock(query, digest, destination),
  ].join("\n");
}

/** Term 1 is always the original query. At most three terms. Extras must be 2–5 words. */
export function ensureQueryAnchor(query: string, terms: string[]): string[] {
  const original = query.replace(/\s+/g, " ").trim();
  const extras: string[] = [];
  for (const raw of terms) {
    const term = raw.replace(/\s+/g, " ").trim();
    const count = term.split(" ").filter(Boolean).length;
    if (!term || term.toLowerCase() === original.toLowerCase()) continue;
    if (count < 2 || count > 5) continue;
    if (extras.some((have) => have.toLowerCase() === term.toLowerCase())) continue;
    extras.push(term);
    if (extras.length === 2) break;
  }
  const anchored = original ? [original, ...extras] : extras;
  return anchored.length ? anchored : [DEFAULT_PROFILE];
}

export function termsFromModel(raw: string, query: string): string[] {
  try {
    const parsed = JSON.parse(raw) as { search_terms?: unknown };
    const terms = Array.isArray(parsed.search_terms) ? parsed.search_terms.filter((term): term is string => typeof term === "string") : [];
    return ensureQueryAnchor(query, terms);
  } catch {
    return ensureQueryAnchor(query, []);
  }
}

function qualifierFor(topic: string): string {
  let hash = 0;
  for (const char of topic) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return QUALIFIERS[hash % QUALIFIERS.length] ?? "notes";
}

/**
 * Non-LLM fallback. Bigrams and trigrams over the digest, boosted when they
 * repeat a topic word. The original query stays term 1.
 */
export function ngramTerms(digest: ContextDigest, query: string, now = Date.now()): string[] {
  const topicWords = new Set(digest.topics.flatMap((topic) => lexicalTokens(topic.name)));
  const saved = digest.notes.join(" ").toLowerCase();
  const posts = (digest.beliefs.length ? digest.beliefs : digest.topics.map((topic) => ({ topic: topic.name, claim: topic.name })))
    .map((belief) => ({ text: `${belief.topic} ${belief.claim}`, author: belief.topic, at: 0 }));
  const scores = new Map<string, number>();
  const seenAuthor = new Set<string>();
  for (const post of posts) {
    const words = lexicalTokens(post.text);
    const phrases: string[] = [];
    for (let i = 0; i < words.length - 1; i += 1) {
      phrases.push(`${words[i]} ${words[i + 1]}`);
      if (words[i + 2]) phrases.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
    const seenHere = new Set<string>();
    for (const phrase of phrases) {
      if (seenHere.has(phrase)) continue;
      seenHere.add(phrase);
      const key = `${post.author}\0${phrase}`;
      const first = !seenAuthor.has(key);
      seenAuthor.add(key);
      let score = first ? 3 : 1;
      if (post.at > 0 && now - post.at < 6 * 3_600_000) score *= 2;
      if (saved.includes(phrase)) score += 4;
      score += phrase.split(" ").filter((word) => topicWords.has(word)).length * 5;
      scores.set(phrase, (scores.get(phrase) ?? 0) + score);
    }
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([phrase]) => phrase);
  const grouped: string[] = [];
  let bucket: string[] = [];
  const flush = (): void => {
    if (bucket.length >= 2) grouped.push([...new Set(bucket)].slice(0, 5).join(" "));
    bucket = [];
  };
  for (const phrase of ranked) {
    const words = phrase.split(" ");
    if (bucket.length && bucket.length + words.length > 5) flush();
    bucket.push(...words);
    if (grouped.length === 2) break;
  }
  flush();
  if (!grouped.length) {
    const topic = digest.topics[0]?.name;
    if (topic) grouped.push(`${topic} ${qualifierFor(topic)}`);
  }
  return ensureQueryAnchor(query, grouped);
}

export function contextScore(item: Pick<InspirationItem, "title" | "summary" | "quote">, focus: WorkFocus[]): { score: number; match?: string } {
  const words = new Set(lexicalTokens(`${item.title} ${item.summary} ${item.quote ?? ""}`));
  let best = 0;
  let match: string | undefined;
  for (const job of focus) {
    const terms = lexicalTokens(`${job.title} ${job.detail}`);
    const hits = terms.filter((term) => words.has(term)).length;
    const titleHits = lexicalTokens(job.title).filter((term) => words.has(term)).length;
    const score = hits + titleHits * 2;
    if (score > best) { best = score; match = job.title; }
  }
  return best > 0 ? { score: best, match } : { score: 0 };
}

export function inspirationScore(item: InspirationItem, focus: WorkFocus[], now: number): number {
  const context = contextScore(item, focus).score * 3;
  const published = item.published ? Date.parse(item.published) : NaN;
  const age = Number.isFinite(published) ? now - published : Number.POSITIVE_INFINITY;
  let fresh = 0;
  if (age < 2 * 86_400_000) fresh = 4;
  else if (age < 7 * 86_400_000) fresh = 2;
  else if (age > FRESH_MS && !RECYCLE.has(item.media)) fresh = -6;
  const obscure = isMainstream(item.url) ? -4 : item.obscure ? 3 : 1;
  return context + fresh + obscure + (item.media === "article" ? 0 : 1);
}

export interface MixOptions {
  now?: number;
  seen?: Set<string>;
  /** When a url was last seated. Oldest is recycled first once the fresh pool is short. */
  lastShown?: Map<string, number>;
  limit?: number;
}

function contentKey(item: InspirationItem): string {
  return (item.quote || item.figure || item.title).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 180);
}

export function dedupeInspiration(items: InspirationItem[]): InspirationItem[] {
  const urls = new Set<string>();
  const contents = new Set<string>();
  const out: InspirationItem[] = [];
  for (const item of items) {
    const url = item.url?.trim();
    const content = contentKey(item);
    if (!url || !item.title?.trim() || urls.has(url) || (content && contents.has(content))) continue;
    urls.add(url);
    if (content) contents.add(content);
    out.push(item);
  }
  return out;
}

function isFresh(item: InspirationItem, now: number, seen: Set<string>, lastShown: Map<string, number>): boolean {
  if (seen.has(item.url) || lastShown.has(item.url)) return false;
  if (RECYCLE.has(item.media)) return true;
  const published = item.published ? Date.parse(item.published) : NaN;
  if (Number.isFinite(published) && now - published > FRESH_MS) return false;
  return true;
}

function roundRobin(items: InspirationItem[], focus: WorkFocus[], now: number): InspirationItem[] {
  const sorted = [...items].sort((a, b) => inspirationScore(b, focus, now) - inspirationScore(a, focus, now));
  const groups = new Map<string, InspirationItem[]>();
  for (const item of sorted) {
    const list = groups.get(item.sourceId) ?? [];
    list.push(item);
    groups.set(item.sourceId, list);
  }
  const queues = [...groups.values()];
  const out: InspirationItem[] = [];
  let moved = true;
  while (moved) {
    moved = false;
    for (const queue of queues) {
      const next = queue.shift();
      if (!next) continue;
      out.push(next);
      moved = true;
    }
  }
  return out;
}

/** Quotas, then round-robin across sources. Seen articles stay out. Short types recycle the oldest last_shown_at. */
export function mixInspiration(items: InspirationItem[], focus: WorkFocus[], options: MixOptions = {}): InspirationItem[] {
  const now = options.now ?? Date.now();
  const seen = options.seen ?? new Set<string>();
  const lastShown = options.lastShown ?? new Map<string, number>();
  const limit = options.limit ?? 12;
  const unique = dedupeInspiration(items).map((item) => {
    const match = contextScore(item, focus).match;
    return match ? { ...item, match } : item;
  });
  const fresh = new Map<MediaKind, InspirationItem[]>();
  const recycle = new Map<MediaKind, InspirationItem[]>();
  for (const kind of TYPE_ORDER) { fresh.set(kind, []); recycle.set(kind, []); }
  for (const item of unique) {
    if (isFresh(item, now, seen, lastShown)) fresh.get(item.media)?.push(item);
    else if (RECYCLE.has(item.media) && (lastShown.has(item.url) || seen.has(item.url))) recycle.get(item.media)?.push(item);
  }
  for (const kind of TYPE_ORDER) {
    fresh.set(kind, roundRobin(fresh.get(kind) ?? [], focus, now));
    recycle.get(kind)?.sort((a, b) => (lastShown.get(a.url) ?? 0) - (lastShown.get(b.url) ?? 0));
  }

  const picked: InspirationItem[] = [];
  const counts = Object.fromEntries(TYPE_ORDER.map((kind) => [kind, 0])) as Record<MediaKind, number>;
  const take = (kind: MediaKind, pool: Map<MediaKind, InspirationItem[]>): boolean => {
    if (picked.length >= limit || counts[kind] >= TYPE_QUOTA[kind]) return false;
    const next = pool.get(kind)?.shift();
    if (!next || picked.some((have) => have.url === next.url)) return false;
    picked.push(next);
    counts[kind] += 1;
    return true;
  };
  let moved = true;
  while (picked.length < limit && moved) {
    moved = false;
    for (const kind of TYPE_ORDER) if (take(kind, fresh)) moved = true;
  }
  moved = true;
  while (picked.length < limit && moved) {
    moved = false;
    for (const kind of TYPE_ORDER) if (RECYCLE.has(kind) && take(kind, recycle)) moved = true;
  }
  return picked;
}
