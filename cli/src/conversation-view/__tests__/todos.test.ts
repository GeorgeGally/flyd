import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetWorkIndexPath, useWorkIndexPath } from "../../work/database.js";
import { upcomingAgenda } from "../../runtime/agenda.js";
import {
  appendConfirmedTodos, listDoneConfirmedTodos, listOpenConfirmedTodos, replaceConfirmedTodos,
  tickedFlydAsks, tickFlydAsk, untickConfirmedTodo,
} from "../../work/work-hypothesis/confirmed-todos.js";
import type { Job } from "../jobs.js";
import { ConversationViewServer } from "../server.js";
import { readTodos, tickTodo, todosFrom } from "../todos.js";
import type { ConversationSource } from "../types.js";

const NOW = new Date("2026-11-07T12:00:00.000Z");

function job(over: Partial<Job>): Job {
  return {
    id: "cap5", group: "needs", state: "Needs you", title: "Cap5", project: "", at: "", next: "", owner: "you", ask: "Which hero should ship?",
    because: "", shots: [], links: [], files: [], threads: [], digest: null, ...over,
  };
}
const entry = (over: object) => ({ id: "e1", itemId: "i1", task: "Check the deploy", at: "2026-11-06T12:00:00.000Z", status: "failed", result: "", read: false, ...over }) as never;
const empty = { jobs: [], inbox: [], open: [], done: [], ticked: new Set<string>(), now: NOW };

describe("what the Todo tab reads", () => {
  it("lists what a job needs of him, with the job it opens and where it comes from", () => {
    const list = todosFrom({ ...empty, jobs: [job({})] });
    expect(list.open).toEqual([expect.objectContaining({ text: "Which hero should ship?", line: "Cap5 · Needs you", job: "cap5", from: "flyd" })]);
  });

  it("leaves out jobs that are Flyd's to move, and his idle projects with nothing asked", () => {
    const list = todosFrom({ ...empty, jobs: [
      job({ id: "a", group: "working", owner: "Flyd", ask: "" }),
      job({ id: "b", group: "waiting", owner: "you", ask: "", next: "Nothing is moving this." }),
      job({ id: "c", group: "done", owner: "", ask: "" }),
    ] });
    expect(list.open).toEqual([]);
  });

  it("does not say the job's name twice when the ask is the title", () => {
    const list = todosFrom({ ...empty, jobs: [job({ title: "Land the fix", ask: "Land the fix", state: "Ready to land" })] });
    expect(list.open[0]!.line).toBe("Ready to land");
  });

  it("asks about an agenda run that stopped, until a later run goes well or a week passes", () => {
    expect(todosFrom({ ...empty, inbox: [entry({})] }).open).toEqual([
      expect.objectContaining({ id: "inbox:e1", text: "Try again or drop: Check the deploy", from: "flyd" }),
    ]);
    expect(todosFrom({ ...empty, inbox: [entry({ status: "blocked" })] }).open).toHaveLength(1);
    expect(todosFrom({ ...empty, inbox: [entry({ status: "ok" })] }).open).toEqual([]);
    expect(todosFrom({ ...empty, inbox: [entry({}), entry({ id: "e2", status: "ok" })] }).open).toEqual([]);
    expect(todosFrom({ ...empty, inbox: [entry({ at: "2026-10-20T12:00:00.000Z" })] }).open).toEqual([]);
  });

  it("puts Flyd's asks ahead of his own list and says when his own are due", () => {
    const own = { id: "todo-1", description: "Book flights", status: "open", sortOrder: 0, createdAt: "", updatedAt: "", dueAt: "2026-11-20" } as const;
    const late = { ...own, id: "todo-2", description: "Send invoice", dueAt: "2026-11-01" };
    const today = { ...own, id: "todo-3", description: "Call Sam", dueAt: "2026-11-07" };
    const list = todosFrom({ ...empty, jobs: [job({})], open: [own, late, today] });
    expect(list.open.map((row) => row.text)).toEqual(["Which hero should ship?", "Book flights", "Send invoice", "Call Sam"]);
    expect(list.open.slice(1).map((row) => row.line)).toEqual(["Due 20 Nov", "Was due 1 Nov", "Due today"]);
  });

  it("drops a ticked ask, and brings it back as a new one when the job asks something else", () => {
    const first = todosFrom({ ...empty, jobs: [job({})] }).open[0]!;
    expect(todosFrom({ ...empty, jobs: [job({})], ticked: new Set([first.id]) }).open).toEqual([]);
    expect(todosFrom({ ...empty, jobs: [job({ ask: "And the footer?" })], ticked: new Set([first.id]) }).open).toHaveLength(1);
  });

  it("keeps a ticked decision ticked when its words change", () => {
    const decision = { task: "t", decisionId: "d1", question: "q", choices: [] };
    const first = todosFrom({ ...empty, jobs: [job({ decision })] }).open[0]!;
    expect(todosFrom({ ...empty, jobs: [job({ decision, ask: "Reworded?" })], ticked: new Set([first.id]) }).open).toEqual([]);
  });
});

describe("the Todo tab's store", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-todo-tab-"));
    useWorkIndexPath(join(dir, "work-index.sqlite"));
    process.env.FLYD_AGENDA_DIR = dir;
  });
  afterEach(() => {
    closeDb();
    resetWorkIndexPath();
    delete process.env.FLYD_AGENDA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps a tick on his own item, and an untick reopens it", () => {
    const [todo] = appendConfirmedTodos(["Book flights"]);
    expect(tickTodo(todo!.id, [])).toBe(true);
    expect(readTodos([]).open).toEqual([]);
    expect(readTodos([]).done).toEqual([expect.objectContaining({ id: todo!.id, text: "Book flights", from: "you" })]);
    expect(tickTodo(todo!.id, [])).toBe(false);
    expect(untickConfirmedTodo(todo!.id)).toBe(true);
    expect(readTodos([]).open.map((row) => row.text)).toEqual(["Book flights"]);
    expect(readTodos([]).done).toEqual([]);
  });

  it("keeps a tick on a Flyd ask out of his open list, and an untick asks again", () => {
    const jobs = [job({})];
    const ask = readTodos(jobs).open[0]!;
    expect(tickTodo(ask.id, jobs)).toBe(true);
    expect(tickTodo(ask.id, jobs)).toBe(false);
    tickFlydAsk(ask.id, ask.text);
    expect(listOpenConfirmedTodos()).toEqual([]);
    expect(tickedFlydAsks()).toEqual(new Set([ask.id]));
    const list = readTodos(jobs);
    expect(list.open).toEqual([]);
    expect(list.done).toEqual([expect.objectContaining({ text: "Which hero should ship?", from: "flyd" })]);
    expect(untickConfirmedTodo(list.done[0]!.id)).toBe(true);
    expect(readTodos(jobs).open.map((row) => row.id)).toEqual([ask.id]);
    expect(tickedFlydAsks().size).toBe(0);
  });

  it("will not tick an ask nobody is asking", () => {
    expect(tickTodo("job:nothing", [job({})])).toBe(false);
    expect(tickedFlydAsks().size).toBe(0);
  });

  it("reads a stuck run from the agenda's own inbox, and leaves the agenda's schedule alone", () => {
    writeFileSync(join(dir, "inbox.jsonl"), `${JSON.stringify({ id: "e1", itemId: "i1", task: "Check the deploy", at: new Date().toISOString(), status: "failed", result: "", read: false })}\n`);
    writeFileSync(join(dir, "inbox.jsonl"), `${JSON.stringify({ id: "e9", itemId: "i9", task: "Internal", at: new Date().toISOString(), status: "failed", result: "", read: false, internal: true })}\n`, { flag: "a" });
    const stuck = readTodos([]).open;
    expect(stuck.map((row) => row.id)).toEqual(["inbox:e1"]);
    expect(tickTodo("inbox:e1", [])).toBe(true);
    expect(readTodos([]).open).toEqual([]);
    expect(upcomingAgenda()).toEqual([]);
  });

  it("stops showing done items after a week", () => {
    const [todo] = appendConfirmedTodos(["Old thing"]);
    tickTodo(todo!.id, []);
    expect(listDoneConfirmedTodos(new Date(Date.now() + 60_000))).toEqual([]);
    expect(readTodos([], new Date(Date.now() + 8 * 24 * 60 * 60 * 1000)).done).toEqual([]);
  });

  it("does not touch a ticked ask when his list is replaced", () => {
    tickFlydAsk("job:x", "Pick one");
    replaceConfirmedTodos(["Only this"]);
    expect(tickedFlydAsks()).toEqual(new Set(["job:x"]));
    expect(listOpenConfirmedTodos().map((todo) => todo.description)).toEqual(["Only this"]);
  });

  it("serves adds and ticks over the view's route, and they outlive a restart of the store", async () => {
    const source = { assistantLabel: "Flyd", canSend: true, listSessions: async () => [] } as unknown as ConversationSource;
    const feed = { start() {}, stop() {}, current: () => ({ memories: [], news: [], taste: [] }), onRefresh: () => () => {} };
    const server = new ConversationViewServer(source, undefined, undefined, undefined, feed as never);
    try {
      const port = await server.listen(0);
      const base = `http://127.0.0.1:${port}`;
      const token = (await (await fetch(`${base}/api/token`)).json()).token as string;
      const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/todos`, {
        method: "POST", headers: { "content-type": "application/json", "x-flyd-view-token": token, ...headers }, body: JSON.stringify(body),
      });
      expect((await post({ op: "add", text: "x" }, { "x-flyd-view-token": "wrong" })).status).toBe(403);
      expect((await post({ op: "add", text: "x" }, { origin: "https://evil.example" })).status).toBe(403);
      expect((await post({ op: "add", text: "   " })).status).toBe(400);
      expect((await post({ op: "add", text: "y".repeat(301) })).status).toBe(400);
      expect((await post({ op: "wipe" })).status).toBe(400);

      const added = await (await post({ op: "add", text: "  Call   the  bank " })).json();
      expect(added.todos.open.map((row: { text: string }) => row.text)).toEqual(["Call the bank"]);
      const id = added.todos.open[0].id as string;
      const ticked = await (await post({ op: "tick", id })).json();
      expect(ticked.todos.open).toEqual([]);
      expect(ticked.todos.done.map((row: { id: string }) => row.id)).toEqual([id]);

      const gone = await post({ op: "tick", id: "job:gone" });
      expect(gone.status).toBe(404);
      expect((await gone.json()).todos.done).toHaveLength(1);

      closeDb();
      expect(readTodos([]).done.map((row) => row.id)).toEqual([id]);
      expect((await post({ op: "untick", id })).status).toBe(200);
      closeDb();
      expect(readTodos([]).open.map((row) => row.text)).toEqual(["Call the bank"]);
    } finally {
      await server.close();
    }
  });
});
