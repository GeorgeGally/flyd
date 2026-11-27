import { quietReport } from "./report.js";
import { commandDir, listDomainRuns, mutateDomainRun } from "./store.js";
import type { DomainRun, RunClosure } from "./types.js";

// A run Flyd handed firstmate stops asking George once its question is closed.
//
// Firstmate answers a note once (its inbox script: "One reply per note"), so a run
// that came back `needs_decision` can never be told the call was answered,
// overtaken or archived later: it froze there, and every surface kept putting it
// to George (the 20 Oct "Held up" card, still asking on 14 Nov). Instead Flyd
// reads firstmate's own record of the task the run is for and settles the run
// when that task is closed. A run firstmate's record cannot place is left alone
// here; the board's 3-day limit on asking (conversation-view/jobs.ts) is the
// backstop. George saying a card is old settles it too (retire, below): the
// promise "I'll stop raising it" is a record, not a sentence.

/** What Flyd reads of one firstmate backlog row (conversation-view/artefact.ts `parseBacklog`). */
export interface TaskRecord {
  notes?: string;
  /** Checked off: done, archived or closed. */
  closed?: boolean;
  finished?: string;
  /** An open hold's reason; absent once the hold is lifted. */
  hold?: string;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The names firstmate's record may know a run by: its id, its short id ("domain-45b4d25a") and its inbox note. Pure. */
export function runNames(run: Pick<DomainRun, "id" | "transport">): string[] {
  const short = /^(domain-[0-9a-f]{8})-[0-9a-f-]+$/.exec(run.id)?.[1];
  return [...new Set([run.id, short, run.transport.requestId, run.transport.externalId].filter((name): name is string => Boolean(name && name.length >= 8)))];
}

/**
 * The firstmate tasks a run is for: the task its own request names (`task:<id>` in its context), and every backlog
 * row whose body names the run ("Flyd domain-45b4d25a", "From Flyd inbox request 1792372415-jr6Ysy"). Pure.
 */
export function firstmateTasksOfRun(run: Pick<DomainRun, "id" | "transport" | "request">, entries: ReadonlyMap<string, TaskRecord>): string[] {
  const named = (run.request.contextRefs ?? []).flatMap((ref) => /^task:([\w.-]+)$/.exec(ref)?.[1] ?? []);
  const patterns = runNames(run).map((name) => new RegExp(`(?<![\\w-])${escape(name)}(?![\\w-])`));
  const mentioned = [...entries].filter(([, entry]) => entry.notes && patterns.some((pattern) => pattern.test(entry.notes!))).map(([task]) => task);
  return [...new Set([...named, ...mentioned])];
}

/** How firstmate's record says a task closed, in a few words, or undefined while it may still be open. Pure. */
export function taskClosedBy(entry: TaskRecord | undefined): string | undefined {
  if (!entry) return undefined;
  if (entry.finished) return `finished ${entry.finished}`;
  if (entry.closed) return "closed";
  if (entry.hold) return undefined;
  const mode = [...(entry.notes ?? "").matchAll(/\bResolution mode:\s*([a-z]+)/gi)].at(-1)?.[1]?.toLowerCase();
  return mode ? `its call was ${mode}` : undefined;
}

/**
 * Why a run's question is closed, when every task it is for is closed in firstmate's record; undefined when it is
 * for no task the record names, or any of them may still be open. Pure.
 */
export function runClosedInRecord(run: Pick<DomainRun, "id" | "transport" | "request">, entries: ReadonlyMap<string, TaskRecord>): Omit<RunClosure, "at" | "by"> | undefined {
  const tasks = firstmateTasksOfRun(run, entries);
  if (!tasks.length) return undefined;
  const closed = tasks.map((task) => [task, taskClosedBy(entries.get(task))] as const);
  if (closed.some(([, how]) => !how)) return undefined;
  return {
    reason: closed.map(([task, how]) => `its task ${task} was ${how}`).join("; "),
    evidenceRefs: closed.map(([task]) => `firstmate-task-closed:${task}`),
  };
}

/** A run still putting a question to George that firstmate's record could settle. */
function asking(run: DomainRun): boolean {
  return run.transport.kind === "firstmate" && !run.request.objectiveId && run.status === "needs_decision" && !run.closedBy;
}

/**
 * Settles every run whose question firstmate's record has closed: it is called off with why (`closedBy`), quietly, so
 * no surface puts it to George again and nothing tells him it ended. Returns the runs it settled. Idempotent.
 */
export function settleClosedRuns(entries: ReadonlyMap<string, TaskRecord>, options: { now?: Date; dir?: string; runs?: DomainRun[] } = {}): DomainRun[] {
  const dir = options.dir ?? commandDir();
  const at = (options.now ?? new Date()).toISOString();
  const settled: DomainRun[] = [];
  for (const run of options.runs ?? listDomainRuns(dir)) {
    if (!asking(run)) continue;
    const closure = runClosedInRecord(run, entries);
    if (!closure) continue;
    const saved = mutateDomainRun(run.id, (current) => current && asking(current)
      ? { ...current, status: "cancelled", updatedAt: at, closedBy: { by: "firstmate", ...closure, at }, report: quietReport("cancelled", at) }
      : null, dir);
    if (saved?.closedBy?.at === at) settled.push(saved);
  }
  return settled;
}

/**
 * George said this run's card is old, moot or done: it never asks him again. A run waiting on his answer is called
 * off; finished work waiting on his look keeps its result and is marked looked at. Work still under way is not a card
 * to retire (telling the work to stop is a cancel). Returns the run as saved, or why it was left.
 */
export function retireRun(id: string, words: string, options: { now?: Date; dir?: string } = {}): { run: DomainRun } | { refused: string } {
  const at = (options.now ?? new Date()).toISOString();
  let refused = "There is no such piece of work.";
  const saved = mutateDomainRun(id, (current) => {
    if (!current) return null;
    if (current.closedBy) { refused = ""; return null; }
    const closedBy: RunClosure = { by: "george", reason: words.trim().slice(0, 500) || "George said it is old", evidenceRefs: [`george-words:${at}`], at };
    if (current.status === "needs_decision") return { ...current, status: "cancelled", updatedAt: at, closedBy, report: quietReport("cancelled", at) };
    if (current.status === "completed" || current.status === "cancelled") return { ...current, closedBy };
    refused = "That work is still under way; stopping it is a cancel, not a retired card.";
    return null;
  }, options.dir ?? commandDir());
  if (saved?.closedBy) return { run: saved };
  return { refused: refused || "Already retired." };
}
