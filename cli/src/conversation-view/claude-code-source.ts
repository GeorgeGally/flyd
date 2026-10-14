import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { discoverCommands, matchCommand, type SlashCommand } from "./commands.js";
import { mergeNotes, relayed, type CaptainInbox } from "./firstmate-inbox.js";
import { routeMessage, type Complete, type FlydDesk } from "./flyd-desk.js";
import { followUps, inlineOutcomes, withFollowUps } from "./follow-ups.js";
import { inFlydsVoice } from "./flyd-voice.js";
import { readProjects } from "../council/projects.js";
import type { CrewProgress } from "./crew-progress.js";
import { handoffLine, livened } from "./living.js";
import { LineFollower } from "./line-follower.js";
import { markRead, readUnacknowledged } from "./note-receipts.js";
import { ownWords, threaded } from "./replies.js";
import { ElementShots } from "./element-shots.js";
import { isHisImage, ReplyShots } from "./reply-shots.js";
import { pictured, PICTURE_WITHIN_MS, siteChangeOf } from "./site-changes.js";
import { captainImageAt, toolImageAt, TranscriptConversation } from "./transcript-filter.js";
import type {
  ConversationFollower,
  ConversationMessage,
  ConversationSnapshot,
  ConversationSource,
  Exchange,
  FileUpload,
  ImageData,
  ImageUpload,
  Recipient,
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
/** A session nobody follows any more is kept read this long, so a reload or reconnect does not parse it again. */
const LINGER_MS = 60_000;

interface Subscriber {
  onUpdate: (snapshot: ConversationSnapshot) => void;
  onError?: (error: Error) => void;
}

/** One reading of a session's transcript, shared by every view that follows it and by `read()`. */
interface SharedSession {
  follower: LineFollower;
  conversation: TranscriptConversation;
  subscribers: Set<Subscriber>;
  timer: ReturnType<typeof setInterval>;
  linger?: ReturnType<typeof setTimeout>;
  stopPictures?: () => void;
  /** Lines were read since the last snapshot was made. */
  dirty: boolean;
  /** A crop of a changed element finished since the last snapshot. */
  pictures: boolean;
  noteKey: string;
  snapshot?: ConversationSnapshot;
  /** Firstmate's chat answers to the notes, kept until the notes or its replies change. */
  answers?: { key: string; found: Record<string, ConversationMessage> };
}

/** His own names for his projects, read when a living line is composed. */
function projectNames(): string[] {
  return readProjects().map((project) => project.name);
}

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

/**
 * "t<offset>.<n>": the n-th image of the transcript line at that byte offset,
 * read back from the transcript: one the captain pasted, or a screenshot the
 * assistant read.
 */
function transcriptImage(path: string, imageId: string): ImageData | null {
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
  const image = captainImageAt(entry, Number(ref[2])) ?? toolImageAt(entry, Number(ref[2]));
  if (!image || !IMAGE_MEDIA_TYPES.has(image.mediaType)) return null;
  return { mediaType: image.mediaType, data: Buffer.from(image.data, "base64") };
}

/**
 * When the session started (its first timed entry), and whether the Agent SDK
 * drove it rather than a person at Claude Code's prompt: firstmate's
 * supervision sessions run that way, beside the captain's own conversation.
 */
function sessionHead(path: string, size: number): { start?: string; entrypoint?: string; settled: boolean } {
  const head = readRange(path, 0, Math.min(size, START_SCAN_BYTES));
  const start = /"timestamp":"([^"]+)"/.exec(head)?.[1];
  if (start === undefined) return { settled: false };
  // The first message entry carries the entrypoint after its content (older builds wrote none), so that whole line is
  // read; before it, a queued prompt may be all there is.
  let offset = 0;
  for (const line of head.split("\n")) {
    if (/"type":"(?:user|assistant)"/.test(line)) {
      let entry: unknown;
      try {
        entry = JSON.parse(readLineAt(path, offset) ?? "");
      } catch {
        return { start, settled: false };
      }
      const entrypoint = typeof entry === "object" && entry !== null ? (entry as { entrypoint?: unknown }).entrypoint : undefined;
      return { start, ...(typeof entrypoint === "string" ? { entrypoint } : {}), settled: true };
    }
    offset += Buffer.byteLength(line) + 1;
  }
  return { start, settled: false };
}

/**
 * Reads Claude Code session transcripts; transcript files are never written.
 * With a CaptainInbox, the captain can also send messages, and the ones he
 * sent are shown in the session that was current when he sent them.
 *
 * With a FlydDesk as well, the window is Flyd's: a question that is not
 * software work goes to Flyd's own assistant, the rest to firstmate's inbox,
 * and firstmate's session lines become updates Flyd relays.
 */
export class ClaudeCodeTranscriptSource implements ConversationSource {
  readonly assistantLabel: string;
  private readonly projectDir: string;
  private readonly pollMs: number;
  private readonly inbox?: CaptainInbox;
  private readonly desk?: { desk: FlydDesk; complete: Complete };
  /** What the crewmate working on each note is doing now. */
  private readonly crew?: Pick<CrewProgress, "steps">;
  /**
   * Notes firstmate has plainly read though they still sit in its inbox (it files a note only once done with it):
   * answered in its own chat, or picked up by its turn. Kept once seen, since a turn naming a note ends long
   * before the note is filed.
   */
  private readonly heard = new Set<string>();
  /** The newest snapshot followed per session: what the router sees as recent conversation. */
  private readonly latest = new Map<string, ConversationMessage[]>();
  private readonly titles = new Map<string, { size: number; mtimeMs: number; title: string }>();
  private readonly heads = new Map<string, { start?: string; entrypoint?: string; settled: boolean }>();

  private readonly commandRoots: { claudeHome?: string; projectDir?: string };
  /** Where the screenshot behind each note's answer is kept. */
  private readonly shots?: ReplyShots;
  /** Crops of the elements a site change touched. */
  private readonly elements?: ElementShots;
  private commandCache?: { at: number; commands: SlashCommand[] };
  private readonly shared = new Map<string, SharedSession>();

  constructor(options: {
    projectDir?: string;
    assistantLabel?: string;
    pollMs?: number;
    inbox?: CaptainInbox;
    /** Flyd's own answers, and the model call that decides who answers each message. */
    desk?: { desk: FlydDesk; complete: Complete };
    /** Reads each note's crewmate step; only with an inbox. */
    crew?: Pick<CrewProgress, "steps">;
    /** Where the assistant's skills and commands live (default ~/.claude, plus its working directory's .claude). */
    commandRoots?: { claudeHome?: string; projectDir?: string };
    /** Where the screenshot behind each note's answer is kept (default ~/.flyd/view/reply-shots; none under tests). */
    shots?: ReplyShots;
    /** Crops of the element each site change touched (default ~/.flyd/view/element-shots; none under tests). */
    elements?: ElementShots;
  } = {}) {
    this.shots = options.shots ?? (process.env.VITEST ? undefined : new ReplyShots());
    this.elements = options.elements ?? (process.env.VITEST ? undefined : new ElementShots());
    this.commandRoots = options.commandRoots ?? {};
    this.projectDir = options.projectDir ?? resolveProjectDir(FIRSTMATE_PROJECT_DIR);
    // With a desk the window is Flyd's: it speaks to him, firstmate stays backstage.
    this.assistantLabel = options.assistantLabel ?? (options.inbox && options.desk ? "Flyd" : basename(this.projectDir).endsWith("firstmate") ? "firstmate" : "Claude");
    this.pollMs = options.pollMs ?? 400;
    this.inbox = options.inbox;
    this.desk = options.inbox ? options.desk : undefined;
    this.crew = options.inbox ? options.crew : undefined;
  }

  get canSend(): boolean {
    return this.inbox !== undefined;
  }

  async send(sessionId: string, text: string, images?: ImageUpload[], files?: FileUpload[], to?: Recipient): Promise<SentMessage> {
    if (!this.inbox) throw new Error("This conversation is read-only");
    this.sessionPath(sessionId);
    const command = matchCommand(text, await this.commands());
    if (this.desk) {
      // A reply goes back to whoever gave the answer; only a new message is routed.
      // The conversation his message may continue: who handled his last message, and when he sent it.
      const last = this.exchanges().map((exchange) => exchange.question)
        .reduce<ConversationMessage | undefined>((newest, question) => (!newest || Date.parse(question.timestamp ?? "") > Date.parse(newest.timestamp ?? "") ? question : newest), undefined);
      const previous = last ? { owner: last.id.startsWith("ask:") ? "flyd" as const : "firstmate" as const, ...(last.timestamp ? { at: last.timestamp } : {}) } : undefined;
      const route = to ?? await routeMessage(
        { text, images: images?.length ?? 0, files: files?.length ?? 0, ...(command ? { command: command.name } : {}), recent: this.latest.get(sessionId) ?? [], sessionId, ...(previous ? { previous } : {}) },
        process.env.FLYD_ROUTING_FALLBACK_MODEL && !process.env.VITEST
          ? async (prompt) => {
            const { query } = await import("../lib/llm.js");
            return query(prompt, process.env.FLYD_ROUTING_FALLBACK_MODEL);
          }
          : this.desk.complete,
      );
      if (route === "flyd") return this.desk.desk.ask(text);
      try {
        const sent = await this.inbox.send(text, images, command?.name, files);
        return { ...sent, waiting: handoffLine("queued", { text: ownWords(text), projects: projectNames() }) };
      } catch (error) {
        // Firstmate is backstage in Flyd's window: its refusal goes to the log, not to him.
        const message = error instanceof Error ? error.message : String(error);
        if (!/firstmate|fm-inbox/i.test(message)) throw error;
        console.warn(`[view] firstmate inbox refused a message: ${message}`);
        throw new Error("Flyd couldn't pass this on just now; send it again");
      }
    }
    return this.inbox.send(text, images, command?.name, files);
  }

  async sendDecision(text: string, images?: ImageUpload[]): Promise<SentMessage> {
    if (!this.inbox) throw new Error("This conversation is read-only");
    return this.inbox.send(text, images);
  }

  /** Skills and commands, re-read at most once a minute. */
  async commands(): Promise<SlashCommand[]> {
    if (!this.inbox) return [];
    const now = Date.now();
    if (!this.commandCache || now - this.commandCache.at > 60_000) {
      let commands: SlashCommand[];
      try {
        commands = discoverCommands(this.commandRoots);
      } catch {
        commands = this.commandCache?.commands ?? [];
      }
      this.commandCache = { at: now, commands };
    }
    return this.commandCache.commands;
  }

  /**
   * "t<offset>.<n>": the n-th pasted image of the transcript line at that
   * byte offset, read back from the transcript. "f<name>": an image the
   * captain sent from the view, from firstmate's inbox images.
   */
  async image(sessionId: string, imageId: string): Promise<ImageData | null> {
    const path = this.sessionPath(sessionId);
    if (imageId.startsWith("f")) return this.inbox?.image(imageId) ?? null;
    return transcriptImage(path, imageId);
  }

  /**
   * Each answer's screenshot as Flyd's own copy, made the first time the
   * answer is seen; a shot that cannot be kept is left out.
   */
  private keptShots(sessionId: string, answers: Record<string, ConversationMessage>, exchanges: Exchange[]): Record<string, ConversationMessage> {
    const kept: Record<string, ConversationMessage> = {};
    for (const [id, answer] of Object.entries(answers)) {
      const { shots, ...rest } = answer;
      // His own images on the note: firstmate often opens a copy of one, which is no picture of the result.
      const his = (): Buffer[] => (exchanges.find((exchange) => exchange.question.id === id)?.question.images ?? [])
        .map((image) => this.inbox?.image(image)?.data)
        .filter((data): data is Buffer => data !== undefined);
      const paths = this.shots && shots?.length
        ? shots.map((shot) => this.shots!.keep(sessionId, shot, () => {
          const image = transcriptImage(this.sessionPath(sessionId), shot);
          return image && !isHisImage(image.data, his()) ? image : null;
        })).filter((path): path is string => path !== null)
        : [];
      kept[id] = paths.length ? { ...rest, shots: paths } : rest;
    }
    return kept;
  }

  /**
   * A reply that changed a website, with the page it changed as a button and
   * the element it touched as its picture (asked for in the background while
   * the change is recent); any other message as it was.
   */
  private sited<T extends ConversationMessage>(sessionId: string, message: T): T {
    const change = siteChangeOf(message);
    if (!change) return message;
    const at = Date.parse(message.timestamp ?? "");
    const recent = Number.isNaN(at) || Date.now() - at < PICTURE_WITHIN_MS;
    const shot = recent ? this.elements?.shot({ key: message.id, pages: change.pages, locators: change.locators }) : undefined;
    if (shot?.state === "ready" || shot?.state === "pending" || !this.shots || !message.shots?.some((id) => !id.startsWith("/"))) return pictured(message, change.page, shot);
    // No element to show: the screenshot the turn looked at is the picture, kept as Flyd's own copy.
    const shots = message.shots
      .map((id) => (id.startsWith("/") ? id : this.shots!.keep(sessionId, id, () => transcriptImage(this.sessionPath(sessionId), id))))
      .filter((path): path is string => path !== null);
    return pictured({ ...message, shots }, change.page, shot);
  }

  /** Cached once its first message is written: a session's first entries never change. */
  private headOf(path: string): { start?: string; entrypoint?: string } {
    const cached = this.heads.get(path);
    if (cached) return cached;
    const head = sessionHead(path, statSync(path).size);
    if (head.settled) this.heads.set(path, head);
    return head;
  }

  /**
   * A session the Agent SDK drove (firstmate's supervision) is machinery, not
   * a conversation with him: its stale wakes and routine outcomes never
   * reach the window, the island, or a note's placement.
   */
  private isSupervision(path: string): boolean {
    return this.headOf(path).entrypoint === "sdk-cli";
  }

  /**
   * This session's window: its start until another session replaced it. A
   * later-start session only ends the window if it started after this one's
   * last write; sessions overlap (a mirror starts while the live one still
   * runs), so a session that outlived the others stays open to now.
   */
  private noteWindow(sessionId: string): { from?: string; until?: string } {
    const sessions = readdirSync(this.projectDir)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => {
        const path = join(this.projectDir, name);
        if (this.isSupervision(path)) return null;
        const start = this.headOf(path).start;
        return start === undefined ? null : { id: name.slice(0, -".jsonl".length), start, mtimeMs: statSync(path).mtimeMs };
      })
      .filter((session): session is { id: string; start: string; mtimeMs: number } => session !== null)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const index = sessions.findIndex((session) => session.id === sessionId);
    if (index === -1) return {};
    const here = sessions[index]!;
    const replaced = sessions.slice(index + 1).find((session) => Date.parse(session.start) > here.mtimeMs);
    return { from: here.start, ...(replaced ? { until: replaced.start } : {}) };
  }

  /** Every question asked from the window, to firstmate or to Flyd, oldest first. */
  exchanges(): Exchange[] {
    const notes = this.inbox?.notes() ?? [];
    const asks = this.desk?.desk.exchanges() ?? [];
    const all = threaded(asks.length === 0 ? notes : [...notes, ...asks].sort((a, b) => Date.parse(a.question.timestamp ?? "") - Date.parse(b.question.timestamp ?? "")));
    // What the crewmate on each note is doing now, wherever the note is shown: under it in the window and in the column.
    const steps = this.crew?.steps(all);
    for (const id of this.heard) if (!all.some((exchange) => exchange.question.id === id)) this.heard.delete(id);
    return all.map((exchange) => {
      const step = steps?.get(exchange.question.id);
      // A crewmate on the note means firstmate read it.
      if (step && !exchange.answer && !exchange.answered && !exchange.settled) return markRead({ ...exchange, waiting: step });
      return this.heard.has(exchange.question.id) ? markRead(exchange) : exchange;
    });
  }

  /**
   * Firstmate's chat answers to the notes, with their screenshots kept. A
   * tool line changes neither the notes nor the replies, so a session being
   * followed works them out again only when one of those changed.
   */
  private answersOf(sessionId: string, snapshot: ConversationSnapshot, exchanges: Exchange[], shared?: SharedSession): Record<string, ConversationMessage> {
    // Finished messages never change; only the newest can still grow, or gain the notes and pictures its turn names.
    const last = snapshot.messages.at(-1);
    const key = [
      snapshot.working,
      snapshot.messages.length,
      last ? JSON.stringify([last.id, last.role, last.text, last.timestamp, last.notes, last.shots, last.site, last.wake]) : "",
      exchanges.map((exchange) => `${exchange.question.id}:${exchange.answer?.id ?? ""}:${exchange.takenAt ?? ""}`).join(","),
    ].join("\n");
    if (shared?.answers?.key === key) return shared.answers.found;
    const found = this.keptShots(sessionId, followUps(exchanges, snapshot.messages, snapshot.working), exchanges);
    if (shared) shared.answers = { key, found };
    return found;
  }

  private withNotes(sessionId: string, snapshot: ConversationSnapshot, exchanges: Exchange[], shared?: SharedSession): ConversationSnapshot {
    const steps = this.crew?.steps(exchanges);
    // Firstmate's context window is its own machinery, not part of Flyd's conversation.
    const { context: _context, ...flyds } = snapshot;
    const voiced = this.desk
      ? { ...flyds, messages: relayed(snapshot.messages), ...(snapshot.activity ? { activity: inFlydsVoice(snapshot.activity) } : {}) }
      : snapshot;
    if (exchanges.length === 0) return { ...voiced, messages: voiced.messages.map((message) => this.sited(sessionId, message)) };
    // Firstmate's answers in its own chat, read before its supervision replies are filtered out.
    const answered = Object.fromEntries(Object.entries(this.answersOf(sessionId, snapshot, exchanges, shared))
      .map(([id, answer]) => [id, this.sited(sessionId, answer)]));
    // What firstmate's session is doing now goes on the line of the note it took, not under the dots; once it has
    // said the outcome in its own chat, that outcome is the line.
    const shown = inlineOutcomes(withFollowUps(exchanges, answered, snapshot.working));
    const picked = new Set(voiced.working ? voiced.workingOn ?? [] : []);
    for (const exchange of shown) if (readUnacknowledged(exchange, picked)) this.heard.add(exchange.question.id);
    const live = livened(shown.map((exchange) => (this.heard.has(exchange.question.id) ? markRead(exchange) : exchange)), { projects: projectNames(), ...(steps?.size ? { steps } : {}), ...(voiced.working && voiced.activity ? { activity: voiced.activity } : {}), ...(voiced.working && voiced.workingOn ? { workingOn: voiced.workingOn } : {}) });
    return {
      ...voiced,
      messages: mergeNotes(voiced.messages.map((message) => this.sited(sessionId, message)), live, this.noteWindow(sessionId)),
      ...(Object.keys(answered).length ? { followUps: answered } : {}),
    };
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
      .filter((session) => session.size > 0 && SESSION_ID.test(session.id) && !this.isSupervision(session.path))
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
    // A session a view follows is already read: catch up on it rather than parse the whole transcript again.
    const shared = this.shared.get(sessionId);
    if (shared) {
      const fresh = this.refresh(sessionId, shared);
      if (fresh) this.deliver(shared, fresh);
      return shared.snapshot!;
    }
    const conversation = new TranscriptConversation();
    new LineFollower(this.sessionPath(sessionId)).readNew((line, offset) => conversation.pushLine(line, offset));
    return this.withNotes(sessionId, conversation.snapshot(), this.exchanges());
  }

  /**
   * Every view of a session (the page, the island's status, a reconnect)
   * shares one reading of its transcript: it is parsed once, then each new
   * line once, and each update is worked out once for all of them.
   */
  follow(
    sessionId: string,
    onUpdate: (snapshot: ConversationSnapshot) => void,
    onError?: (error: Error) => void,
  ): ConversationFollower {
    const shared = this.shared.get(sessionId) ?? this.share(sessionId);
    if (shared.linger) clearTimeout(shared.linger);
    delete shared.linger;
    const subscriber: Subscriber = { onUpdate, ...(onError ? { onError } : {}) };
    shared.subscribers.add(subscriber);
    const before = shared.snapshot;
    this.pump(sessionId, shared);
    // Nothing new since the last update: this view still needs it.
    if (shared.snapshot && shared.snapshot === before) this.deliver(shared, shared.snapshot, [subscriber]);
    let closed = false;
    return {
      close: () => {
        if (closed) return;
        closed = true;
        shared.subscribers.delete(subscriber);
        if (shared.subscribers.size > 0) return;
        shared.linger = setTimeout(() => this.unshare(sessionId, shared), LINGER_MS);
        shared.linger.unref?.();
      },
    };
  }

  private share(sessionId: string): SharedSession {
    const shared: SharedSession = {
      follower: new LineFollower(this.sessionPath(sessionId)),
      conversation: new TranscriptConversation(),
      subscribers: new Set(),
      // Polling, not fs.watch: it behaves the same for every editor and
      // filesystem, and a stat every few hundred ms is negligible.
      timer: setInterval(() => this.pump(sessionId, shared), this.pollMs),
      dirty: true,
      pictures: false,
      noteKey: "",
    };
    shared.timer.unref?.();
    // A crop of a changed element that finishes is news to the views too.
    shared.stopPictures = this.elements?.onChange(() => {
      shared.pictures = true;
      this.pump(sessionId, shared);
    });
    this.shared.set(sessionId, shared);
    return shared;
  }

  private unshare(sessionId: string, shared: SharedSession): void {
    if (shared.subscribers.size > 0) return;
    clearInterval(shared.timer);
    shared.stopPictures?.();
    if (this.shared.get(sessionId) === shared) this.shared.delete(sessionId);
  }

  /** Reads what was appended; with nobody following, that is all until someone does. */
  private pump(sessionId: string, shared: SharedSession): void {
    try {
      if (shared.subscribers.size === 0) {
        this.catchUp(shared);
        return;
      }
      const fresh = this.refresh(sessionId, shared);
      if (fresh) this.deliver(shared, fresh);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      for (const subscriber of [...shared.subscribers]) subscriber.onError?.(failure);
    }
  }

  private catchUp(shared: SharedSession): void {
    const count = shared.follower.readNew(
      (line, offset) => shared.conversation.pushLine(line, offset),
      () => {
        shared.conversation = new TranscriptConversation();
        delete shared.answers;
        shared.dirty = true;
      },
    );
    if (count > 0) shared.dirty = true;
  }

  /** A new snapshot when anything it shows may have changed, else undefined. */
  private refresh(sessionId: string, shared: SharedSession): ConversationSnapshot | undefined {
    this.catchUp(shared);
    const exchanges = this.exchanges();
    const key = exchanges.map((exchange) => `${exchange.question.id}:${exchange.waiting}:${exchange.answer?.id ?? ""}`).join(",");
    const notesChanged = key !== shared.noteKey;
    shared.noteKey = key;
    if (shared.snapshot && !shared.dirty && !notesChanged && !shared.pictures) return undefined;
    shared.dirty = false;
    shared.pictures = false;
    const snapshot = this.withNotes(sessionId, shared.conversation.snapshot(), exchanges, shared);
    shared.snapshot = snapshot;
    this.latest.set(sessionId, snapshot.messages.slice(-8));
    return snapshot;
  }

  private deliver(shared: SharedSession, snapshot: ConversationSnapshot, to: Iterable<Subscriber> = [...shared.subscribers]): void {
    for (const subscriber of to) {
      try {
        subscriber.onUpdate(snapshot);
      } catch (error) {
        subscriber.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}
