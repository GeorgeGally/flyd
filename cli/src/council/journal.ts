import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";

// One continuous record of what George and Flyd said, across launches. Chat
// sessions are disposable; the journal is what the Archivist curates from and
// what the next conversation can pick up. A restart is a non-event.

export interface JournalTurn {
  id: string;
  at: string;
  user: string;
  assistant: string;
  /** Short "name: outcome" lines for tools the turn used. */
  tools?: string[];
  surface?: string;
}

export function journalDir(): string {
  return process.env.FLYD_JOURNAL_DIR?.trim() || join(FLYD_DIR, "journal");
}

function dayFile(date: Date, dir: string): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return join(dir, `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.jsonl`);
}

export function appendJournalTurn(
  turn: Omit<JournalTurn, "id" | "at"> & { at?: Date },
  dir = journalDir(),
): JournalTurn {
  const at = turn.at ?? new Date();
  const entry: JournalTurn = {
    id: `${at.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: at.toISOString(),
    user: turn.user,
    assistant: turn.assistant,
    ...(turn.tools?.length ? { tools: turn.tools } : {}),
    ...(turn.surface ? { surface: turn.surface } : {}),
  };
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  appendFileSync(dayFile(at, dir), `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  return entry;
}

/** Turns strictly after `sinceIso`, oldest first. */
export function readJournalSince(sinceIso: string | null, dir = journalDir(), limit = 400): JournalTurn[] {
  if (!existsSync(dir)) return [];
  const sinceDay = sinceIso ? sinceIso.slice(0, 10) : "";
  const turns: JournalTurn[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".jsonl")).sort()) {
    // Day files older than the cursor's day cannot hold newer turns (local vs UTC may differ by a day).
    if (sinceDay && file.slice(0, 10) < shiftDay(sinceDay, -1)) continue;
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const turn = JSON.parse(line) as JournalTurn;
        if (!sinceIso || turn.at > sinceIso) turns.push(turn);
      } catch {
        // A torn final line from a crash is skipped, never fatal.
      }
    }
  }
  turns.sort((a, b) => a.at.localeCompare(b.at));
  return turns.slice(-limit);
}

/** The most recent turns, for continuity across launches. */
export function recentJournal(count: number, dir = journalDir()): JournalTurn[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((name) => name.endsWith(".jsonl")).sort().slice(-3);
  const turns: JournalTurn[] = [];
  for (const file of files) {
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { turns.push(JSON.parse(line) as JournalTurn); } catch { /* torn line */ }
    }
  }
  return turns.sort((a, b) => a.at.localeCompare(b.at)).slice(-count);
}

function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
