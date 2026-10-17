import { outcomeFirst, spoken } from "./rail.js";
import { clip, inline, sentences } from "./summaries.js";
import type { ConversationMessage, Exchange } from "./types.js";

// His reply to one answer: written in the window under that answer, it goes
// out as an ordinary note (or question to Flyd) whose first line says what it
// answers, so whoever reads it knows what "that" means. The line is hidden
// again when the note is shown, and the reply is threaded under the answer.
// His answer to a question a session asked in its own reply (see choices.ts)
// goes out the same way, its line quoting that question. So does an answer
// Flyd gave for him by one of his standing rules (see auto-answers.ts), its
// line naming the rule, and his taking such an answer back.

/** How much of his note and of the answer the reply quotes. */
const QUOTE_CHARS = 160;

// A reply to a session's own message names it by its id and quotes its question instead of his note.
const MARKER = /^\[(Captain is replying from Flyd|Flyd is answering for the captain) to ((?:note|ask):[\w.-]+|reply:[\w.#:-]+) — (?:his note|your question): "([^"\n]*)"([^\n]*)\]\n*/;
/** The standing rule an answer Flyd gave for him was settled by, as the line quotes it. */
const RULE = /; by his standing rule: "([^"\n]*)"/;
const TAKEN_BACK = /; he takes back the answer Flyd gave for him\b/;

/** One line, no brackets or double quotes to break the marker: how a note quotes the question it answers. */
export function quoted(text: string): string {
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

/**
 * The note that carries his answer to a question the session put to him in
 * its own reply, not under any note of his: it quotes the question and the
 * reply's opening, so the session knows what his "yes" says yes to. Pure.
 */
export function answerNote(message: ConversationMessage, question: string, words: string): string {
  const said = opening(message);
  const asked = quoted(question);
  const marker = `[Captain is replying from Flyd to ${message.id} — your question: "${asked}"`
    + `${said && said !== asked ? `; your reply began: "${said}"` : ""}. His answer follows.]`;
  return `${marker}\n\n${words.trim()}`;
}

/**
 * The note that answers, for him, a question put to him, when one of his
 * standing rules already settles it. It says it is Flyd's answer, which rule
 * gave it, and that Flyd gives it with his delegated authority, so the
 * session acts on it as his word and knows he can still take it back. Pure.
 */
export function autoAnswerNote(target: string, question: string, answer: string, rule: string): string {
  return `[Flyd is answering for the captain to ${target} — your question: "${quoted(question)}"; by his standing rule: "${quoted(rule)}". Flyd decides this with his delegated authority: act on it as his word. He can take it back.]\n\n${answer.trim()}`;
}

/** The note that takes back an answer Flyd gave for him: hold off until he answers himself. Pure. */
export function undoNote(target: string, question: string, answer: string): string {
  return `[Captain is replying from Flyd to ${target} — your question: "${quoted(question)}"; he takes back the answer Flyd gave for him ("${quoted(answer)}") and will answer himself. Hold off until he does.]\n\nHold off on that; I'll answer this one myself.`;
}

/** The longest passage he can comment on, in characters. */
export const PASSAGE_CHARS = 2000;

/**
 * His comment on a passage he selected in one message of a conversation: it
 * names the conversation and whose words they were and quotes the passage
 * whole, so whoever reads it knows what "this" is without the screen. Pure.
 */
export function passageNote(passage: { quote: string; from: "user" | "assistant"; assistant: string; conversation: { id: string; title?: string } }, words: string): string {
  const whose = passage.from === "user" ? "my message" : `${passage.assistant}'s reply`;
  const title = passage.conversation.title?.trim();
  const where = title && title !== passage.conversation.id ? `"${title}" (session ${passage.conversation.id})` : `session ${passage.conversation.id}`;
  const quote = passage.quote.trim().replace(/\n{3,}/g, "\n\n").split("\n").map((line) => `> ${line}`.trimEnd()).join("\n");
  return `Comment on a passage of ${whose} in the conversation ${where}:\n\n${quote}\n\n${words.trim()}`;
}

/** A message with its reply line read: his own words, and what they answer. Pure. */
export function readReply(message: ConversationMessage): ConversationMessage {
  const found = MARKER.exec(message.text);
  if (!found) return message;
  const rule = found[1]!.startsWith("Flyd") ? RULE.exec(found[4]!)?.[1] : undefined;
  return {
    ...message,
    text: ownWords(message.text),
    replyTo: found[2]!,
    replyQuote: found[3]!,
    ...(rule !== undefined ? { answeredFor: rule } : {}),
    ...(TAKEN_BACK.test(found[4]!) ? { undoes: true } : {}),
  };
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
