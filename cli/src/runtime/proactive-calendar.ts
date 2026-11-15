import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CareEvent } from "./proactive-care.js";

const runFile = promisify(execFile);

// Read event *metadata* only. No description, attendee email, notes,
// location or participant list is captured. Never starts Calendar when it is
// closed (the caller checks appRunning first).
const SCRIPT = String.raw`
on twoDigits(n)
  set s to (n as integer) as string
  if length of s < 2 then return "0" & s
  return s
end twoDigits

on run argv
  set startBound to current date
  set endBound to startBound + (2 * hours)
  set out to ""
  tell application "Calendar"
    repeat with c in calendars
      try
        repeat with e in (every event of c whose start date is greater than startBound and start date is less than endBound)
          set d to start date of e
          set stamp to ((year of d as integer) as string) & "-" & my twoDigits(month of d as integer) & "-" & my twoDigits(day of d as integer) & "T" & my twoDigits(hours of d) & ":" & my twoDigits(minutes of d) & ":00"
          set out to out & (uid of e as string) & tab & (summary of e as string) & tab & stamp & linefeed
        end repeat
      end try
    end repeat
  end tell
  return out
end run
`;

export function parseCalendarMetadata(raw: string): CareEvent[] {
  const unique = new Set<string>();
  return raw.split("\n").flatMap((line) => {
    const parts = line.trim().split("\t");
    if (parts.length !== 3) return [];
    const [id, title, start] = parts;
    if (!id || !title || !start || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(start)) return [];
    const parsed = new Date(start);
    // JavaScript normalizes invalid days (e.g. February 31); do not let
    // malformed Calendar metadata create phantom upcoming meetings.
    const formatted = Number.isNaN(parsed.getTime()) ? "" :
      `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}T${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}:${String(parsed.getSeconds()).padStart(2, "0")}`;
    if (formatted !== start || /[\r\n]/.test(id + title)) return [];
    if (unique.has(id + start)) return [];
    unique.add(id + start);
    return [{ id: id.slice(0, 180), title: title.slice(0, 180), start }];
  }).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 20);
}

export async function upcomingCalendarMetadata(): Promise<CareEvent[]> {
  if (process.platform !== "darwin" || process.env.VITEST) return [];
  const { stdout } = await runFile("osascript", ["-e", SCRIPT], { timeout: 7000, maxBuffer: 48 * 1024 });
  return parseCalendarMetadata(stdout);
}
