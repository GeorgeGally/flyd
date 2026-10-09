import type { DomainRun } from "./types.js";

// What of a finished domain run is worth a notification. A domain boss's
// reply can carry its own machinery — acknowledgements, supervision status,
// "no news yet", which worker picked something up — and that belongs in the
// durable result, never on George's screen. Decisions and failures always
// reach him; a completion only when it reads as an outcome.

/** Housekeeping that says nothing finished: "shipshape", "no news yet", "on it". */
const ROUTINE_OPENING = /^(shipshape|all (quiet|clear|good|calm)|no (news|change|updates?|progress)\b|nothing (new|to report|yet)|still (working|waiting|running|on it|going)|on it\b|ack(nowledged)?\b|noted\b|got it\b|understood\b|standing by|will (report|update|let you know|follow up)|working on it|picked (it|this) up|queued\b|received\b)/i;
/** Supervision chatter about the workers rather than the work. */
const MACHINERY = /\b(posted an update|is moving again|acknowledged (my|the|your) decision|(a |the )?(worker|crewmate|lane|pane|supervisor|heartbeat|wake|status line|inbox note|no-mistakes)\b|dispatched\b|is now on\b)/i;
const PULL_REQUEST = /https?:\/\/\S+\/pull\/\d+/i;
/** Words that mean something actually landed, so a mention of a worker doesn't hide it. */
const OUTCOME = /(\bready (for (your )?review|to merge)\b|\b(merged|shipped|landed|deployed|published|released|finished|completed|fixed|pushed|failed|blocked)\b)/i;

/** The brief as George would read it: one line, no "Captain," salutation. */
export function plainBrief(text: string): string {
  const line = text.replace(/\s+/g, " ").trim().replace(/^captain[,:!.]?\s+/i, "");
  return line ? line[0]!.toUpperCase() + line.slice(1) : "";
}

export function isRoutineChatter(text: string): boolean {
  const brief = plainBrief(text);
  if (!brief) return true;
  if (PULL_REQUEST.test(brief)) return false;
  if (ROUTINE_OPENING.test(brief)) return true;
  return MACHINERY.test(brief) && !OUTCOME.test(brief);
}

/** The notification text for a run, or null when nothing George cares about happened. */
export function captainNotice(run: DomainRun): string | null {
  if (!run.result) return null;
  const brief = plainBrief(run.result.brief);
  if (!brief) return null;
  if (run.status === "needs_decision") return `I need your decision: ${brief}`;
  if (run.status === "failed") return `Work hit a problem: ${brief}`;
  if (run.status !== "completed" || isRoutineChatter(brief)) return null;
  return brief;
}
