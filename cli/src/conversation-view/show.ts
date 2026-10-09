import { inFlydsVoice } from "./flyd-voice.js";
import { asksForDecision, headlineOf, statusOf } from "./status.js";
import { capitalise, clip, inline, isRoutine, sentences } from "./summaries.js";
import type { ConversationMessage, ConversationSnapshot } from "./types.js";

// Show mode: Flyd's own picture of what matters now, for the Conversation
// window's visual screen. Not a dashboard: at most three things, picked in a
// fixed order of what deserves his eyes most (a call only he can make, what
// just landed, what is moving right now, a question of his still waiting, the
// latest word from the fleet), each one headline in Flyd's words. Pure: the
// same snapshot, clock, readings and projects always pick the same things.

export type ShowKind = "call" | "landed" | "live" | "waiting" | "news" | "clear";

export interface ShowLink {
  label: string;
  url: string;
}

export interface ShowItem {
  /** Stable while it is the same thing, so the page animates only what is new. */
  id: string;
  kind: ShowKind;
  /** One line, in Flyd's words. */
  headline: string;
  /** Why Flyd shows it, in a few words. */
  why: string;
  at?: string;
  /** Pull requests it names. */
  links?: ShowLink[];
  /** His own name for the project it belongs to, when Flyd knows it. */
  project?: string;
  /** The conversation message it comes from, so the page can open it in the terminal. */
  ref?: string;
}

export interface ShowScreen {
  /** Flyd's opening line, to him. */
  title: string;
  items: ShowItem[];
  /** The assistant is working right now. */
  live: boolean;
}

export interface ShowProject {
  name: string;
  repos: string[];
}

export interface ShowInputs {
  now?: number;
  /** Who answers his software questions, as he knows it. */
  assistant?: string;
  /** Flyd's own reading of a message (its interpretation or summary), when it has one. */
  reading?: (message: ConversationMessage) => string | undefined;
  /** A reply Flyd's model judged routine: the terminal mutes it, show mode passes it over. */
  muted?: (message: ConversationMessage) => boolean;
  projects?: ShowProject[];
}

export const MAX_SHOW_ITEMS = 3;
const LANDED_WITHIN_MS = 24 * 60 * 60 * 1000;
const NEWS_WITHIN_MS = 6 * 60 * 60 * 1000;
const HEADLINE_CHARS = 110;
const MAX_LINKS = 2;

const PR_URL = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\b/g;
const SALUTATION = /^(?:captain|sir|george|boss)\s*[,!:—-]\s*/i;
/** Work that finished: merged, shipped, deployed, green. */
const LANDED = /\b(?:merged|landed|shipped|released|deployed|went live|is live|now live|(?:checks?|ci) (?:are |is |all )?(?:green|passed|passing)|all green)\b/i;
/** The same words about something that has not happened yet. */
const NOT_YET = /\b(?:not|never|yet to|until|once|if|when|will|would|could|should|ready to|waiting for|wait for)\b|n't\b|\bcan (?:merge|land|ship)\b/i;
/** Work handed to him: his merge, his review, his ok. */
const FOR_HIM = /\bready (?:to |for (?:your |a |the )?)(?:merge|review|land)\b|\bawaits? your\b|\bwaiting (?:on|for) (?:you|your)\b|\bneeds? your (?:merge|review|ok|approval|call|decision|go-ahead)\b/i;

/** Firstmate's words to him: its replies, its relayed updates and its answers to his notes; never Flyd's own answers to his questions. */
function fromFleet(message: ConversationMessage): boolean {
  return message.role === "assistant" && !(message.answers && !message.answers.startsWith("note:"));
}

function age(message: ConversationMessage, now: number): number {
  const at = message.timestamp ? Date.parse(message.timestamp) : Number.NaN;
  // Without a time, the order of the conversation is all there is: count it as recent.
  return Number.isNaN(at) ? 0 : now - at;
}

/** Prose sentences of a message, links shortened, code and salutation dropped. */
function proseSentences(text: string): string[] {
  const prose = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(PR_URL, (_url, _owner: string, _repo: string, number: string) => `#${number}`)
    .split("\n")
    .map((line) => line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*|»\s*)/, ""))
    .filter((line) => line.trim() && !line.trim().startsWith("|"))
    .join(" ");
  return sentences(inline(prose).replace(SALUTATION, "")).map((sentence) => sentence.replace(SALUTATION, ""));
}

function tidy(line: string): string {
  return capitalise(clip(inFlydsVoice(line.replace(/\s+/g, " ").trim()), HEADLINE_CHARS));
}

/** The question in a message that asks him something, with the sentence before it when the question alone is short ("A or B?"). */
function askLine(text: string): string | null {
  const said = proseSentences(text);
  const asking = /\?|\b(?:do you want|would you like|should i|shall i|want me to|your call|your decision|ok to|okay to|approve)\b/i;
  let index = -1;
  for (let at = said.length - 1; at >= 0; at -= 1) {
    if (asking.test(said[at]!) || FOR_HIM.test(said[at]!)) {
      index = at;
      break;
    }
  }
  if (index === -1) return null;
  const line = said[index]!.length < 40 && index > 0 ? `${said[index - 1]} ${said[index]}` : said[index]!;
  return tidy(line);
}

/** The sentence that says something landed, and only one that says it already did. */
function landedLine(text: string): string | null {
  const line = proseSentences(text).find((sentence) => LANDED.test(sentence) && !NOT_YET.test(sentence));
  return line ? tidy(line) : null;
}

function headline(text: string): string {
  return tidy(headlineOf(text.replace(PR_URL, (_url, _owner: string, _repo: string, number: string) => `#${number}`)).replace(SALUTATION, ""));
}

function linksIn(text: string): ShowLink[] {
  const links: ShowLink[] = [];
  for (const match of text.matchAll(PR_URL)) {
    if (links.some((link) => link.url === match[0])) continue;
    links.push({ label: `${match[2]} #${match[3]}`, url: match[0] });
    if (links.length === MAX_LINKS) break;
  }
  return links;
}

const base = (path: string) => path.replace(/\/+$/, "").split("/").pop()!.toLowerCase();
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** His own name for what a message is about: the project whose repo its pull request is in, else the first project it names. */
function projectOf(text: string, projects: ShowProject[]): string | undefined {
  for (const match of text.matchAll(PR_URL)) {
    const repo = match[2]!.toLowerCase();
    const owner = projects.find((project) => project.repos.some((path) => base(path) === repo) || slug(project.name) === repo);
    if (owner) return owner.name;
  }
  let best: { name: string; at: number } | undefined;
  for (const project of projects) {
    if (project.name.trim().length < 3) continue;
    const escaped = project.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const at = new RegExp(`\\b${escaped}\\b`, "i").exec(text)?.index;
    if (at !== undefined && (!best || at < best.at)) best = { name: project.name, at };
  }
  return best?.name;
}

/** Flyd's three things: what he needs to see now, most important first. */
export function showOf(snapshot: ConversationSnapshot, inputs: ShowInputs = {}): ShowScreen {
  const now = inputs.now ?? Date.now();
  const assistant = inputs.assistant ?? "firstmate";
  const projects = inputs.projects ?? [];
  const messages = snapshot.messages;
  const readingOf = (message: ConversationMessage): string => inputs.reading?.(message) || message.text;
  const routine = (message: ConversationMessage): boolean => isRoutine(message.text) || inputs.muted?.(message) === true;
  const used = new Set<string>();
  const items: ShowItem[] = [];
  const add = (kind: ShowKind, message: ConversationMessage | null, item: Omit<ShowItem, "id" | "kind">) => {
    if (message) used.add(message.id);
    const links = message ? linksIn(message.text) : [];
    const project = message ? projectOf(message.text, projects) : undefined;
    items.push({
      id: `${kind}:${message?.id ?? kind}`,
      kind,
      ...item,
      ...(message?.timestamp && !item.at ? { at: message.timestamp } : {}),
      ...(links.length ? { links } : {}),
      ...(project ? { project } : {}),
      ...(message ? { ref: message.id } : {}),
    });
  };

  // A call only he can make: the newest ask since he last spoke.
  let lastCaptain = -1;
  messages.forEach((message, index) => {
    if (message.role === "user") lastCaptain = index;
  });
  const since = messages.slice(lastCaptain + 1).filter((message) => fromFleet(message) && !routine(message));
  const call = [...since].reverse().find((message) => asksForDecision(message.text) || FOR_HIM.test(message.text));
  if (call) add("call", call, { headline: askLine(readingOf(call)) ?? askLine(call.text) ?? headline(readingOf(call)), why: "waiting on you" });

  // What just landed: the newest reply in the last day that says work finished.
  const fresh = (message: ConversationMessage, within: number) => fromFleet(message) && !used.has(message.id) && age(message, now) < within && !routine(message);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (!fresh(message, LANDED_WITHIN_MS)) continue;
    const line = landedLine(message.text);
    if (line) {
      add("landed", message, { headline: line, why: "just landed" });
      break;
    }
  }

  // What is moving right now.
  const status = statusOf(snapshot, now);
  if (status.working) {
    items.push({
      id: "live",
      kind: "live",
      headline: tidy(status.activity ?? "Working on it"),
      why: `${assistant} is on it now`,
      ...(snapshot.lastActivity ? { at: snapshot.lastActivity } : {}),
    });
  }

  // A question of his that has no answer yet.
  const waiting = [...messages].reverse().find((message) => message.role === "user" && message.waiting);
  if (waiting) add("waiting", waiting, { headline: `“${clip(inline(waiting.text), 80)}”`, why: waiting.waiting! });

  // The latest word from the fleet, when nothing above said it.
  const news = [...messages].reverse().find((message) => fresh(message, NEWS_WITHIN_MS));
  if (news) add("news", news, { headline: headline(readingOf(news)), why: `latest from ${assistant}` });

  const chosen = items.slice(0, MAX_SHOW_ITEMS);
  if (chosen.length === 0) {
    chosen.push({ id: "clear", kind: "clear", headline: "Nothing needs you right now.", why: "I'll flag it when something does" });
  }
  return { title: titleOf(chosen), items: chosen, live: status.working };
}

/** Flyd's opening line: led by the most important thing on screen. */
export function titleOf(items: ShowItem[]): string {
  const kinds = new Set(items.map((item) => item.kind));
  if (kinds.has("call")) return "Your move, sir.";
  if (kinds.has("landed")) return "Good news, sir.";
  if (kinds.has("live")) return "Under way, sir.";
  if (kinds.has("waiting") || kinds.has("news")) return "Here's where things stand, sir.";
  return "All quiet, sir.";
}
