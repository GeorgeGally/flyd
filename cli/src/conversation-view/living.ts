import { clipKeepingLinks } from "./line-links.js";
import { isPlaceholderStatus } from "./status-text.js";
import type { Exchange } from "./types.js";

// The one line Flyd shows under a message he sent from the window, from the
// moment it leaves until its answer replaces it: what is happening to it, in
// Flyd's words, updated in place. It never names who has the message or
// where it went (George's rule: no "Passing this to firstmate", no handoff
// news); it says what is being done: the session's current step when known, else what
// his message asks for (with the project he named), else only that it is under way. His
// own words are never quoted back unless they read as a task Flyd is doing.

/** The quiet line from the moment he sends until something more is known: it is queued to happen. */
export const WORKING = "Queued";
/** The page shows this the moment he sends. */
export const RECEIVED = WORKING;
/** Flyd is answering it itself, before its first step is known. */
export const ANSWERING = "Looking this up";
const ACTIVITY_CHARS = 90;

/** Where a note to firstmate stands: written to its inbox, or read by firstmate. */
export type Handoff = "queued" | "taken";

const GERUND: Record<string, string> = {
  fix: "Fixing", add: "Adding", check: "Checking", make: "Making", build: "Building", update: "Updating", remove: "Removing",
  change: "Changing", find: "Finding", move: "Moving", write: "Writing", create: "Creating", show: "Showing", run: "Running",
  test: "Testing", review: "Reviewing", merge: "Merging", ship: "Shipping", land: "Landing", set: "Setting", get: "Getting",
  turn: "Turning", put: "Putting", look: "Looking", rename: "Renaming", delete: "Deleting", improve: "Improving", clean: "Cleaning",
  debug: "Debugging", investigate: "Investigating", design: "Designing", redesign: "Redesigning", implement: "Implementing",
  deploy: "Deploying", open: "Opening", read: "Reading", draft: "Drafting", research: "Researching", sort: "Sorting",
};
const BACKSTAGE = /\b(?:firstmate|first mate|crew|crewmates?|workers?|helpers?|help|agents?|claude|opencode|codex|staff|team)\b/i;
const FIRST_PERSON = /\b(?:i|me|my|mine|myself|we|us|our|ours|ourselves)\b/i;
const POLITE = /^(?:(?:hey|hi|ok|okay|so|and|also|now|then|please|pls|can you|could you|would you|will you|i(?:'d| would) like you to|i want you to|i need you to|let's|lets|go ahead and|just)\s+)+/i;
const VAGUE = /^(?:it|this|that|them|these|those|there)$/i;
/** "how do I fix X" asks for the same work as "fix X". */
const HOW_TO = /^how\s+(?:do|does|can|could|would|should)\s+(?:i|we|you|one)\s+/i;
/** A question asking what something is: "what is …", "who's …", "where are …". */
const WHAT_IS = /^(?:what|who|whose|where|which|when)(?:'s|s|\s+(?:is|are|was|were))\s+/i;
/** A remainder that is a clause, not a thing to look up: it starts with a pronoun, or something in it is going on. */
const CLAUSE = /^(?:it|this|that|they|them|he|she|we|you|i|there|these|those)\b|(?:^|\s)\w+ing\b/i;

/** The concrete thing in his message, in Flyd's words: "fix the footer on GNM" → "Fixing the footer on GNM". */
function subjectOf(text: string): string {
  const first = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  if (first.startsWith("/")) return "";
  const stripped = first.replace(POLITE, "").replace(/[?!.]+$/, "").trim();
  const [verb = "", ...rest] = stripped.replace(HOW_TO, "").split(" ");
  const gerund = GERUND[verb.toLowerCase()];
  const object = rest.join(" ");
  if (gerund && object && !VAGUE.test(object) && !BACKSTAGE.test(object) && !FIRST_PERSON.test(object)) return clip(`${gerund} ${object}`);
  return questionTopic(first);
}

/** What a plain question is about, in Flyd's words: "what is usb overdrive?" → "Looking up usb overdrive". */
function questionTopic(first: string): string {
  if (!/\?\s*$/.test(first) || !WHAT_IS.test(first)) return "";
  const rest = first.replace(/[?!.]+$/, "").replace(WHAT_IS, "").trim();
  return rest && !CLAUSE.test(rest) && !BACKSTAGE.test(rest) && !FIRST_PERSON.test(rest) ? clip(`Looking up ${rest}`) : "";
}

/** The project his message names, by his own name for it. */
function projectIn(text: string, projects: string[]): string | undefined {
  return projects.find((name) => {
    const trimmed = name.trim();
    return trimmed.length >= 3 && new RegExp(`\\b${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
  });
}

/**
 * The line for a note to firstmate: the work itself, never the handoff. Once the session's current step is known it
 * says that; before then, what his message asks for, with the project when he named one.
 */
export function handoffLine(handoff: Handoff, details: { activity?: string; text?: string; projects?: string[] } = {}): string {
  // A relayed activity that only says something is happening is dropped, so the living line always names the
  // concrete thing (his message's own subject), never a placeholder.
  const activity = handoff === "taken" && details.activity && !isPlaceholderStatus(details.activity) ? clip(details.activity) : "";
  if (activity) return upperFirst(activity);
  const subject = (details.text ? subjectOf(details.text) : "") || (handoff === "queued" ? "Queued for a next step" : "Waiting for a clear next step");
  const project = details.text ? projectIn(details.text, details.projects ?? []) : undefined;
  return project && !new RegExp(project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(subject) ? `${project}: ${subject}` : subject;
}

function upperFirst(text: string): string {
  return text[0]!.toUpperCase() + text.slice(1);
}

function clip(text: string): string {
  return clipKeepingLinks(text.replace(/\s+/g, " ").trim().replace(/[.…]+$/, ""), ACTIVITY_CHARS, 40);
}

/**
 * Brings each note's line up to date: the step of the crewmate working on it when one is, else what firstmate's
 * own session is doing now, only on the notes its current turn picked up. A line under a note is always that note's
 * own: firstmate's session may be busy with something else entirely, so its step never lands on a note its turn did
 * not name. Once firstmate has said the outcome, work that carries on (a crewmate on it, a turn still on it) keeps
 * its running line under the outcome. Each line is replaced in place, so nothing reads as a growing log.
 */
export function livened(exchanges: Exchange[], live: { activity?: string; projects?: string[]; steps?: Map<string, string>; workingOn?: string[] }): Exchange[] {
  // Firstmate reads a note straight from its inbox and only files it once done, so a note it is working on can still
  // read as queued; the turn naming it is what says it has been picked up.
  const picked = new Set(live.workingOn ?? []);
  return exchanges.map((exchange) => {
    if (exchange.answer || exchange.answered || !exchange.handoff) return exchange;
    const step = live.steps?.get(exchange.question.id);
    const onIt = picked.has(exchange.question.id);
    const doing = step ? upperFirst(clip(step)) : onIt && live.activity ? handoffLine("taken", { activity: live.activity }) : "";
    if (exchange.settled) return doing ? { ...exchange, doing } : exchange;
    if (doing) return { ...exchange, waiting: doing };
    return { ...exchange, waiting: handoffLine(onIt ? "taken" : exchange.handoff, { text: exchange.question.text, ...(live.projects ? { projects: live.projects } : {}) }) };
  });
}
