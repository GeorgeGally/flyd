import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchPublicUrl, type HostLookup } from "../runtime/url-guard.js";
import { shortConversationTitle } from "./session-title.js";
import { storyKey } from "./story-media.js";
import type { SessionSummary } from "./types.js";

// One article, read once, then the conversation about it. The text is evidence
// for that thread. It is not instructions, and it is not saved as memory.

const HTML_CAP = 800_000;
const TEXT_CAP = 12_000;
const ARTICLE_SESSION = /^window:article-([a-f0-9]{16})$/;

export const ARTICLE_STARTERS = ["What's new here?", "How does this apply to Flyd?"];

export interface ArticleText {
  title: string;
  url: string;
  text: string;
}

interface ArticleCache {
  url: string;
  title: string;
  text: string;
  starters: string[];
  at: string;
  error?: boolean;
  media?: string;
}

interface ChatIndex {
  [sessionId: string]: { url: string; title: string; at: string; label?: string };
}

export function articleSessionId(url: string): string {
  return `window:article-${storyKey(url)}`;
}

export function isArticleSession(sessionId: string | undefined): boolean {
  return ARTICLE_SESSION.test(sessionId ?? "") || /:window:article-[a-f0-9]{16}$/.test(sessionId ?? "");
}

function articleKey(sessionId: string): string | undefined {
  return /window:article-([a-f0-9]{16})$/.exec(sessionId)?.[1];
}

function articlesDir(dir: string): string {
  return join(dir, "scout", "articles");
}

function cachePath(dir: string, key: string): string {
  return join(articlesDir(dir), `${key}.json`);
}

function chatsPath(dir: string): string {
  return join(articlesDir(dir), "chats.json");
}

function readCache(dir: string, key: string): ArticleCache | undefined {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(dir, key), "utf8")) as ArticleCache;
    if (parsed && typeof parsed.url === "string" && typeof parsed.text === "string" && Array.isArray(parsed.starters)) return parsed;
  } catch { /* not read yet */ }
  return undefined;
}

function writeCache(dir: string, key: string, record: ArticleCache): void {
  mkdirSync(articlesDir(dir), { recursive: true });
  writeFileSync(cachePath(dir, key), JSON.stringify(record));
}

function readChats(dir: string): ChatIndex {
  try {
    const parsed = JSON.parse(readFileSync(chatsPath(dir), "utf8")) as ChatIndex;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeChats(dir: string, index: ChatIndex): void {
  mkdirSync(articlesDir(dir), { recursive: true });
  writeFileSync(chatsPath(dir), JSON.stringify(index));
}

function decode(value: string): string {
  return value
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  const raw = match?.[2] ?? match?.[3] ?? match?.[4];
  return raw ? decode(raw).trim() : undefined;
}

function meta(html: string, key: string): string | undefined {
  const needle = key.toLowerCase();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const prop = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
    if (prop === needle) return attr(tag, "content");
  }
  return undefined;
}

function regions(html: string, tag: string): string[] {
  const found: string[] = [];
  const open = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = open.exec(html))) {
    const token = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    token.lastIndex = match.index + match[0].length;
    let depth = 1;
    let close: RegExpExecArray | null;
    while ((close = token.exec(html))) {
      depth += close[1] ? -1 : 1;
      if (depth === 0) {
        found.push(html.slice(match.index + match[0].length, close.index));
        open.lastIndex = close.index + close[0].length;
        break;
      }
    }
    if (depth !== 0) break;
  }
  return found;
}

function toText(html: string): string {
  return decode(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

/** The article body, with the chrome taken off. A long <article> or <main> wins; otherwise the page. */
export function extractArticleText(html: string): { title: string; text: string } {
  const head = html.slice(0, 200_000);
  const title = (meta(head, "og:title") || meta(head, "twitter:title") || head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
    .replace(/\s+/g, " ").trim();
  const candidates = [...regions(html, "article"), ...regions(html, "main")];
  const best = candidates.map(toText).sort((a, b) => b.length - a.length)[0];
  const text = (best && best.length > 280 ? best : toText(html.replace(/<head[\s\S]*?<\/head>/i, " "))).slice(0, TEXT_CAP);
  return { title: title.slice(0, 300), text };
}

/** Captions already in the page. A timed-text file or a transcript block. Nothing invented. */
export function extractTranscript(html: string): string | null {
  const block = html.match(/<(?:div|section|article)[^>]*(?:id|class)="[^"]*transcript[^"]*"[^>]*>([\s\S]*?)<\/(?:div|section|article)>/i);
  const fromBlock = block ? toText(block[1] ?? "") : "";
  if (fromBlock.length > 40) return fromBlock.slice(0, TEXT_CAP);
  if (!/WEBVTT/.test(html)) return null;
  const cues = html
    .split(/\n+/)
    .filter((line) => line.trim() && !/^WEBVTT|^NOTE|^STYLE|^[\d:.]+ --> /.test(line.trim()) && !/^\d+$/.test(line.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return cues.length > 40 ? cues.slice(0, TEXT_CAP) : null;
}

export function missingTranscript(title: string, description = ""): string {
  return ["No transcript is available for this video.", title.trim(), description.trim()].filter(Boolean).join("\n\n");
}

const SUPPLIED_MEDIA = new Set(["quote", "stat", "thread", "image", "gif"]);

function clipText(value: string | undefined, max: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanStarters(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const questions: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const text = item.replace(/\s+/g, " ").trim();
    if (text.length < 8 || text.length > 120 || !text.endsWith("?")) continue;
    if (/https?:|<[a-z]|ignore (?:all|previous)|system prompt|\btool\b/i.test(text)) continue;
    questions.push(text);
    if (questions.length === 3) break;
  }
  return questions;
}

async function starterQuestions(article: { title: string; text: string }, ask: (prompt: string) => Promise<string>): Promise<string[]> {
  if (!article.text.trim()) return ARTICLE_STARTERS;
  try {
    const raw = await ask([
      `Title: ${article.title}`,
      article.text.slice(0, 1_500),
      "Write two short questions George might ask about this article. One about what is new in it. One about how it applies to his work.",
      "Reply with a JSON array of two strings. Each is one question ending in ?. Nothing else.",
    ].join("\n\n"));
    const parsed = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] ?? "[]") as unknown;
    const questions = cleanStarters(parsed);
    return questions.length ? questions : ARTICLE_STARTERS;
  } catch {
    return ARTICLE_STARTERS;
  }
}

export interface ReadArticleOptions {
  fetchImpl?: typeof fetch;
  lookup?: HostLookup;
  /** Cheap question writer. Under tests, omitted, so the starters stay the two defaults and nothing is called. */
  ask?: (prompt: string) => Promise<string>;
  title?: string;
  /** quote, stat, thread, image, gif, or video. An article is fetched as a page. */
  media?: string;
  /** Words already on the card: the quote, the stat, the thread line. Not a transcript. */
  text?: string;
  description?: string;
  /** Read a page whose text could not be read before again instead of answering from an empty article. */
  refresh?: boolean;
}

/** Read the article once and keep the text and the starter questions beside it. A second call does not fetch. */
export async function readArticle(dir: string, pageUrl: string, options: ReadArticleOptions = {}): Promise<ArticleCache> {
  const key = storyKey(pageUrl);
  const cached = readCache(dir, key);
  if (cached && !(options.refresh && !cached.text.trim())) return cached;
  const media = options.media ?? cached?.media ?? "article";
  const blank = (error: boolean, title = options.title?.trim() || "", text = ""): ArticleCache => ({
    url: pageUrl, title, text, media, starters: ARTICLE_STARTERS, at: new Date().toISOString(), ...(error || !text ? { error: true } : {}),
  });
  const store = async (record: ArticleCache): Promise<ArticleCache> => {
    const reuse = options.refresh && cached ? cached.starters : null;
    const ask = reuse ? undefined : options.ask ?? (process.env.VITEST || !record.text ? undefined : await liveAsk());
    const starters = reuse ?? (ask ? await starterQuestions({ title: record.title, text: record.text }, ask) : ARTICLE_STARTERS);
    const stored = { ...record, starters };
    writeCache(dir, key, stored);
    return stored;
  };
  const supplied = clipText(options.text, 4_000);
  if (SUPPLIED_MEDIA.has(media) && (supplied || media === "gif")) {
    const title = options.title?.trim() || "";
    const text = media === "gif"
      ? ["This is a GIF. There is no article text and no transcript.", title, clipText(options.description, 500) || supplied].filter(Boolean).join("\n\n")
      : supplied;
    return store({ url: pageUrl, title, text, starters: ARTICLE_STARTERS, at: new Date().toISOString(), ...(!text ? { error: true } : {}) });
  }
  if (media === "video" && process.env.VITEST && !options.fetchImpl) {
    const title = options.title?.trim() || "";
    return store({ url: pageUrl, title, text: missingTranscript(title, clipText(options.description, 500)), starters: ARTICLE_STARTERS, at: new Date().toISOString() });
  }
  if (process.env.VITEST && !options.fetchImpl) {
    const record = blank(true);
    writeCache(dir, key, record);
    return record;
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  let record = blank(true);
  try {
    const response = await fetchPublicUrl(fetchImpl, pageUrl, { lookup: options.lookup, headers: { accept: "text/html" } });
    const declared = Number(response.headers.get("content-length"));
    const bytes = response.ok && !(Number.isFinite(declared) && declared > HTML_CAP) ? Buffer.from(await response.arrayBuffer()) : null;
    const html = bytes && bytes.length > 0 && bytes.length <= HTML_CAP ? bytes.toString("utf8") : "";
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    const readable = Boolean(html) && (!type || /html|xml|text\/plain/.test(type) || /<html|<article|<p\b/i.test(html.slice(0, 2_000)));
    if (readable) {
      const extracted = extractArticleText(html);
      const title = extracted.title || options.title?.trim() || "";
      const transcript = media === "video" ? extractTranscript(html) : null;
      const text = media === "video"
        ? (transcript ?? missingTranscript(title, clipText(options.description, 500) || extracted.text.slice(0, 400)))
        : extracted.text;
      return store({ url: pageUrl, title, text, starters: ARTICLE_STARTERS, at: new Date().toISOString(), ...(!text ? { error: true } : {}) });
    }
  } catch {
    record = blank(true);
  }
  writeCache(dir, key, record);
  return record;
}

async function liveAsk(source = "article-starters"): Promise<(prompt: string) => Promise<string>> {
  const { quickQuery } = await import("../lib/llm.js");
  return (prompt) => quickQuery(prompt, { source, json: true });
}

export interface OpenedArticle {
  session: string;
  title: string;
  url: string;
  starters: string[];
  link: { href: string; label: string };
}

/** Open the conversation for this article: read it once, then register the thread under its title. */
export async function openArticleChat(dir: string, pageUrl: string, options: ReadArticleOptions = {}): Promise<OpenedArticle> {
  const record = await readArticle(dir, pageUrl, options);
  let host = pageUrl;
  try { host = new URL(pageUrl).host; } catch { /* keep the url */ }
  const title = shortConversationTitle(record.title || options.title?.trim() || host);
  const session = articleSessionId(pageUrl);
  const label = { quote: "Quote", stat: "Stat", gif: "GIF", video: "Video", image: "Image", thread: "Thread" }[options.media ?? ""] ?? "Article";
  const index = readChats(dir);
  index[session] = { url: pageUrl, title, at: record.at, label };
  writeChats(dir, index);
  return { session, title, url: pageUrl, starters: record.starters, link: { href: pageUrl, label } };
}

function summaryOf(dir: string, sessionId: string, chat: { url: string; title: string; at: string; label?: string }, withStarters: boolean): SessionSummary {
  const key = articleKey(sessionId);
  const record = key ? readCache(dir, key) : undefined;
  return {
    id: sessionId,
    title: shortConversationTitle(record?.title || chat.title),
    updatedAt: record?.at || chat.at,
    link: { href: chat.url, label: chat.label || "Article" },
    ...(withStarters && record?.starters?.length ? { starters: record.starters } : {}),
  };
}

/** One opened article thread, titled with the piece and pointing back at it. */
export function articleChat(dir: string, sessionId: string): SessionSummary | undefined {
  const chat = readChats(dir)[sessionId];
  return chat ? summaryOf(dir, sessionId, chat, true) : undefined;
}

/** Every article thread he has opened, newest first. */
export function listArticleChats(dir: string): SessionSummary[] {
  return Object.entries(readChats(dir))
    .map(([id, chat]) => summaryOf(dir, id, chat, true))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/** The cached article for a conversation, including one whose text could not be read. */
export function articleForSession(dir: string, sessionId: string): ArticleText | undefined {
  const key = articleKey(sessionId);
  if (!key) return undefined;
  const record = readCache(dir, key);
  const chat = readChats(dir)[`window:article-${key}`];
  if (!record && !chat) return undefined;
  return {
    title: record?.title || chat?.title || "Article",
    url: record?.url || chat?.url || "",
    text: record?.text ?? "",
  };
}

export interface ArticleTurnOptions {
  fetchImpl?: typeof fetch;
  lookup?: HostLookup;
  /** The cheap reading of whether his question is about the piece. Under tests, injected. */
  ask?: (prompt: string) => Promise<string>;
}

/** Whether his question is about this piece, or about his own work, code, memory or the web. A reading that fails keeps the article. */
async function aboutTheArticle(question: string, article: ArticleText, ask: (prompt: string) => Promise<string>): Promise<boolean> {
  try {
    const raw = await ask([
      "George is in a conversation about one article.",
      `Title: ${article.title}`,
      article.text.slice(0, 700),
      `His question: ${question.replace(/\s+/g, " ").slice(0, 800)}`,
      "Does answering that question depend on this article, or on the rest of Flyd — his own projects, code, repositories, his history, memory, calendar, or the web? Do not look anything up.",
      'Reply with JSON only: {"about": true} when it depends on this article, {"about": false} when it needs the rest of Flyd.',
    ].join("\n\n"));
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { about?: unknown };
    return parsed.about !== false && parsed.about !== "false";
  } catch {
    return true;
  }
}

/** The article a turn in this chat is grounded in, or undefined when the question needs the rest of Flyd instead. */
export async function articleTurnFor(dir: string, sessionId: string, question: string, options: ArticleTurnOptions = {}): Promise<ArticleText | undefined> {
  const cached = articleForSession(dir, sessionId);
  if (!cached) return undefined;
  const article = cached.text.trim() ? cached : await readArticle(dir, cached.url, {
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.lookup ? { lookup: options.lookup } : {}),
    ...(cached.title ? { title: cached.title } : {}),
    refresh: true,
  }).then((record) => ({ title: record.title || cached.title, url: record.url || cached.url, text: record.text }))
    .catch(() => cached);
  // Still unreadable: Flyd answers with the tools it has, not from an article it never saw.
  if (!article.text.trim()) return undefined;
  const ask = options.ask ?? (process.env.VITEST ? undefined : await liveAsk("article-routing"));
  return ask && !(await aboutTheArticle(question, article, ask)) ? undefined : article;
}
