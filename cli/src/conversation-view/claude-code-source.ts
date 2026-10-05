import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { LineFollower } from "./line-follower.js";
import { TranscriptConversation } from "./transcript-filter.js";
import type {
  ConversationFollower,
  ConversationSnapshot,
  ConversationSource,
  SessionSummary,
} from "./types.js";

/** Firstmate's Claude Code home; the default conversation for `flyd view`. */
export const FIRSTMATE_PROJECT_DIR = "-Users-radarboy3000-Documents-firstmate";
const TITLE_SCAN_BYTES = 256 * 1024;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function claudeProjectsRoot(): string {
  return join(homedir(), ".claude", "projects");
}

/** Accepts a project dir name under ~/.claude/projects or an absolute path. */
export function resolveProjectDir(project: string): string {
  return isAbsolute(project) ? project : join(claudeProjectsRoot(), project);
}

function readRange(path: string, start: number, length: number): string {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, start);
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function lastTitleIn(text: string): string | undefined {
  let title: string | undefined;
  for (const line of text.split("\n")) {
    if (!line.includes('"custom-title"') && !line.includes('"ai-title"') && !line.includes('"type":"summary"')) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      const value = entry.customTitle ?? entry.aiTitle ?? entry.summary;
      if (typeof value === "string" && value.trim()) title = value.trim();
    } catch {
      // A torn line at the edge of the scanned window.
    }
  }
  return title;
}

/**
 * Session title without reading a whole (often 100MB+) transcript: the
 * newest title entry near the end, else one near the start, else the first
 * captain message.
 */
function sessionTitle(path: string, size: number): string {
  const tail = readRange(path, Math.max(0, size - TITLE_SCAN_BYTES), Math.min(size, TITLE_SCAN_BYTES));
  const head = size > TITLE_SCAN_BYTES ? readRange(path, 0, TITLE_SCAN_BYTES) : "";
  const title = lastTitleIn(tail) ?? lastTitleIn(head);
  if (title) return title;
  const conversation = new TranscriptConversation();
  for (const line of (head || tail).split("\n")) if (line) conversation.pushLine(line);
  const first = conversation.snapshot().messages.find((message) => message.role === "user");
  return first ? first.text.replace(/\s+/g, " ").slice(0, 80) : "Untitled session";
}

/** Reads Claude Code session transcripts. Read-only: transcript files are never written. */
export class ClaudeCodeTranscriptSource implements ConversationSource {
  readonly assistantLabel: string;
  private readonly projectDir: string;
  private readonly pollMs: number;
  private readonly titles = new Map<string, { size: number; mtimeMs: number; title: string }>();

  constructor(options: { projectDir?: string; assistantLabel?: string; pollMs?: number } = {}) {
    this.projectDir = options.projectDir ?? resolveProjectDir(FIRSTMATE_PROJECT_DIR);
    this.assistantLabel = options.assistantLabel ?? (basename(this.projectDir).endsWith("firstmate") ? "firstmate" : "Claude");
    this.pollMs = options.pollMs ?? 400;
  }

  private sessionPath(sessionId: string): string {
    if (!SESSION_ID.test(sessionId)) throw new Error(`Invalid session id: ${sessionId}`);
    const path = join(this.projectDir, `${sessionId}.jsonl`);
    if (!existsSync(path)) throw new Error(`No such session: ${sessionId}`);
    return path;
  }

  async listSessions(): Promise<SessionSummary[]> {
    if (!existsSync(this.projectDir)) return [];
    const sessions = readdirSync(this.projectDir)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => {
        const path = join(this.projectDir, name);
        const stat = statSync(path);
        return { id: name.slice(0, -".jsonl".length), path, size: stat.size, mtime: stat.mtime };
      })
      .filter((session) => session.size > 0 && SESSION_ID.test(session.id))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const listed = new Set(sessions.map((session) => session.path));
    for (const path of this.titles.keys()) if (!listed.has(path)) this.titles.delete(path);
    return sessions.map((session) => ({
      id: session.id,
      title: this.cachedTitle(session.path, session.size, session.mtime.getTime()),
      updatedAt: session.mtime.toISOString(),
    }));
  }

  /** Titles are rescanned only when a transcript's size or mtime changed. */
  private cachedTitle(path: string, size: number, mtimeMs: number): string {
    const cached = this.titles.get(path);
    if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.title;
    const title = sessionTitle(path, size);
    this.titles.set(path, { size, mtimeMs, title });
    return title;
  }

  async read(sessionId: string): Promise<ConversationSnapshot> {
    const conversation = new TranscriptConversation();
    new LineFollower(this.sessionPath(sessionId)).readNew((line) => conversation.pushLine(line));
    return conversation.snapshot();
  }

  follow(
    sessionId: string,
    onUpdate: (snapshot: ConversationSnapshot) => void,
    onError?: (error: Error) => void,
  ): ConversationFollower {
    const path = this.sessionPath(sessionId);
    const follower = new LineFollower(path);
    let conversation = new TranscriptConversation();
    let closed = false;

    const pump = (initial: boolean): void => {
      if (closed) return;
      try {
        let truncated = false;
        const count = follower.readNew(
          (line) => conversation.pushLine(line),
          () => {
            truncated = true;
            conversation = new TranscriptConversation();
          },
        );
        if (!initial && !truncated && count === 0) return;
        onUpdate(conversation.snapshot());
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    };

    pump(true);
    // Polling, not fs.watch: it behaves the same for every editor and
    // filesystem, and a stat every few hundred ms is negligible.
    const timer = setInterval(() => pump(false), this.pollMs);
    timer.unref?.();
    return {
      close() {
        closed = true;
        clearInterval(timer);
      },
    };
  }
}
