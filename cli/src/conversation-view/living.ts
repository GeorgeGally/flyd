import type { Exchange } from "./types.js";

// The one line Flyd shows under a message he sent from the window, from the
// moment it leaves until its answer replaces it: what is happening to it, in
// Flyd's words, updated in place. Every state comes from something Flyd can
// see (the route it chose, the note in firstmate's inbox, the note moved to
// handled/, firstmate's session mid-turn, Flyd's own answer in flight), never
// from a guess.

/** Before Flyd has decided who takes it: the page shows this the moment he sends. */
export const RECEIVED = "Got it, working out who should take this";
/** Flyd is answering it itself. */
export const ANSWERING = "Answering";
const ACTIVITY_CHARS = 90;

/** Where a note to firstmate stands: written to its inbox, or read by firstmate. */
export type Handoff = "queued" | "taken";

export function handoffLine(handoff: Handoff, details: { project?: string; activity?: string } = {}): string {
  if (handoff === "queued") return `Passing this to firstmate${details.project ? ` - ${details.project}` : ""}`;
  if (details.activity) return `Firstmate is on it: ${lowerFirst(clip(details.activity))}`;
  return `Firstmate is on it${details.project ? ` - ${details.project}` : ""}`;
}

function lowerFirst(text: string): string {
  // "Run the tests" reads as "run the tests"; "PR checks" and "GNM" stay as written.
  return /^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim().replace(/[.…]+$/, "");
  if (flat.length <= ACTIVITY_CHARS) return flat;
  const cut = flat.slice(0, ACTIVITY_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd()}…`;
}

/** The names a project goes by: "GNM (Good Neighbours Market)" is both "GNM" and "Good Neighbours Market". */
function namesOf(name: string): string[] {
  const outer = name.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const inner = /\(([^)]+)\)/.exec(name)?.[1]?.trim();
  return [outer, ...(inner ? [inner] : [])].filter((alias) => alias.length >= 3);
}

/**
 * The one project his own message names, as he named it; none when it names
 * none or several. Only his words count, never a guess at what he meant.
 */
export function projectNamed(text: string, projects: ReadonlyArray<{ name: string }>): string | undefined {
  const found = new Map<string, string>();
  for (const project of projects) {
    for (const alias of namesOf(project.name)) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // An acronym ("GNM", "DIR") counts only as he capitalised it; "which dir" is not a project.
      const acronym = /^[A-Z0-9]+$/.test(alias);
      if (new RegExp(`(?<![\\w])${escaped}(?![\\w])`, acronym ? "" : "i").test(text)) {
        found.set(project.name, alias);
        break;
      }
    }
  }
  return found.size === 1 ? [...found.values()][0] : undefined;
}

/**
 * Brings each unanswered note's line up to date: the project his message
 * names, and for the newest note firstmate has taken, what its session is
 * doing now. Only one line ever carries the live step, so nothing reads as a
 * growing log.
 */
export function livened(exchanges: Exchange[], live: { activity?: string; projectOf?: (text: string) => string | undefined }): Exchange[] {
  const newestTaken = exchanges.reduce((index, exchange, i) => (exchange.handoff === "taken" && !exchange.answer ? i : index), -1);
  return exchanges.map((exchange, i) => {
    if (exchange.answer || !exchange.handoff) return exchange;
    const project = live.projectOf?.(exchange.question.text);
    const activity = i === newestTaken ? live.activity : undefined;
    return { ...exchange, waiting: handoffLine(exchange.handoff, { ...(project ? { project } : {}), ...(activity ? { activity } : {}) }) };
  });
}
