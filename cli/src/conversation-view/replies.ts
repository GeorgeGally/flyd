import { outcomeFirst, spoken } from "./rail.js";
import { clip, inline, sentences } from "./summaries.js";
import type { ConversationMessage, Exchange } from "./types.js";

// His reply to one answer: written in the window under that answer, it goes
// out as an ordinary note (or question to Flyd) whose first line says what it
// answers, so whoever reads it knows what "that" means. The line is hidden
// again when the note is shown, and the reply is threaded under the answer.

/** How much of his note and of the answer the reply quotes. */
const QUOTE_CHARS = 160;

const MARKER = /^\[Captain is replying from Flyd to ((?:note|ask):[\w.-]+) — his note: "([^"\n]*)"[^\n]*\]\n*/;

/** One line, no brackets or double quotes to break the marker. */
function quoted(text: string): string {
  return clip(inline(text).replace(/[[\]]/g, "").replace(/"/g, "'"), QUOTE_CHARS);
}

/** The answer's first sentence, as he read it. */
function opening(answer: ConversationMessage): string {
  const [first = ""] = sentences(inline(outcomeFirst(spoken(answer.text)).split("\n").find((line) => line.trim()) ?? ""));
  return quoted(first);
}

/** The note that carries his reply to this exchange's answer. Pure. */
export function replyNote(parent: Exchange, words: string): string {
  const answer = parent.answer?.text ? parent.answer : undefined;
  const said = answer ? opening(answer) : parent.settled && parent.waiting ? quoted(parent.waiting) : "";
  const shot = (answer?.shots ?? parent.question.shots ?? []).find((path) => path.startsWith("/"));
  const marker = `[Captain is replying from Flyd to ${parent.question.id} — his note: "${quoted(parent.question.text)}"`
    + `${said ? `; your answer began: "${said}"` : ""}${shot ? `; the answer's screenshot: ${shot}` : ""}. His reply follows.]`;
  return `${marker}\n\n${words.trim()}`;
}

/** A message with its reply line read: his own words, and what they answer. Pure. */
export function readReply(message: ConversationMessage): ConversationMessage {
  const found = MARKER.exec(message.text);
  if (!found) return message;
  return { ...message, text: ownWords(message.text), replyTo: found[1]!, replyQuote: found[2]! };
}

/** His own words in a message, its reply line gone. Pure. */
export function ownWords(text: string): string {
  const found = MARKER.exec(text);
  return found ? text.slice(found[0].length).trim() : text;
}

/** Exchanges with each reply's line read. Pure. */
export function threaded(exchanges: Exchange[]): Exchange[] {
  return exchanges.map((exchange) => {
    const question = readReply(exchange.question);
    return question === exchange.question ? exchange : { ...exchange, question };
  });
}
