import { choiceOf } from "./choices.js";
import { stateOf } from "./executive.js";
import { inFlydsVoice } from "./flyd-voice.js";
import { capitalise, clip, inline, isAcknowledgement, SALUTATION, sentences } from "./summaries.js";

// What George sees of his staff's chatter. Flyd is his chief of staff: the
// crew's progress reports, review findings, check status, internal decisions
// and "shipshape" acknowledgements are absorbed, never shown to him as a
// message. Only three things reach him, each in a line or two:
//
//   - something landed: one line and its link;
//   - a decision only he can make: one line, its options as buttons;
//   - a real failure or blocker: one line and what happens next.
//
// Anything Flyd shows him, relayed or its own, is held to a few short lines
// (condense); the full words wait behind "more". Pure.

/** The most lines any message Flyd shows him leads with. */
export const MAX_LINES = 3;
/** A short line, about what fits across the window at a glance. */
export const LINE_CHARS = 120;
/** The whole of what he reads first, at most. */
export const MAX_CHARS = MAX_LINES * LINE_CHARS;

export type GeorgeLine =
  /** Staff chatter: Flyd keeps it. */
  | { kind: "absorbed" }
  | { kind: "landed"; line: string; url?: string }
  | { kind: "decision"; line: string; options: string[] }
  | { kind: "blocker"; line: string };

const URL = /https?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"”’]/g;
const PULL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+\b/;
/** Quoted words are someone else's ("Merged deployed." was a garble it quoted), never the reply's own news. */
const QUOTED = /"[^"\n]*"|“[^”\n]*”/g;
const LANDED = /\b(?:merged|landed|shipped|(?:is|are) (?:now )?live|now live|went live|released|deployed|in main|on main)\b/i;
/** Landing that has not happened: ahead, conditional, negated, or waiting. */
const NOT_LANDED = /\b(?:ll|no|nothing|wrongly|marked|recorded|said|will|would|should|could|shall|going to|once|when|after|before|until|unless|if|ready to|waiting to|wait(?:ing)? for|to be|not|never|isn['’]?t|hasn['’]?t|wasn['’]?t|haven['’]?t|didn['’]?t|unmerged|yet|can|needs? to|about to|plan)\b/i;
/**
 * Work that stopped and stays stopped, said as such: "the deploy is blocked:",
 * "I'm stuck", "it blocked me", "I can't get past the login", "the deploy
 * failed", "gave up". A word on its own ("phrases are blocked", "a failed
 * upload", "finished or failed") is not.
 */
const STOPPED = new RegExp([
  String.raw`\b(?:is|are|was|were|got|still|now|['’]s)\s+(?:blocked|stuck)\s*(?:[:—–]|\b(?:on|by|until|waiting)\b)`,
  String.raw`\b(?:i|we)(?:['’]m|['’]re| am| are)?\s+(?:still\s+)?(?:blocked|stuck)\b`,
  String.raw`\b(?:blocked|stopped)\s+(?:me|us)\b`,
  String.raw`\b(?:i|we)\s+(?:can(?:no|['’])t|couldn['’]t|could not|(?:was|am|were) unable to)\s+(?:proceed|continue|finish|get past|get in|log in|sign in|deploy|push|publish|reach|access|connect)\b`,
  String.raw`\b(?:deploy(?:ment)?|release|publish(?:ing)?|launch|login|upload|server|site|payment)\s+(?:has\s+|have\s+)?failed\b`,
  String.raw`\bgave up\b`,
].join("|"), "i");
/** A failure already being put right, or worked around, is progress, not a blocker. */
const BEING_FIXED = /\b(?:so i|instead|worked around|fixing|retrying|re-?running|repairing|rerun|re-?trying|patching|fix(?:ed)? (?:it|that|this)|now passing|passes now|green now|no longer)\b/i;
/** A failure that was there before the work, or is not the work's: no news. */
const NOT_OURS = /\b(?:same way before|before this|pre-?existing|unrelated|flaky|already (?:failing|failed|broken)|as before)\b/i;
/** Work stuck on how it is built or checked is the staff's to clear, not news for him. */
const HOW_IT_RUNS = /\b(?:checks?|tests?|ci|lint|review(?:er)?|rebase|pipeline|branch|worktree|merge conflict|history|typecheck|build step)\b/i;
/** "No checks failed", "isn't blocked": the word without the news. */
const NEGATED = /\b(?:not|no|never|nothing|none|without|\w+n['’]t)(?:\s+[\w'’-]+){0,2}\s*$/i;
/** A question that asks his leave or his choice, not one the reply asks itself. */
const PUT_TO_HIM = /\b(?:may|can|shall|should) (?:i|we)\b|\b(?:do|would) you (?:want|like|prefer)\b|\bwant me to\b|\bok(?:ay)? (?:to|if)\b|\bwaiting on you\b|\byour (?:call|decision|go-ahead|ok|word)\b|\bwhich (?:one|option|do you)\b/i;
/** "Two things are waiting on you: shall I…": the lead-in before the question itself. */
const WAITING_ON_YOU = /^.*?\bwaiting on you:\s*/i;
/** Asked by naming, not by yes or no. */
const OPEN_ASK = /^(?:which|what|how|where|when|who)\b/i;
/** 'Say "X" and I'll…' at the start of a sentence: his word asked for. */
const SAY = /^(?:just )?say\s*(?:"([^"]+)"|“([^”]+)”)/i;
/** A sentence that says what happens next. */
const NEXT_STEP = /^(?:(?:so |and )?(?:i['’]?ll|i will|we['’]?ll|we will|next|instead|i['’]?m (?:now )?(?:retrying|trying|switching|moving)|the plan is|plan:))/i;

/** Where a clause turns: punctuation, or a word that opens the next one ("…after the review passed"). */
const CLAUSE = /[;—–]|\b(?:but|once|when|after|before|until|unless|if|because|while)\b/gi;
/**
 * "Everything that has landed…", "what landed earlier": the verb describes what it names, not news
 * that it happened. "That" only after a word it describes; "all of that has landed" is news.
 */
const RELATIVE = /(?:\b(?:what|whatever)|(?<=\b(?!(?:of|and|but|so|or|then|is|was|are|were)\b)\w+\s+)(?:that|which))\s+(?:(?:has|have|had)\s+)?(?:been\s+)?$/i;

/** Whether some match of `verb` says it happened, read in its own clause only. */
function happened(sentence: string, verb: RegExp): boolean {
  for (const match of sentence.matchAll(new RegExp(verb.source, "gi"))) {
    if (RELATIVE.test(sentence.slice(0, match.index))) continue;
    let start = 0;
    let end = sentence.length;
    for (const turn of sentence.matchAll(CLAUSE)) {
      if (turn.index! <= match.index!) start = /\w/.test(turn[0]) ? turn.index! : turn.index! + 1;
      else if (turn.index! >= match.index! + match[0].length) { end = turn.index!; break; }
    }
    if (!NOT_LANDED.test(sentence.slice(start, end))) return true;
  }
  return false;
}

/** A sentence that reports work stopped, read without its negated forms. */
function stops(sentence: string): boolean {
  const match = STOPPED.exec(sentence);
  if (!match) return false;
  return !NEGATED.test(sentence.slice(0, match.index)) && !BEING_FIXED.test(sentence) && !NOT_OURS.test(sentence) && !HOW_IT_RUNS.test(sentence);
}

/** A command line: what a terminal takes, not words for him. */
const SHELL = /^[!$>]?\s*(?:cd|npx|npm|node|git|gh|bash|sh|zsh|brew|make|python3?|pip|curl|rm|ls|cat|sudo|open|flyd|tsx|yarn|pnpm)\b/;
/** "To run it yourself, type:" with its command taken out says nothing. */
const TYPE_THIS = /(?:^|(?<=[.!?]\s))[^.!?]*\b(?:type|run|paste|enter)(?: this| it)?:\s*$/i;
/** A line that only labels what follows ("Flyd (merged):"), saying nothing itself. */
const LABEL = /^\S+(?:\s+\S+){0,4}:$/;

/** The prose sentences of a reply, lists flattened, code, tables and bare labels out, salutations dropped. */
function proseSentences(text: string): string[] {
  const prose = text
    .replace(/```[\s\S]*?```/g, " ")
    // A shell command is never put in front of him; whoever needs it has it behind "more".
    .replace(/`([^`\n]+)`/g, (code, inner: string) => (SHELL.test(inner.trim()) ? "\n" : code))
    .split("\n")
    .filter((line) => !line.trim().startsWith("|"))
    .map((line) => inline(line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, "")))
    // "To run it yourself, type:" with its command taken out says nothing.
    .map((line) => line.replace(TYPE_THIS, "").trim())
    .filter((line) => line && !LABEL.test(line))
    .map((line) => (/[.!?:]["”')\]]*$/.test(line) ? line : `${line}.`))
    .join(" ");
  return sentences(prose).map((sentence) => capitalise(sentence.replace(SALUTATION, "").trim())).filter(Boolean);
}

/** One sentence as a line: plain words, links out, at most LINE_CHARS. */
function asLine(sentence: string): string {
  // A pull request's link follows the line; a site is named by its address.
  const named = inline(sentence).replace(URL, (url) => (PULL.test(url) ? "" : url.replace(/^https?:\/\/(?:www\.)?/, "").replace(/\/$/, "")));
  return capitalise(clip(named.replace(/\(\s*\)/g, "").replace(/\s+([.,;:!?])/g, "$1").replace(/(?<!\.)([.!?])\.(?=\s|$)/g, "$1").replace(/:\.$/, ":").replace(/\s+/g, " ").trim(), LINE_CHARS));
}

/** The link a landing names: a pull request first, else any link in the sentence, else in the reply. */
function linkFor(sentence: string, text: string): string | undefined {
  const raw = (s: string) => [...s.matchAll(URL)].map((match) => match[0]);
  const near = raw(sentence);
  const all = raw(text);
  return near.find((url) => PULL.test(url)) ?? all.find((url) => PULL.test(url)) ?? near[0];
}

/**
 * What a staff reply comes to for George: absorbed, or the one line he needs.
 * A question to him wins, unless Flyd already answered it for him (`handled`);
 * then a real stop; then something that landed. Everything else (progress,
 * findings, checks, internal calls, acks) is Flyd's to keep. Pure.
 */
export function staffLine(text: string, handled?: (text: string) => boolean): GeorgeLine {
  const choice = choiceOf(text);
  if (choice) {
    // Several questions at once are put to him one at a time, the first still his named here.
    const [first, ...more] = (choice.steps ?? []).filter((step) => !handled?.(step.question));
    if (first) return { kind: "decision", line: `${asLine(first.question)}${more.length ? ` (and ${more.length} more)` : ""}`, options: first.options };
    if (!choice.steps && !handled?.(choice.question)) return { kind: "decision", line: asLine(choice.question), options: choice.options };
  }
  // Links and quotes are looked at apart from the words: "Merged deployed." quoted is no landing.
  const said = proseSentences(text.replace(URL, (url) => ` ${url} `));
  // A question put to him mid-reply ("still waiting on you: may I delete…? A backup is taken first.") is his too.
  const asked = said.find((sentence) => /\?["”')\]]*$/.test(sentence) && PUT_TO_HIM.test(sentence.replace(QUOTED, " ")) && !handled?.(sentence.replace(WAITING_ON_YOU, "")));
  if (asked) return { kind: "decision", line: asLine(asked.replace(WAITING_ON_YOU, "")), options: OPEN_ASK.test(asked.replace(/^.*?:\s*/, "")) ? [] : ["Yes", "No"] };
  // 'Still waiting on your "merge them" for: …' names his word in quotes.
  const awaited = said.map((sentence) => /\bwaiting (?:on|for) your\s+["“]([^"”]+)["”]/i.exec(sentence)).find(Boolean);
  if (awaited) {
    const words = capitalise(awaited[1]!.trim().replace(/[.!?,;:]+$/, ""));
    return { kind: "decision", line: `${words}?`, options: [words, "Not yet"] };
  }
  // 'Say "drop the local edit" and I'll…' asks him, without a question mark.
  const say = said.map((sentence) => SAY.exec(sentence)).find(Boolean);
  if (say) return { kind: "decision", line: asLine(`${(say[1] ?? say[2])!.trim().replace(/[.!?,;:]+$/, "")}?`), options: [capitalise((say[1] ?? say[2])!.trim().replace(/[.!?,;:]+$/, "")), "Not yet"] };
  const words = said.map((sentence) => sentence.replace(QUOTED, " "));
  const stop = words.findIndex(stops);
  if (stop >= 0) {
    const next = said.slice(stop + 1).find((sentence) => NEXT_STEP.test(sentence));
    return { kind: "blocker", line: `${asLine(said[stop]!)}${next ? ` ${asLine(next)}` : ""}` };
  }
  // "Done: the junk is gone" reports the thing he asked for, finished.
  const landed = words.findIndex((sentence, index) => happened(sentence, LANDED) || (index === 0 && /^done\b[:.,!—–-]/i.test(sentence) && !NOT_LANDED.test(sentence)));
  if (landed >= 0) {
    const url = linkFor(said[landed]!, text);
    return { kind: "landed", line: asLine(said[landed]!), ...(url ? { url } : {}) };
  }
  return { kind: "absorbed" };
}

/** The line as Markdown: the landing's link on its own words, in Flyd's voice. */
export function georgeMarkdown(said: Exclude<GeorgeLine, { kind: "absorbed" }>): string {
  const line = inFlydsVoice(said.line);
  if (said.kind !== "landed" || !said.url) return line;
  // A site the line already names by its address needs no second copy.
  const address = said.url.replace(/^https?:\/\/(?:www\.)?/, "").replace(/\/$/, "");
  return line.includes(address) ? line : `${line} ${said.url}`;
}

/**
 * Any text Flyd shows him, held to MAX_LINES short lines: lists and headings
 * flattened to prose, sentences kept whole from the top until the next would
 * pass the budget. A sentence that waits on him is always kept, unless a card
 * already asks it (`keepAsk: false`). Links in what is kept stay; a pull
 * request named only in what was cut is kept at the end. The full text waits
 * behind "more". Pure.
 */
export function condense(text: string, options: { maxChars?: number; keepAsk?: boolean } = {}): string {
  const maxChars = options.maxChars ?? MAX_CHARS;
  const trimmed = text.trim();
  if (!trimmed) return "";
  const said = proseSentences(trimmed);
  // "You're right." only acknowledges; what he needs starts after it.
  while (said.length > 1 && isAcknowledgement(said[0]!)) said.shift();
  if (said.length === 0) return clip(inline(trimmed), maxChars);
  const kept: string[] = [];
  let used = 0;
  for (const sentence of said) {
    const length = shownLength(sentence) + (kept.length ? 1 : 0);
    if (kept.length && used + length > maxChars) break;
    if (kept.length >= MAX_LINES) break;
    kept.push(kept.length === 0 && length > maxChars ? clip(sentence, maxChars) : sentence);
    used += length;
  }
  // What waits on him is never cut: his decision takes the place of the last line that would not fit beside it.
  const ask = options.keepAsk === false ? undefined : said.find((sentence) => ASKS_HIM.test(sentence));
  if (ask && !kept.includes(ask)) {
    while (kept.length > 1 && (kept.length >= MAX_LINES || kept.reduce((sum, sentence) => sum + shownLength(sentence) + 1, 0) + shownLength(ask) > maxChars)) kept.pop();
    kept.push(shownLength(kept[0]!) + shownLength(ask) + 1 > maxChars ? clip(ask, Math.max(80, maxChars - shownLength(kept[0]!) - 1)) : ask);
  }
  const out = kept.join(" ");
  const pull = trimmed.match(PULL)?.[0];
  return pull && !out.includes(pull) ? `${out} ${pull}` : out;
}

/** A sentence that asks him something or waits on his word. */
const ASKS_HIM = /\?["”')\]]*$|\b(?:decide|your (?:call|decision|word|go-ahead|ok|approval)|needs? (?:you|your)|waiting (?:on|for) you)\b/i;

/** A link reads as a short link, not its whole address. */
const LINK_CHARS = 24;

/** How long text reads on screen, each link counted as a short one. */
function shownLength(text: string): number {
  return text.replace(URL, "x".repeat(LINK_CHARS)).length;
}

/** Whether text already fits what he reads first: short, with no list or table to scan. */
export function fitsAtAGlance(text: string): boolean {
  return shownLength(text.trim()) <= MAX_CHARS && !/^\s*(?:(?:[-*+]|\d+[.)])\s|\|)/m.test(text);
}

/** Words with a link taken out of them, put back together: no stray commas or empty brackets. */
function tidy(text: string): string {
  return text.replace(/\(\s*\)/g, "").replace(/\s*,\s*,/g, ",").replace(/^[\s:,;—–-]+/, "").replace(/[\s:,;]+$/, "").replace(/\s+([,.;:])/g, "$1").replace(/\s+/g, " ").trim();
}

/** Where a piece of work stands; "handled" is a question of his Flyd already answered for him. */
export type OutcomeState = "landed" | "underway" | "needs" | "stuck" | "note" | "handled";

export interface OutcomeCard {
  /** What the piece of work is, in a few words. */
  title: string;
  /** Where it stands, one short line; empty when the title says it all. */
  line: string;
  state: OutcomeState;
  url?: string;
}

/** A reply that reports several pieces of work: its opening line and one card per piece. */
export interface Outcomes {
  lead?: string;
  items: OutcomeCard[];
}

const ITEM = /^(?:\d+[.)]|[-*+])\s+(.+)$/;
/** Finished, as a card's chip reads it: fixed, done, added, live, gone. */
const DONE = /\b(?:fixed|done|added|finished|completed|works now|now works|live|(?:is|are) gone|removed|replaced)\b/i;
/** No more cards than this at once: the rest of the reply waits behind "more". */
const MAX_CARDS = 6;
/** Few enough words before a colon to be a name, not a sentence. */
const NAMED = /^([^:.!?]{2,60}?):\s+(.+)$/;
const TITLE_CHARS = 70;

/** Where one piece of work stands, from its own words. */
export function stateOfItem(words: string): OutcomeState {
  const said = words.replace(QUOTED, " ");
  if (/\?["”')\]]*$/.test(said.trim()) || PUT_TO_HIM.test(said)) return "needs";
  // On a card a piece of work that is stuck says so, whatever it is stuck on.
  const stuck = /\b(?:stuck|blocked|failed|failing)\b/i.exec(said);
  if (stuck && !NEGATED.test(said.slice(0, stuck.index)) && !BEING_FIXED.test(said)) return "stuck";
  if (happened(said, DONE)) return "landed";
  const state = stateOf(said);
  if (state === "landed" && !NOT_LANDED.test(said)) return "landed";
  if (state === "needs") return "needs";
  if (state === "underway") return "underway";
  return happened(said, LANDED) ? "landed" : "note";
}

/**
 * A reply that lists several pieces of work ("**Chief-of-staff voice**: the
 * phantom alerts are fixed…") as cards, one per piece: its name, where it
 * stands in a line, a state, and its link; a question Flyd already answered
 * for him (`handled`) reads as handled, not his call. Null when the reply is
 * not such a list: fewer than two top-level items. Pure.
 */
export function outcomesOf(text: string, handled?: (text: string) => boolean): Outcomes | null {
  const lines = text.replace(/```[\s\S]*?```/g, "").split("\n");
  const items: OutcomeCard[] = [];
  let firstItem = -1;
  // A lead-in such as "**Flyd (merged):**" says where the items under it stand.
  let context: OutcomeState = "note";
  for (const [index, raw] of lines.entries()) {
    const found = ITEM.exec(raw);
    if (!found) {
      const said = inline(raw).trim();
      if (said) context = /:$/.test(said) ? stateOfItem(said.replace(/:$/, "")) : "note";
      continue;
    }
    if (firstItem < 0) firstItem = index;
    const item = found[1]!;
    const url = item.match(URL)?.find((link) => PULL.test(link)) ?? item.match(URL)?.[0];
    const bold = /^\*\*(.+?)\*\*\s*[:.—–-]?\s*(.*)$/.exec(item);
    // Links go on the card, not in its words.
    const plain = tidy(inline(item.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")).replace(URL, ""));
    let title: string;
    let rest: string;
    // "**Flyd decides itself** and Flyd watches staff are stuck…": the bold words open a sentence, they do not name the item.
    if (bold && !/^(?:and|or|but|&|,)/i.test(bold[2]!.trim())) {
      title = tidy(inline(bold[1]!).replace(URL, ""));
      rest = tidy(inline(bold[2]!).replace(URL, ""));
    } else {
      const named = NAMED.exec(plain);
      title = named ? named[1]! : sentences(plain)[0] ?? plain;
      rest = named ? named[2]! : sentences(plain).slice(1).join(" ");
    }
    const first = sentences(rest.replace(URL, "").trim())[0] ?? "";
    const own = stateOfItem(`${title} ${rest}`);
    const state = own === "note" ? context : own;
    items.push({
      title: capitalise(clip(inFlydsVoice(title).replace(/\.$/, ""), TITLE_CHARS)),
      line: first ? asLine(inFlydsVoice(first)) : "",
      state: state === "needs" && handled?.(item) ? "handled" : state,
      ...(url ? { url } : {}),
    });
  }
  if (items.length < 2) return null;
  items.splice(MAX_CARDS);
  const opening = lines.slice(0, Math.max(0, firstItem)).join("\n");
  const said = proseSentences(opening).filter((sentence) => !LABEL.test(sentence));
  const lead = said.length ? asLine(inFlydsVoice(said[0]!)) : undefined;
  return { ...(lead ? { lead } : {}), items };
}

/**
 * A single reply as one compact card: its first line said whole, the next as
 * the line under it, and where that leaves the work. Pure.
 */
export function replyCard(text: string): { state: OutcomeState; line: string; sub?: string } | null {
  const said = sentences(condense(text, { keepAsk: true }).replace(URL, "").replace(/\s+([.,;:])/g, "$1"));
  if (!said[0]) return null;
  const line = clip(said[0], LINE_CHARS * 2);
  const sub = said[1] ? clip(said[1], LINE_CHARS * 2) : undefined;
  return { state: stateOfItem(said.slice(0, 2).join(" ")), line, ...(sub ? { sub } : {}) };
}
