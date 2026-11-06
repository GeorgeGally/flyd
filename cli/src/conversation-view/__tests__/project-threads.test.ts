import { appendFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readLinesFrom } from "../line-follower.js";
import { plainNote } from "../rail.js";
import { ProjectJudge } from "../project-judge.js";
import { threadCatalogue } from "../project-tags.js";
import { ALL_THREAD, ProjectThreads, threadId, THREAD_MESSAGES, withProjectThreads, type ThreadFeed } from "../project-threads.js";
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

describe("the judge in the threads", () => {
  const quiet = { s: { updatedAt: "2026-11-06T10:00:00Z", messages: [
    user("a", "the logan rotate wheel", "2026-11-06T09:00:00Z"), said("b", "Done.", "2026-11-06T09:01:00Z"),
    user("c", "the DIR ident", "2026-11-06T09:02:00Z"), said("d", "Done.", "2026-11-06T09:03:00Z"),
    user("e", "smaller squares", "2026-11-06T09:04:00Z"), said("f", "Done.", "2026-11-06T09:05:00Z"),
  ] } };
  const answering = (choice: string, confidence = 0.9): typeof fetch => vi.fn(async () => new Response(JSON.stringify({
    model: "jev-1.13.0", answers: { message_project: { type: "choice", choice, confidence, probabilities: { [choice]: confidence } } }, usage: { input_tokens: 10, output_tokens: 1 },
  }))) as unknown as typeof fetch;
  const settled = async (threads: ProjectThreads) => { await threads.refresh(); await vi.waitFor(() => expect(threads.snapshot(ALL_THREAD)).toBeDefined()); await new Promise((resolve) => setTimeout(resolve, 20)); };

  it("tags a quiet turn, and keeps the answer so history is asked once", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "flyd-tags-")), "tags.json");
    const fetchFn = answering("b");
    const threads = new ProjectThreads({ feeds: [feed(quiet)], projects, judge: new ProjectJudge({ apiKey: "test", fetchFn, file }) });
    await settled(threads);
    // The nearest project first: DIR is a, Logan b.
    expect(threads.snapshot(threadId("Logan")).messages.map((message) => message.id)).toContain("e");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).not.toContain("smaller");

    const again = answering("a");
    const later = new ProjectThreads({ feeds: [feed(quiet)], projects, judge: new ProjectJudge({ apiKey: "test", fetchFn: again, file }) });
    await settled(later);
    expect(again).not.toHaveBeenCalled();
    expect(later.snapshot(threadId("Logan")).messages.map((message) => message.id)).toContain("e");
  });

  it("leaves a turn it is unsure of in All alone", async () => {
    const threads = new ProjectThreads({ feeds: [feed(quiet)], projects, judge: new ProjectJudge({ apiKey: "test", fetchFn: answering("b", 0.4) }) });
    await settled(threads);
    expect(threads.snapshot(threadId("Logan")).messages.map((message) => message.id)).not.toContain("e");
    expect(threads.snapshot(ALL_THREAD).messages.map((message) => message.id)).toContain("e");
  });

  it("stops asking for the pass when the service is down, and learns nothing", async () => {
    const fetchFn = vi.fn(async () => { throw new Error("down"); }) as unknown as typeof fetch;
    const many = Array.from({ length: 60 }, (_, index) => [
      user(`q${index}`, `quiet ${index}`, new Date(Date.UTC(2026, 10, 1, index)).toISOString()),
      said(`r${index}`, "Done.", new Date(Date.UTC(2026, 10, 1, index, 1)).toISOString()),
    ]).flat();
    const judge = new ProjectJudge({ apiKey: "test", fetchFn });
    const threads = new ProjectThreads({ feeds: [feed({ s: { updatedAt: "2026-11-06T10:00:00Z", messages: [user("n", "DIR ident", "2026-10-30T09:00:00Z"), ...many] } })], projects, judge });
    await settled(threads);
    await vi.waitFor(() => expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThanOrEqual(20));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeLessThanOrEqual(20);
    expect(judge.known("q59")).toBeUndefined();
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
    expect(source.sent).toEqual([["window:project-dir", 'About the project "DIR"\n\nsmaller squares']]);
  });

  it("sends to the live session when the source keeps no conversation per project, never an article's", async () => {
    const source = base();
    await withProjectThreads(source, await threads()).send("project:dir", "smaller");
    expect(source.sent[0]![0]).toBe("live");
  });

  it("from All, says no project", async () => {
    const source = base({ newSession: (id) => ({ id, title: "New", updatedAt: "" }) });
    await withProjectThreads(source, await threads()).send(ALL_THREAD, "hello");
    expect(source.sent).toEqual([["window:project-all", "hello"]]);
  });

  it("leaves ordinary sessions to the source", async () => {
    const source = base();
    const wrapped = withProjectThreads(source, await threads());
    await wrapped.send("live", "hello");
    expect(source.sent).toEqual([["live", "hello"]]);
    expect(wrapped.newSession?.("project:nothing")).toBeUndefined();
    expect(wrapped.newSession?.("project:dir")?.title).toBe("DIR");
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
    expect(plainNote('About the project "DIR"\n\nsmaller squares')).toEqual({ words: "smaller squares", project: "DIR" });
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
