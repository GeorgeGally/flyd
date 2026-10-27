// A Worth a look deck is not a list of articles. Seats are held for a stat, a
// GIF, a video, an image, a quote and a thread, then articles fill what is
// left. Scoring prefers George's live projects and jobs, a fresh date, and a
// source that is not a front-page outlet. Evergreen pieces rotate; they are
// not discarded the day after they are shown.

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

const MAINSTREAM = [
  "theverge.com", "techcrunch.com", "nytimes.com", "bbc.com", "bbc.co.uk", "cnn.com",
  "wired.com", "theguardian.com", "arstechnica.com", "reuters.com", "bloomberg.com",
  "wsj.com", "forbes.com", "businessinsider.com",
];

const STOP = new Set([
  "this", "that", "with", "from", "your", "have", "what", "about", "into", "they", "them",
  "their", "just", "been", "were", "will", "would", "could", "should", "than", "then",
  "also", "only", "over", "after", "before", "where", "which", "while", "there", "here",
  "some", "more", "most", "such", "each", "other", "news", "today", "item",
]);

const SEATS: MediaKind[] = ["stat", "gif", "video", "image", "quote", "thread"];
const EVERGREEN = new Set<MediaKind>(["quote", "stat", "image"]);
const FRESH_MS = 14 * 86_400_000;
const SHOWN_GAP_MS = 20 * 60 * 60 * 1000;

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

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !STOP.has(word));
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
  if (!lead) return "obscure creative tools";
  const words = tokens(`${lead.title} ${lead.detail}`).slice(0, 4);
  return words.join(" ") || lead.title.trim();
}

export function contextScore(item: Pick<InspirationItem, "title" | "summary" | "quote">, focus: WorkFocus[]): { score: number; match?: string } {
  const words = new Set(tokens(`${item.title} ${item.summary} ${item.quote ?? ""}`));
  let best = 0;
  let match: string | undefined;
  for (const job of focus) {
    const terms = tokens(`${job.title} ${job.detail}`);
    const hits = terms.filter((term) => words.has(term)).length;
    const titleHits = tokens(job.title).filter((term) => words.has(term)).length;
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
  else if (age > FRESH_MS && !EVERGREEN.has(item.media)) fresh = -6;
  const obscure = isMainstream(item.url) ? -4 : item.obscure ? 3 : 1;
  return context + fresh + obscure + (item.media === "article" ? 0 : 1);
}

export interface MixOptions {
  now?: number;
  seen?: Set<string>;
  /** When an evergreen url was last seated. Inside the gap, it waits. */
  lastShown?: Map<string, number>;
  limit?: number;
}

function freshEnough(item: InspirationItem, now: number, seen: Set<string>, lastShown: Map<string, number>): boolean {
  if (!item.url || !item.title) return false;
  if (EVERGREEN.has(item.media)) {
    const shown = lastShown.get(item.url);
    if (shown !== undefined && now - shown < SHOWN_GAP_MS) return false;
    return true;
  }
  if (seen.has(item.url)) return false;
  const published = item.published ? Date.parse(item.published) : NaN;
  if (Number.isFinite(published) && now - published > FRESH_MS) return false;
  return true;
}

/** One of each scarce medium, one obscure piece, then articles. One source never fills two non-article seats, and two articles is the cap. */
export function mixInspiration(items: InspirationItem[], focus: WorkFocus[], options: MixOptions = {}): InspirationItem[] {
  const now = options.now ?? Date.now();
  const seen = options.seen ?? new Set<string>();
  const lastShown = options.lastShown ?? new Map<string, number>();
  const limit = options.limit ?? 12;
  const ranked = items
    .filter((item) => freshEnough(item, now, seen, lastShown))
    .map((item) => {
      const match = contextScore(item, focus).match;
      return match ? { ...item, match } : item;
    })
    .sort((a, b) => inspirationScore(b, focus, now) - inspirationScore(a, focus, now) || (lastShown.get(a.url) ?? 0) - (lastShown.get(b.url) ?? 0));

  const picked: InspirationItem[] = [];
  const countSource = (id: string) => picked.filter((item) => item.sourceId === id).length;
  const haveMedia = (media: MediaKind) => picked.some((item) => item.media === media);
  const take = (item: InspirationItem, cap: number): boolean => {
    if (picked.some((have) => have.url === item.url)) return false;
    if (item.media !== "article" && haveMedia(item.media)) return false;
    if (countSource(item.sourceId) >= cap) return false;
    picked.push(item);
    return true;
  };

  for (const seat of SEATS) {
    const next = ranked.find((item) => item.media === seat && countSource(item.sourceId) < 1);
    if (next) take(next, 1);
  }
  if (!picked.some((item) => item.obscure || !isMainstream(item.url))) {
    const wild = ranked.find((item) => (item.obscure || !isMainstream(item.url)) && countSource(item.sourceId) < 1);
    if (wild) take(wild, 1);
  }
  for (const item of ranked) {
    if (picked.length >= limit) break;
    take(item, item.media === "article" ? 2 : 1);
  }
  return picked.slice(0, limit);
}
