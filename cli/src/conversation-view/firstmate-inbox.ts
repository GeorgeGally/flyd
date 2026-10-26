import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DOCUMENT_EXTENSIONS as LIMIT_EXTENSIONS, MAX_FILE_BYTES, MAX_IMAGE_BYTES, type DocumentExtension } from "./attachment-limits.js";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { firstmateHome, firstmateInboxScript } from "../lib/firstmate-home.js";
// Type-only: the page bundle imports this module, and the command layer is loaded when a message is sent.
import type { FirstmateDomainTransport, FirstmateExec, FlydNote } from "../command/firstmate.js";
import type { DomainRequest, DomainRun } from "../command/types.js";
import { inFlydsVoice } from "./flyd-voice.js";
import { handoffLine } from "./living.js";
import { ownWords, readReply } from "./replies.js";
import { forCaptain, pullRequestsIn } from "./status.js";
import type { ConversationMessage, Exchange, FileUpload, ImageData, ImageUpload, SentMessage } from "./types.js";

// The captain's way to talk to firstmate from the view: firstmate's own
// intake, `bin/fm-inbox.sh note`, which stores the message durably under
// $FM_HOME/state/inbox and wakes firstmate. Firstmate reads the note through
// a tool call, so the words never appear in the transcript as a captain
// message; the view reads the note files back to show them in place.
//
// Images the captain pastes are saved under $FM_HOME/data/inbox-images and
// named in the note as "[image: /absolute/path]" lines, so firstmate can
// open them; the view turns those lines back into thumbnails. Documents
// (a PDF, a Word file, notes) go the same way: saved under
// $FM_HOME/data/inbox-files/<stamp>/<their own name>, named as "[file: /path]".
//
// Firstmate answers a note with `fm-inbox.sh reply <id>`, which records the
// answer as state/inbox/.replies/<id>. That reply, and nothing else firstmate
// says, is shown as the answer to the note, in Flyd's voice.
//
// Each message is also a Flyd domain run (command/firstmate.ts), handed over
// through the same transport as chat's coding requests: his words whole, the
// request id (`desk-…`) on the note, what done means and the return contract
// under them. The command scheduler settles the run from firstmate's receipts
// and reply, and the staff watch chases it if it goes quiet.

/**
 * Appended to a note that starts with a slash command the captain picked,
 * so firstmate runs it as if typed in its own Claude Code prompt (notes are
 * otherwise read as plain words). Hidden again when the note is shown.
 */
export function commandMarker(name: string): string {
  return `[Captain ran /${name} from Flyd: run it exactly as if he had typed it in Claude Code.]`;
}
export function withCommandMarker(text: string, name: string | undefined): string {
  return name ? `${text}\n\n${commandMarker(name)}` : text;
}
const COMMAND_MARKER = /^\[Captain ran \/[\w:.-]+ from Flyd:[^\]\n]*\]$/gm;
export function carriesCommand(text: string): boolean {
  return new RegExp(COMMAND_MARKER.source, "m").test(text);
}

/**
 * Flyd's own brief under his words (flyd-brief.ts), marked so firstmate never
 * reads it as his wording. Hidden again when the note is shown.
 */
export function briefBlock(brief: string): string {
  return `--- Flyd's brief (Flyd's own judgement, not George's words) ---\n${brief.trim()}\n--- end of Flyd's brief ---`;
}
const BRIEF_BLOCK = /\n*^--- Flyd's brief \(Flyd's own judgement, not George's words\) ---$[\s\S]*?^--- end of Flyd's brief ---$/m;

/** A desk message's request id: its own prefix, so his window still shows the note as his words (`domain-`/`flyd-` notes are Flyd's). */
const DESK_REQUEST = /^desk-[A-Za-z0-9-]{8,80}$/;

/** What done means for a message he sent from the window, when Flyd has nothing more specific. Pure. */
export function deskDoneWhen(command?: string): string[] {
  return command
    ? [`/${command} has run exactly as George typed it`, "its outcome, or what blocked it, is reported back"]
    : [
      "George's message is answered, or the work it asks for is done and verified",
      "anything only George can decide comes back as a decision with your recommendation",
    ];
}

/** The domain request one desk message opens: his words whole as the original, under the request's own id. */
export function deskRequest(input: { text: string; command?: string; attachments?: string[]; parentRequestId?: string; now?: Date }): DomainRequest {
  const words = input.text.trim();
  // A reply's first line says what it answers; what it asks for is his own words under it.
  const first = ownWords(words).split("\n").find((line) => line.trim())?.trim() ?? "";
  const outcome = input.command
    ? `Run /${input.command} as George typed it`
    : first
      ? (first.length > 200 ? `${first.slice(0, 199).trimEnd()}…` : first)
      : "Read what George attached and act on it";
  return {
    id: `desk-${randomUUID()}`,
    domain: "coding",
    originalMessage: words || outcome,
    intendedOutcome: outcome,
    doneWhen: deskDoneWhen(input.command),
    createdAt: (input.now ?? new Date()).toISOString(),
    source: "view",
    ...(input.attachments?.length ? { contextRefs: input.attachments } : {}),
    ...(input.parentRequestId ? { parentRequestId: input.parentRequestId } : {}),
  };
}

/** The return contract under his words: Flyd's, marked so it is never read as his wording, and hidden from his window. */
export function contractBlock(request: DomainRequest): string {
  return [
    `--- Flyd's return contract (request ${request.id}; Flyd's own, not George's words) ---`,
    "DONE WHEN:",
    ...request.doneWhen.map((point, index) => `${index + 1}. ${point}`),
    "When this reaches a stable outcome or needs his decision, reply to this note (fm-inbox.sh reply). Plain prose is fine: say plainly whether it is done (and what changed), needs his decision (with your recommendation), failed (and why), or still under way (and what is next). Flyd shows your reply under his message and settles the request from it.",
    ...(request.parentRequestId ? [`Follow-up to prior Flyd domain run: ${request.parentRequestId}`] : []),
    "--- end of Flyd's return contract ---",
  ].join("\n");
}
const CONTRACT_BLOCK = /\n*^--- Flyd's return contract \(request [^)\n]*\) ---$[\s\S]*?^--- end of Flyd's return contract ---$/m;

export interface CaptainInbox {
  /** His words to firstmate, with Flyd's own brief under them when it has one. */
  send(text: string, images?: ImageUpload[], command?: string, files?: FileUpload[], brief?: string): Promise<SentMessage>;
  /** Every note the captain has sent, pending or already read by firstmate, with its reply; oldest first. */
  notes(): Exchange[];
  /** A saved image a note names, by the id `notes()` gave it. */
  image(imageId: string): ImageData | null;
}

const SEND_TIMEOUT_MS = 20_000;
export const MAX_NOTE_CHARS = 8_000;
export { MAX_FILE_BYTES, MAX_IMAGE_BYTES };
export const MAX_IMAGES = 4;
const IMAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpg|gif|webp)$/;
export const MAX_FILES = 4;
/** A saved document's place under the files folder: "<stamp>/<name>". */
const FILE_PLACE = /^\d+-[0-9a-f]+\/[^/.][^/]*$/;

/** Documents firstmate can read, by extension; each checked by its bytes where the format has a signature. */
const ZIP = (b: Buffer): boolean => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
const OLE = (b: Buffer): boolean => b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
const TEXT = (b: Buffer): boolean => !b.includes(0);
const DOCUMENT_TYPES: Record<DocumentExtension, (b: Buffer) => boolean> = {
  pdf: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
  docx: ZIP, xlsx: ZIP, pptx: ZIP, odt: ZIP, ods: ZIP, odp: ZIP,
  doc: OLE, xls: OLE, ppt: OLE,
  rtf: (b) => b.subarray(0, 5).toString("latin1") === "{\\rtf",
  txt: TEXT, md: TEXT, markdown: TEXT, csv: TEXT, tsv: TEXT, json: TEXT, yaml: TEXT, yml: TEXT, xml: TEXT, html: TEXT, htm: TEXT, log: TEXT,
};

/** The documents the view lets him attach, by extension (the page reads the same list from attachment-limits.ts). */
export const DOCUMENT_EXTENSIONS: string[] = [...LIMIT_EXTENSIONS];

/** The extension a document is accepted under, or null. */
export function documentExtension(name: string): string | null {
  const ext = extname(name).slice(1).toLowerCase();
  return Object.hasOwn(DOCUMENT_TYPES, ext) ? ext : null;
}

/** A dropped file's own name, made safe to save: no folders, no control or path characters. */
function safeFileName(name: string, ext: string): string {
  const stem = basename(name.replace(/\\/g, "/"), extname(name))
    .replace(/[^\p{L}\p{N} ._()+-]/gu, "_")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 100);
  return `${stem || "document"}.${ext}`;
}

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

/** A message on one of his runs (a chase, a decision passed on): `<run id>:<kind>:<digest>`. */
const RUN_MESSAGE = /^(desk-[A-Za-z0-9-]{8,80}):[a-z_]+:[0-9a-f]+$/;

/** A note as the window reads it: one of his, a message Flyd sent on one of his runs (never shown), or nothing to show. */
type ParsedNote = ConversationMessage | { onRun: string; noteId: string } | null;

function parseNote(file: string, imagesDir: string, filesDir: string): ParsedNote {
  const record = parseRecord(file);
  if (!record) return null;
  // Flyd's command layer writes its domain-run requests and follow-ups into
  // the same inbox, under request ids its runs own (`domain-…`), and Flyd's
  // own notes go under `flyd-…`. They are Flyd talking to firstmate, never
  // something he typed.
  const requestId = record.header.get("request_id") ?? "";
  if (/^(?:domain|flyd)-/.test(requestId)) return null;
  const id = record.header.get("id");
  // Flyd's message on one of his runs is not his words; firstmate's reply to it is still that run's answer.
  const onRun = RUN_MESSAGE.exec(requestId)?.[1];
  if (onRun) return id ? { onRun, noteId: id } : null;
  const run = DESK_REQUEST.test(requestId) ? requestId : undefined;
  const at = record.header.get("at");
  const images: string[] = [];
  const files: string[] = [];
  const text = record.body
    .replace(CONTRACT_BLOCK, "")
    .replace(BRIEF_BLOCK, "")
    .replace(COMMAND_MARKER, "")
    .replace(/^\[image: (.+)\]$/gm, (line, path: string) => {
      const name = path.slice(imagesDir.length + 1);
      if (!path.startsWith(`${imagesDir}/`) || !IMAGE_NAME.test(name)) return line;
      images.push(`f${name}`);
      return "";
    })
    .replace(/^\[file: (.+)\]$/gm, (line, path: string) => {
      const place = path.slice(filesDir.length + 1);
      if (!path.startsWith(`${filesDir}/`) || !FILE_PLACE.test(place)) return line;
      files.push(basename(place));
      return "";
    })
    .trim();
  if (!id || !at || (!text && images.length === 0 && files.length === 0)) return null;
  return { id: `note:${id}`, role: "user", text, timestamp: at, ...(images.length ? { images } : {}), ...(files.length ? { files } : {}), ...(run ? { run } : {}) };
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
  private readonly parsed = new Map<string, ParsedNote>();
  private readonly parsedReplies = new Map<string, ConversationMessage | null>();
  private sorted: Exchange[] = [];
  private listingKey = "";
  private readonly exec?: FirstmateExec;
  /**
   * The one client for firstmate's inbox (the command layer's transport): his messages and Flyd's own notes
   * all go through it as domain runs. This class only reads the inbox's files back.
   */
  private transport?: FirstmateDomainTransport;

  constructor(options: { home?: string; script?: string; exec?: FirstmateExec; transport?: FirstmateDomainTransport } = {}) {
    this.home = options.home ?? options.transport?.home ?? firstmateHome();
    this.script = options.script ?? options.transport?.script ?? firstmateInboxScript(this.home);
    this.exec = options.exec;
    this.transport = options.transport;
  }

  /** The command layer's transport, loaded on first send. */
  private async client(): Promise<FirstmateDomainTransport> {
    if (this.transport) return this.transport;
    const { FirstmateDomainTransport: Transport } = await import("../command/firstmate.js");
    this.transport = new Transport({ home: this.home, script: this.script, ...(this.exec ? { exec: this.exec } : {}) });
    return this.transport;
  }

  /** The run a reply to one of his earlier messages follows up: the run that message opened, if it opened one. */
  private parentRun(text: string): string | undefined {
    const { replyTo } = readReply({ id: "", role: "user", text });
    if (!replyTo?.startsWith("note:")) return undefined;
    return this.notes().find((exchange) => exchange.question.id === replyTo)?.question.run;
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

  get filesDir(): string {
    return join(this.home, "data", "inbox-files");
  }

  /** Checks and saves dropped documents under their own names; returns their absolute paths. */
  private saveFiles(files: FileUpload[]): string[] {
    if (files.length > MAX_FILES) throw new Error(`At most ${MAX_FILES} documents per message`);
    const decoded = files.map((file) => {
      const ext = documentExtension(file.name);
      if (!ext) throw new Error(`${file.name}: only PDFs, text, Markdown, Word, Excel and PowerPoint files can be sent`);
      const bytes = Buffer.from(file.data, "base64");
      if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) throw new Error(`Documents must be under ${MAX_FILE_BYTES / (1024 * 1024)}MB`);
      if (!DOCUMENT_TYPES[ext as DocumentExtension](bytes)) throw new Error(`${file.name} is not a ${ext.toUpperCase()} file`);
      return { bytes, name: safeFileName(file.name, ext) };
    });
    return decoded.map(({ bytes, name }) => {
      const folder = join(this.filesDir, `${Date.now()}-${randomBytes(4).toString("hex")}`);
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      const path = join(folder, name);
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

  /**
   * Flyd's own note to firstmate, as a domain run of its own through the command layer's transport, under a
   * request id that makes it idempotent (a repeat is a replay, not a second note) and keeps it out of his
   * window: it is never something he said, though it may carry his words (`about.georgesWords`).
   */
  async sendOwn(text: string, requestId: string, about: Omit<FlydNote, "requestId" | "body">): Promise<{ replayed: boolean }> {
    const transport = await this.client();
    try {
      const { replayed } = await transport.sendFlydNote({ ...about, requestId, body: text.trim().slice(0, MAX_NOTE_CHARS) });
      return { replayed };
    } catch (error) {
      throw new Error(`firstmate did not take Flyd's note: ${(error instanceof Error ? error.message : String(error)).trim().split("\n").pop() || "no note id returned"}`);
    }
  }

  /**
   * True when firstmate has archived the task as done (`- [x] <id> …` in data/done-archive.md):
   * a closed task is never chased again, whatever a stale fleet read still says about it.
   */
  taskClosed(taskId: string): boolean {
    try {
      const archive = readFileSync(join(this.home, "data", "done-archive.md"), "utf8");
      return archive.split("\n").some((line) => line.startsWith(`- [x] ${taskId} `));
    } catch {
      return false;
    }
  }

  /** Flyd's note about one task, keyed on the task and the note so the inbox takes each note at most once per task. */
  async sendTaskNote(taskId: string, text: string): Promise<{ requestId: string; replayed: boolean }> {
    const note = text.startsWith(`Task ${taskId}.`) ? text : `Task ${taskId}. ${text}`;
    const requestId = `flyd-task-${taskId.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 80)}-${createHash("sha256").update(note).digest("hex").slice(0, 16)}`;
    const { replayed } = await this.sendOwn(note, requestId, { outcome: `Act on Flyd's note about task ${taskId}`, contextRefs: [`task:${taskId}`] });
    return { requestId, replayed };
  }

  /**
   * His message to firstmate as a domain run: `fm-inbox.sh note --request-id desk-… --json -`
   * through the command layer's transport, with the text on stdin (no shell, no interpolation).
   * A reply to one of his earlier messages is a follow-up: its run names that message's run as its parent.
   */
  async send(text: string, images: ImageUpload[] = [], command?: string, files: FileUpload[] = [], brief?: string): Promise<SentMessage> {
    const typed = text.trim();
    if (!typed && images.length === 0 && files.length === 0) throw new Error("Nothing to send");
    if (typed.length > MAX_NOTE_CHARS) throw new Error(`Message is longer than ${MAX_NOTE_CHARS} characters`);
    const paths = this.saveImages(images);
    const filePaths = this.saveFiles(files);
    const attached = [...paths.map((path) => `[image: ${path}]`), ...filePaths.map((path) => `[file: ${path}]`)].join("\n");
    const parentRequestId = this.parentRun(typed);
    const request = deskRequest({ text: typed, ...(command ? { command } : {}), attachments: [...paths, ...filePaths], ...(parentRequestId ? { parentRequestId } : {}) });
    const body = [typed, attached, brief?.trim() ? briefBlock(brief) : "", command ? commandMarker(command) : "", contractBlock(request)]
      .filter(Boolean)
      .join("\n\n");
    const transport = await this.client();
    // Saved is sent: a wake that failed after the note was saved must not read as "not sent", or a resend would duplicate it.
    let warning = "";
    let run: DomainRun;
    try {
      run = await transport.submit(request, "FirstMate", { body, onSavedDespite: (detail) => { warning = detail; } });
    } catch (error) {
      const detail = (error instanceof Error ? error.message : String(error)).trim().split("\n").pop() || "no note id returned";
      throw new Error(`firstmate did not take the message: ${detail}`);
    }
    const said = warning || run.failure;
    return { id: `note:${run.transport.externalId}`, timestamp: new Date().toISOString(), ...(said ? { warning: said } : {}) };
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
        this.parsed.set(name, parseNote(path, this.imagesDir, this.filesDir));
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
    // Firstmate answers each note once, so a run's later word comes on Flyd's message notes on that run:
    // the newest formal reply on any of the run's own notes is its answer, and never another run's.
    const runReply = new Map<string, ConversationMessage>();
    for (const parsed of this.parsed.values()) {
      if (!parsed || !("onRun" in parsed)) continue;
      const reply = replyFor.get(`note:${parsed.noteId}`);
      const held = runReply.get(parsed.onRun);
      if (reply && (!held || Date.parse(reply.timestamp ?? "") > Date.parse(held.timestamp ?? ""))) runReply.set(parsed.onRun, reply);
    }
    const newest = (a: ConversationMessage | undefined, b: ConversationMessage | undefined): ConversationMessage | undefined =>
      !a ? b : !b ? a : Date.parse(b.timestamp ?? "") > Date.parse(a.timestamp ?? "") ? b : a;
    this.sorted = [...this.parsed.entries()]
      .filter((entry): entry is [string, ConversationMessage] => entry[1] !== null && !("onRun" in entry[1]))
      .map(([name, parsed]): Exchange => {
        const path = present.get(name)!;
        // Acknowledged (`drain --ack`) is a move into handled/: the one signal that firstmate read it.
        const read = path.startsWith(`${handled}/`);
        const question: ConversationMessage = { ...parsed, receipt: read ? "read" : "sent" };
        const later = parsed.run ? runReply.get(parsed.run) : undefined;
        const found = newest(replyFor.get(question.id), later);
        const answer = found && found.answers !== question.id ? { ...found, answers: question.id } : found;
        if (answer) return { question, answer, waiting: "" };
        const handoff = read ? "taken" : "queued";
        // Taking a note is a rename into handled/, which stamps the file's ctime.
        const takenAt = handoff === "taken" ? takenTime(path) : undefined;
        return { question, handoff, ...(takenAt ? { takenAt } : {}), waiting: handoffLine(handoff, { text: question.text }) };
      })
      .sort((a, b) => Date.parse(a.question.timestamp ?? "") - Date.parse(b.question.timestamp ?? ""));
    this.listingKey = unreadable ? "" : key;
    return this.sorted;
  }
}

function takenTime(path: string): string | undefined {
  try {
    return new Date(statSync(path).ctimeMs).toISOString();
  } catch {
    return undefined;
  }
}

/**
 * Firstmate's own session, as the window shows it: its lines are not
 * conversation with him but updates Flyd relays, in Flyd's words. Its
 * answers to its own supervision wakes are relayed only when they are for
 * him (see forCaptain).
 */
export function relayed(messages: ConversationMessage[]): ConversationMessage[] {
  const named = new Set<string>();
  return messages
    .filter((message) => {
      const kept = !message.wake || forCaptain(message.text, named);
      for (const url of pullRequestsIn(message.text)) named.add(url);
      return kept;
    })
    .map((message) => (message.role === "assistant" ? { ...message, text: inFlydsVoice(message.text), aside: true } : message));
}

/**
 * Places the captain's questions from the window among transcript messages
 * by time. A reply belongs where the message it answers is (`here`: this
 * session's own message ids, before any are filtered out of view), wherever
 * its time falls. Any other question belongs to the session whose window it
 * was sent in: from its first entry until the next session started
 * (open-ended for the newest).
 *
 * A question's answer sits directly under it, whenever it was written; until
 * then the question says what is happening to it. Nothing else is ever shown
 * as its answer.
 */
export function mergeNotes(
  messages: ConversationMessage[],
  exchanges: Exchange[],
  window: { from?: string; until?: string },
  here: Iterable<string> = messages.map((message) => message.id),
): ConversationMessage[] {
  const time = (iso?: string): number => (iso ? Date.parse(iso) : Number.NaN);
  const from = time(window.from);
  const until = time(window.until);
  const own = new Set(here);
  // Oldest first, so a reply to a reply finds its parent already placed.
  const inWindow = exchanges.filter((exchange) => {
    if (exchange.question.flydAsked) return false;
    const { replyTo } = exchange.question;
    const at = time(exchange.question.timestamp);
    const belongs = replyTo ? own.has(replyTo) : (Number.isNaN(from) || at >= from) && (Number.isNaN(until) || at < until);
    if (belongs) own.add(exchange.question.id);
    return belongs;
  });
  if (inWindow.length === 0) return messages;
  const formal = inWindow.filter((exchange) => exchange.answer?.id.startsWith("note-reply:"));
  const represented = (message: ConversationMessage): boolean => message.aside === true && formal.some(({ question, answer }) =>
    answer?.text.trim() === message.text.trim()
    && time(message.timestamp) >= time(question.timestamp)
    && (!message.notes?.length || message.notes.includes(question.id.slice("note:".length))));
  const merged: ConversationMessage[] = [];
  const push = (exchange: Exchange): void => {
    if (exchange.answer) merged.push(exchange.question, exchange.answer);
    else merged.push({ ...exchange.question, waiting: exchange.waiting, ...(exchange.waitingFailed ? { waitingFailed: true } : {}), ...(exchange.settled ? { settled: true } : {}), ...(exchange.doing ? { doing: exchange.doing } : {}) });
  };
  let next = 0;
  for (const message of messages) {
    const at = time(message.timestamp);
    while (next < inWindow.length && !Number.isNaN(at) && time(inWindow[next]!.question.timestamp) <= at) push(inWindow[next++]!);
    if (!represented(message)) merged.push(message);
  }
  while (next < inWindow.length) push(inWindow[next++]!);
  return merged;
}
