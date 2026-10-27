import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { quickQuery } from "../lib/llm.js";
import { fetchPublicUrl } from "../runtime/url-guard.js";
import {
  buildDigest, ensureQueryAnchor, expansionPrompt, focusTerm, ngramTerms, termsFromModel,
  type ContextDigest, type InspirationItem, type WorkFocus,
} from "./inspiration.js";

// Free baseline: HN, Wikimedia, Wikipedia, Wikiquote. Keyed sources are skipped
// when the env var is absent. Nothing here recalls a URL or a statistic.
// TLS verification stays on. Names of people are not hard-coded.

export const INSPIRATION_ENV = [
  "GIPHY_API_KEY",
  "PEXELS_API_KEY",
  "REDDIT_CLIENT_ID",
  "REDDIT_API_SECRET",
  "BRAVE_SEARCH_API_KEY",
  "BRAVE_SEARCH_GOGGLES",
] as const;

const HOUR = 3_600_000;
const TTL = {
  digest: 12 * HOUR,
  expansion: 24 * HOUR,
  fresh: HOUR,
  braveStats: 12 * HOUR,
  gif: 8 * HOUR,
  trending: 30 * 60_000,
  images: 8 * HOUR,
  videos: 6 * HOUR,
  quotes: 8 * HOUR,
  data: 12 * HOUR,
};

const UA = "Flyd/1.0 (personal research feed)";

const WORLD_BANK: Array<{ tokens: string[]; id: string; percent: boolean }> = [
  { tokens: ["gdp", "income"], id: "NY.GDP.PCAP.CD", percent: false },
  { tokens: ["emissions", "carbon"], id: "EN.ATM.CO2E.PC", percent: false },
  { tokens: ["unemployment"], id: "SL.UEM.TOTL.ZS", percent: true },
];

const OWID: Array<{ tokens: string[]; slug: string; label: string }> = [
  { tokens: ["population", "census"], slug: "population", label: "World population" },
  { tokens: ["expectancy"], slug: "life-expectancy", label: "Life expectancy" },
  { tokens: ["internet", "broadband"], slug: "share-of-individuals-using-the-internet", label: "Share of people using the internet" },
];

interface Bucket { key: string; at: string; hits: InspirationItem[] }
interface Store {
  randomId?: string;
  giphyCooldownUntil?: string;
  reddit?: { token: string; until: string };
  digest?: { signature: string; at: string; digest: ContextDigest };
  expansion?: { key: string; at: string; terms: string[] };
  buckets: Record<string, Bucket>;
}

interface Fetched { ok: boolean; status: number; text: string; headers: Headers }

function cachePath(dir: string): string { return join(dir, "scout", "inspiration-cache.json"); }
function shownPath(dir: string): string { return join(dir, "scout", "inspiration-shown.json"); }

function emptyStore(): Store { return { buckets: {} }; }

function readStore(dir: string): Store {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(dir), "utf8")) as Store;
    return parsed && typeof parsed === "object" ? { ...emptyStore(), ...parsed, buckets: parsed.buckets ?? {} } : emptyStore();
  } catch {
    return emptyStore();
  }
}

function writeStore(dir: string, store: Store): void {
  try {
    mkdirSync(join(dir, "scout"), { recursive: true });
    writeFileSync(cachePath(dir), JSON.stringify(store));
  } catch { /* a failed cache write still returns the hits */ }
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

/** Persisted per-url last_shown_at. The newest 200 stay; the mixer recycles the oldest. */
export function markShown(dir: string, urls: string[], now: Date): void {
  const current = Object.fromEntries([...readShown(dir)].map(([url, time]) => [url, new Date(time).toISOString()]));
  for (const url of urls) current[url] = now.toISOString();
  const entries = Object.entries(current)
    .sort((a, b) => Date.parse(a[1]) - Date.parse(b[1]))
    .slice(-200);
  mkdirSync(join(dir, "scout"), { recursive: true });
  writeFileSync(shownPath(dir), JSON.stringify(Object.fromEntries(entries)));
}

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
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

/** Drops a year, a leading zero, a citation, and a figure whose newest year is more than four years behind. */
export function acceptStat(text: string, figure: string, now: number): boolean {
  if (/^0\d/.test(figure.trim())) return false;
  const bare = figure.replace(/,/g, "").replace(/\s+/g, "");
  if (/^(?:19|20)\d{2}$/.test(bare)) return false;
  if (/\b(?:doi|issn|et al\.?|journal)\b/i.test(text)) return false;
  const years = [...text.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  if (years.length && Math.max(...years) < new Date(now).getUTCFullYear() - 4) return false;
  return true;
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
  return (parts.find((part) => part.includes(figure)) ?? text).replace(/\s+/g, " ").replace(/\[[0-9]+\]/g, "").trim().slice(0, 180);
}

function wikiUrl(host: string, title: string): string {
  return `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

export function statsFromWikipedia(json: unknown, now = Date.now()): InspirationItem[] {
  const hits: InspirationItem[] = [];
  for (const page of pagesOf(json)) {
    const title = typeof page.title === "string" ? page.title : "";
    const extract = typeof page.extract === "string" ? page.extract : "";
    const figure = figureIn(extract);
    if (!title || title.startsWith("Wikipedia:") || !figure || !acceptStat(extract, figure, now)) continue;
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
  return hits.sort((a, b) => a.points - b.points).slice(0, 3).map(({ points: _points, ...item }) => item);
}

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** The old daily RSS path 404s. This reads the live feed, which still carries ht:news_item. */
export function trendsFromRss(xml: string): InspirationItem[] {
  if (!xml.includes("<item")) return [];
  const hits: InspirationItem[] = [];
  for (const item of xml.split(/<item\b[^>]*>/).slice(1)) {
    if (!item.includes("news_item")) continue;
    const title = decodeXml(item.match(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/)?.[1] ?? "");
    const url = decodeXml(item.match(/<ht:news_item_url>([\s\S]*?)<\/ht:news_item_url>/)?.[1] ?? "");
    const trend = decodeXml(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    if (!title || !/^https:\/\//.test(url)) continue;
    hits.push({
      url,
      title,
      source: "Google Trends",
      sourceId: "trends",
      summary: trend ? `Trending: ${trend}` : title,
      media: "article",
    });
    if (hits.length === 3) break;
  }
  return hits;
}

export function quotesFromZen(json: unknown, query: string): InspirationItem[] {
  const wanted = new Set(query.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length >= 3 && !["the", "and", "for"].includes(word)) ?? []);
  if (!wanted.size || !Array.isArray(json)) return [];
  const hits: InspirationItem[] = [];
  for (const raw of json) {
    const row = raw as { q?: unknown; a?: unknown };
    const quote = typeof row.q === "string" ? row.q.replace(/\s+/g, " ").trim() : "";
    const attribution = typeof row.a === "string" ? row.a.replace(/\s+/g, " ").trim() : "";
    if (quote.length < 20 || quote.length > 280) continue;
    const words = new Set(quote.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    if (![...wanted].some((word) => words.has(word))) continue;
    const id = createHash("sha256").update(quote).digest("hex").slice(0, 12);
    hits.push({
      url: `https://zenquotes.io/#${id}`,
      title: attribution || "ZenQuotes",
      source: "ZenQuotes",
      sourceId: "zenquotes",
      summary: quote,
      media: "quote",
      quote,
      ...(attribution ? { attribution } : {}),
      obscure: true,
    });
    if (hits.length === 2) break;
  }
  return hits;
}

export function gifsFromGiphy(json: unknown): InspirationItem[] {
  const data = (json as { data?: unknown[] } | null)?.data ?? [];
  const hits: InspirationItem[] = [];
  for (const raw of data) {
    const row = raw as { title?: unknown; url?: unknown; images?: { original?: { url?: unknown }; fixed_height?: { url?: unknown } } };
    const page = typeof row.url === "string" ? row.url : "";
    const mediaUrl = typeof row.images?.original?.url === "string" ? row.images.original.url : typeof row.images?.fixed_height?.url === "string" ? row.images.fixed_height.url : "";
    const title = typeof row.title === "string" && row.title.trim() ? row.title.trim() : "GIF";
    if (!page.startsWith("https://") || !mediaUrl.startsWith("https://")) continue;
    hits.push({
      url: page, title, source: "Giphy", sourceId: "giphy", summary: title, media: "gif", mediaUrl, obscure: true,
    });
    if (hits.length === 4) break;
  }
  return hits;
}

export function giphyCooldownUntil(headers: { get(name: string): string | null }, now: number): string {
  const raw = headers.get("x-ratelimit-reset");
  const value = raw ? Number(raw) : NaN;
  let until = now + HOUR;
  if (Number.isFinite(value) && value > 0) until = value > 1_000_000_000 ? value * 1000 : now + value * 1000;
  return new Date(until).toISOString();
}

interface PexelsPhoto { url?: unknown; alt?: unknown; photographer?: unknown; src?: { large?: unknown; landscape?: unknown; original?: unknown } }

export function imagesFromPexels(json: unknown): InspirationItem[] {
  const photos = ((json as { photos?: PexelsPhoto[] } | null)?.photos ?? []);
  const hits: InspirationItem[] = [];
  for (const photo of photos) {
    const url = typeof photo.url === "string" ? photo.url : "";
    const mediaUrl = [photo.src?.landscape, photo.src?.large, photo.src?.original].find((value): value is string => typeof value === "string" && value.startsWith("https://"));
    if (!url.startsWith("https://") || !mediaUrl) continue;
    const title = typeof photo.alt === "string" && photo.alt.trim() ? photo.alt.trim() : "Photo";
    const photographer = typeof photo.photographer === "string" ? photo.photographer.trim() : "";
    hits.push({
      url, title: title.slice(0, 140), source: "Pexels", sourceId: "pexels:image",
      summary: photographer ? `Photo by ${photographer}.` : title, media: "image", mediaUrl, obscure: true,
    });
    if (hits.length === 4) break;
  }
  return hits;
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function videosFromPexels(json: unknown): InspirationItem[] {
  const videos = ((json as { videos?: Array<Record<string, unknown>> } | null)?.videos ?? []);
  const hits: InspirationItem[] = [];
  for (const video of videos) {
    const url = typeof video.url === "string" ? video.url : "";
    const files = Array.isArray(video.video_files) ? video.video_files as Array<{ quality?: unknown; file_type?: unknown; link?: unknown; width?: unknown }> : [];
    const mp4 = files.filter((file) => file.file_type === "video/mp4" && typeof file.link === "string");
    const hd = mp4.find((file) => file.quality === "hd") ?? mp4.sort((a, b) => Number(b.width ?? 0) - Number(a.width ?? 0))[0];
    const mediaUrl = typeof hd?.link === "string" ? hd.link : "";
    if (!url.startsWith("https://") || !mediaUrl.startsWith("https://")) continue;
    const user = video.user as { name?: unknown } | undefined;
    const name = typeof user?.name === "string" ? user.name : "Pexels";
    const duration = typeof video.duration === "number" ? clock(video.duration) : "";
    const title = typeof video.url === "string" ? `Video by ${name}` : "Video";
    hits.push({
      url, title, source: "Pexels", sourceId: "pexels:video",
      summary: duration ? `${duration} · ${name}` : name, media: "video", mediaUrl, obscure: true,
    });
    if (hits.length === 3) break;
  }
  return hits;
}

/** Permalink URLs only. A row with no permalink is dropped, never invented. */
export function threadsFromReddit(json: unknown): InspirationItem[] {
  const children = (json as { data?: { children?: unknown[] } } | null)?.data?.children ?? [];
  const hits: InspirationItem[] = [];
  for (const raw of children) {
    const data = (raw as { data?: Record<string, unknown> }).data ?? {};
    const permalink = typeof data.permalink === "string" ? data.permalink : "";
    const title = typeof data.title === "string" ? data.title.replace(/\s+/g, " ").trim() : "";
    if (!title || !permalink.startsWith("/r/") || !permalink.includes("/comments/")) continue;
    const subreddit = typeof data.subreddit === "string" ? data.subreddit : "";
    const author = typeof data.author === "string" ? data.author : "";
    hits.push({
      url: `https://www.reddit.com${permalink}`,
      title,
      source: subreddit ? `r/${subreddit}` : "Reddit",
      sourceId: "reddit",
      summary: [subreddit ? `r/${subreddit}` : "", author ? `by ${author}` : ""].filter(Boolean).join(" "),
      media: "thread",
      obscure: true,
    });
    if (hits.length === 2) break;
  }
  return hits;
}

function listicle(title: string): boolean {
  return /^\s*\d+\s+(?:best|ways|things|reasons|tips)\b/i.test(title) || /\blist of\b/i.test(title);
}

function stripSite(title: string): string {
  return title.replace(/\s+[-|–—]\s+[^-|–—]+$/, "").replace(/\s+/g, " ").trim();
}

function publishedFromAge(age: string | undefined, now: number): string | undefined {
  const match = age?.match(/(\d+)\s+(minute|hour|day|week)/i);
  if (!match) return undefined;
  const count = Number(match[1]);
  const unit = match[2].toLowerCase();
  const scale = unit.startsWith("minute") ? 60_000 : unit.startsWith("hour") ? HOUR : unit.startsWith("day") ? 86_400_000 : 7 * 86_400_000;
  return new Date(now - count * scale).toISOString();
}

function braveResults(json: unknown): Array<Record<string, unknown>> {
  const root = json as { results?: unknown[]; web?: { results?: unknown[] } } | null;
  const rows = root?.results ?? root?.web?.results ?? [];
  return rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
}

export function newsFromBrave(json: unknown, now = Date.now()): InspirationItem[] {
  const hits: Array<{ item: InspirationItem; tier: number }> = [];
  const seen = new Set<string>();
  for (const row of braveResults(json)) {
    const url = typeof row.url === "string" ? row.url : "";
    const rawTitle = typeof row.title === "string" ? row.title : "";
    const title = stripSite(rawTitle);
    if (!url.startsWith("https://") || !title || seen.has(url) || listicle(title)) continue;
    seen.add(url);
    const description = typeof row.description === "string" ? row.description.trim() : "";
    const snippets = Array.isArray(row.extra_snippets) ? row.extra_snippets.filter((snippet): snippet is string => typeof snippet === "string") : [];
    const snippet = snippets[0]?.trim() ?? "";
    const summary = description.length > 50 ? description : snippet ? snippet.charAt(0).toUpperCase() + snippet.slice(1) : description;
    const age = typeof row.age === "string" ? row.age : undefined;
    const published = publishedFromAge(age, now);
    const ageMs = published ? now - Date.parse(published) : Number.POSITIVE_INFINITY;
    const tier = ageMs < 86_400_000 ? 20 : ageMs < 3 * 86_400_000 ? 12 : ageMs < 7 * 86_400_000 ? 7 : ageMs < 14 * 86_400_000 ? 3 : 1;
    hits.push({
      item: {
        url, title, source: "Brave", sourceId: "brave:news", summary: summary.slice(0, 280), media: "article",
        ...(published ? { published } : {}),
      },
      tier,
    });
  }
  return hits.sort((a, b) => b.tier - a.tier).map((row) => row.item);
}

export function statsFromBrave(json: unknown, now = Date.now()): InspirationItem[] {
  const hits: InspirationItem[] = [];
  for (const row of braveResults(json)) {
    const url = typeof row.url === "string" ? row.url : "";
    const title = typeof row.title === "string" ? stripSite(row.title) : "";
    const description = typeof row.description === "string" ? row.description : "";
    const text = `${title} ${description}`;
    const figure = figureIn(text);
    if (!url.startsWith("https://") || !title || !figure || !acceptStat(text, figure, now)) continue;
    let host = "";
    try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { host = ""; }
    hits.push({
      url, title, source: host || "Web", sourceId: "brave:stat", summary: sentenceWith(text, figure),
      media: "stat", figure, obscure: true,
    });
    if (hits.length === 3) break;
  }
  return hits;
}

function figureFromRaw(raw: string, percent: boolean): string | undefined {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(cleaned) || /^0\d/.test(cleaned)) return undefined;
  if (/^(?:19|20)\d{2}$/.test(cleaned)) return undefined;
  const negative = cleaned.startsWith("-");
  const [whole, frac] = cleaned.replace(/^-/, "").split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const shown = `${negative ? "-" : ""}${frac ? `${withCommas}.${frac}` : withCommas}`;
  return percent ? `${shown}%` : shown;
}

export function statsFromWorldBank(json: unknown, now = Date.now()): InspirationItem[] {
  const rows = Array.isArray(json) ? json[1] : undefined;
  if (!Array.isArray(rows)) return [];
  const hits: InspirationItem[] = [];
  for (const raw of rows) {
    const row = raw as { value?: unknown; date?: unknown; indicator?: { id?: unknown; value?: unknown }; country?: { value?: unknown } };
    if (typeof row.value !== "number" || !Number.isFinite(row.value)) continue;
    const id = typeof row.indicator?.id === "string" ? row.indicator.id : "";
    const label = typeof row.indicator?.value === "string" ? row.indicator.value : "";
    const country = typeof row.country?.value === "string" ? row.country.value : "";
    const date = typeof row.date === "string" ? row.date : "";
    const year = Number(date);
    if (!id || !label || !Number.isFinite(year) || year < new Date(now).getUTCFullYear() - 4) continue;
    const figure = figureFromRaw(String(row.value), id.endsWith(".ZS"));
    if (!figure) continue;
    hits.push({
      url: `https://data.worldbank.org/indicator/${encodeURIComponent(id)}`,
      title: label,
      source: "World Bank",
      sourceId: "worldbank",
      summary: `${label}, ${country || "World"}, ${date}.`,
      media: "stat",
      figure,
      published: `${date}-01-01`,
      obscure: true,
    });
  }
  return hits;
}

function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"" && line[i + 1] === "\"") { current += "\""; i += 1; continue; }
    if (char === "\"") { quoted = !quoted; continue; }
    if (char === "," && !quoted) { cells.push(current); current = ""; continue; }
    current += char;
  }
  cells.push(current);
  return cells;
}

/** A number is emitted only when a World row in this CSV has one. HTML or a short file yields nothing. */
export function statsFromOwidCsv(csv: string, slug: string, label: string, now = Date.now()): InspirationItem[] {
  if (!csv.includes(",") || csv.trimStart().startsWith("<") || csv.length < 40) return [];
  const lines = csv.trim().split(/\r?\n/);
  const header = splitCsv(lines[0] ?? "").map((cell) => cell.trim().toLowerCase());
  const entityI = header.indexOf("entity");
  const yearI = header.indexOf("year");
  const valueI = header.findIndex((cell, index) => index !== entityI && index !== yearI && cell !== "code" && !cell.endsWith("original_year"));
  if (entityI < 0 || yearI < 0 || valueI < 0) return [];
  let best: { year: number; value: string } | undefined;
  for (const line of lines.slice(1)) {
    const cols = splitCsv(line);
    if (cols[entityI]?.trim() !== "World") continue;
    const year = Number(cols[yearI]);
    const value = cols[valueI]?.trim() ?? "";
    if (!Number.isFinite(year) || !/^-?\d/.test(value)) continue;
    if (!best || year > best.year) best = { year, value };
  }
  if (!best || best.year < new Date(now).getUTCFullYear() - 4) return [];
  const figure = figureFromRaw(best.value, false);
  if (!figure) return [];
  return [{
    url: `https://ourworldindata.org/grapher/${slug}`,
    title: label,
    source: "Our World in Data",
    sourceId: "owid",
    summary: `${label} for the world in ${best.year}.`,
    media: "stat",
    figure,
    published: `${best.year}-01-01`,
    obscure: true,
  }];
}

function matchedSeries<T extends { tokens: string[] }>(table: T[], text: string): T | undefined {
  const words = new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  return table.find((row) => row.tokens.some((token) => words.has(token)));
}

async function fetchText(fetchImpl: typeof fetch, url: string, options: { headers?: Record<string, string>; timeout?: number; method?: "GET" | "POST"; body?: string } = {}): Promise<Fetched | null> {
  try {
    const response = await fetchPublicUrl(fetchImpl, url, {
      headers: { "user-agent": UA, accept: "application/json", ...options.headers },
      signal: AbortSignal.timeout(options.timeout ?? 8_000),
      ...(options.method === "POST" ? { method: "POST" as const, body: options.body ?? "" } : {}),
    });
    return { ok: response.ok, status: response.status, text: await response.text(), headers: response.headers };
  } catch {
    return null;
  }
}

async function readJson(fetchImpl: typeof fetch, url: string, headers?: Record<string, string>): Promise<unknown> {
  const response = await fetchText(fetchImpl, url, headers ? { headers } : {});
  if (!response?.ok) return null;
  try { return JSON.parse(response.text) as unknown; } catch { return null; }
}

function cachedBucket(store: Store, name: string, key: string, ttl: number, now: Date): InspirationItem[] | undefined {
  const hit = store.buckets[name];
  if (hit && hit.key === key && Array.isArray(hit.hits) && now.getTime() - Date.parse(hit.at) < ttl) return hit.hits;
  return undefined;
}

function saveBucket(dir: string, store: Store, name: string, key: string, hits: InspirationItem[], now: Date): InspirationItem[] {
  store.buckets[name] = { key, at: now.toISOString(), hits };
  writeStore(dir, store);
  return hits;
}

function stableId(store: Store, dir: string): string {
  if (store.randomId) return store.randomId;
  store.randomId = createHash("sha256").update(randomBytes(16)).digest("hex").slice(0, 16);
  writeStore(dir, store);
  return store.randomId;
}

/** One cheap call, cached 24h on the digest signature. A failure uses the n-gram fallback. */
export async function expandQuery(dir: string, query: string, digest: ContextDigest, options: {
  now?: Date;
  destination?: string;
  ask?: (prompt: string) => Promise<string>;
  log?: (line: string) => void;
} = {}): Promise<string[]> {
  const now = options.now ?? new Date();
  const destination = options.destination ?? "news";
  const key = `${digest.signature}|${destination}|${query}`;
  const store = readStore(dir);
  const cached = store.expansion;
  if (cached && cached.key === key && Array.isArray(cached.terms) && now.getTime() - Date.parse(cached.at) < TTL.expansion) return cached.terms;
  const prompt = expansionPrompt(query, digest, destination);
  const log = options.log ?? ((line: string) => console.info(line));
  let terms: string[];
  const ask = options.ask ?? (process.env.VITEST ? undefined : (text: string) => quickQuery(text, {
    json: true, maxTokens: 200, source: "inspiration-expand",
    system: "You write short search terms. Return JSON only.",
  }));
  if (!ask) terms = ngramTerms(digest, query, now.getTime());
  else {
    try {
      const raw = await ask(prompt);
      const inputTokens = Math.ceil(prompt.length / 4);
      const outputTokens = Math.ceil(raw.length / 4);
      const usd = (inputTokens * 0.25 + outputTokens * 1.25) / 1_000_000;
      log(`inspiration expansion est_tokens=${inputTokens}+${outputTokens} est_usd=${usd.toFixed(5)} rate=$0.25/$1.25 per Mtok (chars/4, not a bill)`);
      const modeled = termsFromModel(raw, query);
      terms = modeled.length > 1 ? modeled : ensureQueryAnchor(query, ngramTerms(digest, query, now.getTime()).slice(1));
    } catch {
      terms = ngramTerms(digest, query, now.getTime());
    }
  }
  store.expansion = { key, at: now.toISOString(), terms };
  writeStore(dir, store);
  return terms;
}

async function fetchGiphy(fetchImpl: typeof fetch, dir: string, store: Store, term: string, now: Date): Promise<InspirationItem[]> {
  const key = env("GIPHY_API_KEY");
  if (!key) return [];
  if (store.giphyCooldownUntil && Date.parse(store.giphyCooldownUntil) > now.getTime()) return [];
  const cacheKey = term.slice(0, 50);
  const cached = cachedBucket(store, "giphy", cacheKey, TTL.gif, now);
  if (cached) return cached;
  const randomId = stableId(store, dir);
  const q = encodeURIComponent(term.slice(0, 50));
  const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(key)}&q=${q}&limit=8&offset=0&rating=pg-13&lang=en&bundle=messaging_non_clips&remove_low_contrast=1&random_id=${randomId}`;
  const response = await fetchText(fetchImpl, url);
  if (response?.status === 429) {
    store.giphyCooldownUntil = giphyCooldownUntil(response.headers, now.getTime());
    writeStore(dir, store);
    return [];
  }
  if (!response?.ok) return [];
  let hits: InspirationItem[] = [];
  try { hits = gifsFromGiphy(JSON.parse(response.text) as unknown); } catch { hits = []; }
  if (hits.length) return saveBucket(dir, store, "giphy", cacheKey, hits, now);
  const trendKey = "trending";
  const trending = cachedBucket(store, "giphy-trending", trendKey, TTL.trending, now);
  if (trending) return trending;
  const offset = Number.parseInt(randomId.slice(0, 2), 16) % 51;
  const trendUrl = `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(key)}&limit=8&offset=${offset}&rating=pg-13&random_id=${randomId}`;
  const trend = await fetchText(fetchImpl, trendUrl);
  if (trend?.status === 429) {
    store.giphyCooldownUntil = giphyCooldownUntil(trend.headers, now.getTime());
    writeStore(dir, store);
    return [];
  }
  if (!trend?.ok) return [];
  try { hits = gifsFromGiphy(JSON.parse(trend.text) as unknown); } catch { hits = []; }
  return saveBucket(dir, store, "giphy-trending", trendKey, hits, now);
}

async function fetchPexels(fetchImpl: typeof fetch, dir: string, store: Store, term: string, now: Date, kind: "image" | "video"): Promise<InspirationItem[]> {
  const key = env("PEXELS_API_KEY");
  if (!key) return [];
  const name = kind === "image" ? "pexels-photo" : "pexels-video";
  const cached = cachedBucket(store, name, term, kind === "image" ? TTL.images : TTL.videos, now);
  if (cached) return cached;
  const path = kind === "image"
    ? `https://api.pexels.com/v1/search?query=${encodeURIComponent(term)}&per_page=6&orientation=landscape`
    : `https://api.pexels.com/videos/search?query=${encodeURIComponent(term)}&per_page=4`;
  const response = await fetchText(fetchImpl, path, { headers: { authorization: key } });
  if (!response?.ok) return [];
  let hits: InspirationItem[] = [];
  try { hits = kind === "image" ? imagesFromPexels(JSON.parse(response.text) as unknown) : videosFromPexels(JSON.parse(response.text) as unknown); } catch { hits = []; }
  return saveBucket(dir, store, name, term, hits, now);
}

async function fetchReddit(fetchImpl: typeof fetch, dir: string, store: Store, term: string, now: Date): Promise<InspirationItem[]> {
  const id = env("REDDIT_CLIENT_ID");
  const secret = env("REDDIT_API_SECRET");
  if (!id || !secret) return [];
  const cached = cachedBucket(store, "reddit", term, TTL.fresh, now);
  if (cached) return cached;
  let token = store.reddit && Date.parse(store.reddit.until) > now.getTime() ? store.reddit.token : "";
  if (!token) {
    const basic = Buffer.from(`${id}:${secret}`).toString("base64");
    const exchanged = await fetchText(fetchImpl, "https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      body: "grant_type=client_credentials",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
    });
    if (!exchanged?.ok) return [];
    try {
      const body = JSON.parse(exchanged.text) as { access_token?: unknown; expires_in?: unknown };
      token = typeof body.access_token === "string" ? body.access_token : "";
      const expires = typeof body.expires_in === "number" ? body.expires_in : 3600;
      if (token) {
        store.reddit = { token, until: new Date(now.getTime() + Math.max(60, expires - 60) * 1000).toISOString() };
        writeStore(dir, store);
      }
    } catch { return []; }
  }
  if (!token) return [];
  const response = await fetchText(fetchImpl, `https://oauth.reddit.com/search?q=${encodeURIComponent(term)}&limit=5&sort=hot&type=link`, {
    headers: { authorization: `Bearer ${token}`, "user-agent": UA },
  });
  if (!response?.ok) return [];
  let hits: InspirationItem[] = [];
  try { hits = threadsFromReddit(JSON.parse(response.text) as unknown); } catch { hits = []; }
  return saveBucket(dir, store, "reddit", term, hits, now);
}

async function fetchBrave(fetchImpl: typeof fetch, dir: string, store: Store, term: string, now: Date, log: (line: string) => void): Promise<InspirationItem[]> {
  const key = env("BRAVE_SEARCH_API_KEY");
  if (!key) return [];
  const headers = { "x-subscription-token": key, accept: "application/json" };
  const hits: InspirationItem[] = [];
  const goggles = env("BRAVE_SEARCH_GOGGLES").split(",").map((goggle) => goggle.trim()).filter(Boolean).slice(0, 2);
  const newsKey = `${term}|${goggles.join("|")}`;
  const cachedNews = cachedBucket(store, "brave-news", newsKey, TTL.fresh, now);
  if (cachedNews) hits.push(...cachedNews);
  else {
    const queries = goggles.length ? goggles.map((goggle) => `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(term)}&count=5&freshness=pm&extra_snippets=true&goggles=${encodeURIComponent(goggle)}`) : [`https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(term)}&count=5&freshness=pm&extra_snippets=true`];
    log(`inspiration brave news requests=${queries.length} (billed by the Brave plan, not estimated here)`);
    const news: InspirationItem[] = [];
    for (const url of queries) {
      const response = await fetchText(fetchImpl, url, { headers, timeout: 5_000 });
      if (!response?.ok) continue;
      try { news.push(...newsFromBrave(JSON.parse(response.text) as unknown, now.getTime())); } catch { /* skip a bad body */ }
    }
    hits.push(...saveBucket(dir, store, "brave-news", newsKey, news, now));
  }
  const statsKey = term;
  const cachedStats = cachedBucket(store, "brave-stats", statsKey, TTL.braveStats, now);
  if (cachedStats) hits.push(...cachedStats);
  else {
    log("inspiration brave stats requests=1 (billed by the Brave plan, not estimated here)");
    const response = await fetchText(fetchImpl, `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(`${term} statistics data report`)}&count=3`, { headers, timeout: 5_000 });
    let stats: InspirationItem[] = [];
    if (response?.ok) {
      try { stats = statsFromBrave(JSON.parse(response.text) as unknown, now.getTime()); } catch { stats = []; }
    }
    hits.push(...saveBucket(dir, store, "brave-stats", statsKey, stats, now));
  }
  return hits;
}

async function fetchBaseline(fetchImpl: typeof fetch, dir: string, store: Store, terms: string[], signature: string, now: Date): Promise<InspirationItem[]> {
  const term = terms[0] ?? "";
  const key = `${signature}|${terms.join("|")}`;
  const jobs: Array<{ name: string; ttl: number; load: () => Promise<InspirationItem[]> }> = [];
  const take = (name: string, ttl: number, load: () => Promise<InspirationItem[]>): void => { jobs.push({ name, ttl, load }); };
  take("hn", TTL.fresh, async () => {
    const batches = await Promise.all(terms.slice(0, 3).map((one) => readJson(fetchImpl, `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(one)}&tags=story&hitsPerPage=8`).then(threadsFromHn)));
    return batches.flat();
  });
  take("commons", TTL.images, async () => mediaFromCommons(await readJson(fetchImpl, `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(term)}&gsrlimit=8&prop=imageinfo&iiprop=url|mime`)));
  take("wiki", TTL.data, async () => statsFromWikipedia(await readJson(fetchImpl, `https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(`${term} statistics`)}&gsrlimit=4&prop=extracts&exintro=1&explaintext=1`), now.getTime()));
  take("wikiquote", TTL.quotes, async () => quotesFromWikiquote(await readJson(fetchImpl, `https://en.wikiquote.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(term)}&gsrlimit=4&prop=extracts&exintro=1&explaintext=1`)));
  take("zen", TTL.quotes, async () => quotesFromZen(await readJson(fetchImpl, "https://zenquotes.io/api/quotes"), term));
  take("trends", TTL.fresh, async () => {
    const response = await fetchText(fetchImpl, "https://trends.google.com/trending/rss?geo=US", { headers: { accept: "application/rss+xml, text/xml, */*" } });
    return response?.ok ? trendsFromRss(response.text) : [];
  });
  const joined = terms.join(" ");
  const bank = matchedSeries(WORLD_BANK, joined);
  if (bank) {
    take(`worldbank:${bank.id}`, TTL.data, async () => statsFromWorldBank(await readJson(fetchImpl, `https://api.worldbank.org/v2/country/WLD/indicator/${bank.id}?format=json&mrv=1`), now.getTime()));
  }
  const owid = matchedSeries(OWID, joined);
  if (owid) {
    take(`owid:${owid.slug}`, TTL.data, async () => {
      const response = await fetchText(fetchImpl, `https://ourworldindata.org/grapher/${owid.slug}.csv?csvType=filtered&useColumnShortNames=true`, { headers: { accept: "text/csv" } });
      return response?.ok ? statsFromOwidCsv(response.text, owid.slug, owid.label, now.getTime()) : [];
    });
  }
  const found = await Promise.all(jobs.map(async (job) => {
    const cached = cachedBucket(store, job.name, key, job.ttl, now);
    if (cached) return cached;
    try { return saveBucket(dir, store, job.name, key, await job.load(), now); } catch { return saveBucket(dir, store, job.name, key, [], now); }
  }));
  return found.flat();
}

/** Cached finds for his open jobs. Under tests, returns nothing unless a search or fetch is injected. */
export async function gatherInspiration(dir: string, focus: WorkFocus[], options: {
  now?: Date;
  fetchImpl?: typeof fetch;
  search?: (term: string) => Promise<InspirationItem[]>;
  ask?: (prompt: string) => Promise<string>;
  log?: (line: string) => void;
} = {}): Promise<InspirationItem[]> {
  const now = options.now ?? new Date();
  const built = buildDigest(focus);
  const store = readStore(dir);
  const digest = store.digest && store.digest.signature === built.signature && now.getTime() - Date.parse(store.digest.at) < TTL.digest
    ? store.digest.digest
    : built;
  if (!store.digest || store.digest.signature !== digest.signature) {
    store.digest = { signature: digest.signature, at: now.toISOString(), digest };
    writeStore(dir, store);
  }
  const term = focusTerm(focus);
  if (options.search) {
    const cached = cachedBucket(store, "search", `${digest.signature}|${term}`, TTL.digest, now);
    if (cached) return cached;
    const hits = await options.search(term);
    return saveBucket(dir, store, "search", `${digest.signature}|${term}`, hits, now);
  }
  if (process.env.VITEST && !options.fetchImpl) return [];
  const terms = await expandQuery(dir, term, digest, { now, ...(options.ask ? { ask: options.ask } : {}), ...(options.log ? { log: options.log } : {}) });
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const log = options.log ?? ((line: string) => console.info(line));
  const freshStore = readStore(dir);
  const [baseline, giphy, photos, videos, reddit, brave] = await Promise.all([
    fetchBaseline(fetchImpl, dir, freshStore, terms, digest.signature, now),
    fetchGiphy(fetchImpl, dir, freshStore, terms[0] ?? term, now),
    fetchPexels(fetchImpl, dir, freshStore, terms[0] ?? term, now, "image"),
    fetchPexels(fetchImpl, dir, freshStore, terms[0] ?? term, now, "video"),
    fetchReddit(fetchImpl, dir, freshStore, terms[0] ?? term, now),
    fetchBrave(fetchImpl, dir, freshStore, terms[0] ?? term, now, log),
  ]);
  return [...baseline, ...giphy, ...photos, ...videos, ...reddit, ...brave];
}
