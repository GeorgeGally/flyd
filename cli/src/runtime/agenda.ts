import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { showMacNotification } from "./mac-notifications.js";

// Flyd's own agenda: things George (or Flyd, on his behalf) asked to happen
// later — follow-ups, recurring briefings, checks on something pending. A
// background runner (launchd and/or Core) executes due items as agent turns,
// files the result in an inbox, and notifies George. This is what makes Flyd
// proactive instead of only answering when spoken to.

export type AgendaRepeat = "none" | "hourly" | "daily" | "weekdays" | "weekly";

export interface AgendaItem {
  id: string;
  task: string;
  nextRunAt: string;
  repeat: AgendaRepeat;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastStatus?: "ok" | "failed";
  runs: number;
}

export interface InboxEntry {
  id: string;
  itemId: string;
  task: string;
  at: string;
  status: "ok" | "failed";
  result: string;
  read: boolean;
}

export interface AgendaPaths {
  agenda: string;
  inbox: string;
  lock: string;
}

export function agendaPaths(dir = process.env.FLYD_AGENDA_DIR?.trim() || FLYD_DIR): AgendaPaths {
  return {
    agenda: join(dir, "agenda.json"),
    inbox: join(dir, "inbox.jsonl"),
    lock: join(dir, "agenda.lock"),
  };
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

export function readAgenda(paths = agendaPaths()): AgendaItem[] {
  if (!existsSync(paths.agenda)) return [];
  try {
    const parsed = JSON.parse(readFileSync(paths.agenda, "utf8")) as AgendaItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAgenda(items: AgendaItem[], paths: AgendaPaths): void {
  atomicWrite(paths.agenda, `${JSON.stringify(items, null, 2)}\n`);
}

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/;

/** Parse "YYYY-MM-DD HH:MM" as local wall-clock time. */
export function parseLocalDateTime(text: string): Date | null {
  const match = text.trim().match(LOCAL_DATE_TIME);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatLocalDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Next occurrence strictly after `after`, keeping the item's wall-clock time. */
export function nextOccurrence(previous: Date, repeat: AgendaRepeat, after: Date): Date | null {
  if (repeat === "none") return null;
  const next = new Date(previous);
  const step = () => {
    if (repeat === "hourly") next.setHours(next.getHours() + 1);
    else if (repeat === "weekly") next.setDate(next.getDate() + 7);
    else next.setDate(next.getDate() + 1);
  };
  do {
    step();
    if (repeat === "weekdays") while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  } while (next.getTime() <= after.getTime());
  return next;
}

export function addAgendaItem(
  input: { task: string; when: string; repeat?: AgendaRepeat },
  paths = agendaPaths(),
  now = new Date(),
): AgendaItem {
  const task = input.task.replace(/\s+/g, " ").trim();
  if (!task) throw new Error("A scheduled task needs a description");
  const when = parseLocalDateTime(input.when);
  if (!when) throw new Error(`when must be local YYYY-MM-DD HH:MM, got "${input.when}"`);
  const repeat = input.repeat ?? "none";
  let first = when;
  if (first.getTime() <= now.getTime()) {
    if (repeat === "none") throw new Error(`${input.when} is in the past`);
    first = nextOccurrence(when, repeat, now)!;
  }
  const item: AgendaItem = {
    id: randomUUID().slice(0, 8),
    task,
    nextRunAt: first.toISOString(),
    repeat,
    enabled: true,
    createdAt: now.toISOString(),
    runs: 0,
  };
  writeAgenda([...readAgenda(paths), item], paths);
  return item;
}

export function cancelAgendaItem(id: string, paths = agendaPaths()): AgendaItem | null {
  const items = readAgenda(paths);
  const found = items.find((item) => item.id === id);
  if (!found) return null;
  writeAgenda(items.filter((item) => item.id !== id), paths);
  return found;
}

export function upcomingAgenda(paths = agendaPaths()): AgendaItem[] {
  return readAgenda(paths)
    .filter((item) => item.enabled)
    .sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));
}

export function describeAgendaItem(item: AgendaItem): string {
  const when = formatLocalDateTime(new Date(item.nextRunAt));
  const repeat = item.repeat === "none" ? "" : ` (${item.repeat})`;
  return `[${item.id}] ${when}${repeat} — ${item.task}`;
}

export function readInbox(paths = agendaPaths()): InboxEntry[] {
  if (!existsSync(paths.inbox)) return [];
  return readFileSync(paths.inbox, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as InboxEntry]; } catch { return []; }
  });
}

export function unreadInbox(paths = agendaPaths()): InboxEntry[] {
  return readInbox(paths).filter((entry) => !entry.read);
}

export function markInboxRead(paths = agendaPaths()): void {
  const entries = readInbox(paths);
  if (!entries.some((entry) => !entry.read)) return;
  // Keep the inbox bounded: the last 200 entries are plenty of history.
  const kept = entries.slice(-200).map((entry) => ({ ...entry, read: true }));
  atomicWrite(paths.inbox, `${kept.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}

/** Mark one source's inbox entries read (a chat that already showed them). */
export function markInboxItemRead(itemId: string, paths = agendaPaths()): void {
  const entries = readInbox(paths);
  if (!entries.some((entry) => entry.itemId === itemId && !entry.read)) return;
  atomicWrite(paths.inbox, `${entries.map((entry) => JSON.stringify(entry.itemId === itemId ? { ...entry, read: true } : entry)).join("\n")}\n`);
}

/** Record a result for George (background jobs use this too). */
export function recordInbox(entry: Omit<InboxEntry, "id" | "at" | "read">, paths = agendaPaths(), now = new Date()): void {
  appendInbox({ ...entry, id: randomUUID().slice(0, 8), at: now.toISOString(), read: false }, paths);
}

function appendInbox(entry: InboxEntry, paths: AgendaPaths): void {
  mkdirSync(dirname(paths.inbox), { recursive: true, mode: 0o700 });
  appendFileSync(paths.inbox, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
}

const STALE_LOCK_MS = 20 * 60 * 1000;

/** One runner at a time across launchd and Core; a crashed runner's lock expires. */
function acquireLock(path: string): boolean {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    closeSync(openSync(path, "wx"));
    return true;
  } catch {
    try {
      if (Date.now() - statSync(path).mtimeMs > STALE_LOCK_MS) {
        unlinkSync(path);
        closeSync(openSync(path, "wx"));
        return true;
      }
    } catch { /* another runner won the race */ }
    return false;
  }
}

export async function notifyMac(title: string, message: string): Promise<void> {
  await showMacNotification(title, message);
}

export interface RunDueDependencies {
  now?: () => Date;
  paths?: AgendaPaths;
  /** Runs one agenda task as an agent turn and returns Flyd's answer. */
  runTask(task: string, item: AgendaItem): Promise<string>;
  notify?: (title: string, message: string) => Promise<void>;
}

export interface RunDueResult {
  ran: Array<{ id: string; task: string; status: "ok" | "failed" }>;
  skipped?: "locked";
}

export async function runDueAgenda(deps: RunDueDependencies): Promise<RunDueResult> {
  const paths = deps.paths ?? agendaPaths();
  const now = (deps.now ?? (() => new Date()))();
  if (!readAgenda(paths).some((item) => item.enabled && new Date(item.nextRunAt).getTime() <= now.getTime())) {
    return { ran: [] };
  }
  if (!acquireLock(paths.lock)) return { ran: [], skipped: "locked" };
  const ran: RunDueResult["ran"] = [];
  try {
    const due = readAgenda(paths).filter((item) => item.enabled && new Date(item.nextRunAt).getTime() <= now.getTime());
    for (const item of due) {
      // Advance the schedule before running so a crash cannot re-run the item in a loop.
      const next = nextOccurrence(new Date(item.nextRunAt), item.repeat, now);
      writeAgenda(readAgenda(paths).map((existing) => existing.id !== item.id ? existing : {
        ...existing,
        enabled: next !== null,
        nextRunAt: next ? next.toISOString() : existing.nextRunAt,
        lastRunAt: now.toISOString(),
        runs: existing.runs + 1,
      }), paths);
      let status: "ok" | "failed" = "ok";
      let result: string;
      try {
        result = (await deps.runTask(item.task, item)).trim() || "(no answer)";
      } catch (error) {
        status = "failed";
        result = `Could not complete: ${error instanceof Error ? error.message : String(error)}`;
      }
      writeAgenda(readAgenda(paths).map((existing) => existing.id === item.id ? { ...existing, lastStatus: status } : existing), paths);
      appendInbox({ id: randomUUID().slice(0, 8), itemId: item.id, task: item.task, at: now.toISOString(), status, result, read: false }, paths);
      await (deps.notify ?? notifyMac)(`Flyd — ${item.task.slice(0, 60)}`, result).catch(() => undefined);
      ran.push({ id: item.id, task: item.task, status });
    }
  } finally {
    try { unlinkSync(paths.lock); } catch { /* already gone */ }
  }
  return { ran };
}
