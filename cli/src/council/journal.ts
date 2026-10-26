import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import type { TurnUnderstanding } from "../runtime/conversation-presence.js";
import { defaultIntelligenceDbPath, IntelligenceEventStore } from "../intelligence/event-store.js";

// One continuous record of what George and Flyd said, across launches. Chat
// sessions are disposable; the journal is what the Archivist curates from and
// what the next conversation can pick up. A restart is a non-event.

export interface JournalTurn {
  id: string;
  at: string;
  user: string;
  assistant: string;
  sessionId?: string;
  turnNumber?: number;
  projectIds?: string[];
  /** Short "name: outcome" lines for tools the turn used. */
  tools?: string[];
  surface?: string;
  understanding?: TurnUnderstanding;
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
    ...(turn.understanding ? { understanding: turn.understanding } : {}),
  };
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  appendFileSync(dayFile(at, dir), `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  return entry;
}

/** Turns strictly after `sinceIso`, oldest first. */
function turnsFromFile(sinceIso: string | null, dir: string, limit: number): JournalTurn[] {
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

/** Words that open a turn Flyd wrote for itself (a background job, a review, a scheduled task), not George. */
const FLYD_OWN_TURN = /^(?:Background job you took on for George:|You are checking work someone else did for George|You are reviewing work|Scheduled task George set up)/;

function viewTurnsFromEventSpine(sinceIso: string | null, limit: number): JournalTurn[] {
  const path = defaultIntelligenceDbPath();
  if (!existsSync(path)) return [];
  const store = new IntelligenceEventStore({ path });
  try {
    return store.readSource("chat.cognition").flatMap((event) => {
      if (event.erased || !event.payload) return [];
      const value = event.payload.conversation;
      if (!value || typeof value !== "object") return [];
      const conversation = value as Record<string, unknown>;
      if (typeof conversation.user !== "string" || typeof conversation.assistant !== "string") return [];
      // Every conversation George had with Flyd (the window, the terminal, mobile), never the
      // turns Flyd ran for itself: scheduled jobs and background work it briefed in his name.
      const sessionId = typeof conversation.sessionId === "string" ? conversation.sessionId : "";
      if (sessionId.startsWith("agenda-") || FLYD_OWN_TURN.test(conversation.user)) return [];
      if (sinceIso && event.capturedAt <= sinceIso) return [];
      return [{
        id: event.id,
        at: event.capturedAt,
        user: conversation.user,
        assistant: conversation.assistant,
        ...(sessionId ? { sessionId } : {}),
        ...(typeof conversation.turnNumber === "number" ? { turnNumber: conversation.turnNumber } : {}),
        ...(Array.isArray(conversation.projectIds) ? { projectIds: conversation.projectIds.filter((id): id is string => typeof id === "string") } : {}),
        surface: sessionId.startsWith("view:") ? "conversation-view" : "cli",
      }];
    }).sort((a, b) => a.at.localeCompare(b.at)).slice(-limit);
  } finally {
    store.close();
  }
}

/**
 * Turns after `sinceIso`, oldest first: a reader that advances a cursor to the last turn it
 * took must take the oldest `limit`, or a backlog longer than one batch is skipped for good.
 * With no cursor, the newest `limit`.
 */
export function readJournalSince(sinceIso: string | null, dir?: string, limit = 400): JournalTurn[] {
  const legacy = turnsFromFile(sinceIso, dir ?? journalDir(), sinceIso ? Infinity : limit);
  const view = dir === undefined ? viewTurnsFromEventSpine(sinceIso, sinceIso ? Infinity : limit) : [];
  const turns = [...legacy, ...view].sort((a, b) => a.at.localeCompare(b.at));
  return sinceIso ? turns.slice(0, limit) : turns.slice(-limit);
}

/** The most recent turns, for continuity across launches. */
export function recentJournal(count: number, dir?: string): JournalTurn[] {
  const legacyDir = dir ?? journalDir();
  const legacy: JournalTurn[] = [];
  if (existsSync(legacyDir)) {
    const files = readdirSync(legacyDir).filter((name) => name.endsWith(".jsonl")).sort().slice(-3);
    for (const file of files) {
      for (const line of readFileSync(join(legacyDir, file), "utf8").split("\n")) {
        if (!line.trim()) continue;
        try { legacy.push(JSON.parse(line) as JournalTurn); } catch { /* torn line */ }
      }
    }
  }
  const view = dir === undefined ? viewTurnsFromEventSpine(null, count) : [];
  return [...legacy, ...view].sort((a, b) => a.at.localeCompare(b.at)).slice(-count);
}

function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
