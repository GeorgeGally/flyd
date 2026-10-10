import type { Exchange } from "./types.js";

// The one line Flyd shows under a message he sent from the window, from the
// moment it leaves until its answer replaces it: what is happening to it, in
// Flyd's words, updated in place. It never names who has the message or
// where it went (George's rule: no "Passing this to firstmate", no handoff
// news); it says what is being done: the session's current step when known, else what
// his message asks for (with the project he named), else only that it is under way. His
// own words are never quoted back unless they read as a task Flyd is doing.

/** The quiet line from the moment he sends until something more is known. */
export const WORKING = "Working on it";
/** The page shows this the moment he sends. */
export const RECEIVED = WORKING;
/** Flyd is answering it itself. */
export const ANSWERING = WORKING;
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

/** The concrete thing in his message, in Flyd's words: "fix the footer on GNM" → "Fixing the footer on GNM". */
function subjectOf(text: string): string {
  const first = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  if (first.startsWith("/")) return "";
  const stripped = first.replace(POLITE, "").replace(/[?!.]+$/, "").trim();
  const [verb = "", ...rest] = stripped.split(" ");
  const gerund = GERUND[verb.toLowerCase()];
  const object = rest.join(" ");
  if (!gerund || !object || /^(?:it|this|that|them|these|those)$/i.test(object) || BACKSTAGE.test(object) || FIRST_PERSON.test(object)) return "";
  return clip(`${gerund} ${object}`);
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
  const activity = handoff === "taken" && details.activity ? clip(details.activity) : "";
  if (activity) return upperFirst(activity);
  const subject = (details.text ? subjectOf(details.text) : "") || WORKING;
  const project = details.text ? projectIn(details.text, details.projects ?? []) : undefined;
  return project && !new RegExp(project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(subject) ? `${project}: ${subject}` : subject;
}

function upperFirst(text: string): string {
  return text[0]!.toUpperCase() + text.slice(1);
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim().replace(/[.…]+$/, "");
  if (flat.length <= ACTIVITY_CHARS) return flat;
  const cut = flat.slice(0, ACTIVITY_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd()}…`;
}

/**
 * Brings each unanswered note's line up to date: for the newest note
 * firstmate has taken, what its session is doing now. Only one line ever carries the live step, so nothing reads as a
 * growing log.
 */
export function livened(exchanges: Exchange[], live: { activity?: string; projects?: string[] }): Exchange[] {
  const newestTaken = exchanges.reduce((index, exchange, i) => (exchange.handoff === "taken" && !exchange.answer ? i : index), -1);
  return exchanges.map((exchange, i) => {
    if (exchange.answer || !exchange.handoff) return exchange;
    const activity = i === newestTaken ? live.activity : undefined;
    return { ...exchange, waiting: handoffLine(exchange.handoff, { text: exchange.question.text, ...(live.projects ? { projects: live.projects } : {}), ...(activity ? { activity } : {}) }) };
  });
}
