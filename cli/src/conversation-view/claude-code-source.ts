import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { mergeNotes, type CaptainInbox } from "./firstmate-inbox.js";
import { LineFollower } from "./line-follower.js";
import { captainImageAt, TranscriptConversation } from "./transcript-filter.js";
import type {
  ConversationFollower,
  ConversationSnapshot,
  ConversationSource,
  ImageData,
  ImageUpload,
  SentMessage,
  SessionSummary,
} from "./types.js";

/** Firstmate's Claude Code home; the default conversation for `flyd view`. */
export const FIRSTMATE_PROJECT_DIR = "-Users-radarboy3000-Documents-firstmate";
const TITLE_SCAN_BYTES = 256 * 1024;
const START_SCAN_BYTES = 64 * 1024;
/** A transcript line holding pasted screenshots can be large; past this it is not read back. */
const MAX_IMAGE_LINE_BYTES = 64 * 1024 * 1024;
const IMAGE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
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

/** The whole line that starts at byte `offset`, or null past the size cap. */
function readLineAt(path: string, offset: number): string | null {
  const fd = openSync(path, "r");
  try {
    const chunks: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(1 << 20);
    let position = offset;
    let total = 0;
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, position);
      if (read <= 0) break;
      const end = buffer.subarray(0, read).indexOf(0x0a);
      const piece = Buffer.from(buffer.subarray(0, end === -1 ? read : end));
      chunks.push(piece);
      total += piece.length;
      if (total > MAX_IMAGE_LINE_BYTES) return null;
      if (end !== -1) break;
      position += read;
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** Timestamp of a transcript's first timed entry: when the session started. */
function sessionStart(path: string, size: number): string | undefined {
  return /"timestamp":"([^"]+)"/.exec(readRange(path, 0, Math.min(size, START_SCAN_BYTES)))?.[1];
}

/**
 * Reads Claude Code session transcripts; transcript files are never written.
 * With a CaptainInbox, the captain can also send messages, and the ones he
 * sent are shown in the session that was current when he sent them.
 */
export class ClaudeCodeTranscriptSource implements ConversationSource {
  readonly assistantLabel: string;
  private readonly projectDir: string;
  private readonly pollMs: number;
  private readonly inbox?: CaptainInbox;
  private readonly titles = new Map<string, { size: number; mtimeMs: number; title: string }>();
  private readonly starts = new Map<string, string | undefined>();

  constructor(options: { projectDir?: string; assistantLabel?: string; pollMs?: number; inbox?: CaptainInbox } = {}) {
    this.projectDir = options.projectDir ?? resolveProjectDir(FIRSTMATE_PROJECT_DIR);
    this.assistantLabel = options.assistantLabel ?? (basename(this.projectDir).endsWith("firstmate") ? "firstmate" : "Claude");
    this.pollMs = options.pollMs ?? 400;
    this.inbox = options.inbox;
  }

  get canSend(): boolean {
    return this.inbox !== undefined;
  }

  async send(sessionId: string, text: string, images?: ImageUpload[]): Promise<SentMessage> {
    if (!this.inbox) throw new Error("This conversation is read-only");
    this.sessionPath(sessionId);
    return this.inbox.send(text, images);
  }

  /**
   * "t<offset>.<n>": the n-th pasted image of the transcript line at that
   * byte offset, read back from the transcript. "f<name>": an image the
   * captain sent from the view, from firstmate's inbox images.
   */
  async image(sessionId: string, imageId: string): Promise<ImageData | null> {
    const path = this.sessionPath(sessionId);
    if (imageId.startsWith("f")) return this.inbox?.image(imageId) ?? null;
    const ref = /^t(\d+)\.(\d+)$/.exec(imageId);
    if (!ref) return null;
    const offset = Number(ref[1]);
    if (!Number.isSafeInteger(offset) || offset >= statSync(path).size) return null;
    const line = readLineAt(path, offset);
    if (!line) return null;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      return null;
    }
    const image = captainImageAt(entry, Number(ref[2]));
    if (!image || !IMAGE_MEDIA_TYPES.has(image.mediaType)) return null;
    return { mediaType: image.mediaType, data: Buffer.from(image.data, "base64") };
  }

  /** Cached: a session's first entry never changes. An empty file is retried later. */
  private startOf(path: string): string | undefined {
    if (!this.starts.has(path)) {
      const start = sessionStart(path, statSync(path).size);
      if (start === undefined) return undefined;
      this.starts.set(path, start);
    }
    return this.starts.get(path);
  }

  /** From this session's start until the next session started; open-ended for the latest. */
  private noteWindow(sessionId: string): { from?: string; until?: string } {
    const starts = readdirSync(this.projectDir)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => {
        const path = join(this.projectDir, name);
        return { id: name.slice(0, -".jsonl".length), start: this.startOf(path) };
      })
      .filter((session): session is { id: string; start: string } => session.start !== undefined)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const index = starts.findIndex((session) => session.id === sessionId);
    if (index === -1) return {};
    return { from: starts[index]!.start, ...(starts[index + 1] ? { until: starts[index + 1]!.start } : {}) };
  }

  private withNotes(sessionId: string, snapshot: ConversationSnapshot, notes: ReturnType<CaptainInbox["notes"]>): ConversationSnapshot {
    if (notes.length === 0) return snapshot;
    return { ...snapshot, messages: mergeNotes(snapshot.messages, notes, this.noteWindow(sessionId)) };
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
    new LineFollower(this.sessionPath(sessionId)).readNew((line, offset) => conversation.pushLine(line, offset));
    return this.withNotes(sessionId, conversation.snapshot(), this.inbox?.notes() ?? []);
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
    let noteKey = "";

    const pump = (initial: boolean): void => {
      if (closed) return;
      try {
        let truncated = false;
        const count = follower.readNew(
          (line, offset) => conversation.pushLine(line, offset),
          () => {
            truncated = true;
            conversation = new TranscriptConversation();
          },
        );
        const notes = this.inbox?.notes() ?? [];
        const key = notes.map((note) => note.id).join(",");
        const notesChanged = key !== noteKey;
        noteKey = key;
        if (!initial && !truncated && count === 0 && !notesChanged) return;
        onUpdate(this.withNotes(sessionId, conversation.snapshot(), notes));
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
