import { plainNote } from "./rail.js";
import { inFlydsVoice } from "./flyd-voice.js";
import type { ProjectAsker } from "./project-asker.js";
import { aboutOnly, askLine, nameReader, tagTurns, turnsOf, type ThreadProject, type Turn } from "./project-tags.js";
import { inline, SALUTATION, sentences } from "./summaries.js";
import type { ChatScope, ConversationFollower, ConversationMessage, ConversationSnapshot, ConversationSource, FileUpload, ImageData, ImageUpload, SentMessage, SessionSummary } from "./types.js";

// His conversations split by project. Every feed's sessions are read once in the
// background, then only what changed, tagged (project-tags.ts) and merged across
// sessions; a thread is a session of its own to the rest of the view, so the
// stream, its summaries and the message box work in it unchanged.

export const THREAD_PREFIX = "project:";
export const ALL_THREAD = `${THREAD_PREFIX}all`;
/** What nothing could place: no project of its own, and still findable. */
export const OTHER_THREAD = `${THREAD_PREFIX}other`;
/** The newest messages a thread carries. */
export const THREAD_MESSAGES = 200;

const REFRESH_MS = 5_000;
/** He is still talking: a turn is placed once its reply has had time to name its project. */
const UNANSWERED_MS = 5 * 60_000;
/** A mid-turn session quiet for this long was cut short, not working; a long tool call writes nothing until it ends. */
const CUT_SHORT_MS = 30 * 60_000;
/** The words firstmate reads back for a thread he writes in, so "make it smaller" means something. */
const CONTEXT_LINES = 6;

export interface ThreadFeed {
  sessions(): Promise<SessionSummary[]>;
  read(sessionId: string): Promise<ConversationSnapshot>;
  image(sessionId: string, imageId: string): Promise<ImageData | null>;
  /** Whether a message may be shown to him at all: the staff's words pass the same check as in the stream. */
  shows?(message: ConversationMessage): boolean;
  /** Changes when something beside the session's own file changes what it reads as: an inbox note, its reply. */
  revision?(): string;
  volatile?: boolean;
}

export interface ThreadSummary {
  id: string;
  name: string;
  /** His newest words here. */
  question?: string;
  /** What came back to them, or the newest update when he has said nothing since. */
  answer?: string;
  /** The newest thing said here. */
  at?: string;
  /** The newest thing said to him here, for the unread mark. */
  replyAt?: string;
  count: number;
}

export interface ThreadList {
  /** False until every session has been read once. */
  ready: boolean;
  all?: ThreadSummary;
  projects: ThreadSummary[];
  /** What nothing could place. */
  other?: ThreadSummary;
}

interface Entry { message: ConversationMessage; at: number; projects: string[] }

interface SessionIndex {
  stamp: string;
  fingerprint: string;
  active: boolean;
  /** Mid-turn with nothing back yet: when the session last moved, so a turn cut short does not read as working for ever. */
  workingAt?: number;
  /** The projects of the words that turn is on; none when nothing is left unanswered. */
  asking?: string[];
  turns: Turn[];
  /** Each message as a thread shows it, worked out once. */
  shown: Map<string, ConversationMessage>;
  named: string[][];
  unplaced: number[];
}

export function threadId(name: string): string {
  return `${THREAD_PREFIX}${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

/** Whether a session id is one of the threads, not a conversation of its own. */
export function isThread(sessionId: string | null | undefined): boolean {
  return Boolean(sessionId?.startsWith(THREAD_PREFIX));
}

const oneLine = (text: string, limit: number): string => {
  const flat = inline(text);
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat;
};

/** A reply's opening thought for a row of the list: no salutation, no lead-in to a list, the project's own line when it has one. */
function gist(text: string, own: (line: string) => boolean = () => false): string {
  const lines = text.replace(/```[\s\S]*?(?:```|$)/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  const said = lines.filter((line) => !line.endsWith(":"));
  const first = said.find(own) ?? said[0] ?? lines[0] ?? "";
  const body = inline(first.replace(/^(?:[-*+]|\d+[.)])\s+/, "")).replace(SALUTATION, "");
  const lead = oneLine(sentences(body)[0] ?? body, 160);
  return lead ? `${lead.charAt(0).toUpperCase()}${lead.slice(1)}` : "";
}

export class ProjectThreads {
  private readonly sessions = new Map<string, SessionIndex>();
  private entries: Entry[] = [];
  private ready = false;
  private running?: Promise<void>;
  private again = false;
  private asking = false;
  private timer?: ReturnType<typeof setInterval>;
  private readonly listeners = new Set<() => void>();
  private readonly read: (text: string) => string[];
  private readonly names: (text: string) => string[];

  constructor(private readonly options: {
    feeds: ThreadFeed[];
    projects: ThreadProject[];
    asker?: ProjectAsker;
    now?: () => number;
  }) {
    // The same words are read at every merge: once each is enough.
    const reader = nameReader(options.projects);
    this.names = reader;
    const read = new Map<string, string[]>();
    this.read = (text) => {
      const known = read.get(text);
      if (known) return known;
      const names = reader(text);
      read.set(text, names);
      return names;
    };
  }

  /** Reads everything once, then keeps up. */
  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** One pass at a time; a call during a pass runs one more after it. */
  refresh(): Promise<void> {
    if (this.running) { this.again = true; return this.running; }
    this.running = this.pass().catch((error: unknown) => {
      console.warn(`[view] project threads: ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => {
      this.running = undefined;
      if (this.again) { this.again = false; void this.refresh(); }
    });
    return this.running;
  }

  private async pass(): Promise<void> {
    let changed = false;
    let sinceMerge = 0;
    let mergeBatch = 25;
    const listed = new Set<string>();
    for (const [feed, source] of this.options.feeds.entries()) {
      const revision = source.revision?.() ?? "";
      for (const session of await source.sessions()) {
        const key = `${feed}|${session.id}`;
        const stamp = `${session.updatedAt}|${revision}`;
        listed.add(key);
        const previous = this.sessions.get(key);
        if (previous?.stamp === stamp && !(source.volatile && previous.active)) continue;
        const snapshot = await source.read(session.id).catch(() => undefined);
        if (!snapshot) continue;
        const fingerprint = JSON.stringify(snapshot);
        if (previous?.stamp === stamp && previous.fingerprint === fingerprint) continue;
        this.index(key, feed, stamp, fingerprint, session, snapshot);
        changed = true;
        // A long backfill shows what it has as it goes.
        if (!this.ready && ++sinceMerge >= mergeBatch) { this.merge(); sinceMerge = 0; mergeBatch *= 2; }
      }
    }
    // A conversation that went away takes its words with it.
    for (const key of this.sessions.keys()) {
      if (listed.has(key)) continue;
      this.sessions.delete(key);
      changed = true;
    }
    const first = !this.ready;
    this.ready = true;
    if (changed || first) this.merge();
    void this.askUnplaced();
  }

  private index(key: string, feed: number, stamp: string, fingerprint: string, session: SessionSummary, snapshot: ConversationSnapshot): void {
    const seen = new Set<string>();
    const shows = this.options.feeds[feed]!.shows;
    const fresh = snapshot.messages.filter((message) => !seen.has(message.id) && seen.add(message.id) && (!shows || shows(message)));
    const turns = turnsOf(fresh);
    const shown = new Map(turns.flatMap((turn) => [...turn.asked, ...(turn.reply ? [turn.reply] : [])])
      .map((message) => [message.id, this.shown(message, feed, session.id)] as const));
    const active = snapshot.working || snapshot.messages.some((message) => message.role === "user" && Boolean(message.waiting) && !message.waitingFailed && !message.settled);
    this.sessions.set(key, {
      stamp, fingerprint, active, turns, shown, named: [], unplaced: [],
      ...(snapshot.working ? { workingAt: Date.parse(session.updatedAt) || 0 } : {}),
    });
  }

  /** The conversations as one list, oldest first, each message with its projects. */
  private merge(): void {
    const asker = this.options.asker;
    const seen = new Set<string>();
    const entries: Entry[] = [];
    for (const session of this.sessions.values()) {
      const { tags, named, unplaced } = tagTurns(session.turns, this.read, asker ? (turn) => asker.known(turn.key) : undefined);
      session.named = named;
      session.unplaced = unplaced;
      const open = session.turns.at(-1);
      session.asking = open && !open.reply ? tags.get(open.asked.at(-1)?.id ?? "") ?? [] : undefined;
      for (const turn of session.turns) {
        for (const message of [...turn.asked, ...(turn.reply ? [turn.reply] : [])]) {
          // A resumed session repeats the one it came from.
          if (seen.has(message.id)) continue;
          seen.add(message.id);
          entries.push({ message: session.shown.get(message.id)!, at: Date.parse(message.timestamp ?? "") || 0, projects: tags.get(message.id) ?? [] });
        }
      }
    }
    this.entries = entries.sort((a, b) => a.at - b.at);
    for (const listener of [...this.listeners]) listener();
  }

  /** A message as a thread shows it: said in Flyd's voice, his own words only, its pictures still findable. */
  private shown(message: ConversationMessage, feed: number, sessionId: string): ConversationMessage {
    const { notes: _notes, reports: _reports, shots, site: _site, wake: _wake, ...rest } = message;
    const kept = shots?.filter((shot) => shot.startsWith("/"));
    const images = [...(message.images ?? []), ...(shots?.filter((shot) => !shot.startsWith("/")) ?? [])];
    return {
      ...rest,
      ...(kept?.length ? { shots: kept } : {}),
      text: message.role === "assistant" ? inFlydsVoice(message.text) : plainNote(message.text).words,
      ...(images.length ? { images: images.map((id) => `${feed}|${sessionId}|${id}`) } : {}),
    };
  }

  /** Firstmate is asked about the turns nothing here could place, newest first; its answers come back on a later pass. */
  private async askUnplaced(): Promise<void> {
    const asker = this.options.asker;
    if (!asker || this.asking) return;
    this.asking = true;
    try {
      const now = (this.options.now ?? Date.now)();
      const cases = [...this.sessions.values()].flatMap((session) => session.unplaced.map((index) => ({ session, index })))
        .filter(({ session, index }) => {
          const turn = session.turns[index]!;
          return turn.reply !== undefined || now - (Date.parse(turn.asked.at(-1)?.timestamp ?? "") || 0) > UNANSWERED_MS;
        })
        .sort((a, b) => this.turnAt(b.session.turns[b.index]!) - this.turnAt(a.session.turns[a.index]!))
        .map(({ session, index }) => ({ turn: session.turns[index]!.key, line: askLine(session.turns, index, session.named) }));
      if (await asker.ask(cases)) this.merge();
    } catch (error) {
      console.warn(`[view] could not ask firstmate about projects: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.asking = false;
    }
  }

  private turnAt(turn: Turn): number {
    return Date.parse((turn.reply ?? turn.asked.at(-1))?.timestamp ?? "") || 0;
  }

  private summary(id: string, name: string, entries: Entry[]): ThreadSummary {
    const asked = entries.map((entry) => entry.message.role).lastIndexOf("user");
    const question = asked >= 0 ? entries[asked]!.message : undefined;
    const answer = entries.slice(asked + 1).find((entry) => entry.message.role === "assistant")?.message;
    const newestReply = entries[entries.map((entry) => entry.message.role).lastIndexOf("assistant")]?.message;
    const told = answer ?? (asked >= 0 ? undefined : newestReply);
    const reading = told && id !== ALL_THREAD && id !== OTHER_THREAD ? aboutOnly(told.text, name, this.read) : told?.text;
    const at = entries.at(-1)?.message.timestamp;
    return {
      id, name, count: entries.length,
      ...(question ? { question: oneLine(question.text, 200) } : {}),
      ...(reading ? { answer: gist(reading, (line) => this.read(line).includes(name)) } : {}),
      ...(at ? { at } : {}),
      ...(newestReply?.timestamp ? { replyAt: newestReply.timestamp } : {}),
    };
  }

  /** Every project with something said, newest first. */
  list(): ThreadList {
    const byName = new Map<string, Entry[]>();
    for (const entry of this.entries) {
      for (const name of entry.projects) {
        const entries = byName.get(name);
        if (entries) entries.push(entry); else byName.set(name, [entry]);
      }
    }
    const projects = [...byName].map(([name, entries]) => this.summary(threadId(name), name, entries))
      .sort((a, b) => Date.parse(b.at ?? "") - Date.parse(a.at ?? ""));
    const other = this.entries.filter((entry) => !entry.projects.length);
    return {
      ready: this.ready, projects,
      ...(this.entries.length ? { all: this.summary(ALL_THREAD, "All", this.entries) } : {}),
      ...(other.length ? { other: this.summary(OTHER_THREAD, "Other", other) } : {}),
    };
  }

  name(sessionId: string): string | undefined {
    if (sessionId === ALL_THREAD) return "All";
    if (sessionId === OTHER_THREAD) return "Other";
    return this.options.projects.find((project) => threadId(project.name) === sessionId)?.name;
  }

  /** The thread's project, when it is one rather than All or Other. */
  project(sessionId: string): string | undefined {
    return sessionId === ALL_THREAD || sessionId === OTHER_THREAD ? undefined : this.name(sessionId);
  }

  snapshot(sessionId: string): ConversationSnapshot {
    const project = this.project(sessionId);
    const known = this.name(sessionId) !== undefined;
    const matching = this.entries.filter((entry) => known && (sessionId === ALL_THREAD
      || (sessionId === OTHER_THREAD ? !entry.projects.length : entry.projects.includes(project!))));
    const messages = matching.slice(-THREAD_MESSAGES).map((entry) => (project && entry.projects.length > 1 && entry.message.role === "assistant"
        ? { ...entry.message, text: aboutOnly(entry.message.text, project, this.read) }
        : entry.message));
    const last = messages.at(-1);
    const now = (this.options.now ?? Date.now)();
    const midTurn = known && [...this.sessions.values()].some(({ workingAt, asking }) => workingAt !== undefined && asking && now - workingAt < CUT_SHORT_MS
      && (sessionId === ALL_THREAD || (sessionId === OTHER_THREAD ? !asking.length : asking.includes(project!))));
    return {
      messages,
      working: midTurn || matching.some(({ message }) => message.role === "user" && Boolean(message.waiting) && !message.waitingFailed && !message.settled),
      ...(project ? { project } : {}),
      ...(last?.timestamp ? { lastActivity: last.timestamp } : {}),
    };
  }

  /** What his words in a thread need to stand on their own, in the lines `plainNote` takes back off. */
  /**
   * Where a message is for: the one project his words clearly name, else where he
   * wrote it from. "Flyd, …" addressed to Flyd names no project.
   */
  scopeFor(text: string, from: ChatScope): ChatScope {
    const named = this.names(text.replace(/^\s*(?:(?:hey|hi|ok|okay)\s+)?flyd\b[\s,:!.-]*/i, ""));
    if (from.project && named.includes(from.project)) return { project: from.project };
    return named.length === 1 ? { project: named[0]! } : { ...from };
  }

  lead(sessionId: string): string {
    const project = this.project(sessionId);
    const lines = this.snapshot(sessionId).messages.slice(-CONTEXT_LINES)
      .map((message) => `> ${message.role === "user" ? "George" : "Flyd"}: ${oneLine(message.text, 200)}`);
    return [project ? `About the project "${project}"` : "About this conversation", ...lines].join("\n");
  }

  image(imageId: string): Promise<ImageData | null> {
    const [feed = "", session = "", ...rest] = imageId.split("|");
    const source = this.options.feeds[Number(feed)];
    return source ? source.image(session, rest.join("|")) : Promise.resolve(null);
  }
}

/** The view's source with the threads added: a thread reads as a session; everything else is the source's own. */
export function withProjectThreads(source: ConversationSource, threads: ProjectThreads): ConversationSource {
  /** Where his words in a thread go: a conversation of that project's own when the source keeps one, else the live session. */
  const target = async (sessionId: string): Promise<string> => {
    const own = `window:${sessionId.replace(":", "-")}`;
    if (source.newSession?.(own)) return own;
    const live = (await source.listSessions()).find((session) => !session.id.startsWith("window:article-"))?.id;
    if (!live) throw new Error("No conversation to send to");
    return live;
  };
  /** His words with the thread they were said in. A slash command stays first, or it is no longer a command. */
  // A project's thread speaks for that project; "everything" and "other" are no project's.
  const threadScope = (sessionId: string): ChatScope => {
    const project = threads.project(sessionId);
    return project ? { project } : {};
  };
  const inThread = (sessionId: string, text: string): string => (text.trimStart().startsWith("/") ? text : `${threads.lead(sessionId)}\n\n${text}`);
  const sent = async (work: Promise<SentMessage>): Promise<SentMessage> => {
    const result = await work;
    void threads.refresh();
    return result;
  };
  return {
    assistantLabel: source.assistantLabel,
    canSend: source.canSend,
    ...(source.answersInSession !== undefined ? { answersInSession: source.answersInSession } : {}),
    listSessions: () => source.listSessions(),
    newSession: (sessionId: string): SessionSummary | undefined => {
      const name = threads.name(sessionId);
      if (isThread(sessionId)) return name ? { id: sessionId, title: name, updatedAt: new Date().toISOString() } : undefined;
      return source.newSession?.(sessionId);
    },
    read: async (sessionId) => {
      if (!isThread(sessionId)) return source.read(sessionId);
      const snapshot = threads.snapshot(sessionId);
      const current = await target(sessionId).then((id) => source.read(id)).catch(() => undefined);
      return current?.confirm ? { ...snapshot, confirm: current.confirm } : snapshot;
    },
    follow: (sessionId, onUpdate, onError): ConversationFollower => {
      if (!isThread(sessionId)) return source.follow(sessionId, onUpdate, onError);
      let closed = false;
      let last = "";
      let confirm: ConversationSnapshot["confirm"];
      let targetFollower: ConversationFollower | undefined;
      const update = () => {
        if (closed) return;
        const base = threads.snapshot(sessionId);
        const snapshot = confirm ? { ...base, confirm } : base;
        const said = JSON.stringify(snapshot);
        if (said === last) return;
        last = said;
        onUpdate(snapshot);
      };
      const stop = threads.onChange(update);
      update();
      void target(sessionId).then((id) => {
        if (closed) return;
        targetFollower = source.follow(id, (snapshot) => { confirm = snapshot.confirm; update(); }, onError);
      }).catch((error: unknown) => onError?.(error instanceof Error ? error : new Error(String(error))));
      return { close: () => { closed = true; stop(); targetFollower?.close(); } };
    },
    send: async (sessionId, text, images?: ImageUpload[], files?: FileUpload[], to?, scope?: ChatScope) => {
      if (!isThread(sessionId)) return sent(source.send(sessionId, text, images, files, to, scope ? threads.scopeFor(text, scope) : undefined));
      const where = threads.scopeFor(text, scope ?? threadScope(sessionId));
      // The thread's own lead says which project it is; a message he sent elsewhere from here goes without it.
      const said = where.project === threads.project(sessionId) ? inThread(sessionId, text) : text;
      return sent(source.send(await target(sessionId), said, images, files, to, where));
    },
    ...(source.sendDecision ? { sendDecision: async (text: string, images: ImageUpload[] = [], decision?: { decisionId: string; taskId: string }, sessionId?: string) =>
      source.sendDecision!(text, images, decision, sessionId && isThread(sessionId) ? await target(sessionId) : sessionId) } : {}),
    ...(source.sendDecisionFollowUp ? { sendDecisionFollowUp: async (text: string, decision: { decisionId: string; taskId: string }, sessionId?: string) =>
      source.sendDecisionFollowUp!(text, decision, sessionId && isThread(sessionId) ? await target(sessionId) : sessionId) } : {}),
    commands: () => source.commands(),
    image: (sessionId, imageId) => (isThread(sessionId) ? threads.image(imageId) : source.image(sessionId, imageId)),
    ...(source.exchanges ? { exchanges: () => source.exchanges!() } : {}),
    ...(source.resolveConfirm ? { resolveConfirm: (id: string, allow: boolean) => source.resolveConfirm!(id, allow) } : {}),
    ...(source.noteAnswer ? { noteAnswer: (id: string) => source.noteAnswer!(id) } : {}),
    projectThreads: () => threads.list(),
  };
}
