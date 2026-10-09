import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { firstmateHome } from "../lib/firstmate-home.js";
import { inFlydsVoice } from "./flyd-voice.js";
import type { ConversationMessage, Exchange, ImageData, ImageUpload, SentMessage } from "./types.js";

// The captain's way to talk to firstmate from the view: firstmate's own
// intake, `bin/fm-inbox.sh note`, which stores the message durably under
// $FM_HOME/state/inbox and wakes firstmate. Firstmate reads the note through
// a tool call, so the words never appear in the transcript as a captain
// message; the view reads the note files back to show them in place.
//
// Images the captain pastes are saved under $FM_HOME/data/inbox-images and
// named in the note as "[image: /absolute/path]" lines, so firstmate can
// open them; the view turns those lines back into thumbnails.
//
// Firstmate answers a note with `fm-inbox.sh reply <id>`, which records the
// answer as state/inbox/.replies/<id>. That reply, and nothing else firstmate
// says, is shown as the answer to the note, in Flyd's voice.

/**
 * Appended to a note that starts with a slash command the captain picked,
 * so firstmate runs it as if typed in its own Claude Code prompt (notes are
 * otherwise read as plain words). Hidden again when the note is shown.
 */
export function commandMarker(name: string): string {
  return `[Captain ran /${name} from Flyd: run it exactly as if he had typed it in Claude Code.]`;
}
const COMMAND_MARKER = /^\[Captain ran \/[\w:.-]+ from Flyd:[^\]\n]*\]$/gm;

export interface CaptainInbox {
  send(text: string, images?: ImageUpload[], command?: string): Promise<SentMessage>;
  /** Every note the captain has sent, pending or already read by firstmate, with its reply; oldest first. */
  notes(): Exchange[];
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

/** A note or reply record: `key=value` header lines, a `--` line, then the body. */
function parseRecord(file: string): { header: Map<string, string>; body: string } | null {
  const raw = readFileSync(file, "utf8");
  const split = raw.indexOf("\n--\n");
  if (split === -1) return null;
  const header = new Map<string, string>();
  for (const line of raw.slice(0, split).split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) header.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return { header, body: raw.slice(split + 4).replace(/\n$/, "") };
}

function parseNote(file: string, imagesDir: string): ConversationMessage | null {
  const record = parseRecord(file);
  if (!record) return null;
  const id = record.header.get("id");
  const at = record.header.get("at");
  const images: string[] = [];
  const text = record.body
    .replace(COMMAND_MARKER, "")
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

function parseReply(file: string): ConversationMessage | null {
  const record = parseRecord(file);
  const id = record?.header.get("id");
  const at = record?.header.get("at");
  if (!record || !id || !at || !record.body.trim()) return null;
  return { id: `note-reply:${id}`, role: "assistant", text: inFlydsVoice(record.body), timestamp: at, answers: `note:${id}` };
}

export class FirstmateInbox implements CaptainInbox {
  readonly script: string;
  readonly home: string;
  /**
   * Parsed notes and replies by file name. Neither ever changes: firstmate
   * only moves a note into handled/ under the same name, and records one
   * reply per note. So each file is read once.
   */
  private readonly parsed = new Map<string, ConversationMessage | null>();
  private readonly parsedReplies = new Map<string, ConversationMessage | null>();
  private sorted: Exchange[] = [];
  private listingKey = "";

  constructor(options: { home?: string; script?: string } = {}) {
    this.home = options.home ?? firstmateHome();
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
  send(text: string, images: ImageUpload[] = [], command?: string): Promise<SentMessage> {
    const typed = text.trim();
    if (!typed && images.length === 0) return Promise.reject(new Error("Nothing to send"));
    if (typed.length > MAX_NOTE_CHARS) return Promise.reject(new Error(`Message is longer than ${MAX_NOTE_CHARS} characters`));
    let paths: string[];
    try {
      paths = this.saveImages(images);
    } catch (error) {
      return Promise.reject(error);
    }
    const body = [typed, paths.map((path) => `[image: ${path}]`).join("\n"), command ? commandMarker(command) : ""]
      .filter(Boolean)
      .join("\n\n");
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

  notes(): Exchange[] {
    const inbox = join(this.home, "state", "inbox");
    const handled = join(inbox, "handled");
    const replies = join(inbox, ".replies");
    const present = new Map<string, string>();
    for (const dir of [inbox, handled]) {
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) if (name.endsWith(".note")) present.set(name, join(dir, name));
    }
    const replyNames = existsSync(replies) ? readdirSync(replies).filter((name) => !name.startsWith(".")) : [];
    const key = [...[...present.values()].sort(), ...replyNames.sort()].join("\n");
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
    for (const name of replyNames) {
      if (this.parsedReplies.has(name)) continue;
      try {
        this.parsedReplies.set(name, parseReply(join(replies, name)));
      } catch {
        unreadable = true;
      }
    }
    const replyFor = new Map<string, ConversationMessage>();
    for (const reply of this.parsedReplies.values()) if (reply?.answers) replyFor.set(reply.answers, reply);
    this.sorted = [...this.parsed.entries()]
      .filter((entry): entry is [string, ConversationMessage] => entry[1] !== null)
      .map(([name, question]): Exchange => {
        const answer = replyFor.get(question.id);
        if (answer) return { question, answer, waiting: "" };
        return { question, waiting: present.get(name)!.startsWith(`${handled}/`) ? "firstmate is on it" : "passed to firstmate" };
      })
      .sort((a, b) => Date.parse(a.question.timestamp ?? "") - Date.parse(b.question.timestamp ?? ""));
    this.listingKey = unreadable ? "" : key;
    return this.sorted;
  }
}

/**
 * Firstmate's own session, as the window shows it: its lines are not
 * conversation with him but updates Flyd relays, in Flyd's words.
 */
export function relayed(messages: ConversationMessage[]): ConversationMessage[] {
  return messages.map((message) => (message.role === "assistant" ? { ...message, text: inFlydsVoice(message.text), aside: true } : message));
}

/**
 * Places the captain's questions from the window among transcript messages
 * by time. Only those inside the session's window belong to it: from its
 * first entry until the next session started (open-ended for the newest).
 *
 * A question's answer sits directly under it, whenever it was written; until
 * then the question says what is happening to it. Nothing else is ever shown
 * as its answer.
 */
export function mergeNotes(
  messages: ConversationMessage[],
  exchanges: Exchange[],
  window: { from?: string; until?: string },
): ConversationMessage[] {
  const time = (iso?: string): number => (iso ? Date.parse(iso) : Number.NaN);
  const from = time(window.from);
  const until = time(window.until);
  const inWindow = exchanges.filter((exchange) => {
    const at = time(exchange.question.timestamp);
    return (Number.isNaN(from) || at >= from) && (Number.isNaN(until) || at < until);
  });
  if (inWindow.length === 0) return messages;
  const merged: ConversationMessage[] = [];
  const push = (exchange: Exchange): void => {
    if (exchange.answer) merged.push(exchange.question, exchange.answer);
    else merged.push({ ...exchange.question, waiting: exchange.waiting });
  };
  let next = 0;
  for (const message of messages) {
    const at = time(message.timestamp);
    while (next < inWindow.length && !Number.isNaN(at) && time(inWindow[next]!.question.timestamp) <= at) push(inWindow[next++]!);
    merged.push(message);
  }
  while (next < inWindow.length) push(inWindow[next++]!);
  return merged;
}
