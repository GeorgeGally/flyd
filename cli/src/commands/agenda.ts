import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { FLYD_APPLICATION_ROOT, FLYD_DIR } from "../lib/config.js";
import {
  addAgendaItem, cancelAgendaItem, describeAgendaItem, formatLocalDateTime, markInboxRead,
  readInbox, runDueAgenda, upcomingAgenda, type AgendaRepeat,
} from "../runtime/agenda.js";

const LABEL = "com.flyd.agenda";
const DEFAULT_BRIEF_TASK = "Morning brief: today's calendar and reminders (flag anything overdue), what changed in my active repos since yesterday, any Flyd agenda results I haven't seen, and the one thing most worth doing first today.";

function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function agendaLaunchAgentPlist(nodePath: string, entryPath: string, logPath: string, path: string): string {
  const args = [nodePath, entryPath, "agenda", "run-due"].map((arg) => `    <string>${escapeXml(arg)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${escapeXml(FLYD_APPLICATION_ROOT)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(path)}</string>
    <key>HOME</key>
    <string>${escapeXml(homedir())}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
</dict>
</plist>
`;
}

function nextWeekdayAt(hour: number): string {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
  return formatLocalDateTime(date);
}

function install(): void {
  if (process.platform !== "darwin") throw new Error("flyd agenda install uses launchd and is macOS-only");
  const entry = join(FLYD_APPLICATION_ROOT, "cli", "dist", "entry.js");
  if (!existsSync(entry)) throw new Error(`Build Flyd first (cd cli && npm run build): ${entry} is missing`);
  const logDir = join(FLYD_DIR, "logs");
  mkdirSync(logDir, { recursive: true });
  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  // launchd starts with a minimal PATH; carry the tools Flyd shells out to.
  const path = [...new Set([
    join(process.execPath, ".."), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin",
    ...(process.env.PATH ?? "").split(":"),
  ])].filter(Boolean).join(":");
  writeFileSync(plistPath(), agendaLaunchAgentPlist(process.execPath, entry, join(logDir, "agenda.log"), path));
  const domain = `gui/${process.getuid?.() ?? 501}`;
  try { execFileSync("launchctl", ["bootout", domain, plistPath()], { stdio: "ignore" }); } catch { /* not loaded */ }
  execFileSync("launchctl", ["bootstrap", domain, plistPath()], { stdio: "inherit" });
  process.stdout.write(`Flyd agenda runner installed (${plistPath()}); it checks for due items every 5 minutes.\n`);
  if (upcomingAgenda().length === 0) {
    const item = addAgendaItem({ task: DEFAULT_BRIEF_TASK, when: nextWeekdayAt(8), repeat: "weekdays" });
    process.stdout.write(`Seeded a weekday morning brief: ${describeAgendaItem(item)}\nCancel with: flyd agenda cancel ${item.id}\n`);
  }
}

function uninstall(): void {
  const domain = `gui/${process.getuid?.() ?? 501}`;
  try { execFileSync("launchctl", ["bootout", domain, plistPath()], { stdio: "ignore" }); } catch { /* not loaded */ }
  if (existsSync(plistPath())) unlinkSync(plistPath());
  process.stdout.write("Flyd agenda runner removed. Agenda items are kept; Core still runs them while it is up.\n");
}

export async function runAgendaCommand(
  action = "list",
  args: string[] = [],
  options: { at?: string; repeat?: string } = {},
): Promise<void> {
  switch (action) {
    case "list": {
      const items = upcomingAgenda();
      process.stdout.write(items.length
        ? `${items.map(describeAgendaItem).join("\n")}\n`
        : "Flyd's agenda is empty. Ask Flyd to follow up on something, or: flyd agenda add \"task\" --at \"YYYY-MM-DD HH:MM\"\n");
      return;
    }
    case "add": {
      const task = args.join(" ").trim();
      if (!task || !options.at) throw new Error('Usage: flyd agenda add "task" --at "YYYY-MM-DD HH:MM" [--repeat daily|weekdays|weekly|hourly]');
      const item = addAgendaItem({ task, when: options.at, repeat: (options.repeat ?? "none") as AgendaRepeat });
      process.stdout.write(`Scheduled ${describeAgendaItem(item)}\n`);
      return;
    }
    case "cancel": {
      const removed = cancelAgendaItem(args[0] ?? "");
      if (!removed) throw new Error(`No agenda item ${args[0] ?? ""}`);
      process.stdout.write(`Cancelled: ${removed.task}\n`);
      return;
    }
    case "run-due": {
      const { runAgendaTask } = await import("../runtime/agenda-runner.js");
      const result = await runDueAgenda({ runTask: runAgendaTask });
      if (result.skipped) process.stdout.write("Another agenda run is in progress.\n");
      for (const ran of result.ran) process.stdout.write(`${new Date().toISOString()} ${ran.status} ${ran.id} ${ran.task}\n`);
      // The council curates and advises on the same tick when there is something new.
      const { runCouncilPass } = await import("../council/council.js");
      const { query } = await import("../lib/llm.js");
      const { notifyMac } = await import("../runtime/agenda.js");
      const council = await runCouncilPass({ complete: (prompt) => query(prompt, undefined, undefined, undefined, undefined, { json: true }), notify: notifyMac }).catch((error: unknown) => {
        process.stderr.write(`council pass failed: ${error instanceof Error ? error.message : String(error)}\n`);
        return null;
      });
      const { superviseCrew } = await import("../crew/crew.js");
      for (const task of await superviseCrew({ notify: notifyMac }).catch(() => [])) {
        process.stdout.write(`${new Date().toISOString()} crew: ${task.id} ${task.status}\n`);
      }
      const { scoutTick } = await import("../council/scout.js");
      const scoutLog = await scoutTick({
        complete: (prompt) => query(prompt, undefined, undefined, undefined, undefined, { json: true }),
        notify: notifyMac,
      }).catch((error: unknown) => [`failed: ${error instanceof Error ? error.message : String(error)}`]);
      if (scoutLog.length) process.stdout.write(`${new Date().toISOString()} scout: ${scoutLog.join("; ")}\n`);
      if (council && !council.skipped) {
        process.stdout.write(`${new Date().toISOString()} council: ${council.librarian?.turns ?? 0} turns, ${council.librarian?.captures ?? 0} captures, ${council.advisories.length} advisories\n`);
      }
      return;
    }
    case "inbox": {
      const entries = readInbox().slice(-10);
      process.stdout.write(entries.length
        ? `${entries.map((entry) => `${entry.read ? " " : "•"} ${formatLocalDateTime(new Date(entry.at))} ${entry.task}\n  ${entry.result.replace(/\n/g, "\n  ")}`).join("\n\n")}\n`
        : "Nothing in Flyd's inbox yet.\n");
      markInboxRead();
      return;
    }
    case "install":
      install();
      return;
    case "uninstall":
      uninstall();
      return;
    default:
      throw new Error(`Unknown agenda action: ${action} (list|add|cancel|run-due|inbox|install|uninstall)`);
  }
}
