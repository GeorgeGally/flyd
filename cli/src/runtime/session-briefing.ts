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

/** Profile sections a PA most needs; empty ones prompt an /onboard nudge. */
export function profileGaps(profile: string | null): string[] {
  if (!profile) return ["everything"];
  const wanted = ["About me", "People", "Routines", "Goals"];
  return wanted.filter((section) => {
    const match = profile.match(new RegExp(`^## ${section}\\n((?:(?!^## ).*\\n?)*)`, "m"));
    return !match || !/^\s*-\s+\S/m.test(match[1]);
  });
}

export interface SessionBriefingDependencies {
  now?: () => Date;
  paths?: AgendaPaths;
  loadReminders?: () => Promise<DueReminder[]>;
  readProfile?: () => string | null;
}

/** Lines for the session intro, or [] when there is nothing worth saying. */
export async function composeSessionBriefing(deps: SessionBriefingDependencies = {}): Promise<string[]> {
  const now = (deps.now ?? (() => new Date()))();
  const paths = deps.paths ?? agendaPaths();
  const lines: string[] = [];

  try {
    const { openAdvisories, updateAdvisoryStatus } = await import("../council/advisors.js");
    const worth = openAdvisories(now).filter((advisory) => advisory.urgency !== "low").slice(0, 2);
    for (const advisory of worth) {
      lines.push(`${advisory.advisor === "critic" ? "Critic" : "Strategist"}: ${firstLine(advisory.text, 160)}`);
      if (!deps.paths) updateAdvisoryStatus(advisory.id, "shown", now);
    }
  } catch {
    // The council is advisory; a missing store never blocks the briefing.
  }

  try {
    const scout = await import("../council/scout.js");
    const edition = scout.latestEdition();
    const markPath = `${scout.scoutDir()}/briefed-date`;
    const { readFileSync: read, writeFileSync: write, mkdirSync: mkdir } = await import("node:fs");
    let briefed = "";
    try { briefed = read(markPath, "utf8").trim(); } catch { /* never briefed */ }
    const today = formatLocalDateTime(now).slice(0, 10);
    if (!deps.paths && edition && edition.items.length && briefed !== today && edition.date >= formatLocalDateTime(new Date(now.getTime() - 86_400_000)).slice(0, 10)) {
      lines.push("Worth knowing (/more N, /less N):");
      for (const item of edition.items.slice(0, 6)) lines.push(`  ${item.n}. ${item.kind === "rabbit_hole" || item.kind === "wildcard" ? "🐇 " : item.kind === "must" ? "❗ " : ""}${firstLine(item.title, 70)} — ${firstLine(item.why, 110)}`);
      mkdir(scout.scoutDir(), { recursive: true });
      write(markPath, today);
    }
  } catch {
    // News is optional; the briefing never fails for it.
  }
  try {
    const { takeEvolutionNotes } = await import("../council/scout.js");
    const notes = deps.paths ? [] : takeEvolutionNotes();
    if (notes.length) lines.push(`Scout adjusted: ${notes.join("; ")}`);
  } catch {
    // Optional.
  }

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
  try {
    const { readUserProfile } = await import("../lib/user-profile.js");
    const gaps = profileGaps((deps.readProfile ?? readUserProfile)());
    if (gaps.length) {
      const phrase: Record<string, string> = {
        everything: "much about you", "About me": "where you live", People: "the people in your life",
        Routines: "your routines", Goals: "your goals",
      };
      lines.push(`I don't know ${gaps.map((gap) => phrase[gap] ?? gap).join(", ")} yet — type /onboard and I'll ask a few questions.`);
    }
  } catch {
    // A missing or unreadable profile never blocks the briefing.
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
