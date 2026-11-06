import { appendFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readLinesFrom } from "../line-follower.js";
import { plainNote } from "../rail.js";
import { ProjectAsker } from "../project-asker.js";
import { threadCatalogue } from "../project-tags.js";
import { ALL_THREAD, OTHER_THREAD, ProjectThreads, threadId, THREAD_MESSAGES, withProjectThreads, type ThreadFeed } from "../project-threads.js";
import type { ConversationMessage, ConversationSnapshot, ConversationSource, SessionSummary } from "../types.js";

const projects = threadCatalogue("", []);
const user = (id: string, text: string, timestamp: string): ConversationMessage => ({ id, role: "user", text, timestamp });
const said = (id: string, text: string, timestamp: string, extra: Partial<ConversationMessage> = {}): ConversationMessage => ({ id, role: "assistant", text, timestamp, ...extra });

function feed(sessions: Record<string, { updatedAt: string; messages: ConversationMessage[] }>): ThreadFeed & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    sessions: async () => Object.entries(sessions).map(([id, session]): SessionSummary => ({ id, title: id, updatedAt: session.updatedAt })),
    read: async (id) => { reads.push(id); return { messages: sessions[id]!.messages, working: false }; },
    image: async (session, id) => ({ mediaType: "image/png", data: Buffer.from(`${session}:${id}`) }),
  };
}

const HISTORY = {
  old: { updatedAt: "2026-11-01T10:00:00Z", messages: [
    user("o1", "the DIR start button is ugly", "2026-11-01T09:00:00Z"),
    said("o2", "Captain, a designer has started.", "2026-11-01T09:01:00Z"),
    user("o3", "logan needs gradients", "2026-11-01T09:02:00Z"),
    said("o4", "Captain, gradients are in.", "2026-11-01T09:03:00Z"),
  ] },
  live: { updatedAt: "2026-11-06T10:00:00Z", messages: [
    said("w1", "Captain, shipshape.", "2026-11-06T08:00:00Z", { wake: true }),
    user("l1", "videos are not caching on DIR", "2026-11-06T09:00:00Z"),
    said("l2", "Captain, the worker found the bug.\n\nIt was the player.", "2026-11-06T09:01:00Z"),
    said("l3", "Captain, the Logan pages landed.", "2026-11-06T09:30:00Z", { wake: true }),
  ] },
};

afterEach(() => { vi.restoreAllMocks(); });

describe("ProjectThreads", () => {
  it("backfills every session and lists each project's latest exchange, newest first", async () => {
    const threads = new ProjectThreads({ feeds: [feed(HISTORY)], projects });
    expect(threads.list().ready).toBe(false);
    await threads.refresh();
    const list = threads.list();
    expect(list.ready).toBe(true);
    expect(list.projects.map((project) => project.name)).toEqual(["Logan", "DIR"]);
    expect(list.projects[1]).toMatchObject({
      id: "project:dir", question: "videos are not caching on DIR", answer: "The worker found the bug.", replyAt: "2026-11-06T09:01:00Z",
    });
  });

  it("publishes partial backfill in growing batches and finishes with every session", async () => {
    const sessions = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`s${i}`, { updatedAt: "2026-11-06T10:00:00Z", messages: [user(`q${i}`, "DIR", "2026-11-06T09:00:00Z")] }]));
    const threads = new ProjectThreads({ feeds: [feed(sessions)], projects });
    const counts: number[] = [];
    threads.onChange(() => counts.push(threads.snapshot(ALL_THREAD).messages.length));
    await threads.refresh();
    expect(counts).toEqual([25, 75, 100]);
    expect(threads.list().ready).toBe(true);
  });

  it("gathers a project's thread across sessions, answers under their questions", async () => {
    const threads = new ProjectThreads({ feeds: [feed(HISTORY)], projects });
    await threads.refresh();
    expect(threads.snapshot(threadId("DIR")).messages.map((message) => message.id)).toEqual(["o1", "o2", "l1", "l2"]);
    expect(threads.snapshot(threadId("DIR")).project).toBe("DIR");
  });

  it("speaks in Flyd's voice in a thread", async () => {
    const threads = new ProjectThreads({ feeds: [feed(HISTORY)], projects });
    await threads.refresh();
    expect(threads.snapshot(threadId("DIR")).messages[1]!.text).toMatch(/^Sir, /);
  });

  it("All is everything said but the wakes with nothing to say", async () => {
    const threads = new ProjectThreads({ feeds: [feed(HISTORY)], projects });
    await threads.refresh();
    const ids = threads.snapshot(ALL_THREAD).messages.map((message) => message.id);
    expect(ids).toEqual(["o1", "o2", "o3", "o4", "l1", "l2", "l3"]);
    expect(threads.list().all?.name).toBe("All");
  });

  it("shows only this project's points of a reply about several", async () => {
    const threads = new ProjectThreads({ feeds: [feed({ s: { updatedAt: "2026-11-06T10:00:00Z", messages: [
      said("r", "Status:\n\n- **DIR:** set one rendered.\n- **Logan:** filters have started.", "2026-11-06T09:00:00Z", { wake: true }),
    ] } })], projects });
    await threads.refresh();
    expect(threads.snapshot(threadId("DIR")).messages[0]!.text).not.toContain("filters");
    expect(threads.snapshot(threadId("Logan")).messages[0]!.text).not.toContain("rendered");
    expect(threads.snapshot(ALL_THREAD).messages[0]!.text).toContain("filters");
    expect(threads.list().projects.find((project) => project.name === "Logan")?.answer).toBe("Logan: filters have started.");
  });

  it("leads a row with what was said, not a lead-in or a code block", async () => {
    const threads = new ProjectThreads({ feeds: [feed({ s: { updatedAt: "2026-11-06T10:00:00Z", messages: [
      user("q", "the hftw login?", "2026-11-06T09:00:00Z"),
      said("r", "Captain, HFTW admin details:\n\n\`\`\`\nsecret\n\`\`\`\n\n- Login page: example.com", "2026-11-06T09:01:00Z"),
    ] } })], projects });
    await threads.refresh();
    expect(threads.list().projects[0]?.answer).toBe("Login page: example.com");
  });

  it("shows a message once when a resumed session repeats it", async () => {
    const twice = { a: { updatedAt: "2026-11-05T10:00:00Z", messages: [user("q", "DIR ident", "2026-11-05T09:00:00Z")] }, b: { updatedAt: "2026-11-06T10:00:00Z", messages: [user("q", "DIR ident", "2026-11-05T09:00:00Z")] } };
    const threads = new ProjectThreads({ feeds: [feed(twice)], projects });
    await threads.refresh();
    expect(threads.snapshot(threadId("DIR")).messages).toHaveLength(1);
  });

  it("reads only sessions that changed", async () => {
    const source = feed(HISTORY);
    const threads = new ProjectThreads({ feeds: [source], projects });
    await threads.refresh();
    source.reads.length = 0;
    await threads.refresh();
    expect(source.reads).toEqual([]);
    HISTORY.live.updatedAt = "2026-11-06T10:05:00Z";
    await threads.refresh();
    expect(source.reads).toEqual(["live"]);
  });

  it("keeps a thread to its newest messages", async () => {
    const many = Array.from({ length: THREAD_MESSAGES + 5 }, (_, index) => user(`m${index}`, `DIR note ${index}`, new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString()));
    const threads = new ProjectThreads({ feeds: [feed({ s: { updatedAt: "2026-11-02T00:00:00Z", messages: many } })], projects });
    await threads.refresh();
    const { messages } = threads.snapshot(threadId("DIR"));
    expect(messages).toHaveLength(THREAD_MESSAGES);
    expect(messages.at(-1)!.id).toBe(`m${THREAD_MESSAGES + 4}`);
  });

  it("finds a thread's pictures in the session they came from", async () => {
    const threads = new ProjectThreads({ feeds: [feed({ s: { updatedAt: "2026-11-06T10:00:00Z", messages: [{ ...user("q", "DIR ident", "2026-11-06T09:00:00Z"), images: ["120"] }] } })], projects });
    await threads.refresh();
    const [id] = threads.snapshot(threadId("DIR")).messages[0]!.images!;
    expect((await threads.image(id!))?.data.toString()).toBe("s:120");
  });
});

describe("firstmate placing what Flyd cannot", () => {
  const quiet = { s: { updatedAt: "2026-11-06T10:00:00Z", messages: [
    user("a", "the logan rotate wheel", "2026-11-06T09:00:00Z"), said("b", "Done.", "2026-11-06T09:01:00Z"),
    user("c", "the DIR ident", "2026-11-06T09:02:00Z"), said("d", "Done.", "2026-11-06T09:03:00Z"),
    user("e", "smaller squares", "2026-11-06T09:04:00Z"), said("f", "Done.", "2026-11-06T09:05:00Z"),
  ] } };
  const names = projects.map((project) => project.name);
  const pass = async (threads: ProjectThreads) => { await threads.refresh(); await new Promise((resolve) => setTimeout(resolve, 5)); };

  function firstmate(answer?: (note: string) => string) {
    const notes: Array<{ body: string; requestId: string }> = [];
    return {
      notes,
      send: vi.fn(async (body: string, requestId: string) => { notes.push({ body, requestId }); return true; }),
      reply: (requestId: string) => (answer && notes.some((note) => note.requestId === requestId) ? answer(notes.find((note) => note.requestId === requestId)!.body) : undefined),
    };
  }
  const idIn = (note: string): string => /^([0-9a-f]{8}) \|/m.exec(note)![1]!;

  it("asks firstmate about a turn nothing places, and files it where firstmate says", async () => {
    const staff = firstmate((note) => `Here you go:\n${idIn(note)}: Logan`);
    const threads = new ProjectThreads({ feeds: [feed(quiet)], projects, asker: new ProjectAsker({ ...staff, names }) });
    await pass(threads);
    expect(staff.notes).toHaveLength(1);
    expect(staff.notes[0]!.body).toContain("smaller squares");
    expect(staff.notes[0]!.body).toContain("around: Logan, DIR");
    expect(threads.snapshot(OTHER_THREAD).messages.map((message) => message.id)).toContain("e");
    await pass(threads);
    expect(threads.snapshot(threadId("Logan")).messages.map((message) => message.id)).toContain("e");
    expect(threads.snapshot(OTHER_THREAD).messages.map((message) => message.id)).not.toContain("e");
  });

  it("files what firstmate cannot place under Other, and does not ask again", async () => {
    const staff = firstmate((note) => `${idIn(note)}: Other`);
    const threads = new ProjectThreads({ feeds: [feed(quiet)], projects, asker: new ProjectAsker({ ...staff, names }) });
    await pass(threads);
    await pass(threads);
    await pass(threads);
    expect(staff.notes).toHaveLength(1);
    expect(threads.list().other).toMatchObject({ id: OTHER_THREAD, question: "smaller squares" });
  });

  it("takes a project firstmate made up as no project", async () => {
    const staff = firstmate((note) => `${idIn(note)}: Nonsense`);
    const asker = new ProjectAsker({ ...staff, names });
    const threads = new ProjectThreads({ feeds: [feed(quiet)], projects, asker });
    await pass(threads);
    await pass(threads);
    expect(threads.snapshot(OTHER_THREAD).messages.map((message) => message.id)).toContain("e");
  });

  it("keeps firstmate's answers by hash, its open note across a restart, and no words on disk", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "flyd-tags-")), "tags.json");
    const staff = firstmate((note) => `${idIn(note)}: Logan`);
    await pass(new ProjectThreads({ feeds: [feed(quiet)], projects, asker: new ProjectAsker({ ...staff, names, file }) }));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const later = new ProjectThreads({ feeds: [feed(quiet)], projects, asker: new ProjectAsker({ ...staff, names, file }) });
    await pass(later);
    expect(staff.notes).toHaveLength(1);
    await pass(later);
    expect(later.snapshot(threadId("Logan")).messages.map((message) => message.id)).toContain("e");
    expect(readFileSync(file, "utf8")).not.toContain("smaller");
  });

  it("holds one note at a time, spaced out, and asks nothing while firstmate is not taking notes", async () => {
    let now = 1_000_000_000_000;
    const asked = Array.from({ length: 30 }, (_, index) => ({ turn: `t${index}`, line: `line ${index}` }));
    const staff = firstmate((note) => note.split("\n").filter((line) => / \| /.test(line)).map((line) => `${line.slice(0, 8)}: Other`).join("\n"));
    const asker = new ProjectAsker({ ...staff, names, now: () => now });
    expect(await asker.ask(asked)).toBe(false);
    expect(staff.notes[0]!.body.split("\n").filter((line) => / \| /.test(line))).toHaveLength(25);
    expect(await asker.ask(asked)).toBe(true);
    expect(await asker.ask(asked)).toBe(false);
    expect(staff.notes).toHaveLength(1);
    now += 16 * 60_000;
    await asker.ask(asked);
    expect(staff.notes).toHaveLength(2);

    const away = new ProjectAsker({ send: async () => false, reply: () => undefined, names });
    expect(await away.ask(asked)).toBe(false);
    expect(away.known("t0")).toBeUndefined();
  });

  it("keeps retrying missing and unknown answers across restarts", async () => {
    let now = 1_000_000_000_000;
    const file = join(mkdtempSync(join(tmpdir(), "flyd-retry-")), "tags.json");
    const staff = firstmate((note) => {
      const ids = [...note.matchAll(/^([0-9a-f]{8}) \|/gm)].map((match) => match[1]);
      return staff.notes.length === 1 ? `${ids[0]}: Logan\n${ids[1]}: Unknown` : `${ids[0]}: Unknown`;
    });
    const cases = ["a", "b", "c"].map((turn) => ({ turn, line: turn }));
    let asker = new ProjectAsker({ ...staff, names, file, now: () => now });
    await asker.ask(cases);
    await asker.ask(cases);
    expect(asker.known("a")).toBe("Logan");
    expect(asker.known("b")).toBeUndefined();
    expect(asker.known("c")).toBeUndefined();
    asker = new ProjectAsker({ ...staff, names, file, now: () => now });
    now += 16 * 60_000;
    await asker.ask(cases);
    await asker.ask(cases);
    expect(asker.known("b")).toBeUndefined();
    expect(asker.known("c")).toBeUndefined();
    now += 16 * 60_000;
    await asker.ask(cases);
    expect(staff.notes).toHaveLength(3);
  });

  it("gives up on a note never answered, so the next can go", async () => {
    let now = 1_000_000_000_000;
    const staff = firstmate();
    const asker = new ProjectAsker({ ...staff, names, now: () => now });
    await asker.ask([{ turn: "t", line: "line" }]);
    now += 7 * 60 * 60_000;
    await asker.ask([{ turn: "t", line: "line" }]);
    expect(staff.notes).toHaveLength(2);
    expect(new Set(staff.notes.map((note) => note.requestId)).size).toBe(2);
  });
});

describe("what the threads keep up with", () => {
  it("refreshes volatile failure state without a timestamp change", async () => {
    const sessions: Record<string, { updatedAt: string; messages: ConversationMessage[] }> = { s: { updatedAt: "2026-11-06T10:00:00Z", messages: [{ ...user("q", "DIR ident", "2026-11-06T09:00:00Z"), waiting: "Working" }] } };
    const threads = new ProjectThreads({ feeds: [{ ...feed(sessions), volatile: true }], projects });
    await threads.refresh();
    expect(threads.snapshot("project:dir").working).toBe(true);
    sessions.s!.messages[0] = { ...sessions.s!.messages[0]!, waitingFailed: true };
    await threads.refresh();
    expect(threads.snapshot("project:dir").working).toBe(false);
    expect(threads.snapshot("project:dir").messages[0]?.waitingFailed).toBe(true);
  });

  it("rereads only active or changed volatile sessions", async () => {
    const sessions: Record<string, { updatedAt: string; messages: ConversationMessage[] }> = {
      idle: { updatedAt: "2026-11-06T10:00:00Z", messages: [user("i", "Logan", "2026-11-06T09:00:00Z")] },
      active: { updatedAt: "2026-11-06T10:00:00Z", messages: [{ ...user("a", "DIR", "2026-11-06T09:00:00Z"), waiting: "Working" }] },
    };
    const source = { ...feed(sessions), volatile: true };
    const threads = new ProjectThreads({ feeds: [source], projects });
    await threads.refresh();
    source.reads.length = 0;
    await threads.refresh();
    expect(source.reads).toEqual(["active"]);
    sessions.active!.messages[0] = { ...sessions.active!.messages[0]!, waitingFailed: true };
    await threads.refresh();
    source.reads.length = 0;
    await threads.refresh();
    expect(source.reads).toEqual([]);
    sessions.idle!.updatedAt = "2026-11-06T10:01:00Z";
    await threads.refresh();
    expect(source.reads).toEqual(["idle"]);
  });

  it("keeps an active request working when another session replies later", async () => {
    const threads = new ProjectThreads({ feeds: [feed({
      active: { updatedAt: "1", messages: [{ ...user("q", "DIR ident", "2026-11-06T09:00:00Z"), waiting: "Working" }] },
      other: { updatedAt: "2", messages: [said("r", "DIR update", "2026-11-06T10:00:00Z")] },
    })], projects });
    await threads.refresh();
    expect(threads.snapshot("project:dir").working).toBe(true);
    expect(threads.snapshot(ALL_THREAD).working).toBe(true);
  });

  it("shows a transcript mid-turn as working in the project asked about, and only while it is moving", async () => {
    const updatedAt = "2026-11-06T10:00:00Z";
    let now = Date.parse(updatedAt) + 60_000;
    const midTurn: ThreadFeed = {
      ...feed({}),
      sessions: async () => [{ id: "t", title: "t", updatedAt }],
      read: async () => ({ messages: [user("q", "the DIR ident", "2026-11-06T09:59:00Z")], working: true }),
    };
    const threads = new ProjectThreads({ feeds: [midTurn], projects, now: () => now });
    await threads.refresh();
    expect(threads.snapshot("project:dir").working).toBe(true);
    expect(threads.snapshot(ALL_THREAD).working).toBe(true);
    expect(threads.snapshot("project:logan").working).toBe(false);
    expect(threads.snapshot(OTHER_THREAD).working).toBe(false);
    now += 60 * 60_000;
    expect(threads.snapshot("project:dir").working).toBe(false);
  });

  it("does not call a supervision turn work on the last thing asked", async () => {
    const updatedAt = "2026-11-06T10:00:00Z";
    const midWake: ThreadFeed = {
      ...feed({}),
      sessions: async () => [{ id: "t", title: "t", updatedAt }],
      read: async () => ({ messages: [user("q", "the DIR ident", "2026-11-06T09:58:00Z"), said("r", "DIR ident is done.", "2026-11-06T09:59:00Z")], working: true }),
    };
    const threads = new ProjectThreads({ feeds: [midWake], projects, now: () => Date.parse(updatedAt) });
    await threads.refresh();
    expect(threads.snapshot("project:dir").working).toBe(false);
  });

  it("keeps answer attachments and resolves transcript shots in both threads", async () => {
    const threads = new ProjectThreads({ feeds: [feed({ a: { updatedAt: "2026-11-06T10:00:00Z", messages: [
      user("q", "the DIR ident", "2026-11-06T09:00:00Z"),
      said("r", "DIR ident has three steps.", "2026-11-06T09:01:00Z", {
        artefact: "1. One\n2. Two\n3. Three",
        page: { url: "https://example.com/dir", label: "DIR" },
        shots: ["/kept/shot.png", "t10.0"],
        images: ["existing"],
      }),
    ] } })], projects });
    await threads.refresh();
    const answer = threads.snapshot("project:dir").messages.at(-1)!;
    expect(answer.artefact).toContain("Three");
    expect(answer.page?.url).toBe("https://example.com/dir");
    expect(answer.shots).toEqual(["/kept/shot.png"]);
    expect(answer.images).toEqual(["0|a|existing", "0|a|t10.0"]);
    expect(threads.snapshot(ALL_THREAD).messages.at(-1)?.images).toEqual(answer.images);
    expect((await threads.image(answer.images![1]!))?.data.toString()).toBe("a:t10.0");
  });

  it("lets a conversation that went away go", async () => {
    const sessions = { a: { updatedAt: "2026-11-06T10:00:00Z", messages: [user("q", "DIR ident", "2026-11-06T09:00:00Z")] } } as Record<string, { updatedAt: string; messages: ConversationMessage[] }>;
    const threads = new ProjectThreads({ feeds: [feed(sessions)], projects });
    await threads.refresh();
    delete sessions.a;
    await threads.refresh();
    expect(threads.snapshot(threadId("DIR")).messages).toEqual([]);
    expect(threads.list().projects).toEqual([]);
  });

  it("reads a session again when its inbox moves, though its file did not", async () => {
    let revision = "one";
    const source = { ...feed(HISTORY), revision: () => revision };
    const threads = new ProjectThreads({ feeds: [source], projects });
    await threads.refresh();
    source.reads.length = 0;
    await threads.refresh();
    expect(source.reads).toEqual([]);
    revision = "two";
    await threads.refresh();
    expect(source.reads.length).toBeGreaterThan(0);
  });

  it("keeps out what the feed will not show him, in the thread and on its row", async () => {
    const source = { ...feed({ s: { updatedAt: "2026-11-06T10:00:00Z", messages: [user("q", "DIR ident", "2026-11-06T09:00:00Z"), said("r", "the secret machinery", "2026-11-06T09:01:00Z")] } }), shows: (message: ConversationMessage) => !message.text.includes("machinery") };
    const threads = new ProjectThreads({ feeds: [source], projects });
    await threads.refresh();
    expect(threads.snapshot(threadId("DIR")).messages.map((message) => message.id)).toEqual(["q"]);
    expect(threads.list().projects[0]?.answer).toBeUndefined();
  });
});

describe("withProjectThreads", () => {
  const base = (over: Partial<ConversationSource> = {}): ConversationSource & { sent: Array<[string, string]> } => {
    const sent: Array<[string, string]> = [];
    return {
      sent,
      assistantLabel: "Flyd", canSend: true,
      listSessions: async () => [{ id: "window:article-1234567", title: "article", updatedAt: "2026-11-06T10:00:00Z" }, { id: "live", title: "live", updatedAt: "2026-11-05T10:00:00Z" }],
      read: async (): Promise<ConversationSnapshot> => ({ messages: [], working: false }),
      follow: () => ({ close() {} }),
      send: async (session, text) => { sent.push([session, text]); return { id: "sent", timestamp: "2026-11-06T10:00:00Z" }; },
      commands: async () => [],
      image: async () => null,
      ...over,
    };
  };
  const threads = async () => {
    const built = new ProjectThreads({ feeds: [feed(HISTORY)], projects });
    await built.refresh();
    return built;
  };

  it("sends his words in a thread to that project's own conversation, saying which project", async () => {
    const source = base({ newSession: (id) => (id.startsWith("window:") ? { id, title: "New", updatedAt: "" } : undefined) });
    await withProjectThreads(source, await threads()).send("project:dir", "smaller squares");
    const [[session, text]] = source.sent as [[string, string]];
    expect(session).toBe("window:project-dir");
    expect(text).toMatch(/^About the project "DIR"\n> /);
    expect(plainNote(text)).toEqual({ words: "smaller squares", thread: true, project: "DIR" });
  });

  it("carries what he is looking at, so a follow-up means something in a new conversation", async () => {
    const source = base({ newSession: (id) => ({ id, title: "New", updatedAt: "" }) });
    await withProjectThreads(source, await threads()).send("project:dir", "make it smaller");
    expect(source.sent[0]![1]).toContain("> George: videos are not caching on DIR");
    expect(source.sent[0]![1]).toContain("> Flyd: Sir, the worker found the bug.");
  });

  it("leaves a slash command first, so it is still a command", async () => {
    const source = base({ newSession: (id) => ({ id, title: "New", updatedAt: "" }) });
    await withProjectThreads(source, await threads()).send("project:dir", "/compact");
    expect(source.sent[0]![1]).toBe("/compact");
  });

  it("sends to the live session when the source keeps no conversation per project, never an article's", async () => {
    const source = base();
    await withProjectThreads(source, await threads()).send("project:dir", "smaller");
    expect(source.sent[0]![0]).toBe("live");
  });

  it("from All, says no project, and still carries the talk", async () => {
    const source = base({ newSession: (id) => ({ id, title: "New", updatedAt: "" }) });
    await withProjectThreads(source, await threads()).send(ALL_THREAD, "hello");
    expect(source.sent[0]![0]).toBe("window:project-all");
    expect(plainNote(source.sent[0]![1])).toEqual({ words: "hello", thread: true });
  });

  it("leaves ordinary sessions to the source", async () => {
    const source = base();
    const wrapped = withProjectThreads(source, await threads());
    await wrapped.send("live", "hello");
    expect(source.sent).toEqual([["live", "hello"]]);
    expect(wrapped.newSession?.("project:nothing")).toBeUndefined();
    expect(wrapped.newSession?.("project:dir")?.title).toBe("DIR");
  });

  it("forwards decision follow-ups to ordinary and thread target sessions", async () => {
    const followUp = vi.fn(async (_text: string, _decision: { decisionId: string; taskId: string }, _session?: string) => ({ id: "sent", timestamp: "2026-11-06T10:00:00Z" }));
    const source = base({ newSession: (id) => ({ id, title: "New", updatedAt: "" }), sendDecisionFollowUp: followUp });
    const wrapped = withProjectThreads(source, await threads());
    const decision = { decisionId: "d", taskId: "t" };
    for (const session of ["live", "project:dir", ALL_THREAD, OTHER_THREAD]) await wrapped.sendDecisionFollowUp!("more", decision, session);
    expect(followUp.mock.calls.map((call) => call[2])).toEqual(["live", "window:project-dir", "window:project-all", "window:project-other"]);
  });

  it("exposes and clears the target session confirmation in reads and follows", async () => {
    let confirmation: ConversationSnapshot["confirm"] = { id: "approval", prompt: "Continue?" };
    let publish: ((snapshot: ConversationSnapshot) => void) | undefined;
    let closed = false;
    const source = base({
      newSession: (id) => ({ id, title: "New", updatedAt: "" }),
      read: async () => ({ messages: [], working: true, ...(confirmation ? { confirm: confirmation } : {}) }),
      follow: (_id, onUpdate) => { publish = onUpdate; onUpdate({ messages: [], working: true, confirm: confirmation }); return { close: () => { closed = true; } }; },
    });
    const wrapped = withProjectThreads(source, await threads());
    expect((await wrapped.read("project:dir")).confirm).toEqual(confirmation);
    const seen: ConversationSnapshot[] = [];
    const follower = wrapped.follow("project:dir", (snapshot) => seen.push(snapshot));
    await vi.waitFor(() => expect(seen.at(-1)?.confirm?.id).toBe("approval"));
    confirmation = undefined;
    publish!({ messages: [], working: false });
    expect(seen.at(-1)?.confirm).toBeUndefined();
    expect((await wrapped.read("project:dir")).confirm).toBeUndefined();
    follower.close();
    expect(closed).toBe(true);
  });

  it("follows a thread, and tells the follower when it changes", async () => {
    const live = await threads();
    const seen: ConversationSnapshot[] = [];
    const follower = withProjectThreads(base(), live).follow("project:dir", (snapshot) => seen.push(snapshot));
    expect(seen).toHaveLength(1);
    HISTORY.live.messages.push(user("l9", "more on DIR", "2026-11-06T09:40:00Z"));
    HISTORY.live.updatedAt = "2026-11-06T10:10:00Z";
    await live.refresh();
    expect(seen).toHaveLength(2);
    expect(seen[1]!.messages.at(-1)!.id).toBe("l9");
    follower.close();
    expect(withProjectThreads(base(), live).projectThreads?.().projects.length).toBeGreaterThan(0);
  });
});

describe("plainNote", () => {
  it("takes the window's project line off his words and keeps which project", () => {
    expect(plainNote('About the project "DIR"\n> George: the ident\n> Flyd: Done.\n\nsmaller squares')).toEqual({ words: "smaller squares", thread: true, project: "DIR" });
  });
});

describe("readLinesFrom", () => {
  it("reads complete lines, holds back a torn one, and carries on from where it stopped", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "flyd-lines-")), "t.jsonl");
    writeFileSync(path, "one\ntwo\nthr");
    const lines: Array<[string, number]> = [];
    const offset = await readLinesFrom(path, 0, (line, at) => lines.push([line, at]));
    expect(lines).toEqual([["one", 0], ["two", 4]]);
    expect(offset).toBe(8);
    appendFileSync(path, "ee\n");
    await readLinesFrom(path, offset, (line, at) => lines.push([line, at]));
    expect(lines.at(-1)).toEqual(["three", 8]);
  });
});
