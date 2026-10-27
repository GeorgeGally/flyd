import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ActivityPanel, ActivityStory } from "./activity.js";
import { fetchPublicUrl, type HostLookup } from "../runtime/url-guard.js";

// A news card's picture is the article's og:image, fetched once and kept beside
// the scout files. The page only ever sees a same-origin path. A missing,
// empty, or non-image response leaves no path, and the card sets type instead.

const HTML_CAP = 800_000;
const IMAGE_CAP = 5_000_000;
const ICON_CAP = 256_000;
const KEEP = 400;

export interface ExtractedMedia {
  image?: string;
  icon?: string;
  published?: string;
  minutes?: number;
}

interface MediaRecord {
  url: string;
  at: string;
  image: "file" | "none";
  imageType?: string;
  icon: "file" | "none";
  iconType?: string;
  clip?: "file" | "none";
  clipType?: string;
  published?: string;
  minutes?: number;
  error?: boolean;
}

type Index = Record<string, MediaRecord>;

/** Stable id for a story URL. Sixteen hex chars, safe as a file name and a query id. */
export function storyKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function mediaDir(dir: string): string {
  return join(dir, "scout", "media");
}

function indexPath(dir: string): string {
  return join(mediaDir(dir), "index.json");
}

function readIndex(dir: string): Index {
  try {
    const parsed = JSON.parse(readFileSync(indexPath(dir), "utf8")) as Index;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeIndex(dir: string, index: Index): void {
  const keys = Object.keys(index);
  if (keys.length > KEEP) {
    const drop = keys.sort((a, b) => Date.parse(index[a]?.at ?? "") - Date.parse(index[b]?.at ?? "")).slice(0, keys.length - KEEP);
    for (const key of drop) delete index[key];
  }
  mkdirSync(mediaDir(dir), { recursive: true });
  writeFileSync(indexPath(dir), JSON.stringify(index));
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  const raw = match?.[2] ?? match?.[3] ?? match?.[4];
  if (raw == null || raw === "") return undefined;
  return raw.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function meta(html: string, key: string): string | undefined {
  const needle = key.toLowerCase();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const prop = (attr(tag, "property") ?? attr(tag, "name") ?? attr(tag, "itemprop") ?? "").toLowerCase();
    if (prop !== needle) continue;
    const content = attr(tag, "content");
    if (content) return content;
  }
  return undefined;
}

function httpUrl(raw: string | undefined, base: string): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const url = new URL(raw.trim(), base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function minutesOf(raw: string): number | undefined {
  const iso = /^PT(?:(\d+)H)?(?:(\d+)M)?/i.exec(raw.trim());
  const minutes = iso && (iso[1] || iso[2]) ? Number(iso[1] ?? 0) * 60 + Number(iso[2] ?? 0) : Number((/(\d{1,3})/.exec(raw) ?? [])[1]);
  return Number.isInteger(minutes) && minutes > 0 && minutes < 400 ? minutes : undefined;
}

function readingMinutes(html: string): number | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = `${attr(tag, "name") ?? ""} ${attr(tag, "property") ?? ""} ${attr(tag, "itemprop") ?? ""}`.toLowerCase();
    if (!/reading|timerequired|time required/.test(key)) continue;
    const got = minutesOf(attr(tag, "content") ?? "");
    if (got) return got;
  }
  const duration = /"timeRequired"\s*:\s*"(PT[^"]+)"/i.exec(html);
  return duration ? minutesOf(duration[1] ?? "") : undefined;
}

function publishedOf(html: string): string | undefined {
  const raw = meta(html, "article:published_time") || meta(html, "og:published_time") || meta(html, "date")
    || /"datePublished"\s*:\s*"([^"]+)"/.exec(html)?.[1];
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function iconHref(html: string): string | undefined {
  let fallback: string | undefined;
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    if (!/\bicon\b/.test(rel)) continue;
    const href = attr(tag, "href");
    if (!href) continue;
    if (rel.includes("apple-touch-icon")) return href;
    fallback ??= href;
  }
  return fallback;
}

/** What the article page itself claims: picture, icon, date, reading time. Relative URLs resolve; anything but http(s) is dropped. */
export function extractStoryMedia(html: string, pageUrl: string): ExtractedMedia {
  const head = html.slice(0, 200_000);
  const image = httpUrl(meta(head, "og:image") || meta(head, "og:image:secure_url") || meta(head, "twitter:image") || meta(head, "twitter:image:src"), pageUrl);
  const icon = httpUrl(iconHref(head), pageUrl);
  const published = publishedOf(head);
  const minutes = readingMinutes(head);
  return { ...(image ? { image } : {}), ...(icon ? { icon } : {}), ...(published ? { published } : {}), ...(minutes ? { minutes } : {}) };
}

/** An image we will keep. SVG and anything that is not a real bitmap is not one, whatever the Content-Type says. */
export function imageKind(contentType: string | null, bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  const declared = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (declared && !declared.startsWith("image/") && declared !== "application/octet-stream") return null;
  if (declared === "image/svg+xml") return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return "image/x-icon";
  return null;
}

async function readCapped(response: Response, max: number): Promise<Buffer | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.length > 0 && bytes.length <= max ? bytes : null;
}

async function pullAsset(fetchImpl: typeof fetch, url: string, max: number, lookup?: HostLookup): Promise<{ type: string; bytes: Buffer } | null> {
  try {
    const response = await fetchPublicUrl(fetchImpl, url, { lookup, headers: { accept: "image/*,*/*;q=0.8" } });
    if (!response.ok) return null;
    const bytes = await readCapped(response, max);
    if (!bytes) return null;
    const type = imageKind(response.headers.get("content-type"), bytes);
    return type ? { type, bytes } : null;
  } catch {
    return null;
  }
}

/** Fetch one article, keep a usable picture and icon, and remember the miss so it is not fetched again. */
export async function collectStoryMedia(dir: string, pageUrl: string, fetchImpl: typeof fetch, lookup?: HostLookup): Promise<MediaRecord> {
  const key = storyKey(pageUrl);
  const previous = readIndex(dir)[key];
  const blank = (error = false): MediaRecord => ({
    url: pageUrl, at: new Date().toISOString(), image: "none", icon: "none", ...(error ? { error } : {}),
    ...(previous?.clip ? { clip: previous.clip, ...(previous.clipType ? { clipType: previous.clipType } : {}) } : {}),
  });
  let record = blank(true);
  try {
    const response = await fetchPublicUrl(fetchImpl, pageUrl, { lookup, headers: { accept: "text/html,image/*;q=0.8" } });
    const bytes = response.ok ? await readCapped(response, HTML_CAP) : null;
    const direct = bytes ? imageKind(response.headers.get("content-type"), bytes) : null;
    if (direct && bytes && direct !== "image/svg+xml") {
      mkdirSync(mediaDir(dir), { recursive: true });
      writeFileSync(join(mediaDir(dir), `${key}.img`), bytes);
      record = { ...blank(false), image: "file", imageType: direct };
      const index = readIndex(dir);
      index[key] = record;
      writeIndex(dir, index);
      return record;
    }
    const found = bytes ? extractStoryMedia(bytes.toString("utf8"), pageUrl) : undefined;
    record = blank(!found);
    if (found?.published) record.published = found.published;
    if (found?.minutes) record.minutes = found.minutes;
    if (found?.image) {
      const image = await pullAsset(fetchImpl, found.image, IMAGE_CAP, lookup);
      if (image) {
        mkdirSync(mediaDir(dir), { recursive: true });
        writeFileSync(join(mediaDir(dir), `${key}.img`), image.bytes);
        record.image = "file";
        record.imageType = image.type;
      }
    }
    if (found?.icon) {
      const icon = await pullAsset(fetchImpl, found.icon, ICON_CAP, lookup);
      if (icon) {
        mkdirSync(mediaDir(dir), { recursive: true });
        writeFileSync(join(mediaDir(dir), `${key}.icon`), icon.bytes);
        record.icon = "file";
        record.iconType = icon.type;
      }
    }
  } catch {
    record = blank(true);
  }
  const index = readIndex(dir);
  index[key] = record;
  writeIndex(dir, index);
  return record;
}

const flying = new Set<string>();
let tail: Promise<void> = Promise.resolve();

export interface ScheduleOptions {
  dir: string;
  fetchImpl?: typeof fetch;
  lookup?: HostLookup;
  onStored?: () => void;
}

/** One article at a time. Under tests nothing is fetched unless a fetch is passed in. */
export function scheduleStoryMedia(urls: string[], options: ScheduleOptions): void {
  if (process.env.VITEST && !options.fetchImpl) return;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const index = readIndex(options.dir);
  for (const url of [...new Set(urls)]) {
    const key = storyKey(url);
    if (flying.has(key) || index[key]) continue;
    flying.add(key);
    tail = tail.then(async () => {
      try {
        await collectStoryMedia(options.dir, url, fetchImpl, options.lookup);
        options.onStored?.();
      } finally {
        flying.delete(key);
      }
    }).catch(() => undefined);
  }
}

function fileReady(dir: string, name: string): boolean {
  try {
    return statSync(join(mediaDir(dir), name)).size > 0;
  } catch {
    return false;
  }
}

function decorateStory(story: ActivityStory, dir: string, record: MediaRecord | undefined, saved: boolean): ActivityStory {
  const key = storyKey(story.url);
  const image = record?.image === "file" && fileReady(dir, `${key}.img`) ? `/api/story-image?id=${key}` : undefined;
  const icon = record?.icon === "file" && fileReady(dir, `${key}.icon`) ? `/api/story-icon?id=${key}` : undefined;
  const clip = story.media === "gif" && record?.clip === "file" && fileReady(dir, `${key}.clip`) ? `/api/story-clip?id=${key}` : undefined;
  if (!image && !icon && !clip && !record?.published && record?.minutes == null && !saved) return story;
  return {
    ...story,
    ...(image ? { image } : {}),
    ...(icon ? { icon } : {}),
    ...(clip ? { clip } : {}),
    ...(record?.published ? { published: record.published } : {}),
    ...(record?.minutes ? { minutes: record.minutes } : {}),
    ...(saved ? { saved: true } : {}),
  };
}

/** GIF urls sitting on an edition, so a card can play the file it already named. */
export function storyClips(raw: unknown): Array<{ url: string; mediaUrl: string }> {
  const items = (raw as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    const row = item as { url?: unknown; mediaUrl?: unknown; media?: unknown };
    if (row.media !== "gif" || typeof row.url !== "string" || typeof row.mediaUrl !== "string") return [];
    if (!/^https?:\/\//i.test(row.url) || !/^https?:\/\//i.test(row.mediaUrl)) return [];
    return [{ url: row.url, mediaUrl: row.mediaUrl }];
  });
}

const CLIP_CAP = 4_000_000;

async function collectStoryClip(dir: string, pageUrl: string, mediaUrl: string, fetchImpl: typeof fetch, lookup?: HostLookup): Promise<void> {
  const key = storyKey(pageUrl);
  const index = readIndex(dir);
  if (index[key]?.clip === "file" || index[key]?.clip === "none") return;
  const asset = await pullAsset(fetchImpl, mediaUrl, CLIP_CAP, lookup);
  const previous = index[key] ?? { url: pageUrl, at: new Date().toISOString(), image: "none" as const, icon: "none" as const };
  const gif = asset?.type === "image/gif";
  if (gif && asset) {
    mkdirSync(mediaDir(dir), { recursive: true });
    writeFileSync(join(mediaDir(dir), `${key}.clip`), asset.bytes);
  }
  index[key] = { ...previous, clip: gif ? "file" : "none", ...(gif && asset ? { clipType: asset.type } : {}) };
  writeIndex(dir, index);
}

/** One GIF at a time, after the picture queue. Under tests nothing is fetched unless a fetch is passed in. */
export function scheduleStoryClips(jobs: Array<{ url: string; mediaUrl: string }>, options: ScheduleOptions): void {
  if (process.env.VITEST && !options.fetchImpl) return;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const index = readIndex(options.dir);
  for (const job of jobs) {
    const key = storyKey(job.url);
    if (flying.has(`${key}:clip`) || index[key]?.clip) continue;
    flying.add(`${key}:clip`);
    tail = tail.then(async () => {
      try {
        await collectStoryClip(options.dir, job.url, job.mediaUrl, fetchImpl, options.lookup);
        options.onStored?.();
      } finally {
        flying.delete(`${key}:clip`);
      }
    }).catch(() => undefined);
  }
}

function savedPath(dir: string): string {
  return join(dir, "scout", "saved.json");
}

function readSaved(dir: string): Set<string> {
  try {
    const parsed = JSON.parse(readFileSync(savedPath(dir), "utf8")) as { urls?: unknown };
    return new Set(Array.isArray(parsed.urls) ? parsed.urls.filter((url): url is string => typeof url === "string") : []);
  } catch {
    return new Set();
  }
}

/** Adds a cached picture, icon, date and reading time onto stories that have them. Stories with nothing cached are unchanged. */
export function applyStoryMedia(panel: ActivityPanel, dir: string): ActivityPanel {
  const index = readIndex(dir);
  const saved = readSaved(dir);
  const map = (stories?: ActivityStory[]): ActivityStory[] | undefined => {
    if (!stories) return stories;
    let changed = false;
    const next = stories.map((story) => {
      const decorated = decorateStory(story, dir, index[storyKey(story.url)], saved.has(story.url));
      if (decorated !== story) changed = true;
      return decorated;
    });
    return changed ? next : stories;
  };
  const now = panel.now.map((item) => {
    const stories = map(item.stories);
    return stories === item.stories ? item : { ...item, stories };
  });
  const recent = panel.recent.map((item) => {
    const stories = map(item.stories);
    return stories === item.stories ? item : { ...item, stories };
  });
  if (now.every((item, i) => item === panel.now[i]) && recent.every((item, i) => item === panel.recent[i])) return panel;
  return { ...panel, now, recent };
}

export function storyUrls(panel: ActivityPanel): string[] {
  return [...panel.now, ...panel.recent].flatMap((item) => (item.stories ?? []).map((story) => story.url));
}

/** Toggle a kept story. Returns whether it is saved after the change. */
export function toggleSavedStory(dir: string, url: string): boolean {
  const saved = readSaved(dir);
  if (saved.has(url)) saved.delete(url);
  else saved.add(url);
  mkdirSync(join(dir, "scout"), { recursive: true });
  writeFileSync(savedPath(dir), JSON.stringify({ urls: [...saved] }));
  return saved.has(url);
}

const KEY = /^[a-f0-9]{16}$/;

/** Bytes for a cached picture or icon, or null when the id is unknown or the bytes are not an image. */
export function storyAsset(dir: string, kind: "image" | "icon" | "clip", id: string): { type: string; bytes: Buffer } | null {
  if (!KEY.test(id)) return null;
  const record = readIndex(dir)[id];
  const ext = kind === "image" ? "img" : kind === "icon" ? "icon" : "clip";
  const kept = kind === "image" ? record?.image === "file" : kind === "icon" ? record?.icon === "file" : record?.clip === "file";
  if (!record || !kept) return null;
  try {
    const bytes = readFileSync(join(mediaDir(dir), `${id}.${ext}`));
    const declared = kind === "image" ? record.imageType : kind === "icon" ? record.iconType : record.clipType;
    const type = imageKind(declared ?? null, bytes);
    return type ? { type, bytes } : null;
  } catch {
    return null;
  }
}
