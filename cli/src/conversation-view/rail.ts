import type { ConversationMessage } from "./types.js";

// Flyd's right column: one scrolling list of what he is talking about and what
// came back. His questions each carry their answer below it, and a preview of
// what the reply showed — a live local page or a local screenshot — sits with
// the reply it came from. Pure: the same conversations and clock always give
// the same column.

export type RailPreviewKind = "live" | "image";

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
  /** Flyd's answer, when it has one. */
  answer?: string;
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

/** The previews a single piece of text names: live pages first, then screenshots. Pure. */
export function previewsIn(text: string): RailPreview[] {
  const out: RailPreview[] = [];
  const seen = new Set<string>();
  const push = (kind: RailPreviewKind, url: string): void => {
    const id = `${kind}:${url}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, kind, url });
  };
  for (const url of text.match(LOOPBACK) ?? []) push("live", url);
  for (const path of text.match(IMAGE_PATH) ?? []) push("image", path);
  return out;
}

/** The previews named across the recent conversation, newest first, capped. Pure. */
export function conversationPreviews(messages: ConversationMessage[], scan = PREVIEW_SCAN, cap = MAX_RAIL_PREVIEWS): RailPreview[] {
  const out: RailPreview[] = [];
  const seen = new Set<string>();
  for (let index = messages.length - 1; index >= 0 && out.length < cap; index -= 1) {
    for (const preview of previewsIn(messages[index]!.text)) {
      if (seen.has(preview.id)) continue;
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

/** One artefact card for a preview: a live page framed, or a screenshot shown. Pure. */
export function previewCard(preview: RailPreview): RailArtefact {
  if (preview.kind === "image") {
    const name = preview.url.split("/").pop() ?? preview.url;
    return { id: preview.id, title: "Screenshot", line: name, image: railImageSrc(preview.url), url: railImageSrc(preview.url) };
  }
  return { id: preview.id, title: "Live preview", line: preview.url.replace(/^https?:\/\//, ""), url: preview.url, preview: preview.url };
}

/** The column from his exchanges, the previews they showed, and the artefacts beside them. Pure. */
export function composeRail(
  exchanges: Array<{ question: ConversationMessage; answer?: ConversationMessage; waiting?: string }>,
  artefacts: RailArtefact[],
  previews: RailPreview[] = [],
): Rail {
  const conversations: RailConversation[] = exchanges
    .filter((exchange) => exchange.question.text.trim())
    .slice(-MAX_RAIL_CONVERSATIONS)
    .map((exchange) => {
      const shown = [...previewsIn(exchange.question.text), ...previewsIn(exchange.answer?.text ?? "")].slice(0, MAX_RAIL_PREVIEWS);
      return {
        id: exchange.question.id,
        question: question(exchange.question.text),
        ...(exchange.answer?.text ? { answer: exchange.answer.text } : {}),
        ...(!exchange.answer?.text && exchange.waiting ? { waiting: exchange.waiting } : {}),
        ...(exchange.question.timestamp ? { at: exchange.question.timestamp } : {}),
        ...(shown.length ? { previews: shown.map((preview) => previewCard(preview)) } : {}),
      };
    });
  const attached = new Set(conversations.flatMap((conversation) => (conversation.previews ?? []).map((preview) => preview.id)));
  const cards = [...artefacts];
  for (const preview of previews) {
    if (attached.has(preview.id)) continue;
    cards.unshift(previewCard(preview));
  }
  return { conversations, artefacts: cards.slice(0, MAX_RAIL_ARTEFACTS) };
}
