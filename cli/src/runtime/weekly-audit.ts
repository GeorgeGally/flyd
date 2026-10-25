import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// George, 2026-10-24: the state-of-the-nation audit is "the big task that I
// need to be happening all the time". Once a week (Monday from 07:00) the
// tick starts scripts/flyd-audit.sh: a read-only Claude Code run that writes
// ~/.flyd/audits/<date>.md and shows its headline on the island. It runs from
// Core's tick rather than launchd, because macOS keeps launchd jobs out of
// ~/Documents. FLYD_AUDIT=0 turns it off.

const AUDIT_WEEKDAY = 1; // Monday
const AUDIT_HOUR = 7;
const MIN_GAP_MS = 6 * 86_400_000;
/** A run still marked running after this long is taken as dead. */
const STALE_RUN_MS = 3 * 3_600_000;

export function auditDir(): string {
  return join(process.env.FLYD_DIR || join(homedir(), ".flyd"), "audits");
}

/** The newest audit's time, from its file: undefined when there is none. */
function lastAuditAt(dir: string): number | undefined {
  try {
    const times = readdirSync(dir).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name)).map((name) => statSync(join(dir, name)).mtimeMs);
    return times.length ? Math.max(...times) : undefined;
  } catch {
    return undefined;
  }
}

/** Whether this week's audit is due: Monday from 07:00 on, and none in the last six days. Pure but for the clock and dir passed in. */
export function auditDue(now: Date, last: number | undefined): boolean {
  if (last !== undefined && now.getTime() - last < MIN_GAP_MS) return false;
  // Missed Monday (Mac asleep, Core down): any later day of the week catches up.
  const daysSinceMonday = (now.getDay() - AUDIT_WEEKDAY + 7) % 7;
  return daysSinceMonday > 0 || now.getHours() >= AUDIT_HOUR;
}

function running(marker: string, now: number): boolean {
  try {
    const { pid, at } = JSON.parse(readFileSync(marker, "utf8")) as { pid: number; at: number };
    if (now - at > STALE_RUN_MS) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Starts the weekly audit when it is due; a line for the tick log when it did. */
export function startWeeklyAuditIfDue(options: { now?: Date; dir?: string; script?: string } = {}): string | undefined {
  if (process.env.FLYD_AUDIT === "0" || process.env.VITEST) return undefined;
  const now = options.now ?? new Date();
  const dir = options.dir ?? auditDir();
  if (!auditDue(now, lastAuditAt(dir))) return undefined;
  const marker = join(dir, ".running");
  if (running(marker, now.getTime())) return undefined;
  const script = options.script ?? resolve(fileURLToPath(new URL("../../../scripts/flyd-audit.sh", import.meta.url)));
  if (!existsSync(script)) return undefined;
  mkdirSync(dir, { recursive: true });
  const log = openSync(join(dir, "audit.log"), "a");
  const child = spawn("/bin/bash", [script], { detached: true, stdio: ["ignore", log, log], env: { ...process.env, FLYD_AUDIT_MARKER: marker } });
  child.unref();
  writeFileSync(marker, JSON.stringify({ pid: child.pid, at: now.getTime() }));
  return `weekly audit started (pid ${child.pid})`;
}
