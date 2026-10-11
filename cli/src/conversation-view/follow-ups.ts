import { inFlydsVoice } from "./flyd-voice.js";
import type { ConversationMessage, Exchange } from "./types.js";

// Firstmate rarely answers a note with a formal `fm-inbox.sh reply`: it says
// its answer in its own chat, in the turn that handled the note, and later
// turns report the work done or landed. This finds, for each note, the latest
// of those chat replies: the turn whose tool lines named the note, then any
// later reply that is plainly about the same thing. Pure.

/** Shorter than this, a reply is "shipshape" chatter, never an answer. */
const MIN_REPLY_CHARS = 40;
/** Words that say nothing about which piece of work a line is about. */
const STOP = new Set([
  "about", "after", "again", "also", "been", "before", "being", "both", "captain", "could", "does", "done", "each", "even", "every",
  "from", "have", "here", "into", "just", "like", "look", "make", "more", "most", "much", "need", "only", "other", "over", "page",
  "please", "same", "should", "show", "some", "such", "than", "that", "their", "them", "then", "there", "these", "they", "this",
  "those", "through", "under", "very", "want", "were", "what", "when", "where", "which", "while", "will", "with", "would", "your",
  "yours", "sir", "now", "can", "the", "and", "for", "not", "but", "all", "any", "has", "had", "its", "our", "out", "too", "you",
  "local", "copy", "reload", "see", "it's", "it", "is", "on", "in", "to", "of", "a", "an", "be", "do", "go", "are", "was", "own",
]);

/** The words that say what a line is about. */
export function topicWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\[(?:image|file): [^\]]*\]/g, " ")
    .match(/[a-z][a-z0-9'-]{2,}/g) ?? [];
  return new Set(words.map((word) => word.replace(/'s$/, "").replace(/s$/, "")).filter((word) => word.length >= 3 && !STOP.has(word)));
}

/** A word in more than this share of firstmate's replies is the session's backdrop ("Christmas"), not a topic. */
const COMMON_SHARE = 0.12;

/** A later reply only updates a note when it reports the work's outcome. */
const OUTCOME = /\b(?:done|landed|merged|finished|fixed|ready|shipped|live|built|in your local copy|now (?:has|shows|is))\b/i;

export interface Sentence {
  words: Set<string>;
  /** The line it sits on, as the reply wrote it. */
  line: number;
}

/**
 * How plainly a later reply is about this question: the share of its rarer
 * words one sentence names again (0 when too few), and that sentence's line.
 */
export function aboutQuestion(question: Set<string>, sentences: Sentence[]): { share: number; line: number } {
  const none = { share: 0, line: -1 };
  if (question.size < 2) return none;
  let best = { shared: 0, line: -1 };
  for (const sentence of sentences) {
    let shared = 0;
    for (const word of question) if (sentence.words.has(word)) shared += 1;
    if (shared > best.shared) best = { shared, line: sentence.line };
  }
  const share = best.shared / Math.min(question.size, 6);
  return best.shared >= 2 && share >= 0.6 ? { share, line: best.line } : none;
}

/** A reply's sentences, each as its topic words and the line it sits on. */
export function sentenceTopics(text: string): Sentence[] {
  return text.split("\n").flatMap((line, index) =>
    line.split(/(?<=[.!?])\s+/).map((sentence) => ({ words: topicWords(sentence), line: index })).filter((sentence) => sentence.words.size > 0));
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

/**
 * What a report says about one note: the line that named it, under its list
 * heading when it is a list item ("Still coming: a menu item for every
 * slide"). A report about many things is not that note's whole answer.
 */
export function excerpt(text: string, line: number): string {
  const lines = text.split("\n");
  const said = lines[line]?.trim() ?? "";
  if (!LIST_ITEM.test(said)) return said;
  let heading = "";
  for (let index = line - 1; index >= 0; index -= 1) {
    const above = lines[index]!.trim();
    if (!above) break;
    if (!LIST_ITEM.test(above)) {
      heading = above.endsWith(":") ? above : "";
      break;
    }
  }
  const item = said.replace(LIST_ITEM, "");
  return heading ? `${heading} ${item}` : item.charAt(0).toUpperCase() + item.slice(1);
}

/**
 * Firstmate's latest chat reply about each note, keyed by the note's
 * question id, in Flyd's voice. `messages` is firstmate's own transcript,
 * in order, before anything is filtered out of it; `working` says its newest
 * reply is still mid-turn, so not yet an answer.
 */
export function followUps(exchanges: Exchange[], messages: ConversationMessage[], working = false): Record<string, ConversationMessage> {
  const notes = exchanges.filter((exchange) => exchange.question.id.startsWith("note:"));
  if (notes.length === 0) return {};
  const byNote = new Map(notes.map((exchange) => [exchange.question.id.slice("note:".length), exchange]));
  const replies = messages.filter((message) => message.role === "assistant" && message.text.trim().length >= MIN_REPLY_CHARS);
  const said = new Map(replies.map((message) => [message.id, topicWords(message.text)]));
  const sentences = new Map(replies.map((message) => [message.id, sentenceTopics(message.text)]));
  const seen = new Map<string, number>();
  for (const words of said.values()) for (const word of words) seen.set(word, (seen.get(word) ?? 0) + 1);
  const common = (word: string): boolean => (seen.get(word) ?? 0) > Math.max(2, replies.length * COMMON_SHARE);
  const topics = new Map(notes.map((exchange) => [exchange.question.id, new Set([...topicWords(exchange.question.text)].filter((word) => !common(word)))]));
  // An untagged report belongs to the one note it is most plainly about; the newer note wins a tie.
  const bestNote = (message: ConversationMessage): Array<{ exchange: Exchange; text: string }> => {
    const at = Date.parse(message.timestamp ?? "");
    let best: { exchange: Exchange; share: number; line: number } | undefined;
    for (const exchange of notes) {
      const asked = Date.parse(exchange.question.timestamp ?? "");
      if (!Number.isNaN(asked) && !Number.isNaN(at) && at <= asked) continue;
      const about = aboutQuestion(topics.get(exchange.question.id)!, sentences.get(message.id)!);
      if (about.share > 0 && (!best || about.share >= best.share)) best = { exchange, ...about };
    }
    // Only the part of the report about this note, unless the report is about nothing else.
    const part = best ? excerpt(message.text, best.line) : "";
    return best ? [{ exchange: best.exchange, text: message.text.includes("\n") ? part : message.text }] : [];
  };
  const found: Record<string, ConversationMessage> = {};
  for (const message of replies) {
    const handled = (message.notes ?? []).filter((id) => byNote.has(id));
    // The turn that handled a note answers it; a reply naming no note may report on one it plainly is about.
    // A reply to a note not listed here is still that note's, never another's.
    const answered = message.notes?.length
      ? handled.map((id) => ({ exchange: byNote.get(id)!, text: message.text }))
      : OUTCOME.test(message.text) ? bestNote(message) : [];
    for (const { exchange, text } of answered) found[exchange.question.id] = answerFrom(message, exchange, text);
  }
  // A note taken with others, its id never named again: the first reply firstmate settled after taking it.
  const settled = working && messages.at(-1)?.role === "assistant" ? replies.filter((message) => message !== messages.at(-1)) : replies;
  for (const exchange of notes) {
    if (found[exchange.question.id] || exchange.answer || !exchange.takenAt) continue;
    const taken = Date.parse(exchange.takenAt);
    const own = exchange.question.id.slice("note:".length);
    const reply = settled.find((message) =>
      !message.wake && Date.parse(message.timestamp ?? "") >= taken && (!message.notes?.length || message.notes.includes(own)));
    if (!reply) continue;
    // The report covers the batch it took, so the line naming most of this note's words is its part.
    const line = reply.text.includes("\n") ? mostAbout(topics.get(exchange.question.id)!, sentences.get(reply.id)!) : -1;
    found[exchange.question.id] = answerFrom(reply, exchange, line >= 0 ? excerpt(reply.text, line) : reply.text);
  }
  return found;
}

/** The line of the sentence that shares the most of these words, or -1 when none shares any. */
function mostAbout(question: Set<string>, sentences: Sentence[]): number {
  let best = { shared: 0, line: -1 };
  for (const sentence of sentences) {
    let shared = 0;
    for (const word of question) if (sentence.words.has(word)) shared += 1;
    if (shared > best.shared) best = { shared, line: sentence.line };
  }
  return best.line;
}

function answerFrom(message: ConversationMessage, exchange: Exchange, text: string): ConversationMessage {
  return { id: message.id, role: "assistant", text: inFlydsVoice(text), ...(message.timestamp ? { timestamp: message.timestamp } : {}), answers: exchange.question.id };
}

/**
 * Each note's answer as firstmate's newest word on it: its formal reply, or a
 * later chat reply about it. A note firstmate took and has no words on is
 * still answered, unless it is the newest one taken while firstmate is mid-turn. Pure.
 */
export function withFollowUps(exchanges: Exchange[], found: Record<string, ConversationMessage>, working = false): Exchange[] {
  const merged = exchanges.map((exchange) => {
    const chat = found[exchange.question.id];
    if (!chat) return exchange;
    const formal = exchange.answer ? Date.parse(exchange.answer.timestamp ?? "") : Number.NaN;
    return !exchange.answer || Date.parse(chat.timestamp ?? "") > formal ? { ...exchange, answer: chat, waiting: "" } : exchange;
  });
  const current = working ? merged.reduce((index, exchange, i) => (exchange.handoff === "taken" ? i : index), -1) : -1;
  return merged.map((exchange, i) =>
    exchange.handoff === "taken" && !exchange.answer && i !== current ? { ...exchange, waiting: "", answered: true } : exchange);
}
