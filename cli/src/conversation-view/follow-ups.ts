import { inFlydsVoice } from "./flyd-voice.js";
import { outcomeFirst, spoken } from "./rail.js";
import { clipKeepingLinks, inlineKeepingLinks } from "./line-links.js";
import type { ConversationMessage, Exchange } from "./types.js";

// A note that opened a domain run (every message he sends now does) is
// answered by firstmate's formal `fm-inbox.sh reply` on it, read from the
// inbox's receipts. Firstmate sometimes says its answer only in its own chat,
// in the turn that handled the note, and later turns report the work done or
// landed: for such a run, once its receipt shows the note was taken up, this
// finds the latest of those chat replies as the fallback: the turn whose tool
// lines named the note, then any later reply plainly about the same thing.
// One run's words are never another run's answer. Pure.

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
  const seen = new Map<string, number>();
  for (const message of replies) for (const word of parsed(message).words) seen.set(word, (seen.get(word) ?? 0) + 1);
  const common = (word: string): boolean => (seen.get(word) ?? 0) > Math.max(2, replies.length * COMMON_SHARE);
  const topics = notes.map((exchange) => new Set([...parsed(exchange.question).words].filter((word) => !common(word))));
  const asked = notes.map((exchange) => Date.parse(exchange.question.timestamp ?? ""));
  // Which notes name each word: a report is only weighed against notes sharing two words with one of its sentences.
  const naming = new Map<string, number[]>();
  topics.forEach((words, index) => {
    if (words.size < 2) return;
    for (const word of words) naming.set(word, [...(naming.get(word) ?? []), index]);
  });
  // An untagged report belongs to the one note it is most plainly about; the newer note wins a tie.
  const bestNote = (message: ConversationMessage): Array<{ exchange: Exchange; text: string }> => {
    const at = Date.parse(message.timestamp ?? "");
    const sentences = parsed(message).sentences;
    const candidates = new Set<number>();
    for (const sentence of sentences) {
      const shared = new Map<number, number>();
      for (const word of sentence.words) {
        for (const index of naming.get(word) ?? []) {
          const count = (shared.get(index) ?? 0) + 1;
          shared.set(index, count);
          if (count === 2) candidates.add(index);
        }
      }
    }
    let best: { exchange: Exchange; share: number; line: number } | undefined;
    for (const index of [...candidates].sort((a, b) => a - b)) {
      if (!Number.isNaN(asked[index]!) && !Number.isNaN(at) && at <= asked[index]!) continue;
      const about = aboutQuestion(topics[index]!, sentences);
      if (about.share > 0 && (!best || about.share >= best.share)) best = { exchange: notes[index]!, ...about };
    }
    // Only the part of the report about this note, unless the report is about nothing else.
    const part = best ? excerpt(message.text, best.line) : "";
    return best ? [{ exchange: best.exchange, text: message.text.includes("\n") ? part : message.text }] : [];
  };
  const found: Record<string, ConversationMessage> = {};
  // A note that opened a domain run is settled by firstmate's formal reply on it; its own chat is only the fallback,
  // and only once the receipts show firstmate took the note up. Words firstmate filed as one note's formal reply are
  // that note's, so its chat repeating them is never another note's answer.
  const formalOwner = new Map<string, string>();
  for (const exchange of exchanges) {
    if (exchange.answer?.id.startsWith("note-reply:")) formalOwner.set(exchange.answer.text.trim(), exchange.question.id);
  }
  const mayAnswer = (exchange: Exchange, message: ConversationMessage): boolean => {
    if (exchange.question.run && exchange.handoff !== "taken") return false;
    const owner = formalOwner.get(inFlydsVoice(message.text).trim());
    return !owner || owner === exchange.question.id;
  };
  // A turn that took in the outcome of crew work a note started reports on that note, when one of its sentences
  // shares two words with the note or with what firstmate said of the work when it took the note.
  const reported = (message: ConversationMessage): Array<{ exchange: Exchange; text: string }> => (message.reports ?? [])
    .filter((id) => byNote.has(id))
    .filter((id) => {
      const exchange = byNote.get(id)!;
      const earlier = found[exchange.question.id];
      const words = new Set([...topics[notes.indexOf(exchange)]!, ...(earlier ? [...parsed(earlier).words].filter((word) => !common(word)) : [])]);
      return parsed(message).sentences.some((sentence) => [...sentence.words].filter((word) => words.has(word)).length >= 2);
    })
    .map((id) => ({ exchange: byNote.get(id)!, text: message.text }));
  for (const message of replies) {
    const handled = (message.notes ?? []).filter((id) => byNote.has(id));
    // The turn that handled a note answers it; a reply naming no note may report on one it plainly is about.
    // A reply to a note not listed here is still that note's, never another's.
    const fromCrew = message.notes?.length ? [] : reported(message);
    const answered = message.notes?.length
      ? handled.map((id) => ({ exchange: byNote.get(id)!, text: message.text }))
      : fromCrew.length ? fromCrew : OUTCOME.test(message.text) ? bestNote(message) : [];
    for (const { exchange, text } of answered) if (mayAnswer(exchange, message)) found[exchange.question.id] = answerFrom(message, exchange, text);
  }
  // A note taken with others, its id never named again: the first reply firstmate settled after taking it.
  const settled = (working && messages.at(-1)?.role === "assistant" ? replies.filter((message) => message !== messages.at(-1)) : replies)
    .filter((message) => !message.wake)
    .map((message) => ({ message, at: Date.parse(message.timestamp ?? "") }));
  const batch: Array<{ exchange: Exchange; index: number; reply: ConversationMessage }> = [];
  notes.forEach((exchange, index) => {
    if (found[exchange.question.id] || exchange.answer || !exchange.takenAt) return;
    const taken = Date.parse(exchange.takenAt);
    const own = exchange.question.id.slice("note:".length);
    const reply = settled.find(({ message, at }) => at >= taken && (!message.notes?.length || message.notes.includes(own)))?.message;
    if (reply && mayAnswer(exchange, reply)) batch.push({ exchange, index, reply });
  });
  // One untagged report shared by several runs' notes answers a run only where a line of it is plainly about that run:
  // a report about one run is never another run's answer.
  const runsPerReply = new Map<ConversationMessage, number>();
  for (const { exchange, reply } of batch) if (exchange.question.run) runsPerReply.set(reply, (runsPerReply.get(reply) ?? 0) + 1);
  for (const { exchange, index, reply } of batch) {
    const shared = exchange.question.run && (runsPerReply.get(reply) ?? 0) > 1;
    if (shared && aboutQuestion(topics[index]!, parsed(reply).sentences).share === 0) continue;
    // The report covers the batch it took, so the line naming most of this note's words is its part.
    const line = reply.text.includes("\n") ? mostAbout(topics[index]!, parsed(reply).sentences) : -1;
    found[exchange.question.id] = answerFrom(reply, exchange, line >= 0 ? excerpt(reply.text, line) : reply.text);
  }
  return found;
}

/** Each message's topic words and sentences, worked out once: the window asks again on every transcript line. */
const parsedText = new WeakMap<ConversationMessage, { text: string; words: Set<string>; sentences: Sentence[] }>();

function parsed(message: ConversationMessage): { words: Set<string>; sentences: Sentence[] } {
  const cached = parsedText.get(message);
  if (cached?.text === message.text) return cached;
  const fresh = { text: message.text, words: topicWords(message.text), sentences: sentenceTopics(message.text) };
  parsedText.set(message, fresh);
  return fresh;
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
  const own = exchange.question.id.slice("note:".length);
  // The turn that took in the note's crew work looked at that work, as much as the turn that handled the note.
  const handled = message.notes?.includes(own) === true || message.reports?.includes(own) === true;
  const whole = inFlydsVoice(message.text);
  return {
    id: message.id,
    role: "assistant",
    text: whole.trim() === exchange.answer?.text.trim() ? whole : inFlydsVoice(text),
    ...(message.timestamp ? { timestamp: message.timestamp } : {}),
    answers: exchange.question.id,
    // Only the turn that handled the note looked at it; a later report's screenshot, or page, may be of anything.
    ...(handled && message.shots?.length ? { shots: message.shots } : {}),
    ...(handled && message.site ? { site: message.site } : {}),
  };
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
    // A run's note firstmate has not taken up has no answer but its formal reply, whatever its chat said.
    if (exchange.question.run && exchange.handoff !== "taken" && !exchange.answer) return exchange;
    const formal = exchange.answer ? Date.parse(exchange.answer.timestamp ?? "") : Number.NaN;
    // A note that opened a domain run is answered by its run's own reply; chat matched by topic words is only the fallback.
    const runReply = Boolean(exchange.question.run && exchange.answer?.id.startsWith("note-reply:"));
    if (!exchange.answer || (!runReply && Date.parse(chat.timestamp ?? "") > formal && chat.text.trim() !== exchange.answer.text.trim())) return { ...exchange, answer: chat, waiting: "" };
    // A formal reply keeps its words; the screenshot firstmate looked at for the note, and the page it changed, still lead it.
    const shots = chat.shots?.length && !exchange.answer.shots?.length ? { shots: chat.shots } : {};
    const page = chat.page && !exchange.answer.page ? { page: chat.page } : {};
    return Object.keys(shots).length || Object.keys(page).length ? { ...exchange, answer: { ...exchange.answer, ...shots, ...page } } : exchange;
  });
  const current = working ? merged.reduce((index, exchange, i) => (exchange.handoff === "taken" ? i : index), -1) : -1;
  return merged.map((exchange, i) =>
    exchange.handoff === "taken" && !exchange.answer && i !== current ? { ...exchange, waiting: "", answered: true } : exchange);
}

/** Longer than this, an inline outcome is clipped at a word. */
const OUTCOME_CHARS = 160;

/**
 * A note answered only in firstmate's own chat keeps that reply where it was
 * said; under his message, its outcome takes the place of the living line.
 * A formal reply stays the note's answer. Pure.
 */
export function inlineOutcomes(exchanges: Exchange[]): Exchange[] {
  return exchanges.map((exchange) => {
    // Taken and finished with, though no reply names it: the column says the same.
    if (exchange.answered && !exchange.answer) return { ...exchange, waiting: "Answered", settled: true };
    if (!exchange.answer || exchange.answer.id.startsWith("note-reply:") || !exchange.question.id.startsWith("note:")) return exchange;
    const { answer, ...rest } = exchange;
    // The screenshot behind the outcome, and the page it changed, go with it, under his message.
    const question = {
      ...rest.question,
      ...(answer.shots?.length ? { shots: answer.shots } : {}),
      ...(answer.page ? { page: answer.page } : {}),
    };
    return { ...rest, question, waiting: outcomeLine(answer.text, exchange.question.text), settled: true };
  });
}

/** Fewer shared words than this, a line is not plainly about his question. */
const ABOUT_WORDS = 2;

/**
 * As plain text, the reply's line plainly about his question (one reply often
 * covers a batch of notes), else its first line that says what changed.
 */
export function outcomeLine(text: string, question = ""): string {
  const said = outcomeFirst(spoken(text));
  const words = topicWords(question);
  const sentences = sentenceTopics(said);
  const line = words.size >= ABOUT_WORDS ? mostAbout(words, sentences) : -1;
  const shared = line >= 0 ? Math.max(...sentences.filter((sentence) => sentence.line === line).map((sentence) => [...words].filter((word) => sentence.words.has(word)).length)) : 0;
  const lead = shared >= ABOUT_WORDS ? excerpt(said, line) : said.split("\n").find((entry) => entry.trim()) ?? "";
  const flat = inlineKeepingLinks(lead.replace(/^\s*(?:[-*+]|\d+[.)]|#+)\s+/, ""));
  return clipKeepingLinks(flat, OUTCOME_CHARS, 60);
}
