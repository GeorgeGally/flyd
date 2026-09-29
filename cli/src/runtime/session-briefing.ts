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
  loadCalendar?: () => Promise<string[]>;
  /** Gather without marking anything seen (news told, advisories shown, inbox read): for preparing ahead. */
  peek?: boolean;
}

/** After telling him the news, don't lead with the same stories again for a few hours. */
const NEWS_REPEAT_MS = 3 * 60 * 60 * 1000;

/** Lines for the session intro, or [] when there is nothing worth saying. */
export async function composeSessionBriefing(deps: SessionBriefingDependencies = {}): Promise<string[]> {
  const now = (deps.now ?? (() => new Date()))();
  const paths = deps.paths ?? agendaPaths();
  const lines: string[] = [];

  try {
    const { openAdvisories, updateAdvisoryStatus } = await import("../council/advisors.js");
    const worth = openAdvisories(now).filter((advisory) => advisory.urgency !== "low").slice(0, 2);
    for (const advisory of worth) {
      lines.push(`On my mind: ${firstLine(advisory.text, 160)}`);
      if (!deps.paths && !deps.peek) updateAdvisoryStatus(advisory.id, "shown", now);
    }
  } catch {
    // The council is advisory; a missing store never blocks the briefing.
  }

  try {
    const scout = await import("../council/scout.js");
    const edition = scout.latestEdition();
    const markPath = `${scout.scoutDir()}/briefed-date`;
    const { readFileSync: read, writeFileSync: write, mkdirSync: mkdir } = await import("node:fs");
    let toldAt: Date | null = null;
    try {
      // Holds when he was last told the news (older builds wrote only the date).
      const raw = read(markPath, "utf8").trim();
      const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw);
      toldAt = Number.isNaN(parsed.getTime()) ? null : parsed;
    } catch { /* never told */ }
    const yesterday = formatLocalDateTime(new Date(now.getTime() - 86_400_000)).slice(0, 10);
    if (!deps.paths && edition && edition.items.length && edition.date >= yesterday) {
      const heard = toldAt && now.getTime() - toldAt.getTime() < NEWS_REPEAT_MS;
      lines.push(heard
        ? `News he already heard at ${clock(toldAt!)} (bring up only if something is new or he asks):`
        : "Today's news, not yet told him (/more N, /less N):");
      for (const item of edition.items.slice(0, heard ? 3 : 6)) lines.push(`  ${item.n}. ${item.kind === "rabbit_hole" || item.kind === "wildcard" ? "🐇 " : item.kind === "must" ? "❗ " : ""}${firstLine(item.title, 70)} — ${firstLine(item.why, 110)}`);
      if (!heard && !deps.peek) {
        mkdir(scout.scoutDir(), { recursive: true });
        write(markPath, now.toISOString());
      }
    }
  } catch {
    // News is optional; the briefing never fails for it.
  }
  try {
    const { takeEvolutionNotes } = await import("../council/scout.js");
    const notes = deps.paths ? [] : takeEvolutionNotes();
    if (notes.length) lines.push(`I tuned your news: ${notes.join("; ")}`);
  } catch {
    // Optional.
  }

  try {
    if (!deps.paths) {
      const crew = await import("../crew/crew.js");
      const tasks = crew.listTasks().filter((task) => task.status === "running" || task.status === "ready" || (task.status === "failed" && task.finishedAt && now.getTime() - Date.parse(task.finishedAt) < 2 * 86_400_000));
      if (tasks.length) {
        lines.push("I'm building:");
        const state = { running: "in progress", verifying: "testing", ready: "done and tested, /land to merge", failed: "didn't work out" } as Record<string, string>;
        for (const task of tasks.slice(0, 4)) lines.push(`  • ${crew.plainOutcome(task)} (${state[task.status] ?? task.status})`);
      }
    }
  } catch {
    // Crew state is optional here.
  }

  const inbox = unreadInbox(paths);
  if (inbox.length) {
    lines.push(`While you were away (${inbox.length} update${inbox.length === 1 ? "" : "s"}):`);
    for (const entry of inbox.slice(-3)) {
      lines.push(`  • ${firstLine(entry.task, 50)} → ${firstLine(entry.result)}`);
    }
    if (inbox.length > 3) lines.push("  …more in `flyd agenda inbox`");
    if (!deps.peek) markInboxRead(paths);
  }

  try {
    const real = async () => (process.env.VITEST ? [] : (await import("./personal-tools.js")).calendarToday(now));
    const events = await (deps.loadCalendar ?? real)();
    if (events.length) lines.push(`Calendar today: ${events.slice(0, 6).map((event) => firstLine(event, 90)).join("; ")}`);
  } catch {
    // Calendar access can be denied or slow; the briefing goes on without it.
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
    lines.push(`Later I'll: ${coming.slice(0, 3).map((item) => `${clock(new Date(item.nextRunAt))} ${firstLine(item.task, 60)}`).join("; ")}`);
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
