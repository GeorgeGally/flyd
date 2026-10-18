import { inFlydsVoice } from "./flyd-voice.js";
import { isPlumbing } from "./for-george.js";
import { asksForDecision, headlineOf, statusOf } from "./status.js";
import { capitalise, clip, digestReply, inline, isRoutine, sentences } from "./summaries.js";
import { withoutStubs } from "./executive.js";
import { choiceOf, choiceTarget, openChoice, type ChoiceStep } from "./choices.js";
import { callItems, composeArtefact, doneItems, fleetCounts, heldItems, nextItems, readyItems, underwayItems, weekLandedItems, type ArtefactInputs, type DayCount } from "./artefact.js";
import { railImageSrc } from "./rail.js";
import { semanticObjectsFromShow, type SemanticEvent, type SemanticObject } from "./semantic.js";
import type { ConversationMessage, ConversationSnapshot } from "./types.js";

// Show mode: Flyd's own picture of what matters now, for the Conversation
// window's visual screen. Not a dashboard: at most three things, picked in a
// fixed order of what deserves his eyes most (a call only he can make, what
// just landed, what is moving right now, a question of his still waiting, the
// latest word from the fleet), each one headline in Flyd's words. Pure: the
// same snapshot, clock, readings and projects always pick the same things.

/** call: needs him; live: under way; ready: finished, not landed; waiting: held up; next: queued; plan: a plan he made. */
export type ShowKind = "call" | "landed" | "live" | "ready" | "waiting" | "next" | "plan" | "news" | "clear";

export interface ShowLink {
  label: string;
  url: string;
  /** A page on this machine that no longer answers: said in words, never a dead link. */
  closed?: boolean;
}

export interface ShowShot {
  /** Same-origin path the page loads it from (it adds its token). */
  src: string;
  label: string;
}

export interface ShowItem {
  /**
   * A question only he can answer, with its options. A fleet hold names its
   * task; a question a reply put to him names where his answer goes (replyTo),
   * and goes back the way a reply to an answer does.
   */
  decision?: { task: string; question: string; choices: string[]; replyTo?: string; recommended?: string; steps?: ChoiceStep[] };
  /** Stable while it is the same thing, so the page animates only what is new. */
  id: string;
  kind: ShowKind;
  /** One line, in Flyd's words. */
  headline: string;
  /** Why Flyd shows it, in a few words. */
  why: string;
  /** The next step or the concrete ask, whole. */
  detail?: string;
  /** A word or two for its state: "merged", "checks green", "paused". */
  status?: string;
  /** Screenshots of the work, newest "after" shots first. */
  shots?: ShowShot[];
  at?: string;
  /** When its worker started: how long a job has been under way. */
  started?: string;
  /** Pull requests it names. */
  links?: ShowLink[];
  /** The web page the work changed: a button that opens it. */
  open?: ShowLink;
  /** His own name for the project it belongs to, when Flyd knows it. */
  project?: string;
  /** The conversation message it comes from, so the page can open it in the terminal. */
  ref?: string;
  /** Firstmate's task id, so what he says about it names the work. */
  task?: string;
}

export interface ShowScreen {
  /** Flyd's opening line, to him. */
  title: string;
  /** One line on the whole situation: what waits on him, what is moving. */
  summary: string;
  items: ShowItem[];
  /** Canonical semantic objects for the same visible items; rendering still uses ShowItem during migration. */
  semantic?: SemanticObject[];
  /** Native task manifestations: one stable Activity per Firstmate job across every phase. */
  activities?: SemanticObject[];
  /** Standalone choices that belong to George rather than to an Activity. */
  decisions?: SemanticObject[];
  /** Durable results: distinct from the Activity that produced them. */
  artifacts?: SemanticObject[];
  /** Snapshot-to-snapshot semantic lifecycle deltas; populated by SnapshotDiffer, not by pure showOf. */
  events?: SemanticEvent[];
  /** How many of each kind exist, including those past the screen's limits. */
  counts: Partial<Record<ShowKind, number>>;
  /** Every call that needs him, as many as counts.call says, each with its question to answer. */
  calls?: ShowItem[];
  /** Every job a worker is on right now, the longest running first. */
  underway?: ShowItem[];
  /** Work that landed, newest first. */
  done?: ShowItem[];
  /** Finished work that waits to land, newest first. */
  ready?: ShowItem[];
  /** Work that stopped — paused, failed, gone quiet — newest first. */
  held?: ShowItem[];
  /** Work queued next. */
  next?: ShowItem[];
  /** Work landed on each of the last seven days, oldest first. */
  landedByDay?: DayCount[];
  /** Every piece of work behind the week's landed figure, newest first. */
  landedWeek?: ShowItem[];
  /** When firstmate's fleet snapshot was read. */
  read?: string;
  /** The assistant is working right now. */
  live: boolean;
  /** What it is doing, when it is working. */
  doing?: string;
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
  /** A reply Flyd's model judged routine: the terminal mutes it, artefact view passes it over. */
  muted?: (message: ConversationMessage) => boolean;
  projects?: ShowProject[];
  /** Flyd's artefact: firstmate's fleet snapshot, Flyd's memory, the news and its taste. */
  artefact?: ArtefactInputs;
}

export const MAX_SHOW_ITEMS = 3;
/** Site changes on the screen at once: the newest few, each with its page. */
export const MAX_SITE_CHANGES = 4;
const SITE_WITHIN_MS = 24 * 60 * 60 * 1000;
/** The artefact carries more than the conversation read: the fleet, memory, news. */
export const MAX_ARTEFACT_ITEMS = 32;
const LANDED_WITHIN_MS = 24 * 60 * 60 * 1000;
const NEWS_WITHIN_MS = 6 * 60 * 60 * 1000;
const HEADLINE_CHARS = 200;
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

/** Where the work went ("Live on …", "pushed", "deployed to …"): not what changed. */
const DEPLOY_ONLY = /\b(?:live on|pushed|deployed(?: to)?|screenshots? (?:is|are) open)\b/gi;
/** Something done: a past-tense action ("pulled", "tested", "rebuilt"). */
const DID = /\b(?:[a-z]{2,}ed|built|made|set up|cut|put|wrote|rewrote|ran|took)\b/i;
/** Words that point at the rest of the reply ("your fixes below"): they mean nothing on their own. */
const POINTING = /,?\s*(?:along with|together with|plus) [^.;:]*\bbelow\b/gi;
/** A caveat or aside: what only happens if asked, what stays as it was. */
const CAVEAT = /\b(?:if asked|only if|only \w+(?: \w+)? if|unless|stays? (?:closed|off|hidden|the same|as (?:it|they) (?:was|were))|however|by the way|note that)\b/i;
/** A link that sits in the sentence: the page button says where it went. */
const BARE_URL = /\s*\bhttps?:\/\/\S+?(?=[\s,;:]|\.(?:\s|$)|$)/g;
/** "to https://…": where the work went, said by the page button instead. */
const TO_URL = /\s+(?:to|on|at)\s+https?:\/\/\S+?(?=[\s,;:]|\.(?:\s|$)|$)/gi;

/** A sentence that only says where the work went ("Live on … and pushed"), with nothing done in it. */
function deployOnly(sentence: string): boolean {
  if (!new RegExp(DEPLOY_ONLY.source, "i").test(sentence)) return false;
  return !DID.test(sentence.replace(BARE_URL, " ").replace(DEPLOY_ONLY, " "));
}

/**
 * A site change told by what it changed: its first sentence that says what was
 * done or changed, then the one after. A sentence that only says where the work
 * went, a question, and a caveat or aside ("Applications stay closed there; the
 * deploy only opens them if asked") never lead; with nothing else said, the
 * first sentence does. Pure.
 */
export function siteChangeLines(text: string): { headline: string; detail?: string } {
  // Line by line: a list item is its own sentence, never the tail of the lead that introduced it.
  const all = text.replace(/```[\s\S]*?```/g, " ").split(/\n+/).flatMap((line) => proseSentences(line));
  // What was done, in words that stand alone: "I pulled …, and deployed to https://… along with your fixes below" leads as "Pulled …, and deployed".
  const said = all
    .filter((sentence) => !deployOnly(sentence) && !/\?$/.test(sentence.trim()) && !CAVEAT.test(sentence))
    .map((sentence) => sentence.replace(TO_URL, "").replace(POINTING, "").replace(/\s+([.,;:])/g, "$1").replace(/^I\s+(?=[a-z]+ed\b)/, ""));
  const [first, second] = said.length ? said : all;
  return { headline: tidy(first ?? text), ...(second ? { detail: tidy(second) } : {}) };
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

/** His project a website belongs to, from the site's own address ("goodneighboursmarket.com" is Good Neighbours'). Pure. */
export function siteProjectOf(url: string, projects: ShowProject[]): string | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/[^a-z0-9]/g, "");
  } catch {
    return undefined;
  }
  const letters = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  return projects.find((project) => [
    ...project.name.split(/[()]/).map(letters),
    ...project.repos.map((repo) => letters(base(repo))),
  ].some((token) => token.length >= 4 && host.includes(token)))?.name;
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

  // Changes made to a website: each its own story, the element it changed as
  // its picture, and the page as a button. Read from firstmate's answers to
  // his notes and its own replies, which is where work done in its own session
  // is reported; the fleet snapshot never sees it.
  const sited = new Map<string, ConversationMessage>();
  for (const message of [...Object.values(snapshot.followUps ?? {}), ...messages]) {
    if (message.role === "assistant" && message.page && !sited.has(message.id) && age(message, now) < SITE_WITHIN_MS) sited.set(message.id, message);
  }
  const siteItems: ShowItem[] = [...sited.values()]
    .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""))
    .slice(0, MAX_SITE_CHANGES)
    .map((message) => {
      used.add(message.id);
      const shots = (message.shots ?? []).filter((shot) => shot.startsWith("/"));
      const project = siteProjectOf(message.page!.url, projects);
      const lines = siteChangeLines(message.text);
      return {
        id: `site:${message.id}`,
        kind: "landed" as const,
        headline: lines.headline,
        ...(lines.detail ? { detail: lines.detail } : {}),
        why: "changed on the site",
        status: /\b(?:live on|is live|now live|went live|deployed)\b/i.test(message.text) ? "live" : "changed",
        open: message.page!,
        ...(shots.length ? { shots: shots.map((shot) => ({ src: railImageSrc(shot), label: shot.split("/").pop()! })) } : {}),
        ...(message.timestamp ? { at: message.timestamp } : {}),
        ...(project ? { project } : {}),
        ref: message.answers?.startsWith("note:") ? message.answers : message.id,
      };
    });

  // A call only he can make: a question still waiting on his answer (a note about
  // something else does not answer it), else the newest ask since he last spoke.
  let lastCaptain = -1;
  messages.forEach((message, index) => {
    if (message.role === "user") lastCaptain = index;
  });
  const since = messages.slice(lastCaptain + 1).filter((message) => fromFleet(message) && !routine(message));
  const open = openChoice(messages.filter((message) => message.role === "user" || fromFleet(message)), routine);
  // Flyd's own plumbing (its session, scripts, permissions) is Flyd's to sort out, never a call of his.
  const call = open?.message ?? [...since].reverse().find((message) => (asksForDecision(message.text) || FOR_HIM.test(message.text)) && !isPlumbing(askLine(message.text) ?? headline(readingOf(message))));
  if (call) {
    // A question with options is answerable on screen: the question leads, what it is about under it.
    const choice = open?.choice ?? choiceOf(call.text);
    const about = choice ? tidy(digestReply(withoutStubs(readingOf(call))).lead) : "";
    add("call", call, choice
      ? {
        headline: choice.question,
        why: "waiting on you",
        ...(about && about !== choice.question ? { detail: about } : {}),
        decision: { task: choiceTarget(call), question: choice.question, choices: choice.options, replyTo: choiceTarget(call), ...(choice.steps ? { steps: choice.steps } : {}) },
      }
      : { headline: askLine(readingOf(call)) ?? askLine(call.text) ?? headline(readingOf(call)), why: "waiting on you" });
  }

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
  // What is moving, in words: the step being taken, else the job a worker is on, else only that work is under way.
  const doing = status.working ? tidy(status.activity ?? underwayItems(inputs.artefact?.fleet)[0]?.headline ?? "Work is under way") : "";
  if (status.working) {
    items.push({
      id: "live",
      kind: "live",
      headline: doing,
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

  // Nothing outstanding: recap the last real things the fleet did — what last
  // landed, what last ran, what is next — so the screen always carries real
  // information rather than a bare reassurance. Honest to its age: the page
  // shows how long ago each was.
  let recap = false;
  if (items.length === 0) {
    for (let index = messages.length - 1; index >= 0 && items.length < MAX_SHOW_ITEMS; index -= 1) {
      const message = messages[index]!;
      if (!fromFleet(message) || used.has(message.id) || routine(message)) continue;
      const line = landedLine(message.text);
      if (line) add("landed", message, { headline: line, why: "last landed" });
      else add("news", message, { headline: headline(readingOf(message)), why: `last from ${assistant}` });
    }
    recap = items.length > 0;
  }

  // Flyd's artefact leads: firstmate's fleet snapshot, its memory, the news. The
  // conversation read fills what is left.
  const projectOfRepo = (repo: string): string | undefined =>
    projects.find((project) => project.repos.some((path) => base(path) === repo.toLowerCase()) || slug(project.name) === repo.toLowerCase())?.name;
  const artefact = inputs.artefact ? composeArtefact(inputs.artefact, { project: projectOfRepo }) : [];
  // A question just put to him in the conversation leads the fleet's older holds; the site's latest changes come next.
  const asked = items.filter((item) => item.kind === "call");
  const chosen = [...asked, ...siteItems, ...artefact, ...items.filter((item) => item.kind !== "call")]
    .slice(0, artefact.length ? MAX_ARTEFACT_ITEMS : MAX_SHOW_ITEMS + siteItems.length);
  if (chosen.every((item) => item.kind === "next" || item.kind === "plan")) {
    const taste = inputs.artefact?.taste?.[0];
    if (taste) chosen.push({ id: "taste", kind: "news", headline: taste, why: "what I'm learning about your taste" });
    else chosen.push({ id: "clear", kind: "clear", headline: "Nothing needs you right now.", why: "I'll flag it when something does" });
  }
  const fleet = inputs.artefact?.fleet;
  const counts: Partial<Record<ShowKind, number>> = { ...fleetCounts(fleet) };
  if (!fleet || fleet.unavailable) {
    for (const item of items) if (item.kind !== "waiting") counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  }
  // The figure "N need you" opens: the fleet's every call when it has a snapshot, else the one just asked.
  const calls = fleet && !fleet.unavailable ? callItems(fleet, { project: projectOfRepo }) : asked;
  // "N need you" is exactly the calls it opens: a call the sheet cannot show is not counted.
  if (fleet && !fleet.unavailable) {
    if (calls.length) counts.call = calls.length;
    else delete counts.call;
  }
  const underway = underwayItems(fleet, { project: projectOfRepo });
  const done = doneItems(fleet, { project: projectOfRepo });
  // What each state figure opens: every piece of work behind the number.
  const ready = readyItems(fleet, { project: projectOfRepo });
  const held = heldItems(fleet, { project: projectOfRepo });
  const next = nextItems(fleet, { project: projectOfRepo });
  // The week's landed figure opens its own week's work, not the column's eight.
  const landedWeek = weekLandedItems(inputs.artefact, { project: projectOfRepo });
  return {
    title: titleOf(chosen, recap && artefact.length === 0),
    summary: situationOf(counts, fleet?.unavailable),
    items: chosen,
    semantic: semanticObjectsFromShow(chosen),
    counts,
    ...(calls.length ? { calls } : {}),
    ...(underway.length ? { underway } : {}),
    ...(done.length ? { done } : {}),
    ...(ready.length ? { ready } : {}),
    ...(held.length ? { held } : {}),
    ...(next.length ? { next } : {}),
    ...(inputs.artefact?.landedByDay ? { landedByDay: inputs.artefact.landedByDay } : {}),
    ...(landedWeek.length ? { landedWeek } : {}),
    ...(fleet?.generated ? { read: fleet.generated } : {}),
    live: status.working,
    ...(doing ? { doing } : {}),
  };
}

/** One line on the whole situation, every figure in it named. Pure. */
export function situationOf(counts: Partial<Record<ShowKind, number>>, unavailable?: string): string {
  if (unavailable) return `I couldn't read firstmate's fleet just now (${unavailable}).`;
  const count = (kind: ShowKind) => counts[kind] ?? 0;
  const calls = count("call");
  const parts = [calls ? `${calls} ${calls === 1 ? "call waits" : "calls wait"} on you` : "nothing waits on you"];
  if (count("live")) parts.push(`${count("live")} under way`);
  if (count("ready")) parts.push(`${count("ready")} waiting to land`);
  if (count("waiting")) parts.push(`${count("waiting")} held up`);
  return `${capitalise(parts.join(", "))}.`;
}

/** Flyd's opening line: led by the most important thing on screen. */
export function titleOf(items: ShowItem[], quiet = false): string {
  const kinds = new Set(items.map((item) => item.kind));
  if (kinds.has("call")) return "Your move, sir.";
  if (quiet) return "Here's where things stand, sir.";
  if (kinds.has("landed")) return "Good news, sir.";
  if (kinds.has("live")) return "Under way, sir.";
  if (kinds.has("waiting") || kinds.has("news")) return "Here's where things stand, sir.";
  return "All quiet, sir.";
}
