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
}

interface ChatIndex {
  [sessionId: string]: { url: string; title: string; at: string };
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
}

/** Read the article once and keep the text and the starter questions beside it. A second call does not fetch. */
export async function readArticle(dir: string, pageUrl: string, options: ReadArticleOptions = {}): Promise<ArticleCache> {
  const key = storyKey(pageUrl);
  const cached = readCache(dir, key);
  if (cached) return cached;
  const blank = (error: boolean, title = options.title?.trim() || ""): ArticleCache => ({
    url: pageUrl, title, text: "", starters: ARTICLE_STARTERS, at: new Date().toISOString(), ...(error ? { error } : {}),
  });
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
      const ask = options.ask ?? (process.env.VITEST ? undefined : await liveAsk());
      const starters = ask ? await starterQuestions({ title, text: extracted.text }, ask) : ARTICLE_STARTERS;
      record = { url: pageUrl, title, text: extracted.text, starters, at: new Date().toISOString(), ...(!extracted.text ? { error: true } : {}) };
    }
  } catch {
    record = blank(true);
  }
  writeCache(dir, key, record);
  return record;
}

async function liveAsk(): Promise<(prompt: string) => Promise<string>> {
  const { quickQuery } = await import("../lib/llm.js");
  return (prompt) => quickQuery(prompt, { source: "article-starters", json: true });
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
  const index = readChats(dir);
  index[session] = { url: pageUrl, title, at: record.at };
  writeChats(dir, index);
  return { session, title, url: pageUrl, starters: record.starters, link: { href: pageUrl, label: "Article" } };
}

function summaryOf(dir: string, sessionId: string, chat: { url: string; title: string; at: string }, withStarters: boolean): SessionSummary {
  const key = articleKey(sessionId);
  const record = key ? readCache(dir, key) : undefined;
  return {
    id: sessionId,
    title: shortConversationTitle(record?.title || chat.title),
    updatedAt: record?.at || chat.at,
    link: { href: chat.url, label: "Article" },
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
