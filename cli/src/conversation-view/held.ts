import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ArtefactRow } from "./artefact.js";

// Held up, said to him: each piece of stopped work as a plain sentence, why it
// matters to him, and the one thing he can do about it. What he chose is kept
// here, in Core, so every view (and the counts) stop showing what he has dealt with.

export type HeldAction = "reply" | "save" | "dismiss" | "act";
export const HELD_ACTIONS: readonly HeldAction[] = ["reply", "save", "dismiss", "act"];

/** Older than this, a hold is noise: it is not shown at all. */
export const HELD_STALE_MS = 30 * 24 * 60 * 60 * 1000;
/** Untouched this long with nothing to answer, a hold is offered to be let go. */
export const HELD_QUIET_MS = 7 * 24 * 60 * 60 * 1000;

const ASKS = /\?|\b(?:decide|decision|choose|pick|approve|confirm|answer|your call|needs? (?:you|your|george|the captain))\b/i;
const KEEPS = /\b(?:report|findings|ready to read|write-?up)\b/i;

/** The same work, however many times the fleet lists it. Pure. */
export function heldKey(row: ArtefactRow): string {
  return [row.repo ?? "", row.label].join("|").toLowerCase().replace(/[^a-z0-9|]+/g, " ").replace(/\s+/g, " ").trim();
}

const ageOf = (row: ArtefactRow, now: number): number => {
  const at = row.at ? Date.parse(row.at) : Number.NaN;
  return Number.isNaN(at) ? 0 : now - at;
};

/** The one thing he can do about a hold. Pure. */
export function heldAction(row: ArtefactRow, now: number): HeldAction {
  if (ASKS.test(`${row.label} ${row.detail ?? ""}`)) return "reply";
  if (KEEPS.test(`${row.label} ${row.detail ?? ""}`)) return "save";
  return ageOf(row, now) > HELD_QUIET_MS ? "dismiss" : "act";
}

/** The work's own name, as words rather than a ticket title. Pure. */
function named(label: string): string {
  return `“${label.replace(/\s+\+\s+/g, " and ").replace(/[\s.:;,]+$/, "")}”`;
}

/** A hold as he reads it: what happened, why it matters to him, what he can do. Pure. */
export function plainHeld(row: ArtefactRow, label: string, now: number): { headline: string; why: string; action: HeldAction } {
  const action = heldAction(row, now);
  const work = named(label);
  const status = (row.status ?? "").toLowerCase();
  const headline = action === "reply" ? `${work} is waiting on your answer.`
    : status === "failed" ? `${work} failed.`
    : status === "paused" ? `${work} is paused.`
    : status === "no word" ? `${work} has gone quiet.`
    : `${work} has stopped.`;
  const days = Math.floor(ageOf(row, now) / 86_400_000);
  const why = action === "reply" ? "It can't go on until you answer, so a word from you moves it."
    : action === "save" ? "It left something worth keeping, and saving it means it isn't lost when the work is cleared."
    : action === "dismiss" ? `Nothing has happened on it for ${days} days, so it is probably no longer needed.`
    : status === "failed" ? "It stopped with an error, so nothing moves until Flyd restarts it."
    : status === "paused" ? "It won't finish until it is told to carry on, and Flyd can do that for you."
    : status === "no word" ? "Nobody is moving it forward, so Flyd can check on it and get it going again."
    : "It won't finish on its own, so Flyd can pick it up again for you.";
  return { headline, why, action };
}

/**
 * Only the holds that need him: none older than a month, each piece of work
 * once, and none he has already dealt with (unless it reported since). Pure.
 */
export function attentionHeld(held: ArtefactRow[], handled: (row: ArtefactRow) => boolean, now: number): ArtefactRow[] {
  const seen = new Set<string>();
  return held.filter((row) => {
    const key = heldKey(row);
    if (ageOf(row, now) > HELD_STALE_MS || seen.has(key)) return false;
    seen.add(key);
    return !handled(row);
  });
}

interface Outcome {
  action: HeldAction;
  at: string;
  task?: string;
}

export function defaultHeldOutcomesFile(): string {
  return join(homedir(), ".flyd", "view", "held-outcomes.json");
}

/** What he chose for each hold, kept on disk; without a file (tests), kept in memory only. */
export class HeldOutcomes {
  private outcomes?: Record<string, Outcome>;

  constructor(private readonly file?: string) {}

  private all(): Record<string, Outcome> {
    if (this.outcomes) return this.outcomes;
    try {
      const parsed = this.file ? JSON.parse(readFileSync(this.file, "utf8")) as unknown : {};
      this.outcomes = parsed && typeof parsed === "object" ? parsed as Record<string, Outcome> : {};
    } catch {
      this.outcomes = {};
    }
    return this.outcomes;
  }

  record(row: ArtefactRow, action: HeldAction, now = Date.now()): void {
    const outcomes = this.all();
    outcomes[heldKey(row)] = { action, at: new Date(now).toISOString(), ...(row.task ? { task: row.task } : {}) };
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify(outcomes, null, 2)}\n`);
  }

  /** Dealt with, and nothing new reported since he chose. */
  handled(row: ArtefactRow): boolean {
    const outcome = this.all()[heldKey(row)];
    if (!outcome) return false;
    const reported = row.at ? Date.parse(row.at) : Number.NaN;
    return Number.isNaN(reported) || reported <= Date.parse(outcome.at);
  }
}
