import type { DomainRun, DomainRunStatus, ReportState, RunReport } from "./types.js";

// One report record per outcome of a run: whether, and how, George was told it.
//
// `due` is written in the same commit as the outcome itself (the domain syncs and their settle points), so a restart
// can never lose it. Core's command tick is the only writer after that (command/scheduler.ts): it reviews each due
// report, holds or sends it, and records what became of it from the delivery log (runtime/delivered.ts). Every
// reader — the chat context, the Chief of Staff's "told already" checks, the morning brief — reads this record.
//
//   due → reviewing → quiet | held | sending | gave_up (its review kept failing)
//   held → sending | shown (in the morning brief) | withdrawn (the run moved on, or he answered)
//   sending → shown | screened | owed | gave_up
//   owed → sending | shown | screened | gave_up

/** States the command tick still has work in. */
export const OPEN_REPORT_STATES: readonly ReportState[] = ["due", "reviewing", "held", "sending", "owed"];

/** Reviews that may fail before a report is given up. */
export const MAX_REVIEW_TRIES = 3;

/** A new outcome's report, still to be told. Written with the outcome. */
export function dueReport(status: DomainRunStatus, at: string): RunReport {
  return { state: "due", status, since: at, at };
}

/** A new outcome that is never George's to hear (history replayed, an old reply read again). Written with the outcome. */
export function quietReport(status: DomainRunStatus, at: string): RunReport {
  return { state: "quiet", status, since: at, at };
}

/** Whether the tick still has to review this run's report. */
export function reportDue(run: DomainRun): boolean {
  return run.report?.state === "due" || run.report?.state === "reviewing";
}

/** Whether two records are the same outcome's report. */
export function sameReport(left: RunReport | undefined, right: RunReport | undefined): boolean {
  return Boolean(left && right) && left!.since === right!.since && left!.status === right!.status;
}

/**
 * The line George was actually shown for a run's latest outcome, or nothing. Only "shown" counts: a line the
 * notification gate screened out, or one held and never released, was never his. A run recorded before the report
 * record falls back to its legacy flags.
 */
export function shownLine(run: DomainRun): string | undefined {
  if (run.report) return run.report.state === "shown" ? run.report.line || undefined : undefined;
  return run.notified ? run.told?.line || undefined : undefined;
}
