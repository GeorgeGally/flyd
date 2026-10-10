import type { ConversationMessage } from "./types.js";

// Flyd's right column: one scrolling list of what he is talking about and what
// came back. His questions each carry their answer below it, and a preview of
// what the reply showed — a live local page or a local screenshot — sits with
// the reply it came from. Pure: the same conversations and clock always give
// the same column.

export type RailPreviewKind = "live" | "image";
/** Whether a live page answered when the server last asked it. */
export type PreviewState = "up" | "down" | "checking";

export interface RailPreview {
  id: string;
  kind: RailPreviewKind;
  /** A loopback URL to frame live, or an absolute local image path to show. */
  url: string;
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
  at?: string;
}

export interface Rail {
  conversations: RailConversation[];
  artefacts: RailArtefact[];
}

/** How far back a named preview still counts as what we are talking about. */
export const PREVIEW_SCAN = 12;
export const MAX_RAIL_CONVERSATIONS = 40;
export const MAX_RAIL_ARTEFACTS = 8;
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

/** One artefact card for a preview: a live page framed once it answers, or a screenshot shown. Pure. */
export function previewCard(preview: RailPreview, state: PreviewState = "up"): RailArtefact {
  if (preview.kind === "image") {
    const name = preview.url.split("/").pop() ?? preview.url;
    return { id: preview.id, title: "Screenshot", line: name, image: railImageSrc(preview.url), url: railImageSrc(preview.url) };
  }
  const line = preview.url.replace(/^https?:\/\//, "");
  if (state === "down") return { id: preview.id, title: "Preview not running", line, url: preview.url, down: true };
  if (state === "checking") return { id: preview.id, title: "Live preview", line, url: preview.url, checking: true };
  return { id: preview.id, title: "Live preview", line, url: preview.url, preview: preview.url };
}

/** Machine status a reply opened with ("status=needs_decision: …"): never his to read. */
const MACHINE_HEADER = /^\s*(?:[a-z][a-z_]*=[\w-]+\s*[:;]?\s*)+/i;

/** A reply as words, its machine header gone. Pure. */
export function spoken(text: string): string {
  const words = text.replace(MACHINE_HEADER, "").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : text.trim();
}

export interface RailOptions {
  /** Whether a live page answers; without it every page is framed. */
  live?: (url: string) => PreviewState;
  /** The answer as Flyd tells it, rendered; without it the column shows the answer's words. */
  voice?: (answer: ConversationMessage) => string | undefined;
}

/** The column from his exchanges, the previews they showed, and the artefacts beside them. Pure. */
export function composeRail(
  exchanges: Array<{ question: ConversationMessage; answer?: ConversationMessage; waiting?: string }>,
  artefacts: RailArtefact[],
  previews: RailPreview[] = [],
  options: RailOptions = {},
): Rail {
  const card = (preview: RailPreview): RailArtefact => previewCard(preview, preview.kind === "live" && options.live ? options.live(preview.url) : "up");
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
        ...(answer ? { answer: spoken(answer.text) } : {}),
        ...(html ? { answerHtml: html } : {}),
        ...(!answer && exchange.waiting ? { waiting: exchange.waiting } : {}),
        ...(exchange.question.timestamp ? { at: exchange.question.timestamp } : {}),
        ...(shown.length ? { previews: shown.map(card) } : {}),
      };
    });
  const attached = new Set(conversations.flatMap((conversation) => (conversation.previews ?? []).map((preview) => preview.id)));
  const cards = [...artefacts];
  for (const preview of [...previews].reverse()) {
    if (attached.has(preview.id)) continue;
    cards.unshift(card(preview));
  }
  return { conversations, artefacts: cards.slice(0, MAX_RAIL_ARTEFACTS) };
}
