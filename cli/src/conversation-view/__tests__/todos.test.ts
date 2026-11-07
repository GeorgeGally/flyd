import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetWorkIndexPath, useWorkIndexPath } from "../../work/database.js";
import { upcomingAgenda } from "../../runtime/agenda.js";
import {
  appendConfirmedTodos, listOpenConfirmedTodos, replaceConfirmedTodos, tickedFlydAsks, tickFlydAsk,
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
const empty = { jobs: [], inbox: [], open: [], ticked: new Set<string>(), now: NOW };

describe("what the Todo tab reads", () => {
  it("lists what a job needs of him, with the job it opens and where it comes from", () => {
    const list = todosFrom({ ...empty, jobs: [job({})] });
    expect(list).toEqual([expect.objectContaining({ text: "Which hero should ship?", line: "Cap5 · Needs you", job: "cap5", from: "flyd" })]);
  });

  it("leaves out jobs that are Flyd's to move, and his idle projects with nothing asked", () => {
    const list = todosFrom({ ...empty, jobs: [
      job({ id: "a", group: "working", owner: "Flyd", ask: "" }),
      job({ id: "b", group: "waiting", owner: "you", ask: "", next: "Nothing is moving this." }),
      job({ id: "c", group: "done", owner: "", ask: "" }),
    ] });
    expect(list).toEqual([]);
  });

  it("does not say the job's name twice when the ask is the title", () => {
    const list = todosFrom({ ...empty, jobs: [job({ title: "Land the fix", ask: "Land the fix", state: "Ready to land" })] });
    expect(list[0]!.line).toBe("Ready to land");
  });

  it("asks about an agenda run that stopped, until a later run goes well or a week passes", () => {
    expect(todosFrom({ ...empty, inbox: [entry({})] })).toEqual([
      expect.objectContaining({ id: "inbox:e1", text: "Try again or drop: Check the deploy", from: "flyd" }),
    ]);
    expect(todosFrom({ ...empty, inbox: [entry({ status: "blocked" })] })).toHaveLength(1);
    expect(todosFrom({ ...empty, inbox: [entry({ status: "ok" })] })).toEqual([]);
    expect(todosFrom({ ...empty, inbox: [entry({}), entry({ id: "e2", status: "ok" })] })).toEqual([]);
    expect(todosFrom({ ...empty, inbox: [entry({ at: "2026-10-20T12:00:00.000Z" })] })).toEqual([]);
  });

  it("does not ask him to retry what was never a run", () => {
    const held = entry({ id: "e3", itemId: "held:ab12cd34", task: "A decision", status: "blocked", result: "Which hero?" });
    const jobResult = entry({ id: "e4", itemId: "job-77", task: "Rebuild the index" });
    expect(todosFrom({ ...empty, inbox: [held, jobResult, entry({})] }).map((row) => row.id)).toEqual(["inbox:e1"]);
  });

  it("puts Flyd's asks ahead of his own list and says when his own are due", () => {
    const own = { id: "todo-1", description: "Book flights", status: "open", sortOrder: 0, createdAt: "", updatedAt: "", dueAt: "2026-11-20" } as const;
    const late = { ...own, id: "todo-2", description: "Send invoice", dueAt: "2026-11-01" };
    const today = { ...own, id: "todo-3", description: "Call Sam", dueAt: "2026-11-07" };
    const list = todosFrom({ ...empty, jobs: [job({})], open: [own, late, today] });
    expect(list.map((row) => row.text)).toEqual(["Which hero should ship?", "Book flights", "Send invoice", "Call Sam"]);
    expect(list.slice(1).map((row) => row.line)).toEqual(["Due 20 Nov", "Was due 1 Nov", "Due today"]);
  });

  it("drops a ticked ask, and brings it back as a new one when the job asks something else", () => {
    const first = todosFrom({ ...empty, jobs: [job({})] })[0]!;
    expect(todosFrom({ ...empty, jobs: [job({})], ticked: new Set([first.id]) })).toEqual([]);
    expect(todosFrom({ ...empty, jobs: [job({ ask: "And the footer?" })], ticked: new Set([first.id]) })).toHaveLength(1);
  });

  it("keeps a ticked decision ticked when its words change", () => {
    const decision = { task: "t", decisionId: "d1", question: "q", choices: [] };
    const first = todosFrom({ ...empty, jobs: [job({ decision })] })[0]!;
    expect(todosFrom({ ...empty, jobs: [job({ decision, ask: "Reworded?" })], ticked: new Set([first.id]) })).toEqual([]);
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

  it("takes a ticked item of his own off the tab for good", () => {
    const [todo] = appendConfirmedTodos(["Book flights"]);
    expect(tickTodo(todo!.id, [])).toBe(true);
    expect(readTodos([])).toEqual([]);
    expect(tickTodo(todo!.id, [])).toBe(false);
  });

  it("keeps a ticked Flyd ask off the tab and out of his open list", () => {
    const jobs = [job({})];
    const ask = readTodos(jobs)[0]!;
    expect(tickTodo(ask.id, jobs)).toBe(true);
    expect(tickTodo(ask.id, jobs)).toBe(false);
    expect(listOpenConfirmedTodos()).toEqual([]);
    expect(tickedFlydAsks()).toEqual(new Set([ask.id]));
    expect(readTodos(jobs)).toEqual([]);
  });

  it("will not tick an ask nobody is asking", () => {
    expect(tickTodo("job:nothing", [job({})])).toBe(false);
    expect(tickedFlydAsks().size).toBe(0);
  });

  it("reads a stuck run from the agenda's own inbox, and leaves the agenda's schedule alone", () => {
    writeFileSync(join(dir, "inbox.jsonl"), `${JSON.stringify({ id: "e1", itemId: "i1", task: "Check the deploy", at: new Date().toISOString(), status: "failed", result: "", read: false })}\n`);
    writeFileSync(join(dir, "inbox.jsonl"), `${JSON.stringify({ id: "e9", itemId: "i9", task: "Internal", at: new Date().toISOString(), status: "failed", result: "", read: false, internal: true })}\n`, { flag: "a" });
    const stuck = readTodos([]);
    expect(stuck.map((row) => row.id)).toEqual(["inbox:e1"]);
    expect(tickTodo("inbox:e1", [])).toBe(true);
    expect(readTodos([])).toEqual([]);
    expect(upcomingAgenda()).toEqual([]);
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
      expect(added.todos.map((row: { text: string }) => row.text)).toEqual(["Call the bank"]);
      await post({ op: "add", text: "Book flights" });
      const id = added.todos[0].id as string;
      const ticked = await (await post({ op: "tick", id })).json();
      expect(ticked.todos.map((row: { text: string }) => row.text)).toEqual(["Book flights"]);

      const gone = await post({ op: "tick", id: "job:gone" });
      expect(gone.status).toBe(404);
      expect((await gone.json()).todos).toHaveLength(1);
      expect((await post({ op: "untick", id })).status).toBe(400);

      closeDb();
      expect(readTodos([]).map((row) => row.text)).toEqual(["Book flights"]);
    } finally {
      await server.close();
    }
  });
});
