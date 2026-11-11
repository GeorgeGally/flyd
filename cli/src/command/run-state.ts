import type { DomainRunStatus } from "./types.js";

// A domain run's life, in one place: which status it may start in, which moves it may make, and what each
// status means to its readers. `mutateDomainRun` (command/store.ts) checks every status change against this
// table. For now an illegal move is only logged to `refusals.jsonl`; refusing it comes one release later.

export const DOMAIN_RUN_STATUSES = [
  "queued", "accepted", "working", "needs_decision", "completed", "incomplete", "failed", "cancelled",
] as const satisfies readonly DomainRunStatus[];

/** The statuses a run may be recorded in when it is first written. */
export const CREATED_AS: readonly DomainRunStatus[] = ["queued", "accepted", "working"];

/** Where each status may move next (staying put is always allowed). */
export const RUN_MOVES: Readonly<Record<DomainRunStatus, readonly DomainRunStatus[]>> = {
  // Its reply can arrive before the staff's acknowledgement does.
  queued: ["accepted", "working", "needs_decision", "completed", "failed", "cancelled"],
  // A run left on record without its inbox receipt is handed over again and may read as queued once more.
  accepted: ["queued", "working", "needs_decision", "completed", "failed", "cancelled"],
  working: ["needs_decision", "completed", "failed", "cancelled"],
  // George's answer sends it back to work; the staff's next reply settles it.
  needs_decision: ["working", "completed", "failed", "cancelled"],
  // Legacy: read again and settled by what its reply said.
  incomplete: ["working", "needs_decision", "completed", "failed", "cancelled"],
  // A message the staff took restarts it; George can still call it off.
  failed: ["working", "cancelled"],
  completed: [],
  cancelled: [],
};

/** Whether a run may go from `from` (null: not yet on record) to `to`. */
export function canMove(from: DomainRunStatus | null, to: DomainRunStatus): boolean {
  if (from === null) return CREATED_AS.includes(to);
  return from === to || (RUN_MOVES[from]?.includes(to) ?? false);
}

/** Handed over and under way, with nothing back yet. */
export function isAtWork(status: DomainRunStatus): boolean {
  return status === "queued" || status === "accepted" || status === "working";
}

/** Came back with something for Flyd to read: a decision, a deliverable or a failure. */
export function cameBack(status: DomainRunStatus): boolean {
  return status === "needs_decision" || status === "completed" || status === "failed";
}

/** The staff has stopped on it: finished, failed or called off. A failed run can still be restarted. */
export function isSettled(status: DomainRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

/** Over for good: nothing moves it again. */
export function isFinal(status: DomainRunStatus): boolean {
  return status === "completed" || status === "cancelled";
}

/** Still George's business: not over for good (a failed run is open until it is restarted or called off). */
export function isOpen(status: DomainRunStatus): boolean {
  return !isFinal(status);
}
