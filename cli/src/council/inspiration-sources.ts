import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchPublicUrl } from "../runtime/url-guard.js";
import { focusTerm, type InspirationItem, type WorkFocus } from "./inspiration.js";

// Four public reads per focus term, then twenty hours of cache. No model call.
// Quiet threads are preferred over busy ones; the point count is not kept and
// is not treated as truth. Twitter and logged-in social searches are not here.

const TTL_MS = 20 * 60 * 60 * 1000;
const HEADERS = { accept: "application/json", "user-agent": "Flyd/1.0 (personal research feed)" };

interface CacheFile { term: string; at: string; hits: InspirationItem[] }

function cachePath(dir: string): string {
  return join(dir, "scout", "inspiration.json");
}

function shownPath(dir: string): string {
  return join(dir, "scout", "inspiration-shown.json");
}

export function readShown(dir: string): Map<string, number> {
  try {
    const parsed = JSON.parse(readFileSync(shownPath(dir), "utf8")) as Record<string, string>;
    return new Map(Object.entries(parsed).flatMap(([url, at]) => {
      const time = Date.parse(at);
      return Number.isFinite(time) ? [[url, time] as const] : [];
    }));
  } catch {
    return new Map();
  }
}

export function markShown(dir: string, urls: string[], now: Date): void {
  let current: Record<string, string> = {};
  try { current = JSON.parse(readFileSync(shownPath(dir), "utf8")) as Record<string, string>; } catch { /* first edition */ }
  for (const url of urls) current[url] = now.toISOString();
  const entries = Object.entries(current).slice(-200);
  mkdirSync(join(dir, "scout"), { recursive: true });
  writeFileSync(shownPath(dir), JSON.stringify(Object.fromEntries(entries)));
}

function pagesOf(json: unknown): Array<Record<string, unknown>> {
  const pages = (json as { query?: { pages?: Record<string, unknown> } } | null)?.query?.pages;
  if (!pages || typeof pages !== "object") return [];
  return Object.values(pages).filter((page): page is Record<string, unknown> => Boolean(page) && typeof page === "object");
}

export function figureIn(text: string): string | undefined {
  const match = /(?<![A-Za-z\d])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?%|\d+(?:\.\d+)?\s(?:million|billion|thousand))(?![\d%])/i.exec(text);
  return match?.[0].replace(/\s+/g, " ").trim();
}

export function quoteIn(text: string): { quote: string; attribution?: string } | undefined {
  const quoted = /[“"]([^”"]{20,240})[”"]/.exec(text);
  if (!quoted?.[1]) return undefined;
  const after = text.slice((quoted.index ?? 0) + quoted[0].length);
  const by = /\s*(?:—|–|-)\s*([^.\n]{2,80})/.exec(after);
  return { quote: quoted[1].replace(/\s+/g, " ").trim(), ...(by?.[1] ? { attribution: by[1].replace(/\s+/g, " ").trim() } : {}) };
}

function sentenceWith(text: string, figure: string): string {
  const parts = text.split(/(?<=\.)\s+/);
  return (parts.find((part) => part.includes(figure)) ?? text).replace(/\s+/g, " ").trim().slice(0, 180);
}

function wikiUrl(host: string, title: string): string {
  return `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

export function statsFromWikipedia(json: unknown): InspirationItem[] {
  const hits: InspirationItem[] = [];
  for (const page of pagesOf(json)) {
    const title = typeof page.title === "string" ? page.title : "";
    const extract = typeof page.extract === "string" ? page.extract : "";
    const figure = figureIn(extract);
    if (!title || title.startsWith("Wikipedia:") || !figure) continue;
    hits.push({
      url: wikiUrl("en.wikipedia.org", title),
      title,
      source: "Wikipedia",
      sourceId: "wiki:stat",
      summary: sentenceWith(extract, figure),
      media: "stat",
      figure,
      obscure: true,
    });
    if (hits.length === 2) break;
  }
  return hits;
}

export function quotesFromWikiquote(json: unknown): InspirationItem[] {
  const hits: InspirationItem[] = [];
  for (const page of pagesOf(json)) {
    const title = typeof page.title === "string" ? page.title : "";
    const extract = typeof page.extract === "string" ? page.extract : "";
    const found = quoteIn(extract);
    if (!title || !found) continue;
    hits.push({
      url: wikiUrl("en.wikiquote.org", title),
      title,
      source: "Wikiquote",
      sourceId: "wikiquote",
      summary: found.quote,
      media: "quote",
      quote: found.quote,
      ...(found.attribution ? { attribution: found.attribution } : {}),
      obscure: true,
    });
    if (hits.length === 2) break;
  }
  return hits;
}

export function mediaFromCommons(json: unknown): InspirationItem[] {
  const hits: InspirationItem[] = [];
  const seen = new Set<string>();
  for (const page of pagesOf(json)) {
    const title = typeof page.title === "string" ? page.title : "";
    const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] as { url?: unknown; mime?: unknown } | undefined : undefined;
    const mediaUrl = typeof info?.url === "string" ? info.url : "";
    const mime = typeof info?.mime === "string" ? info.mime : "";
    const media = mime === "image/gif" ? "gif" : mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : null;
    if (!title || !mediaUrl || !media || seen.has(media)) continue;
    seen.add(media);
    const name = title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "").replace(/[_]+/g, " ");
    hits.push({
      url: wikiUrl("commons.wikimedia.org", title),
      title: name,
      source: "Wikimedia Commons",
      sourceId: `commons:${media}`,
      summary: name,
      media,
      mediaUrl,
      obscure: true,
    });
  }
  return hits;
}

export function threadsFromHn(json: unknown): InspirationItem[] {
  const hits = ((json as { hits?: unknown[] } | null)?.hits ?? []).flatMap((raw): Array<InspirationItem & { points: number }> => {
    const hit = raw as { objectID?: unknown; title?: unknown; url?: unknown; points?: unknown };
    const id = String(hit.objectID ?? "");
    const title = typeof hit.title === "string" ? hit.title.replace(/\s+/g, " ").trim() : "";
    if (!id || !title) return [];
    const points = typeof hit.points === "number" ? hit.points : 0;
    const linked = typeof hit.url === "string" ? hit.url : "";
    let host = "";
    try { host = linked ? new URL(linked).hostname.replace(/^www\./, "") : ""; } catch { /* untitled link */ }
    return [{
      url: `https://news.ycombinator.com/item?id=${encodeURIComponent(id)}`,
      title,
      source: "Hacker News",
      sourceId: "hn:thread",
      summary: host ? `Thread about ${host}.` : "The thread itself.",
      media: "thread",
      obscure: true,
      points,
    }];
  });
  // Quieter threads first. The count is a diversity hint, then thrown away.
  return hits.sort((a, b) => a.points - b.points).slice(0, 3).map(({ points: _points, ...item }) => item);
}

async function readJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchPublicUrl(fetchImpl, url, { headers: HEADERS, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return null;
  return response.json();
}

async function fetchInspiration(fetchImpl: typeof fetch, term: string): Promise<InspirationItem[]> {
  const q = encodeURIComponent(term);
  const reads: Array<Promise<InspirationItem[]>> = [
    readJson(fetchImpl, `https://hn.algolia.com/api/v1/search?query=${q}&tags=story&hitsPerPage=8`).then(threadsFromHn).catch(() => []),
    readJson(fetchImpl, `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=${q}&gsrlimit=8&prop=imageinfo&iiprop=url|mime`).then(mediaFromCommons).catch(() => []),
    readJson(fetchImpl, `https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(`${term} statistics`)}&gsrlimit=4&prop=extracts&exintro=1&explaintext=1`).then(statsFromWikipedia).catch(() => []),
    readJson(fetchImpl, `https://en.wikiquote.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${q}&gsrlimit=4&prop=extracts&exintro=1&explaintext=1`).then(quotesFromWikiquote).catch(() => []),
  ];
  return (await Promise.all(reads)).flat();
}

/** One cached pass for the strongest live project or job. A second call inside twenty hours does not fetch. */
export async function gatherInspiration(dir: string, focus: WorkFocus[], options: { now?: Date; fetchImpl?: typeof fetch; search?: (term: string) => Promise<InspirationItem[]> } = {}): Promise<InspirationItem[]> {
  const term = focusTerm(focus);
  const now = options.now ?? new Date();
  let cached: CacheFile | undefined;
  try { cached = JSON.parse(readFileSync(cachePath(dir), "utf8")) as CacheFile; } catch { /* none yet */ }
  if (cached && cached.term === term && Array.isArray(cached.hits) && now.getTime() - Date.parse(cached.at) < TTL_MS) return cached.hits;
  if (!options.search && process.env.VITEST && !options.fetchImpl) return [];
  const hits = options.search ? await options.search(term) : await fetchInspiration(options.fetchImpl ?? globalThis.fetch, term);
  const record: CacheFile = { term, at: now.toISOString(), hits };
  mkdirSync(join(dir, "scout"), { recursive: true });
  writeFileSync(cachePath(dir), JSON.stringify(record));
  return hits;
}
