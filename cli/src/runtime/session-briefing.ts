import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  agendaPaths, formatLocalDateTime, markInboxRead, unreadInbox, upcomingAgenda, type AgendaPaths,
} from "./agenda.js";

// What a good PA says when you sit down: what happened while you were away,
// what is due today, and what is coming. Deterministic and local so opening
// Flyd stays instant.

const execFileAsync = promisify(execFile);

export interface DueReminder {
  title: string;
  due: Date;
}

const DUE_REMINDERS = `
on run argv
  set cutoff to (current date)
  set time of cutoff to 0
  set cutoff to cutoff + (1 * days)
  set out to ""
  tell application "Reminders"
    repeat with r in (every reminder whose completed is false and due date < cutoff)
      set out to out & (name of r) & tab & ((due date of r) as «class isot» as string) & linefeed
    end repeat
  end tell
  return out
end run`;

export async function loadDueReminders(): Promise<DueReminder[]> {
  if (process.platform !== "darwin") return [];
  const { stdout } = await execFileAsync("osascript", ["-e", DUE_REMINDERS], { timeout: 6_000 });
  return stdout.split("\n").filter(Boolean).flatMap((line) => {
    const [title, iso] = line.split("\t");
    const due = new Date(iso ?? "");
    return title && !Number.isNaN(due.getTime()) ? [{ title, due }] : [];
  });
}

function clock(date: Date): string {
  return formatLocalDateTime(date).slice(11);
}

function firstLine(text: string, max = 110): string {
  const line = text.split("\n").map((part) => part.replace(/^[-•*\s]+/, "").trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export interface SessionBriefingDependencies {
  now?: () => Date;
  paths?: AgendaPaths;
  loadReminders?: () => Promise<DueReminder[]>;
}

/** Lines for the session intro, or [] when there is nothing worth saying. */
export async function composeSessionBriefing(deps: SessionBriefingDependencies = {}): Promise<string[]> {
  const now = (deps.now ?? (() => new Date()))();
  const paths = deps.paths ?? agendaPaths();
  const lines: string[] = [];

  const inbox = unreadInbox(paths);
  if (inbox.length) {
    lines.push(`While you were away (${inbox.length} update${inbox.length === 1 ? "" : "s"}):`);
    for (const entry of inbox.slice(-3)) {
      lines.push(`  • ${firstLine(entry.task, 50)} → ${firstLine(entry.result)}`);
    }
    if (inbox.length > 3) lines.push("  …more in `flyd agenda inbox`");
    markInboxRead(paths);
  }

  let reminders: DueReminder[] = [];
  try {
    reminders = await (deps.loadReminders ?? loadDueReminders)();
  } catch {
    reminders = [];
  }
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const overdue = reminders.filter((reminder) => reminder.due < startOfToday);
  const today = reminders.filter((reminder) => reminder.due >= startOfToday).sort((a, b) => a.due.getTime() - b.due.getTime());
  if (overdue.length) lines.push(`Overdue: ${overdue.map((reminder) => reminder.title).join(", ")}`);
  if (today.length) lines.push(`Due today: ${today.map((reminder) => `${reminder.title} ${clock(reminder.due)}`).join(", ")}`);

  const horizon = now.getTime() + 24 * 60 * 60 * 1000;
  const coming = upcomingAgenda(paths).filter((item) => new Date(item.nextRunAt).getTime() <= horizon);
  if (coming.length) {
    lines.push(`Flyd will: ${coming.slice(0, 3).map((item) => `${clock(new Date(item.nextRunAt))} ${firstLine(item.task, 60)}`).join("; ")}`);
  }
  return lines;
}

/** Compact agenda block for the chat prompt so Flyd knows what it has promised. */
export function agendaPromptBlock(paths = agendaPaths()): string {
  const items = upcomingAgenda(paths).slice(0, 8);
  if (items.length === 0) return "";
  const lines = items.map((item) => `- ${formatLocalDateTime(new Date(item.nextRunAt))}${item.repeat === "none" ? "" : ` (${item.repeat})`} [${item.id}] ${item.task}`);
  return `\n<flyd-agenda>\nThings Flyd has scheduled itself to do (manage with the schedule tool):\n${lines.join("\n")}\n</flyd-agenda>\n`;
}
