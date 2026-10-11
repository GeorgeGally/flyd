import type { ElementShot } from "./element-shots.js";

// A change the fleet made to a website, as Flyd shows it: the page it changed,
// as a button that opens it, and what in the turn says which element changed
// (the CSS rules it edited, the text the reply quotes, the elements its own
// checks looked at), so the picture can be that element rather than the whole
// page. Pure: the same reply and tool lines always give the same page and
// the same element to look for.

/** What a turn's tool lines say about the site it worked on. */
export interface SiteHints {
  /** Pages its browser opened, in order. */
  pages: string[];
  /** Selectors of CSS rules it wrote: the elements it changed. */
  edited: string[];
  /** Elements its own checks picked out (querySelector, closest): what it looked at. */
  looked: string[];
}

/** The page a change is on, as a button: its address said short, and where it opens. */
export interface SitePage {
  label: string;
  url: string;
}

/** One way to find the changed element on the page. */
export interface Locator {
  kind: "css" | "text";
  value: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where on the page the picture is cut from, in CSS pixels. */
export type Clip = Rect;

const MAX_HINTS = 12;
const MAX_LOCATORS = 10;

/** Hosts that are never the site being worked on: code hosts, APIs, the tools around the work. */
const NOT_A_SITE = /^(?:(?:www\.)?github\.com|gist\.github\.com|api\.[^/]+|raw\.githubusercontent\.com|(?:www\.)?npmjs\.com|(?:docs\.)?anthropic\.com|claude\.ai|(?:www\.)?google\.com|calendar\.google\.com|maps\.google\.com|(?:www\.)?instagram\.com|(?:www\.)?youtube\.com)$/i;
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|0\.0\.0\.0)$/i;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`)\]“”‘’]+/gi;
/** A bare host named as the site ("live on christmas.goodneighboursmarket.com"): never a file name. */
const BARE_HOST = /(?<![\w@/.-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|app|dev|co|id|me|site|shop|store|xyz|ai|sg|au|uk|nz|biz|info))((?:\/[^\s<>"'`)\],]*)?)(?![\w-])/gi;
/** Words that say a change reached the site, or what a change did to it. */
const CHANGED = /\b(?:live on|is live|now live|went live|deployed|pushed|published|changed|updated|moved|added|removed|renamed|replaced|now (?:reads|sits|shows|has|opens|says|uses|goes|stays|fits|scrolls|lists))\b/i;
/** Selectors that name the whole page, never one element of it. */
const WHOLE_PAGE = /^(?:html|body|\*|:root|main|html\s+body)$/i;
/** States and generated parts a selector matches only while hovered or drawn: the element itself is what to find. */
const DYNAMIC_PSEUDO = /::?(?:hover|focus(?:-visible|-within)?|active|visited|target|checked|disabled|before|after|placeholder|marker|selection|first-letter|first-line|backdrop|-webkit-[\w-]+|-moz-[\w-]+)\b/gi;

function trimUrl(raw: string): string {
  return raw.replace(/[.,;:!?…]+$/, "").replace(/\*+$/, "");
}

/** A URL as one page: no fragment, no trailing punctuation; null when it is not one. */
function parsed(raw: string): URL | null {
  try {
    const url = new URL(trimUrl(raw));
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function isLoopback(url: URL): boolean {
  return LOOPBACK_HOST.test(url.hostname);
}

/** Whether a page address is just the site's front door. */
function isFrontDoor(url: URL): boolean {
  return /^\/(?:index\.html?)?$/i.test(url.pathname) && !url.search;
}

function asPage(url: URL): string {
  const path = url.pathname === "/" && !url.search ? "" : url.pathname;
  return `${url.protocol}//${url.host}${path}${url.search}`;
}

/** Words that name an address as where the change is: "live on", "see it at", "the preview is". */
const NAMED_SITE = /(?:\blive (?:on|at)|\bdeployed (?:to|on)|\bsee it (?:at|on)|\bpreview(?: is| at|:)|\bopen)\s*\(?\s*$/i;

/** The site addresses a reply names, in order, and whether its words name each as where the change is. */
function sitesIn(text: string): Array<{ url: string; named: boolean }> {
  const found: Array<{ at: number; url: string; named: boolean }> = [];
  const add = (at: number, url: URL | null) => {
    if (!url || NOT_A_SITE.test(url.hostname) || (!isLoopback(url) && !/\.[a-z]{2,}$/i.test(url.hostname))) return;
    found.push({ at, url: asPage(url), named: NAMED_SITE.test(text.slice(Math.max(0, at - 24), at)) });
  };
  const withoutLinks = text.replace(URL_IN_TEXT, (match, at: number) => {
    add(at, parsed(match));
    return " ".repeat(match.length);
  });
  for (const match of withoutLinks.matchAll(BARE_HOST)) add(match.index, parsed(`https://${match[1]}${match[2] ?? ""}`));
  const sites = new Map<string, boolean>();
  for (const entry of found.sort((a, b) => a.at - b.at)) sites.set(entry.url, (sites.get(entry.url) ?? false) || entry.named);
  return [...sites].map(([url, named]) => ({ url, named }));
}

/** The site addresses a reply names, in order: public pages and local previews, never code hosts. Pure. */
export function siteUrlsIn(text: string): string[] {
  return sitesIn(text).map((entry) => entry.url);
}

/** Whether a reply reports a change it made to a website. Pure. */
export function isSiteChange(text: string): boolean {
  return siteUrlsIn(text).length > 0 && CHANGED.test(text);
}

/** A page's address said short: just its path, without an index file or trailing slash ("/vendor-apply"; the front door is "/"). */
export function short(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "").replace(/\/index\.(?:html?|php)$/i, "").replace(/\/+$/, "");
  return path || "/";
}

/**
 * The page a change is on, as a button: the most particular page the reply
 * names (a public page before a local preview). When the reply names only the
 * site's front door but the turn's browser opened a deeper page of a local
 * preview, the button opens that page on the named site. Pure.
 */
export function sitePageOf(text: string, opened: string[] = []): SitePage | undefined {
  const sites = sitesIn(text);
  if (sites.length === 0) return undefined;
  // A site the words name as where the change is ("live on …") beats one only mentioned ("brand.com shows as …").
  const named = new Set(sites.filter((site) => site.named).map((site) => new URL(site.url).host));
  const rank = (site: { url: URL; named: boolean }) => (named.size && !named.has(site.url.host) ? 4 : 0) + (isLoopback(site.url) ? 2 : 0) + (isFrontDoor(site.url) ? 1 : 0);
  let chosen = sites.map((site) => ({ url: new URL(site.url), named: site.named })).sort((a, b) => rank(a) - rank(b))[0]!.url;
  const deeper = [...opened].reverse().map(parsed).find((url): url is URL => url !== null && isLoopback(url) && !isFrontDoor(url));
  if (deeper && !isLoopback(chosen) && isFrontDoor(chosen)) chosen = new URL(`${deeper.pathname}${deeper.search}`, chosen.origin);
  return { label: short(chosen), url: asPage(chosen) };
}

/** The pages to render the change from: the local preview the turn checked first (it is what it looked at), then the pages the reply names. Pure. */
export function renderPages(text: string, opened: string[] = []): string[] {
  const local = [...opened].reverse().map(parsed).filter((url): url is URL => url !== null && isLoopback(url)).map(asPage);
  const page = sitePageOf(text, opened)?.url;
  return [...new Set([...local.slice(0, 1), ...(page ? [page] : []), ...siteUrlsIn(text)])].slice(0, 3);
}

/** A selector as the element it names: hover and generated parts dropped; null when it names the whole page or nothing. */
function elementSelector(raw: string): string | null {
  const selector = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(DYNAMIC_PSEUDO, "").replace(/\s+/g, " ").trim();
  if (!selector || selector.length > 200 || WHOLE_PAGE.test(selector) || /^(?:from|to|\d+%)$/i.test(selector) || /[{}$`]/.test(selector)) return null;
  // A bare tag ("h2", "a") names every one on the page.
  if (/^[a-z][a-z0-9]*$/i.test(selector)) return null;
  return isSelector(selector) ? selector : null;
}

/**
 * Whether text reads as a CSS selector rather than code around one: it opens
 * like a selector, uses only a selector's characters, opens a bracket only
 * for a pseudo-class or an attribute, and closes every one it opens. Pure.
 */
export function isSelector(text: string): boolean {
  if (!/^[.#\[a-z*:>~+]/i.test(text) || /=>|\+\+|;|\\|^s\//.test(text) || !/^[\w\s.#\[\]="'():>+~*,^|@%-]+$/.test(text)) return false;
  if (/(?<!:[\w-]+)\(/.test(text)) return false;
  let depth = 0;
  for (const char of text) {
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** A selector list split at its own commas, never inside :is(…) or [attr="a,b"]. */
function topLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < list.length; at += 1) {
    const char = list[at];
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(list.slice(start, at));
      start = at + 1;
    }
  }
  return [...parts, list.slice(start)];
}

/** The selectors of the rules in a piece of CSS: at-rules and keyframe steps skipped. Pure. */
export function selectorsInCss(css: string): string[] {
  const out: string[] = [];
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const match of plain.matchAll(/(^|[{};])\s*([^{};@]+?)\s*\{\s*[^{}]*?:[^{}]*\}/g)) {
    for (const part of topLevel(match[2]!)) {
      const selector = elementSelector(part);
      if (selector) out.push(selector);
    }
  }
  return [...new Set(out)];
}

/** The elements a script picks out: querySelector, querySelectorAll and closest. Pure. */
export function selectorsInScript(script: string): string[] {
  const out: string[] = [];
  for (const match of script.matchAll(/\b(?:querySelector(?:All)?|closest)\(\s*(\\?["'`])(.+?)\1\s*\)/g)) {
    const selector = elementSelector(match[2]!.replace(/\\(["'])/g, "$1"));
    if (selector) out.push(selector);
  }
  return [...new Set(out)];
}

/** Pages a shell command's browser opens. Pure. */
export function pagesOpenedIn(command: string): string[] {
  const out: string[] = [];
  for (const match of command.matchAll(/\b(?:chrome-devtools-axi\s+(?:open|newpage)|\.goto\(|open\s+-a\s+["']?[\w ]+["']?)\s*["'`]?(https?:\/\/[^\s"'`)]+)/g)) {
    // A page built from a shell variable is not one page.
    if (match[1]!.includes("$")) continue;
    const url = parsed(match[1]!);
    if (url) out.push(asPage(url));
  }
  return out;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** What one tool call says about the site: the CSS it wrote, the elements it looked at, the pages it opened. Pure. */
export function hintsFromTool(name: string, input: unknown): SiteHints {
  const hints: SiteHints = { pages: [], edited: [], looked: [] };
  if (!isRecord(input)) return hints;
  const file = text(input.file_path);
  if (/^(?:Edit|MultiEdit|Write)$/.test(name) && /\.(?:css|scss|less)$/i.test(file)) {
    const written = [text(input.new_string), text(input.content), ...(Array.isArray(input.edits) ? input.edits.map((edit) => (isRecord(edit) ? text(edit.new_string) : "")) : [])].join("\n");
    hints.edited.push(...selectorsInCss(written));
  }
  if (name === "Bash") {
    const command = text(input.command);
    // CSS a command appends or writes into a stylesheet: its quoted strings and heredocs, never the shell around them.
    if (/\.(?:css|scss)\b/.test(command)) {
      const written = [
        ...[...command.matchAll(/<<-?\s*['"]?(\w+)['"]?\n([\s\S]*?)\n\s*\1\b/g)].map((match) => match[2]!),
        ...[...command.matchAll(/'([^']*)'|"((?:\\.|[^"\\])*)"/g)].map((match) => match[1] ?? match[2] ?? ""),
      ];
      hints.edited.push(...new Set(written.flatMap((css) => selectorsInCss(css.replace(/\\n/g, "\n")))));
    }
    hints.looked.push(...selectorsInScript(command));
    hints.pages.push(...pagesOpenedIn(command));
  }
  return hints;
}

/** Hints gathered across a turn, newest edits first, bounded. Pure. */
export function mergeHints(into: SiteHints | undefined, more: SiteHints): SiteHints | undefined {
  if (!more.pages.length && !more.edited.length && !more.looked.length) return into;
  const merged = (older: string[] = [], newer: string[]) => [...new Set([...newer, ...older])].slice(0, MAX_HINTS);
  return {
    pages: [...new Set([...(into?.pages ?? []), ...more.pages])].slice(-MAX_HINTS),
    edited: merged(into?.edited, more.edited),
    looked: merged(into?.looked, more.looked),
  };
}

/** The words a reply quotes: a headline it now reads, a button's label. Pure. */
export function quotedPhrases(reply: string): string[] {
  const out: string[] = [];
  const prose = reply.replace(/```[\s\S]*?```/g, " ").replace(URL_IN_TEXT, " ");
  for (const match of prose.matchAll(/“([^”\n]{3,80})”|"([^"\n]{3,80})"|‘([^’\n]{3,80})’/g)) {
    const phrase = (match[1] ?? match[2] ?? match[3] ?? "").replace(/[.,;:!?]+$/, "").trim();
    // Words, not a path, a selector or a number.
    if (phrase.length >= 3 && /[a-z]{2}/i.test(phrase) && !/[/{}<>=]|^\.|^#/.test(phrase)) out.push(phrase);
  }
  return [...new Set(out)];
}

/**
 * The ways to find the changed element, most telling first: the rules the
 * turn wrote, then the words the reply says are on the page, then the
 * elements its checks looked at. Pure.
 */
export function locatorsFor(reply: string, hints: SiteHints | undefined): Locator[] {
  return [
    ...(hints?.edited ?? []).map((value): Locator => ({ kind: "css", value })),
    ...quotedPhrases(reply).map((value): Locator => ({ kind: "text", value })),
    ...(hints?.looked ?? []).map((value): Locator => ({ kind: "css", value })),
  ].slice(0, MAX_LOCATORS);
}

/** An element covering more of the screen than this is the page, not the change. */
export const PAGE_SHARE = 0.7;

/**
 * Which found element is the change: the first, in the locators' order, that
 * is drawn and is smaller than the page; when every one is page-sized, the
 * first drawn. -1 when none is drawn. Pure.
 */
export function chooseElement(found: Array<Rect | null>, view: { width: number; height: number }): number {
  const area = view.width * view.height;
  const drawn = found.map((rect) => rect !== null && rect.width >= 4 && rect.height >= 4);
  const element = found.findIndex((rect, at) => drawn[at] && rect!.width * rect!.height <= PAGE_SHARE * area);
  return element >= 0 ? element : drawn.indexOf(true);
}

/**
 * The piece of the screen to show for an element: the element with room
 * around it, never smaller than a readable piece of the page, kept inside
 * what is on screen. Pure.
 */
export function cropBox(rect: Rect, view: { width: number; height: number }, options: { pad?: number; minWidth?: number; minHeight?: number } = {}): Clip {
  const pad = options.pad ?? 40;
  const minWidth = Math.min(view.width, options.minWidth ?? 640);
  const minHeight = Math.min(view.height, options.minHeight ?? 360);
  const width = Math.min(view.width, Math.max(minWidth, rect.width + 2 * pad));
  const height = Math.min(view.height, Math.max(minHeight, rect.height + 2 * pad));
  const centreX = rect.x + rect.width / 2;
  const centreY = rect.y + rect.height / 2;
  const x = Math.min(Math.max(0, centreX - width / 2), view.width - width);
  const y = Math.min(Math.max(0, centreY - height / 2), view.height - height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** How long a change stays recent enough to be pictured: older ones keep whatever picture they had. */
export const PICTURE_WITHIN_MS = 24 * 60 * 60 * 1000;

/** What Flyd needs to show a reply as a change to a website: its page, and how to find the element on it. */
export interface SiteChange {
  page: SitePage;
  /** Pages to render the change from, in order. */
  pages: string[];
  locators: Locator[];
}

/** A fleet reply that reports changing a website, as the page it changed and how to find the element; undefined otherwise. Pure. */
export function siteChangeOf(message: { role: string; text: string; site?: SiteHints }): SiteChange | undefined {
  if (message.role !== "assistant" || !isSiteChange(message.text)) return undefined;
  const page = sitePageOf(message.text, message.site?.pages);
  if (!page) return undefined;
  return { page, pages: renderPages(message.text, message.site?.pages), locators: locatorsFor(message.text, message.site) };
}

/**
 * A reply with its page button and, when there is one, the picture of the
 * element it changed in place of the whole page. While the crop is being made
 * the full screenshot waits, so the picture never jumps from page to element;
 * with no crop to be had, the full screenshot stays. Pure.
 */
export function pictured<T extends { shots?: string[]; page?: SitePage }>(message: T, page: SitePage, shot?: ElementShot): T {
  const { shots, ...rest } = message;
  if (shot?.state === "ready") return { ...rest, page, shots: [shot.path] } as T;
  if (shot?.state === "pending") return { ...rest, page } as T;
  return { ...rest, page, ...(shots?.length ? { shots } : {}) } as T;
}
