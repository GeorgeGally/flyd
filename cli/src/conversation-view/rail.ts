import type { ConversationMessage } from "./types.js";

// Flyd's right column: one scrolling list of what he is talking about and what
// came back. His questions each carry their answer below; the artefacts carry a
// live local preview when the conversation is about a running site. Pure: the
// same conversations and clock always give the same column.

export interface RailConversation {
  id: string;
  /** His words, whole. */
  question: string;
  /** Flyd's answer, when it has one. */
  answer?: string;
  /** What is happening to a question that has no answer yet. */
  waiting?: string;
  at?: string;
}

export interface RailArtefact {
  id: string;
  title: string;
  line?: string;
  url?: string;
  /** A live local URL to show inline in the column. */
  preview?: string;
  at?: string;
}

export interface Rail {
  conversations: RailConversation[];
  artefacts: RailArtefact[];
}

/** How far back a named local preview still counts as what we are talking about. */
export const PREVIEW_SCAN = 10;
export const MAX_RAIL_CONVERSATIONS = 40;
export const MAX_RAIL_ARTEFACTS = 8;

/** A loopback URL he named: the site we are looking at, never a remote page. */
const LOOPBACK = /https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::\d+)?(?:\/[^\s)"'<>\]]*)?/;

/**
 * The local site the conversation is about: the newest loopback URL the captain
 * himself named in the recent conversation, so a preview comes up when we are
 * talking about a running site. Pure.
 */
export function conversationPreview(messages: ConversationMessage[], scan = PREVIEW_SCAN): string | undefined {
  const recent = messages.slice(-scan);
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index]!;
    if (message.role !== "user") continue;
    const url = LOOPBACK.exec(message.text)?.[0];
    if (url) return url;
  }
  return undefined;
}

/** His question as a rail row, whole, without a salutation. Pure. */
function question(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 2_000);
}

/** The column from his exchanges and the artefacts worth showing beside them. Pure. */
export function composeRail(
  exchanges: Array<{ question: ConversationMessage; answer?: ConversationMessage; waiting?: string }>,
  artefacts: RailArtefact[],
  preview?: string,
): Rail {
  const conversations: RailConversation[] = exchanges
    .filter((exchange) => exchange.question.text.trim())
    .slice(-MAX_RAIL_CONVERSATIONS)
    .map((exchange) => ({
      id: exchange.question.id,
      question: question(exchange.question.text),
      ...(exchange.answer?.text ? { answer: exchange.answer.text } : {}),
      ...(!exchange.answer?.text && exchange.waiting ? { waiting: exchange.waiting } : {}),
      ...(exchange.question.timestamp ? { at: exchange.question.timestamp } : {}),
    }));
  const cards = [...artefacts];
  if (preview && !cards.some((card) => card.preview === preview)) {
    const host = preview.replace(/^https?:\/\//, "");
    cards.unshift({ id: `preview:${preview}`, title: "Live preview", line: host, url: preview, preview });
  }
  return { conversations, artefacts: cards.slice(0, MAX_RAIL_ARTEFACTS) };
}
