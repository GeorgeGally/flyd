import { inFlydsVoice } from "./flyd-voice.js";
import { capitalise, clip, inline, SALUTATION, sentences } from "./summaries.js";
import type { ConversationMessage } from "./types.js";

// A reply that ends by asking him something, read as a choice he can make
// with one tap: the question in a sentence, and its options. A yes-or-no
// question is Yes / No; one that offers a numbered set ("Want me to add all
// three?") is all of them, any one of them, or none; "A or B?" is A and B; a
// list under "Which do you want?" is one button per item. An open question
// has no options, only his own words. Only the reply's closing words count:
// a question it raised and answered along the way is not put to him. Pure.

export interface ReplyChoice {
  /** The question, one sentence, in Flyd's words. */
  question: string;
  /** One tap each, in order; empty when only his own words can answer. */
  options: string[];
}

/** At most this many options; more is a list to read, not a choice to make. */
const MAX_OPTIONS = 6;
const OPTION_CHARS = 48;
/** A question shorter than this is read with the sentence before it. */
const SHORT_QUESTION = 40;
/** A closing sentence that asks without a question mark. */
const ASK_IMPERATIVE = /^(?:(?:please\s+)?(?:let me know|tell me|pick|choose)\b|your (?:call|decision|pick)\b)/i;
/** A question that asks which, what or how: answered by naming, never by yes or no. */
const OPEN_WORD = /^(?:which|what|how|where|when|who|whom|whose|why)\b/i;
/** Asks about a set the reply listed: "all three", "both", "these". */
const ABOUT_SET = /\b(?:all|both|these|them|each|any of|one of|which)\b/i;
/** Lead-ins that only make the question polite; the alternatives follow them. */
const LEAD_IN = /^(?:so,?\s+|then,?\s+|and\s+)?(?:do you want me to|would you like me to|want me to|should i|shall i|should we|shall we|do you want to|would you like to|do you want|would you like|do you prefer|would you prefer|prefer|is it)\s+/i;

/** A numbered option the reply listed: its number and what it is called. */
interface Listed {
  number?: string;
  label: string;
}

const LIST_ITEM = /^\s*(?:(\d+)[.)]|[-*+])\s+(.*)$/;
const TABLE_ROW = /^\s*\|(.*)\|\s*$/;
const TABLE_RULE = /^\s*\|[\s:|-]*-[\s:|-]*\|?\s*$/;

/** What a listed item is called: its bold lead-in, else its first clause, short. */
function labelOf(text: string): string {
  const bold = /^\*\*(.+?)\*\*/.exec(text.trim());
  const said = inline(bold ? bold[1]! : text).replace(/[:.]+$/, "").trim();
  const clause = bold ? said : said.split(/\s+[—–-]\s+|:\s|(?<=[a-z])\.\s/)[0]!.trim();
  return clip(capitalise(clause), OPTION_CHARS);
}

/** The cells of a Markdown table row. */
function cells(row: string): string[] {
  return TABLE_ROW.exec(row)![1]!.split("|").map((cell) => cell.trim());
}

/** The items of a list or table that runs over these lines, or [] when they are something else. */
function listed(lines: string[]): Listed[] {
  const rows = lines.filter((line) => line.trim());
  if (rows.length >= 3 && rows.every((line) => TABLE_ROW.test(line)) && TABLE_RULE.test(rows[1]!)) {
    return rows.slice(2).map((row) => {
      const [first = "", second = ""] = cells(row);
      const number = /^#?(\d+)\.?$/.exec(first)?.[1];
      return { ...(number ? { number } : {}), label: labelOf(number ? second : first) };
    }).filter((item) => item.label);
  }
  // Top-level items only; a nested line belongs to the item above it.
  const items = rows.filter((line) => !/^\s{2,}/.test(line) || !LIST_ITEM.test(line)).map((line) => LIST_ITEM.exec(line));
  if (items.length === 0 || items.some((item) => !item)) return [];
  return items.map((item) => ({ ...(item![1] ? { number: item![1] } : {}), label: labelOf(item![2]!) })).filter((item) => item.label);
}

/** The reply's blocks: runs of lines between blank lines, code blocks dropped. */
function blocksOf(text: string): string[][] {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").filter((line) => line.trim()))
    .filter((block) => block.length > 0);
}

/** A block is a list, a table, a heading, or prose. */
function isListBlock(block: string[]): boolean {
  return listed(block).length > 0;
}

/** The numbered set nearest above the question: a numbered list, or a table whose rows are numbered. */
function numberedSet(blocks: string[][]): Listed[] {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const items = listed(blocks[index]!);
    if (items.length >= 2 && items.every((item) => item.number)) return items;
  }
  return [];
}

/** The closing ask: the reply's last prose sentence, or the lead-in of a list it ends on. */
function closingAsk(blocks: string[][]): { sentence: string; context: string; after: Listed[]; before: string[][] } | null {
  let end = blocks.length - 1;
  let after: Listed[] = [];
  // A reply that ends on its options: the question is the line just above them.
  if (end >= 0 && isListBlock(blocks[end]!)) {
    after = listed(blocks[end]!);
    end -= 1;
  }
  const block = blocks[end];
  if (!block) return null;
  // A lead-in on the line right above its list ("Which do you want:\n1. …") sits in the same block.
  let lines = block;
  if (after.length === 0) {
    const firstItem = block.findIndex((line) => LIST_ITEM.test(line));
    if (firstItem > 0 && listed(block.slice(firstItem)).length >= 2) {
      after = listed(block.slice(firstItem));
      lines = block.slice(0, firstItem);
    }
  }
  const last = lines.at(-1)!;
  if (/^\s*(?:#|\|)/.test(last) || LIST_ITEM.test(last)) return null;
  const said = sentences(inline(last.replace(/^\s*>\s*/, "")).replace(SALUTATION, ""));
  const sentence = (said.at(-1) ?? "").replace(SALUTATION, "").trim();
  if (!sentence) return null;
  // "A or B?" alone says nothing; the sentence before it on the same line says what about.
  const context = sentence.length < SHORT_QUESTION && said.length > 1 ? said.at(-2)!.replace(SALUTATION, "").trim() : "";
  return { sentence, context, after, before: blocks.slice(0, end) };
}

/** "Should I merge now or wait for checks?": the alternatives, when each is short. */
function alternatives(question: string): string[] {
  const bare = question.replace(/[?:.]+$/, "").replace(LEAD_IN, "");
  if (/\bor (?:not|so|something|anything|otherwise)\b/i.test(bare)) return [];
  const parts = bare.split(/,\s*(?:or\s+)?|\s+or\s+/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 4 || parts.some((part) => part.split(/\s+/).length > 7)) return [];
  if (!/\bor\b/i.test(bare)) return [];
  return parts.map((part) => clip(capitalise(part), OPTION_CHARS));
}

/** "all three" → "Yes, all three"; "both" → "Yes, both". */
function yesToAll(question: string): string {
  const all = /\ball (two|three|four|five|six|\d+|of them)\b/i.exec(question);
  if (all) return `Yes, all ${all[1]!.toLowerCase()}`;
  return /\bboth\b/i.test(question) ? "Yes, both" : "Yes, all of them";
}

/** One option per listed item: "Only 1: Press feedback". */
function onlyOne(item: Listed): string {
  return clip(`Only ${item.number ? `${item.number}: ` : ""}${item.label}`, OPTION_CHARS + 8);
}

/** The choice a reply puts to him, or null when its closing words ask him nothing. */
export function choiceOf(text: string): ReplyChoice | null {
  const blocks = blocksOf(text);
  const ask = closingAsk(blocks);
  if (!ask) return null;
  const { sentence, context, after, before } = ask;
  const asks = /\?["”')\]]*$/.test(sentence) || ASK_IMPERATIVE.test(sentence) || (after.length >= 2 && /:$/.test(sentence));
  if (!asks) return null;
  const question = capitalise(inFlydsVoice([context, sentence.replace(/:$/, "?")].filter(Boolean).join(" ")));
  const lead = sentence.replace(LEAD_IN, "");
  // Options listed under the question are the choice.
  if (after.length >= 2 && after.length <= MAX_OPTIONS) return { question, options: after.map((item) => item.label) };
  const either = alternatives(sentence);
  if (either.length) return { question, options: either };
  const set = numberedSet(before);
  if (OPEN_WORD.test(lead) || OPEN_WORD.test(sentence) || ASK_IMPERATIVE.test(sentence)) {
    // "Which of these?" over a numbered set: one button per item; anything else is his to say.
    return { question, options: ABOUT_SET.test(sentence) && set.length >= 2 && set.length <= MAX_OPTIONS ? set.map((item) => item.label) : [] };
  }
  // A yes-or-no question about a numbered set: all of it, one of it, or none.
  if (ABOUT_SET.test(sentence) && set.length >= 2 && set.length <= MAX_OPTIONS - 2) {
    return { question, options: [yesToAll(sentence), ...set.map(onlyOne), "No"] };
  }
  return { question, options: ["Yes", "No"] };
}

/**
 * The reply still waiting on his choice: the newest assistant message after
 * his last word, when it asks him something and Flyd's model did not judge it
 * routine. Older asks were overtaken by what he said since. Pure.
 */
export function openChoice(
  messages: ConversationMessage[],
  routine: (message: ConversationMessage) => boolean = () => false,
): { message: ConversationMessage; choice: ReplyChoice } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "user") return null;
    if (routine(message)) continue;
    const choice = choiceOf(message.text);
    if (choice) return { message, choice };
  }
  return null;
}

/** Where his answer to a reply goes: the question it answers, else the reply itself. */
export function choiceTarget(message: ConversationMessage): string {
  return message.answers ?? message.id;
}
