import type { PortServer } from "./port-server.js";
import type { ServedBy } from "./preview-probe.js";
import type { WorkState } from "./executive.js";
import type { RailMemories } from "./memory.js";
import { capitalise, inline, SALUTATION, sentences } from "./summaries.js";
import type { ConversationMessage } from "./types.js";

// Flyd's right column: one scrolling list of what he is talking about and what
// came back. His questions each carry their answer below it, and a preview of
// what the reply showed — a live local page or a local screenshot — sits with
// the reply it came from. Pure: the same conversations and clock always give
// the same column.

export type RailPreviewKind = "live" | "image" | "file";
/** Whether a live page answered when the server last asked it, and whether it lets itself be framed. */
export type PreviewState = "up" | "down" | "checking" | "blocked";

export interface RailPreview {
  id: string;
  kind: RailPreviewKind;
  /** A loopback URL to frame live, an absolute local image path to show, or a deliverable's open link. */
  url: string;
  /** What the card is called, when the server knows better than "Live preview". */
  title?: string;
  line?: string;
  /** A same-origin src to frame in place of the URL: a review board's own page, a deck's HTML. */
  frame?: string;
  at?: string;
}

export interface RailConversation {
  id: string;
  /** His words, whole. */
  question: string;
  /** Flyd's answer, when it has one: plain text, machine headers gone. */
  answer?: string;
  /** The answer as Flyd tells it, rendered, when the server has a reading of it. */
  answerHtml?: string;
  /** What is happening to a question that has no answer yet. */
  waiting?: string;
  /** Answered, though there are no words to show for it. */
  answered?: boolean;
  at?: string;
  /** Previews the reply showed: a live page or a local screenshot. */
  previews?: RailArtefact[];
}

export interface RailArtefact {
  id: string;
  title: string;
  line?: string;
  url?: string;
  /** A live local URL to show inline in the column. */
  preview?: string;
  /** A same-origin image src to show inline in the column. */
  image?: string;
  /** A live page that did not answer: shown as "not running" with its URL, never a blank frame. */
  down?: boolean;
  /** A live page not yet checked: no frame until it answers. */
  checking?: boolean;
  /** A live page that refuses to be framed: linked, never a blank frame. */
  blocked?: boolean;
  /** Which server serves a live page, and whether it changed lately. */
  server?: RailServer;
  at?: string;
}

/** The server behind a live page, as the card says it. */
export interface RailServer {
  /** "127.0.0.1:8088". */
  address: string;
  /** "php -S"; absent when nothing listens. */
  command?: string;
  /** The folder it serves, home as "~". */
  folder?: string;
  /** "GNM's own folder", "a copy, not GNM's own folder". */
  whose?: string;
  /** Whether the folder is the project's own, when Flyd can tell. */
  own?: boolean;
  /** What changed behind this address lately: "Server stopped", and the detail. */
  changed?: { at: string; title: string; detail: string };
}

/** A project as the column needs it: its name and its folders. */
export interface RailProject {
  id?: string;
  name: string;
  repos: string[];
}

export interface Rail {
  conversations: RailConversation[];
  artefacts: RailArtefact[];
  /** What Flyd remembers that applies here, and what it is taking in now. */
  memory?: RailMemories;
}

/** How far back a named preview still counts as what we are talking about. */
export const PREVIEW_SCAN = 12;
export const MAX_RAIL_CONVERSATIONS = 40;
export const MAX_RAIL_ARTEFACTS = 10;
export const MAX_RAIL_PREVIEWS = 4;

/** A loopback URL he named: the site we are looking at, never a remote page. */
const LOOPBACK = /https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::\d+)?(?:\/[^\s)"'<>\]]*)?/g;
/** An absolute local image path a reply named. */
const IMAGE_PATH = /(?:\/Users\/|\/home\/|\/tmp\/|\/private\/|\/var\/)[^\s)"'<>\]]+\.(?:png|jpe?g|webp|gif)\b/gi;
/** "not 8088", "instead of http://127.0.0.1:8088/": a page the text says is the wrong one. */
const NEGATED = /\b(?:not|never|instead of|rather than|no longer(?: on| at)?)\s+(?:on\s+|at\s+|port\s+)?(?:(https?:\/\/[^\s)"'<>\]]+)|:?(\d{2,5})\b)/gi;
/** The words that name a URL as the preview: "preview is", "preview at", "preview:". */
const NAMED_PREVIEW = /\bpreview\b[^.\n]{0,24}$/i;

/** A loopback URL as one page: trailing punctuation gone, "/." and "" read as "/". */
export function normalizeLoopback(raw: string): string | null {
  try {
    const url = new URL(raw.replace(/[.,;:!?]+$/, ""));
    return `${url.protocol}//${url.host}${url.pathname || "/"}${url.search}`;
  } catch {
    return null;
  }
}

function portOf(url: string): string {
  const parsed = new URL(url);
  return parsed.port || (parsed.protocol === "https:" ? "443" : "80");
}

/** The pages a piece of text says are not the one: whole URLs, and bare ports. Pure. */
export function negationsIn(text: string): { urls: Set<string>; ports: Set<string> } {
  const urls = new Set<string>();
  const ports = new Set<string>();
  for (const match of text.matchAll(NEGATED)) {
    const url = match[1] ? normalizeLoopback(match[1]) : null;
    if (url) urls.add(url);
    else if (match[2]) ports.add(match[2]);
  }
  return { urls, ports };
}

function negated(url: string, negations: { urls: Set<string>; ports: Set<string> }): boolean {
  return negations.urls.has(url) || negations.ports.has(portOf(url));
}

/** The previews a single piece of text names: the page it calls the preview first, then other live pages, then screenshots. Pure. */
export function previewsIn(text: string): RailPreview[] {
  const out: RailPreview[] = [];
  const seen = new Set<string>();
  const push = (kind: RailPreviewKind, url: string): void => {
    const id = `${kind}:${url}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, kind, url });
  };
  const negations = negationsIn(text);
  const live = [...text.matchAll(LOOPBACK)]
    .map((match) => ({ url: normalizeLoopback(match[0]), named: NAMED_PREVIEW.test(text.slice(Math.max(0, match.index - 40), match.index)) }))
    .filter((found): found is { url: string; named: boolean } => found.url !== null && !negated(found.url, negations));
  for (const found of [...live.filter((entry) => entry.named), ...live.filter((entry) => !entry.named)]) push("live", found.url);
  for (const path of text.match(IMAGE_PATH) ?? []) push("image", path);
  return out;
}

/** The previews named across the recent conversation, newest first, capped; a page a newer line ruled out stays out. Pure. */
export function conversationPreviews(messages: ConversationMessage[], scan = PREVIEW_SCAN, cap = MAX_RAIL_PREVIEWS): RailPreview[] {
  const out: RailPreview[] = [];
  const seen = new Set<string>();
  const ruledOut = { urls: new Set<string>(), ports: new Set<string>() };
  for (let index = messages.length - 1; index >= Math.max(0, messages.length - scan) && out.length < cap; index -= 1) {
    const text = messages[index]!.text;
    const negations = negationsIn(text);
    negations.urls.forEach((url) => ruledOut.urls.add(url));
    negations.ports.forEach((port) => ruledOut.ports.add(port));
    for (const preview of previewsIn(text)) {
      if (seen.has(preview.id) || (preview.kind === "live" && negated(preview.url, ruledOut))) continue;
      seen.add(preview.id);
      out.push(preview);
      if (out.length >= cap) break;
    }
  }
  return out;
}

/** His question as a rail row, whole. Pure. */
function question(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 2_000);
}

/** The same-origin src the page loads a local screenshot from. */
export function railImageSrc(path: string): string {
  return `/api/rail-image?path=${encodeURIComponent(path)}`;
}

/** One artefact card for a preview: a live page framed once it answers, a screenshot, or a finished file. Pure. */
export function previewCard(preview: RailPreview, state: PreviewState = "up", server?: RailServer): RailArtefact {
  const at = preview.at ? { at: preview.at } : {};
  if (preview.kind === "image") {
    const name = preview.url.split("/").pop() ?? preview.url;
    return { id: preview.id, title: preview.title ?? "Screenshot", line: preview.line ?? name, image: railImageSrc(preview.url), url: railImageSrc(preview.url), ...at };
  }
  if (preview.kind === "file") {
    return { id: preview.id, title: preview.title ?? preview.url.split("/").pop() ?? preview.url, ...(preview.line ? { line: preview.line } : {}), url: preview.url, ...(preview.frame ? { preview: preview.frame } : {}), ...at };
  }
  const line = preview.line ?? preview.url.replace(/^https?:\/\//, "");
  const title = preview.title ?? "Live preview";
  const served = server ? { server } : {};
  if (state === "down") return { id: preview.id, title: "Preview not running", line, url: preview.url, down: true, ...served, ...at };
  // A page that refuses to be framed is shown through its own file when the server has one, else only linked.
  if (preview.frame) return { id: preview.id, title, line, url: preview.url, preview: preview.frame, ...served, ...at };
  if (state === "checking") return { id: preview.id, title, line, url: preview.url, checking: true, ...served, ...at };
  if (state === "blocked") return { id: preview.id, title, line, url: preview.url, blocked: true, ...served, ...at };
  return { id: preview.id, title, line, url: preview.url, preview: preview.url, ...served, ...at };
}

function home(path: string, homeDir: string): string {
  return homeDir && (path === homeDir || path.startsWith(`${homeDir}/`)) ? `~${path.slice(homeDir.length)}` : path;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** "GNM (Good Neighbours Market)" as "GNM". */
function shortName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, "").trim() || name;
}

/**
 * Whose folder a server serves: inside a project's own repo is its own; a
 * folder named after a project elsewhere ("gnm-preview", a worktree "flyd")
 * is a copy of it. Pure.
 */
export function whoseFolder(folder: string, projects: RailProject[]): { whose: string; own: boolean } | undefined {
  const clean = folder.replace(/\/+$/, "");
  for (const project of projects) {
    if (project.repos.some((repo) => { const root = repo.replace(/\/+$/, ""); return clean === root || clean.startsWith(`${root}/`); })) {
      return { whose: `${shortName(project.name)}'s own folder`, own: true };
    }
  }
  const segments = clean.split("/").map(slug).filter(Boolean);
  for (const project of projects) {
    const first = slug(shortName(project.name)).split("-")[0] ?? "";
    const names = [...project.repos.map((repo) => slug(repo.replace(/\/+$/, "").split("/").pop() ?? "")), ...(project.id ? [slug(project.id)] : []), ...(first.length >= 3 ? [first] : [])].filter(Boolean);
    if (segments.some((segment) => names.some((name) => segment === name || segment.startsWith(`${name}-`)))) {
      return { whose: `a copy, not ${shortName(project.name)}'s own folder`, own: false };
    }
  }
  return undefined;
}

function serving(server: PortServer, homeDir: string): string {
  return server.folder ? `${server.command} serving ${home(server.folder, homeDir)}` : server.command;
}

/** A change of server as the card says it. Pure. */
export function changeNotice(change: NonNullable<ServedBy["change"]>, homeDir = ""): { at: string; title: string; detail: string } {
  const { was, now, at } = change;
  if (!was && now) return { at, title: "Server started", detail: serving(now, homeDir) };
  if (was && !now) return { at, title: "Server stopped", detail: `was ${serving(was, homeDir)}` };
  if (was && now && was.folder !== now.folder) {
    return { at, title: "Server changed", detail: `now ${serving(now, homeDir)}, was ${was.folder ? home(was.folder, homeDir) : was.command}` };
  }
  if (was && now && was.command !== now.command) return { at, title: "Server changed", detail: `now ${serving(now, homeDir)}, was ${was.command}` };
  return { at, title: "Server restarted", detail: now ? `same ${serving(now, homeDir)}` : "" };
}

/** The server behind a live page as the card says it, from what the port showed. Pure. */
export function railServer(url: string, served: ServedBy, projects: RailProject[] = [], homeDir = ""): RailServer {
  const address = new URL(url).host;
  const { server, change } = served;
  const place = server?.folder ? whoseFolder(server.folder, projects) : undefined;
  return {
    address,
    ...(server ? { command: server.command } : {}),
    ...(server?.folder ? { folder: home(server.folder, homeDir) } : {}),
    ...(place ?? {}),
    ...(change ? { changed: changeNotice(change, homeDir) } : {}),
  };
}

/** Machine status a reply opened with ("status=needs_decision: …"): never his to read. */
const MACHINE_HEADER = /^\s*(?:[a-z][a-z_]*=[\w-]+\s*[:;]?\s*)+/i;

/** A reply as words, its machine header gone. Pure. */
export function spoken(text: string): string {
  const words = text.replace(MACHINE_HEADER, "").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : text.trim();
}

/** The column's status card says what happened in his words: work that landed is "Done". */
export const RAIL_CARD_TITLES: Partial<Record<WorkState, string>> = { landed: "Done" };

/** A lead that only acknowledges, or says where ("Done on Visit → Hours:"), not what changed. */
const HOLLOW_LEAD = /^(?:(?:yes|ok(?:ay)?|right),?\s+)?(?:agreed|aye(?: aye)?|yes|ok(?:ay)?|sure|right|noted|understood|got it|on it|will do|shipshape|(?:all |that's |it's )?(?:done|finished|sorted|fixed))(?:\s+(?:on|in|at|for|to|with)\s+[^.!?:]{1,60})?\s*[.!:]?$/i;
const LIST_MARK = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
/** "**Position:** …" — the label an item opens with, which says nothing on its own. */
const ITEM_LABEL = /^(?:(?:\*\*|__)[^*_\n]{1,40}?:?(?:\*\*|__)\s*:?|[A-Z][\w ]{0,30}:)\s*/;

/** The first sentence in these lines that says what changed, and the lines without it. */
function outcomeIn(lines: string[]): { outcome: string; lines: string[] } | undefined {
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at]!;
    const mark = LIST_MARK.exec(line);
    const body = mark ? line.slice(mark[0].length) : line.trim();
    const label = mark ? ITEM_LABEL.exec(body)?.[0] ?? "" : "";
    const [first, ...others] = sentences(body.slice(label.length));
    if (!first || HOLLOW_LEAD.test(inline(first))) continue;
    const outcome = capitalise(inline(first).replace(/[:;,]$/, "."));
    const nested = /^\s+\S/.test(lines[at + 1] ?? "") && (mark ? lines[at + 1]!.search(/\S/) > mark[1]!.length : false);
    // The sentence leads the answer now, so its line goes; an item that opens a nested list keeps its place.
    const rest = others.join(" ");
    const kept = rest ? [...lines.slice(0, at), `${mark ? mark[0] + label : ""}${rest}`, ...lines.slice(at + 1)]
      : nested ? lines : [...lines.slice(0, at), ...lines.slice(at + 1)];
    return { outcome, lines: kept };
  }
  return undefined;
}

/**
 * His answer in the column, leading with what changed: no salutation, and a
 * lead that only acknowledges ("Done on Visit → Hours.") gives way to the
 * sentence that says what changed, taken from the answer or, when the answer
 * has none, from the reply it tells. The rest of the answer follows. Pure.
 */
export function outcomeFirst(text: string, reply?: string): string {
  const answer = opened(text);
  if (!answer.hollow) return capitalise(answer.said);
  const own = outcomeIn(answer.lines);
  if (own) return [own.outcome, own.lines.join("\n").trim()].filter(Boolean).join("\n\n");
  const told = reply ? opened(reply) : undefined;
  const found = told ? outcomeIn(told.hollow ? told.lines : told.said.split("\n")) : undefined;
  return found ? [found.outcome, answer.lines.join("\n").trim()].filter(Boolean).join("\n\n") : capitalise(answer.said);
}

/** Text without its salutation, whether its lead only acknowledges, and the lines after that lead. */
function opened(text: string): { said: string; hollow: boolean; lines: string[] } {
  const said = text.trim().replace(SALUTATION, "");
  const [firstLine = "", ...after] = said.split("\n");
  const [lead = "", ...rest] = sentences(firstLine);
  return { said, hollow: HOLLOW_LEAD.test(inline(lead)), lines: [rest.join(" "), ...after].filter((line, at) => at > 0 || line.trim()) };
}

export interface RailOptions {
  /** Whether a live page answers; without it every page is framed. */
  live?: (url: string) => PreviewState;
  /** The answer as Flyd tells it, rendered; without it the column shows the answer's words. */
  voice?: (answer: ConversationMessage) => string | undefined;
  /** What the server knows about a page a reply named: a review board's title and own file. */
  known?: (preview: RailPreview) => RailPreview;
  /** Which server serves a live page, once known. */
  server?: (url: string) => RailServer | undefined;
}

/** The column from his exchanges, the previews they showed, and the artefacts beside them. Pure. */
export function composeRail(
  exchanges: Array<{ question: ConversationMessage; answer?: ConversationMessage; waiting?: string; answered?: boolean }>,
  artefacts: RailArtefact[],
  previews: RailPreview[] = [],
  options: RailOptions = {},
): Rail {
  const card = (named: RailPreview): RailArtefact => {
    const preview = options.known?.(named) ?? named;
    if (preview.kind !== "live") return previewCard(preview);
    return previewCard(preview, options.live ? options.live(preview.url) : "up", options.server?.(preview.url));
  };
  const conversations: RailConversation[] = exchanges
    .filter((exchange) => exchange.question.text.trim())
    .slice(-MAX_RAIL_CONVERSATIONS)
    .map((exchange) => {
      const answer = exchange.answer?.text ? exchange.answer : undefined;
      // The answer has the last word: a page it rules out ("not 8088") is not shown for the question either.
      const said = [exchange.question.text, answer?.text ?? ""].join("\n");
      const shown = previewsIn(said).slice(0, MAX_RAIL_PREVIEWS);
      const html = answer ? options.voice?.(answer) : undefined;
      return {
        id: exchange.question.id,
        question: question(exchange.question.text),
        ...(answer ? { answer: outcomeFirst(spoken(answer.text)) } : {}),
        ...(html ? { answerHtml: html } : {}),
        ...(!answer && exchange.answered ? { answered: true } : !answer && exchange.waiting ? { waiting: exchange.waiting } : {}),
        ...(exchange.question.timestamp ? { at: exchange.question.timestamp } : {}),
        ...(shown.length ? { previews: shown.map(card) } : {}),
      };
    });
  const attached = new Set(conversations.flatMap((conversation) => (conversation.previews ?? []).map((preview) => preview.id)));
  const cards = [...artefacts];
  const own = previews.filter((preview) => !attached.has(preview.id) && (attached.add(preview.id), true));
  cards.unshift(...own.map(card));
  return { conversations, artefacts: cards.slice(0, MAX_RAIL_ARTEFACTS) };
}
