import { callId, type ArtefactRow, type BacklogEntry, type OvertakenCheck } from "./artefact.js";
import type { StaleCallJudge } from "./stale-calls.js";

// A decision waiting on George that the work has already moved past. Flyd is
// his chief of staff: before it shows him a pending call, it reads the staff's
// own record of that call's task, and when the record says so plainly (the
// task was finished or merged, or the hold was answered or released) the call
// leaves Needs you and the staff are told to close it. George is never asked.
//
// The explicit record settles a call first. Past that, an old call the staff
// never closed is weighed against what George's own work has done since
// (stale-calls.ts): only a confident judgment that it was overtaken settles it.

/** The last resolution firstmate recorded on a task: "answered", "released" and the like. */
function resolution(entry: BacklogEntry): string | undefined {
  return [...(entry.notes ?? "").matchAll(/\bResolution mode:\s*([a-z]+)/gi)].at(-1)?.[1]?.toLowerCase();
}

/**
 * What overtook a pending call, in a few words, or undefined while it may
 * still be live: its task is not in the record, or the record does not say
 * the task finished or the hold was resolved. Pure.
 */
export function overtakenBy(entry: BacklogEntry | undefined): string | undefined {
  if (!entry) return undefined;
  if (entry.finished) return `its task finished ${entry.finished}`;
  if (entry.hold) return undefined;
  const mode = resolution(entry);
  if (!mode) return undefined;
  return mode === "answered" ? "it was answered" : `its hold was ${mode}`;
}

/** The note that tells the staff a call was overtaken and asks them to close it. Pure. */
export function closeNote(row: ArtefactRow, why: string): string {
  return [
    `Flyd's own note, not George's: the pending decision ${row.task ?? ""} ("${row.label}") is overtaken: ${why}.`,
    "It has left his Needs you and he will not be asked. Close the hold; if it is still a real decision, reopen it with what changed.",
  ].join("\n\n");
}

/** Flyd's check of calls against the staff's record of their tasks. */
export class OvertakenCalls implements OvertakenCheck {
  constructor(private readonly options: {
    /** Tells the staff to close an overtaken call on `task`, as Flyd's own note. */
    send: (note: string, requestId: string, task: string) => Promise<unknown>;
    /** Weighs old calls the record leaves open against what has happened since. */
    stale?: Pick<StaleCallJudge, "judge">;
  }) {}

  async check(entry: BacklogEntry | undefined, row: ArtefactRow, entries: Map<string, BacklogEntry>): Promise<string | undefined> {
    return overtakenBy(entry) ?? await this.options.stale?.judge(row, entry, entries).catch(() => undefined);
  }

  async close(row: ArtefactRow, why: string): Promise<void> {
    if (!row.task) return;
    // The request id makes the note idempotent: a restart that finds the same call again sends nothing new;
    // the call reopened under the same task is raised again, and gets its own.
    await this.options.send(closeNote(row, why), `flyd-close-${callId(row)}`.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 125), row.task);
  }
}
