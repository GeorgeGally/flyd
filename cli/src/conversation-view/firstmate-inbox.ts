import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ConversationMessage, ImageData, ImageUpload, SentMessage } from "./types.js";

// The captain's way to talk to firstmate from the view: firstmate's own
// intake, `bin/fm-inbox.sh note`, which stores the message durably under
// $FM_HOME/state/inbox and wakes firstmate. Firstmate reads the note through
// a tool call, so the words never appear in the transcript as a captain
// message; the view reads the note files back to show them in place.
//
// Images the captain pastes are saved under $FM_HOME/data/inbox-images and
// named in the note as "[image: /absolute/path]" lines, so firstmate can
// open them; the view turns those lines back into thumbnails.

export interface CaptainInbox {
  send(text: string, images?: ImageUpload[]): Promise<SentMessage>;
  /** Every note the captain has sent, pending or already read by firstmate. */
  notes(): ConversationMessage[];
  /** A saved image a note names, by the id `notes()` gave it. */
  image(imageId: string): ImageData | null;
}

const SEND_TIMEOUT_MS = 20_000;
export const MAX_NOTE_CHARS = 8_000;
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const IMAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpg|gif|webp)$/;

/** Accepted image types, recognised by their bytes rather than the claimed type. */
const IMAGE_TYPES: Array<{ mediaType: string; ext: string; matches: (b: Buffer) => boolean }> = [
  { mediaType: "image/png", ext: "png", matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mediaType: "image/jpeg", ext: "jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mediaType: "image/gif", ext: "gif", matches: (b) => b.subarray(0, 4).toString("latin1") === "GIF8" },
  { mediaType: "image/webp", ext: "webp", matches: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
];

export function sniffImage(bytes: Buffer): { mediaType: string; ext: string } | null {
  const type = IMAGE_TYPES.find((candidate) => candidate.matches(bytes));
  return type ? { mediaType: type.mediaType, ext: type.ext } : null;
}

export const FIRSTMATE_HOME = join(homedir(), "Documents", "firstmate");

function parseNote(file: string, imagesDir: string): ConversationMessage | null {
  const raw = readFileSync(file, "utf8");
  const split = raw.indexOf("\n--\n");
  if (split === -1) return null;
  const header = new Map<string, string>();
  for (const line of raw.slice(0, split).split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) header.set(line.slice(0, eq), line.slice(eq + 1));
  }
  const id = header.get("id");
  const at = header.get("at");
  const images: string[] = [];
  const text = raw
    .slice(split + 4)
    .replace(/\n$/, "")
    .replace(/^\[image: (.+)\]$/gm, (line, path: string) => {
      const name = path.slice(imagesDir.length + 1);
      if (!path.startsWith(`${imagesDir}/`) || !IMAGE_NAME.test(name)) return line;
      images.push(`f${name}`);
      return "";
    })
    .trim();
  if (!id || !at || (!text && images.length === 0)) return null;
  return { id: `note:${id}`, role: "user", text, timestamp: at, ...(images.length ? { images } : {}) };
}

export class FirstmateInbox implements CaptainInbox {
  readonly script: string;
  readonly home: string;
  /**
   * Parsed notes by file name. A note's content never changes; firstmate only
   * moves it into handled/ under the same name, so each is read once.
   */
  private readonly parsed = new Map<string, ConversationMessage | null>();
  private sorted: ConversationMessage[] = [];
  private listingKey = "";

  constructor(options: { home?: string; script?: string } = {}) {
    this.home = options.home ?? FIRSTMATE_HOME;
    this.script = options.script ?? join(this.home, "bin", "fm-inbox.sh");
  }

  available(): boolean {
    return existsSync(this.script);
  }

  get imagesDir(): string {
    return join(this.home, "data", "inbox-images");
  }

  /** Checks and saves pasted images; returns their absolute paths. */
  private saveImages(images: ImageUpload[]): string[] {
    if (images.length > MAX_IMAGES) throw new Error(`At most ${MAX_IMAGES} images per message`);
    const decoded = images.map((image) => {
      const bytes = Buffer.from(image.data, "base64");
      if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error(`Images must be under ${MAX_IMAGE_BYTES / (1024 * 1024)}MB`);
      const type = sniffImage(bytes);
      if (!type) throw new Error("Only PNG, JPEG, GIF and WebP images can be sent");
      return { bytes, type };
    });
    if (decoded.length === 0) return [];
    mkdirSync(this.imagesDir, { recursive: true });
    return decoded.map(({ bytes, type }) => {
      const path = join(this.imagesDir, `${Date.now()}-${randomBytes(4).toString("hex")}.${type.ext}`);
      writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
      return path;
    });
  }

  image(imageId: string): ImageData | null {
    const name = imageId.startsWith("f") ? imageId.slice(1) : "";
    if (!IMAGE_NAME.test(name)) return null;
    const path = join(this.imagesDir, name);
    if (!existsSync(path)) return null;
    const data = readFileSync(path);
    const type = sniffImage(data);
    return type ? { mediaType: type.mediaType, data } : null;
  }

  /** Runs `fm-inbox.sh note -` with the text on stdin: no shell, no interpolation. */
  send(text: string, images: ImageUpload[] = []): Promise<SentMessage> {
    const typed = text.trim();
    if (!typed && images.length === 0) return Promise.reject(new Error("Nothing to send"));
    if (typed.length > MAX_NOTE_CHARS) return Promise.reject(new Error(`Message is longer than ${MAX_NOTE_CHARS} characters`));
    let paths: string[];
    try {
      paths = this.saveImages(images);
    } catch (error) {
      return Promise.reject(error);
    }
    const body = [typed, paths.map((path) => `[image: ${path}]`).join("\n")].filter(Boolean).join("\n\n");
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.script,
        ["note", "-"],
        { env: { ...process.env, FM_HOME: this.home }, timeout: SEND_TIMEOUT_MS, maxBuffer: 1 << 20 },
        (error, stdout, stderr) => {
          const id = /^queued (\S+)/m.exec(stdout)?.[1];
          const detail = `${stderr}`.trim().split("\n").pop() || (error ? error.message : "no note id returned");
          if (!id) {
            reject(new Error(`firstmate did not take the message: ${detail}`));
            return;
          }
          // `queued <id>` means the note is saved; a failure after that (the
          // wake) must not read as "not sent", or a resend would duplicate it.
          resolve({ id: `note:${id}`, timestamp: new Date().toISOString(), ...(error ? { warning: detail } : {}) });
        },
      );
      child.stdin?.end(body);
    });
  }

  notes(): ConversationMessage[] {
    const inbox = join(this.home, "state", "inbox");
    const present = new Map<string, string>();
    for (const dir of [inbox, join(inbox, "handled")]) {
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) if (name.endsWith(".note")) present.set(name, join(dir, name));
    }
    const key = [...present.keys()].sort().join("\n");
    if (key === this.listingKey) return this.sorted;

    for (const name of this.parsed.keys()) if (!present.has(name)) this.parsed.delete(name);
    let unreadable = false;
    for (const [name, path] of present) {
      if (this.parsed.has(name)) continue;
      try {
        this.parsed.set(name, parseNote(path, this.imagesDir));
      } catch {
        // Moved to handled/ between listing and reading; read it next time.
        unreadable = true;
      }
    }
    this.sorted = [...this.parsed.values()]
      .filter((note): note is ConversationMessage => note !== null)
      .sort((a, b) => Date.parse(a.timestamp ?? "") - Date.parse(b.timestamp ?? ""));
    this.listingKey = unreadable ? "" : key;
    return this.sorted;
  }
}

/**
 * Places notes among transcript messages by time. Only notes inside the
 * session's window belong to it: from its first entry until the next
 * session started (open-ended for the newest).
 */
export function mergeNotes(
  messages: ConversationMessage[],
  notes: ConversationMessage[],
  window: { from?: string; until?: string },
): ConversationMessage[] {
  const time = (iso?: string): number => (iso ? Date.parse(iso) : Number.NaN);
  const from = time(window.from);
  const until = time(window.until);
  const inWindow = notes.filter((note) => {
    const at = time(note.timestamp);
    return (Number.isNaN(from) || at >= from) && (Number.isNaN(until) || at < until);
  });
  if (inWindow.length === 0) return messages;
  const merged: ConversationMessage[] = [];
  let next = 0;
  for (const message of messages) {
    const at = time(message.timestamp);
    while (next < inWindow.length && !Number.isNaN(at) && time(inWindow[next]!.timestamp) <= at) merged.push(inWindow[next++]!);
    merged.push(message);
  }
  while (next < inWindow.length) merged.push(inWindow[next++]!);
  return merged;
}
