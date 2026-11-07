import { createHash } from "node:crypto";
import { georgeInbox, type InboxEntry } from "../runtime/agenda.js";
import {
  listDoneConfirmedTodos, listOpenConfirmedTodos, tickConfirmedTodo, tickedFlydAsks, tickFlydAsk, type ConfirmedTodo,
} from "../work/work-hypothesis/confirmed-todos.js";
import { dueStatus, formatDueLabel } from "../work/work-hypothesis/due-dates.js";
import type { Job } from "./jobs.js";

// The Todo tab: what he must do himself. Two kinds of thing sit on it. His own
// list is the confirmed to-dos, the one briefings and the `todos` tool read, so
// what he adds here Flyd knows about and the other way round. Flyd's asks are
// read fresh on every draw from where they already live: the jobs that need him
// and agenda runs that stopped short. They never join his list, so one that is
// settled elsewhere simply leaves; only his tick on one is kept.

/** The longest item he can add. */
export const MAX_TODO_CHARS = 300;
const DAY = 24 * 60 * 60 * 1000;
/** How long a ticked item stays in reach of an untick. */
const DONE_KEEP_MS = 7 * DAY;
/** How long a stuck agenda run keeps asking. It asks once, in a notification, and may never be answered. */
const STUCK_KEEP_MS = 7 * DAY;

export interface TodoRow {
  /** A confirmed to-do's id, or the ref of a Flyd ask. */
  id: string;
  text: string;
  /** One short line under it: when it is due, or where the ask comes from. */
  line?: string;
  /** The job that holds the ask, where he can act on it. */
  job?: string;
  from: "you" | "flyd";
}

export interface TodoList {
  open: TodoRow[];
  done: TodoRow[];
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);

/** The ask's own identity: a new question on the same job is a new ask, reworded words on the same decision are not. */
function jobRef(job: Job): string {
  return `job:${hash(`${job.id}\0${job.decision?.decisionId ?? job.questionIdentity ?? job.ask}`)}`;
}

function jobAsks(jobs: Job[]): TodoRow[] {
  return jobs.filter((job) => job.group === "needs" && job.owner === "you" && job.ask.trim()).map((job) => ({
    id: jobRef(job),
    text: job.ask.trim(),
    line: [job.title === job.ask.trim() ? "" : job.title, job.state].filter(Boolean).join(" · "),
    job: job.id,
    from: "flyd",
  }));
}

/** Agenda runs that stopped and ask him how to go on. A later run of the same item that went well answers it. */
function stuckAsks(inbox: InboxEntry[], now: Date): TodoRow[] {
  const latest = new Map(inbox.map((entry) => [entry.itemId, entry]));
  return [...latest.values()]
    .filter((entry) => (entry.status === "failed" || entry.status === "blocked") && now.getTime() - Date.parse(entry.at) <= STUCK_KEEP_MS)
    .map((entry) => ({ id: `inbox:${entry.id}`, text: `Try again or drop: ${entry.task}`, line: "It did not finish", from: "flyd" }));
}

function dueLine(todo: ConfirmedTodo, now: Date): string | undefined {
  const status = dueStatus(todo.dueAt, now);
  if (!status || !todo.dueAt) return undefined;
  if (status.state === "today") return "Due today";
  return `${status.state === "passed" ? "Was due" : "Due"} ${formatDueLabel(todo.dueAt, now)}`;
}

function ownRow(todo: ConfirmedTodo, now: Date): TodoRow {
  const line = dueLine(todo, now);
  return { id: todo.id, text: todo.description, ...(line ? { line } : {}), from: "you" };
}

/** Flyd's asks first, since something is waiting on them, then his own list in its order. Pure. */
export function todosFrom(input: {
  jobs: Job[];
  inbox: InboxEntry[];
  open: ConfirmedTodo[];
  done: ConfirmedTodo[];
  ticked: Set<string>;
  now: Date;
}): TodoList {
  const asks = [...jobAsks(input.jobs), ...stuckAsks(input.inbox, input.now)].filter((row) => !input.ticked.has(row.id));
  return {
    open: [...asks, ...input.open.map((todo) => ownRow(todo, input.now))],
    done: input.done.map((todo) => ({ id: todo.id, text: todo.description, from: todo.sourceRef ? "flyd" : "you" })),
  };
}

/** The list as it stands, around the jobs the column just drew. */
export function readTodos(jobs: Job[], now = new Date()): TodoList {
  return todosFrom({
    jobs,
    inbox: georgeInbox(),
    open: listOpenConfirmedTodos(now),
    done: listDoneConfirmedTodos(new Date(now.getTime() - DONE_KEEP_MS)),
    ticked: tickedFlydAsks(),
    now,
  });
}

/** Tick one item off, whichever kind it is. False when nothing by that id is open. */
export function tickTodo(id: string, jobs: Job[], now = new Date()): boolean {
  const row = readTodos(jobs, now).open.find((item) => item.id === id);
  if (!row) return false;
  if (row.from === "you") return tickConfirmedTodo(id);
  tickFlydAsk(id, row.text);
  return true;
}
