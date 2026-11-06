import { plainNote } from "./rail.js";
import { inFlydsVoice } from "./flyd-voice.js";
import { aboutOnly, judgeCase, nameReader, tagTurns, turnsOf, type ThreadProject, type Turn } from "./project-tags.js";
import type { ProjectJudge } from "./project-judge.js";
import { inline, SALUTATION, sentences } from "./summaries.js";
import type { ConversationFollower, ConversationMessage, ConversationSnapshot, ConversationSource, FileUpload, ImageData, ImageUpload, SentMessage, SessionSummary } from "./types.js";

// His conversations split by project. Every feed's sessions are read once in the
// background, then only what changed, tagged (project-tags.ts) and merged across
// sessions; a thread is a session of its own to the rest of the view, so the
// stream, its summaries and the message box work in it unchanged.

export const THREAD_PREFIX = "project:";
export const ALL_THREAD = `${THREAD_PREFIX}all`;
/** The newest messages a thread carries. */
export const THREAD_MESSAGES = 200;

const REFRESH_MS = 5_000;
const JUDGE_AT_ONCE = 4;
/** A dead service or a bad key is left alone until the next pass. */
const JUDGE_FAILURES = 5;
/** He is still talking: a question is judged with its reply, or once it has plainly had none. */
const UNANSWERED_MS = 5 * 60_000;

export interface ThreadFeed {
  sessions(): Promise<SessionSummary[]>;
  read(sessionId: string): Promise<ConversationSnapshot>;
  image(sessionId: string, imageId: string): Promise<ImageData | null>;
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
}

interface Entry { message: ConversationMessage; at: number; projects: string[] }

interface SessionIndex {
  stamp: string;
  turns: Turn[];
  /** Each message as a thread shows it, worked out once. */
  shown: Map<string, ConversationMessage>;
  named: string[][];
  open: number[];
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
  private judging = false;
  private timer?: ReturnType<typeof setInterval>;
  private readonly listeners = new Set<() => void>();
  private readonly read: (text: string) => string[];

  constructor(private readonly options: {
    feeds: ThreadFeed[];
    projects: ThreadProject[];
    judge?: ProjectJudge;
    now?: () => number;
  }) {
    // The same words are read at every merge: once each is enough.
    const reader = nameReader(options.projects);
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
    for (const [feed, source] of this.options.feeds.entries()) {
      for (const session of await source.sessions()) {
        const key = `${feed}|${session.id}`;
        if (this.sessions.get(key)?.stamp === session.updatedAt) continue;
        const snapshot = await source.read(session.id).catch(() => undefined);
        if (!snapshot) continue;
        this.index(key, feed, session, snapshot.messages);
        changed = true;
        // A long backfill shows what it has as it goes.
        if (!this.ready) this.merge();
      }
    }
    const first = !this.ready;
    this.ready = true;
    if (changed || first) this.merge();
    void this.judgeOpen();
  }

  private index(key: string, feed: number, session: SessionSummary, messages: ConversationMessage[]): void {
    const seen = new Set<string>();
    const turns = turnsOf(messages.filter((message) => !seen.has(message.id) && seen.add(message.id)));
    const shown = new Map(turns.flatMap((turn) => [...turn.asked, ...(turn.reply ? [turn.reply] : [])])
      .map((message) => [message.id, this.shown(message, feed, session.id)] as const));
    this.sessions.set(key, { stamp: session.updatedAt, turns, shown, named: [], open: [] });
  }

  /** The conversations as one list, oldest first, each message with its projects. */
  private merge(): void {
    const judge = this.options.judge;
    const seen = new Set<string>();
    const entries: Entry[] = [];
    for (const session of this.sessions.values()) {
      const { tags, named, open } = tagTurns(session.turns, this.read, judge ? (turn) => judge.known(turn.key) : undefined);
      session.named = named;
      session.open = open;
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
    const { notes: _notes, reports: _reports, shots: _shots, site: _site, wake: _wake, artefact: _artefact, ...rest } = message;
    return {
      ...rest,
      text: message.role === "assistant" ? inFlydsVoice(message.text) : plainNote(message.text).words,
      ...(message.images?.length ? { images: message.images.map((id) => `${feed}|${sessionId}|${id}`) } : {}),
    };
  }

  /** Asks the judge about the quiet turns, newest first, a few at a time, without holding up anything else. */
  private async judgeOpen(): Promise<void> {
    const judge = this.options.judge;
    if (!judge || this.judging) return;
    this.judging = true;
    try {
      const now = (this.options.now ?? Date.now)();
      const busiest = this.busiest();
      const work = [...this.sessions.values()].flatMap((session) => session.open.map((index) => ({ session, index })))
        .filter(({ session, index }) => {
          const turn = session.turns[index]!;
          if (judge.known(turn.key) !== undefined || session.named.every((names) => !names.length) && !busiest.length) return false;
          return turn.reply !== undefined || now - (Date.parse(turn.asked.at(-1)?.timestamp ?? "") || 0) > UNANSWERED_MS;
        })
        .sort((a, b) => this.turnAt(b.session.turns[b.index]!) - this.turnAt(a.session.turns[a.index]!));
      let failures = 0;
      for (let from = 0; from < work.length && failures < JUDGE_FAILURES; from += JUDGE_AT_ONCE) {
        const answers = await Promise.all(work.slice(from, from + JUDGE_AT_ONCE).map(({ session, index }) =>
          judge.request(session.turns[index]!.key, judgeCase(session.turns, index, session.named, this.options.projects, busiest)).catch(() => false)));
        failures = answers.every(Boolean) ? 0 : failures + 1;
        if (answers.some(Boolean)) {
          judge.save();
          this.merge();
        }
      }
    } finally {
      this.judging = false;
    }
  }

  private turnAt(turn: Turn): number {
    return Date.parse((turn.reply ?? turn.asked.at(-1))?.timestamp ?? "") || 0;
  }

  private busiest(): string[] {
    const counts = new Map<string, number>();
    for (const entry of this.entries) for (const name of entry.projects) counts.set(name, (counts.get(name) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }

  private summary(id: string, name: string, entries: Entry[]): ThreadSummary {
    const asked = entries.map((entry) => entry.message.role).lastIndexOf("user");
    const question = asked >= 0 ? entries[asked]!.message : undefined;
    const answer = entries.slice(asked + 1).find((entry) => entry.message.role === "assistant")?.message;
    const newestReply = entries[entries.map((entry) => entry.message.role).lastIndexOf("assistant")]?.message;
    const told = answer ?? (asked >= 0 ? undefined : newestReply);
    const reading = told && name !== "All" ? aboutOnly(told.text, name, this.read) : told?.text;
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
    return { ready: this.ready, projects, ...(this.entries.length ? { all: this.summary(ALL_THREAD, "All", this.entries) } : {}) };
  }

  name(sessionId: string): string | undefined {
    if (sessionId === ALL_THREAD) return "All";
    return this.options.projects.find((project) => threadId(project.name) === sessionId)?.name;
  }

  snapshot(sessionId: string): ConversationSnapshot {
    const name = this.name(sessionId);
    const messages = this.entries.filter((entry) => sessionId === ALL_THREAD || (name && entry.projects.includes(name)))
      .slice(-THREAD_MESSAGES).map((entry) => (name && name !== "All" && entry.projects.length > 1 && entry.message.role === "assistant"
        ? { ...entry.message, text: aboutOnly(entry.message.text, name, this.read) }
        : entry.message));
    const last = messages.at(-1);
    return {
      messages,
      working: last?.role === "user" && Boolean(last.waiting) && !last.waitingFailed && !last.settled,
      ...(name && name !== "All" ? { project: name } : {}),
      ...(last?.timestamp ? { lastActivity: last.timestamp } : {}),
    };
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
  const aboutProject = (sessionId: string, text: string): string => {
    const name = sessionId === ALL_THREAD ? undefined : threads.name(sessionId);
    return name ? `About the project "${name}"\n\n${text}` : text;
  };
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
    read: async (sessionId) => (isThread(sessionId) ? threads.snapshot(sessionId) : source.read(sessionId)),
    follow: (sessionId, onUpdate, onError): ConversationFollower => {
      if (!isThread(sessionId)) return source.follow(sessionId, onUpdate, onError);
      let closed = false;
      let last = "";
      const update = () => {
        if (closed) return;
        const snapshot = threads.snapshot(sessionId);
        const said = JSON.stringify(snapshot);
        if (said === last) return;
        last = said;
        onUpdate(snapshot);
      };
      const stop = threads.onChange(update);
      update();
      return { close: () => { closed = true; stop(); } };
    },
    send: async (sessionId, text, images?: ImageUpload[], files?: FileUpload[], to?) =>
      sent(isThread(sessionId) ? source.send(await target(sessionId), aboutProject(sessionId, text), images, files, to) : source.send(sessionId, text, images, files, to)),
    ...(source.sendDecision ? { sendDecision: async (text: string, images: ImageUpload[] = [], decision?: { decisionId: string; taskId: string }, sessionId?: string) =>
      source.sendDecision!(text, images, decision, sessionId && isThread(sessionId) ? await target(sessionId) : sessionId) } : {}),
    commands: () => source.commands(),
    image: (sessionId, imageId) => (isThread(sessionId) ? threads.image(imageId) : source.image(sessionId, imageId)),
    ...(source.exchanges ? { exchanges: () => source.exchanges!() } : {}),
    ...(source.resolveConfirm ? { resolveConfirm: (id: string, allow: boolean) => source.resolveConfirm!(id, allow) } : {}),
    ...(source.noteAnswer ? { noteAnswer: (id: string) => source.noteAnswer!(id) } : {}),
    projectThreads: () => threads.list(),
  };
}
