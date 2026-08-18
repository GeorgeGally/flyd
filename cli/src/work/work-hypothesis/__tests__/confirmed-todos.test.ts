import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { useWorkIndexPath, resetWorkIndexPath, closeDb } from "../../database.js";
import {
  handleConfirmedTodoUtterance,
  isTodoListQuestion,
  parseTodoCompletion,
  parseTodoItems,
  listOpenConfirmedTodos,
  demotePresentThread,
  isBareTodoList,
} from "../confirmed-todos.js";
import { writePresentModel } from "../store.js";
import { presentModelReply } from "../../../runtime/conversation-responder.js";
import { recallMemoryForTodoItems } from "../../../runtime/todo-memory-recall.js";

describe("confirmed todos", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-todos-"));
    useWorkIndexPath(join(dir, "work-index.sqlite"));
  });

  afterEach(() => {
    closeDb();
    resetWorkIndexPath();
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not invent a to-do list from empty state", () => {
    const answer = handleConfirmedTodoUtterance("whats my to do list?");
    expect(answer?.reply).toMatch(/No confirmed to-dos/i);
  });

  it("does not treat denials as to-do list questions", () => {
    expect(isTodoListQuestion("no i gave u my to do")).toBe(false);
    expect(isTodoListQuestion("whats on my todo")).toBe(true);
  });

  it("appends natural-language add requests and marks them for recall", () => {
    handleConfirmedTodoUtterance("- dead internet radio");
    const reply = handleConfirmedTodoUtterance("add Bridgestone and Linkedin bio");
    expect(reply?.reply).toMatch(/Added 2 items/);
    expect(reply?.recallFor).toEqual(["Bridgestone", "Linkedin bio"]);
    expect(listOpenConfirmedTodos().map((t) => t.description)).toEqual([
      "dead internet radio",
      "Bridgestone",
      "Linkedin bio",
    ]);
  });

  it("does not treat memory imports as to-do adds", () => {
    const reply = handleConfirmedTodoUtterance(
      "add these to memories. this is extracted memories from chatgpt:\n[date] - Preferred name: George.\n[date] - Role: Entrepreneur.",
    );
    expect(reply).toBeNull();
  });

  it("records bare bullet lists and single-bullet appends", () => {
    const multi = handleConfirmedTodoUtterance(`- dead internet radio
- post about sea silo
- add videos to sea silo`);
    expect(multi?.reply).toMatch(/Recorded 3 confirmed/);
    expect(multi?.recallFor).toHaveLength(3);
    expect(listOpenConfirmedTodos().map((t) => t.description)).toEqual([
      "dead internet radio",
      "post about sea silo",
      "add videos to sea silo",
    ]);

    const added = handleConfirmedTodoUtterance("- GNM3 - good neighbours market");
    expect(added?.reply).toMatch(/Added “GNM3 - good neighbours market”/);
    expect(listOpenConfirmedTodos()).toHaveLength(4);
  });

  it("recovers todos from prior conversation when user says they already gave them", () => {
    mkdirSync(join(dir, "conversations"), { recursive: true });
    writeFileSync(
      join(dir, "conversations", "past.json"),
      JSON.stringify({
        version: 1,
        id: "past",
        exchanges: [
          { user: "- dead internet radio", assistant: "ok", recordedAt: "2026-01-01" },
          { user: "- post about sea silo", assistant: "ok", recordedAt: "2026-01-01" },
          { user: "- apply 2 jobs", assistant: "ok", recordedAt: "2026-01-01" },
        ],
      }),
      "utf8",
    );

    const reply = handleConfirmedTodoUtterance("no i gave u my to do", [], { flydDir: dir });
    expect(reply?.reply).toMatch(/Found 3 item/);
    expect(listOpenConfirmedTodos().map((t) => t.description)).toEqual([
      "dead internet radio",
      "post about sea silo",
      "apply 2 jobs",
    ]);
  });

  it("marks complete and persists removal from open list", () => {
    handleConfirmedTodoUtterance(`actually its this:
- robots
- cleanx`);
    const reply = handleConfirmedTodoUtterance("robots is complete");
    expect(reply?.reply).toMatch(/Marked complete and persisted: robots/i);
    expect(listOpenConfirmedTodos().map((t) => t.description)).toEqual(["cleanx"]);
  });

  it("parses natural completion phrasing without clause fragments", () => {
    expect(parseTodoCompletion("robots are done")).toBe("robots");
    expect(parseTodoCompletion("i already said robots are complete")).toBe("robots");
    expect(parseTodoCompletion("what is the weather")).toBeNull();
  });

  it("demotes Present Model threads on completion even without a confirmed todo", () => {
    const now = new Date().toISOString();
    const thread = (name: string, root: string) => ({
      name,
      root,
      isDirty: false,
      hasTasks: false,
      isForeground: false,
      signals: [] as string[],
      demoted: false,
      lastCommitAt: now,
    });
    writePresentModel({
      hypothesisText: "CleanX, Good Neighbours, and Robots look active",
      primaryThreads: [
        thread("CleanX", "/tmp/cleanx"),
        thread("Good Neighbours", "/tmp/gn"),
        thread("Robots", "/tmp/robots"),
      ],
      secondaryThreads: [],
      confidence: "medium",
      uncertainty: [],
      evidenceRefs: [],
      demotions: [],
      revisedAt: now,
      generatedAt: now,
      fromCache: false,
    });
    const reply = handleConfirmedTodoUtterance("robots are done");
    expect(reply?.reply).toMatch(/Demoted “Robots”/i);
    expect(demotePresentThread("robots", "again")).toBeNull();
  });

  it("does not hard-refuse unknown completions", () => {
    expect(handleConfirmedTodoUtterance("widgets are done")).toBeNull();
  });

  it("does not treat Present Model questions as to-do list questions", () => {
    expect(isTodoListQuestion("what am I working on?")).toBe(false);
    expect(
      presentModelReply("whats my to do list?", "  CleanX looks active"),
    ).toBeNull();
  });

  it("parses messy correction lists", () => {
    expect(isBareTodoList(`- dead internet radio
- post about sea silo`)).toBe(true);
    expect(
      parseTodoItems(`actually its this: - dead internet radio
- post about sea silo
- apply 2 jobs`),
    ).toEqual(["dead internet radio", "post about sea silo", "apply 2 jobs"]);
  });

  it("recalls memory for newly added todo items", async () => {
    const note = await recallMemoryForTodoItems(["Bridgestone"], async () => ({
      verdict: "partial",
      matches: [
        {
          id: "1",
          path: "raw/bridgestone.md",
          excerpt: "Bridgestone interview next week about mobility platform role.",
          stale: false,
          authority: "user_observation",
        },
      ],
    }));
    expect(note).toMatch(/Memory recall/);
    expect(note).toMatch(/Bridgestone interview/);
  });
});
