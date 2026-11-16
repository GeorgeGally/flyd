/**
 * The one rule for where a piece of work sits, read by every surface that shows
 * it: the column, Todo, the island and the timeline. Each surface used to re-read
 * the raw records with its own clock and its own words, so the same minute had
 * three answers to "what needs me?". Now Core places an item once, here, and they
 * all read that answer.
 *
 * - needs: his move. A question for him, or finished work waiting on his look.
 *   An unanswered ask stays here however old it is; it is never parked.
 * - moving: Flyd's move. Under way, queued, paused, held up or gone quiet.
 * - done: nothing more for anyone. Landed, closed, or a notice that only told him something.
 */

export type Place = "needs" | "moving" | "done";

/** What the records say about one piece of work, before it is placed. */
export type WorkFact =
  | "asks" | "ready" | "report"
  | "running" | "queued" | "paused" | "blocked" | "quiet"
  | "landed" | "closed" | "told" | "handled";

export interface Placed {
  place: Place;
  /** The state as he reads it: one word set for every surface (see STATE_WORDS). */
  state: string;
}

/** Every state word a surface may show, by fact. Nothing else names a state. */
export const STATE_WORDS: Record<WorkFact, string> = {
  asks: "Needs you",
  ready: "Ready for you",
  report: "Report ready",
  running: "Working",
  queued: "Queued",
  paused: "Paused",
  blocked: "Blocked",
  quiet: "Waiting",
  landed: "Done",
  closed: "Done",
  told: "Done",
  handled: "Handled for you",
};

/** Each place's own name: the column's sections and the island's count. */
export const PLACE_WORDS: Record<Place, string> = { needs: "Needs you", moving: "Moving", done: "Done" };

const PLACE_OF: Record<WorkFact, Place> = {
  asks: "needs",
  ready: "needs",
  report: "needs",
  running: "moving",
  queued: "moving",
  paused: "moving",
  blocked: "moving",
  quiet: "moving",
  landed: "done",
  closed: "done",
  told: "done",
  handled: "done",
};

/** The rule: one fact, one place, one word. Pure. */
export function placeOf(fact: WorkFact): Placed {
  return { place: PLACE_OF[fact], state: STATE_WORDS[fact] };
}

/** Section order: his move first, then what is moving, then what is done. Pure. */
export function placeRank(place: Place): number {
  return place === "needs" ? 0 : place === "moving" ? 1 : 2;
}

/** Within Moving, work under way leads the work that waits. Pure. */
export function movingRank(state: string): number {
  return state === STATE_WORDS.running ? 0 : 1;
}
