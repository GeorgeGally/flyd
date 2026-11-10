import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";

// Whether George has the conversation window open, for Core.
//
// The window's own process keeps one line per open stream, refreshed on its
// heartbeat; Core reads it before announcing work he started from the window:
// with the window open the reply shows under his message there, so a
// notification would say it twice. A stream not refreshed lately is closed.

/** A stream not refreshed for this long is gone (the window's heartbeat is 15 s). */
export const WINDOW_STALE_MS = 45_000;

interface PresenceFile {
  streams: Record<string, { session: string; at: number }>;
}

export function defaultWindowPresenceFile(): string {
  return process.env.FLYD_VIEW_PRESENCE_FILE?.trim() || join(FLYD_DIR, "view", "window.json");
}

function read(path: string): PresenceFile {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<PresenceFile>;
    return { streams: parsed.streams && typeof parsed.streams === "object" ? parsed.streams : {} };
  } catch {
    return { streams: {} };
  }
}

function write(path: string, file: PresenceFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(file));
  renameSync(temp, path);
}

/** Records (or refreshes) an open stream on a session. Best effort. */
export function markWindowOpen(stream: string, session: string, path = defaultWindowPresenceFile(), now = Date.now()): void {
  // Tests never write the real home's presence unless they name their own file.
  if (process.env.VITEST && !process.env.FLYD_VIEW_PRESENCE_FILE && path === defaultWindowPresenceFile()) return;
  try {
    const file = read(path);
    file.streams = Object.fromEntries(Object.entries(file.streams).filter(([, entry]) => now - entry.at < WINDOW_STALE_MS));
    file.streams[stream] = { session, at: now };
    write(path, file);
  } catch { /* Presence is a courtesy: without it Core announces, which is never wrong. */ }
}

/** Forgets a stream that closed. Best effort. */
export function markWindowClosed(stream: string, path = defaultWindowPresenceFile()): void {
  try {
    const file = read(path);
    if (!(stream in file.streams)) return;
    delete file.streams[stream];
    write(path, file);
  } catch { /* A stale line ages out on its own. */ }
}

/** Whether a window is open now, on the given session when one is named. */
export function windowOpen(session?: string, path = defaultWindowPresenceFile(), now = Date.now()): boolean {
  return Object.values(read(path).streams).some((entry) => now - entry.at < WINDOW_STALE_MS && (!session || entry.session === session));
}
