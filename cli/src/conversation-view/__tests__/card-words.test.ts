import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cardSource, cardWordsFromModel, fallbackWords, readCardWords, scheduleCardWords } from "../card-words.js";
import { jobsFrom } from "../jobs.js";
import type { Project } from "../../council/projects.js";
import type { ShowScreen } from "../show.js";

const NOW = Date.parse("2026-11-12T12:00:00.000Z");
const RAW = "005 already satisfied: Edit removed from mode pill in 6d98921 (on easel main)";
const PLAIN = { title: "Easel: the Edit button is gone", body: "View now does editing, so you can try it straight away." };

const easel: Project = {
  id: "easel", name: "Easel", what: "", kind: "product", status: "active", now: "", next: "", people: [], repos: ["/code/easel"], updated: "2026-11-12",
};
const screen = { title: "", summary: "", items: [], counts: {}, live: false, read: "2026-11-12T00:00:00.000Z" } as ShowScreen;
const readyShow = {
  ...screen,
  ready: [{ id: "ready:easel-005", kind: "ready", headline: "Easel", why: "", task: "easel-005", project: "/code/easel", detail: RAW, at: "2026-11-12T11:00:00.000Z" }],
} as unknown as ShowScreen;

function pathFor(): string {
  return join(mkdtempSync(join(tmpdir(), "flyd-card-words-")), "card-words.json");
}

afterEach(() => { vi.restoreAllMocks(); });

describe("board cards from staff status lines", () => {
  it("never shows the raw line or 'Ready to land in product': a card waits on its plain words with a generic line", () => {
    const board = jobsFrom({ projects: [easel], show: readyShow, cardWords: new Map(), now: NOW });
    const card = board.jobs.find((job) => job.id === "easel")!;
    expect(card).toMatchObject({ title: "Easel: an update is ready", ask: "Open to see details.", state: "Ready for you", project: "" });
    const shown = JSON.stringify([card.title, card.state, card.project, card.next, card.ask]);
    expect(shown).not.toMatch(/satisfied|6d98921|main|land|product/i);
    // The rewrite is asked for once, with the raw line and the project.
    expect(board.untranslated).toEqual([expect.objectContaining({ project: "Easel", line: RAW })]);
    // The raw line is nowhere on the job, its Timeline included: the Timeline says the same plain words.
    expect(JSON.stringify(card)).not.toContain("6d98921");
    expect(JSON.stringify(card)).not.toMatch(/satisfied/i);
    expect(card.threads.map((thread) => thread.title)).toContain("Easel: an update is ready");
  });

  it("shows the stored plain words once the model has said them, and asks for nothing more", () => {
    const first = jobsFrom({ projects: [easel], show: readyShow, cardWords: new Map(), now: NOW });
    const words = new Map([[first.untranslated[0]!.key, PLAIN]]);
    const board = jobsFrom({ projects: [easel], show: readyShow, cardWords: words, now: NOW });
    const card = board.jobs.find((job) => job.id === "easel")!;
    expect(card).toMatchObject({ title: PLAIN.title, ask: PLAIN.body });
    expect(card.threads).toContainEqual(expect.objectContaining({ title: PLAIN.title, full: PLAIN.body }));
    expect(JSON.stringify(card)).not.toContain(RAW);
    expect(board.untranslated).toEqual([]);
  });

  it("keeps a ready item's own yes/no question with its buttons instead of rewriting it", () => {
    const show = {
      ...screen,
      ready: [{ id: "ready:easel-try", kind: "ready", headline: "Easel", why: "", task: "easel-try", project: "/code/easel", detail: "Say yes to try the crop tool now, or tell me to wait.", at: "2026-11-12T11:00:00.000Z" }],
    } as unknown as ShowScreen;
    const board = jobsFrom({ projects: [easel], show, cardWords: new Map(), now: NOW });
    const card = board.jobs.find((job) => job.id === "easel")!;
    expect(card.choices?.length).toBeGreaterThan(0);
    expect(card.ask).toContain("crop tool");
    expect(board.untranslated).toEqual([]);
  });

  it("leaves a decision's own question alone", () => {
    const show = {
      ...screen,
      calls: [{ id: "call:pick", kind: "call", headline: "Which hero image?", why: "", task: "pick", project: "/code/easel", detail: "Pick A or B",
        decision: { task: "pick", question: "Which hero image?", choices: ["A", "B"] } }],
    } as unknown as ShowScreen;
    const board = jobsFrom({ projects: [easel], show, cardWords: new Map(), now: NOW });
    expect(board.jobs.find((job) => job.id === "easel")).toMatchObject({ title: "Easel", ask: "Which hero image?" });
    expect(board.untranslated).toEqual([]);
  });

  it("keeps a ready run's question with its answers instead of rewriting it", () => {
    const question = "Say merge to ship the crop tool, or tell me to wait";
    const board = jobsFrom({
      projects: [easel],
      runs: [{ id: "run-q", status: "completed", project: "Easel", outcome: "Crop images on the canvas", question, owner: "FirstMate", updatedAt: "2026-11-12T11:30:00.000Z", artifacts: [], work: "ready" }],
      cardWords: new Map(),
      now: NOW,
    });
    const card = board.jobs.find((job) => job.ask.includes("crop tool"))!;
    expect(card.ask).not.toBe("Open to see details.");
    expect(board.untranslated).toEqual([]);
  });

  it("keeps a ready fleet item's decision question instead of rewriting it", () => {
    const show = {
      ...screen,
      ready: [{ id: "ready:easel-crop", kind: "ready", headline: "Easel", why: "", task: "easel-crop", project: "/code/easel", detail: RAW, at: "2026-11-12T11:00:00.000Z",
        decision: { task: "easel-crop", question: "Try the crop tool now?", choices: ["Yes", "Later"] } }],
    } as unknown as ShowScreen;
    const board = jobsFrom({ projects: [easel], show, cardWords: new Map(), now: NOW });
    expect(board.jobs.find((job) => job.id === "easel")).toMatchObject({ ask: "Try the crop tool now?" });
    expect(board.untranslated).toEqual([]);
  });

  it("says a working card is under way while its plain words are pending", () => {
    const board = jobsFrom({
      projects: [easel],
      runs: [{ id: "run-w", status: "running", project: "Easel", outcome: "Wiring 005 into mode-pill.tsx", owner: "FirstMate", updatedAt: "2026-11-12T11:59:00.000Z", artifacts: [], work: "moving" }],
      cardWords: new Map(),
      now: NOW,
    });
    const card = board.jobs.find((job) => job.group === "working")!;
    expect(card).toMatchObject({ title: "Easel: work is under way", next: "Open to see details." });
  });

  it("rewrites a finished run's card too, with its brief as the raw line", () => {
    const board = jobsFrom({
      projects: [easel],
      runs: [{ id: "run-1", status: "completed", project: "Easel", outcome: "Crop images on the canvas", owner: "FirstMate", updatedAt: "2026-11-12T11:00:00.000Z", artifacts: [], work: "landed" }],
      cardWords: new Map(),
      now: NOW,
    });
    expect(board.jobs.find((job) => job.id === "easel")).toMatchObject({ title: "Easel: finished", next: "Open to see details." });
    expect(board.untranslated.map((source) => source.line)).toEqual(["Crop images on the canvas"]);
    const card = board.jobs.find((job) => job.id === "easel")!;
    expect(card.threads).toHaveLength(1);
    expect(card.threads[0]).toMatchObject({ id: "run-1", title: "Easel: finished", full: "Open to see details." });
  });
});

describe("card words", () => {
  it("accepts a plain reading and refuses one that still talks like a developer", () => {
    expect(cardWordsFromModel("```json\n" + JSON.stringify(PLAIN) + "\n```")).toEqual(PLAIN);
    expect(cardWordsFromModel(JSON.stringify({ title: "Easel: done", body: "Removed in 6d98921." }))).toBeNull();
    expect(cardWordsFromModel(JSON.stringify({ title: "Easel: ready to land", body: "It is on main." }))).toBeNull();
    expect(cardWordsFromModel(JSON.stringify({ title: "Easel: note 005 satisfied", body: "Nothing to do." }))).toBeNull();
    expect(cardWordsFromModel(JSON.stringify({ title: "Easel: tidied", body: "I changed mode-pill.tsx." }))).toBeNull();
    expect(cardWordsFromModel("not json")).toBeNull();
  });

  it("falls back to a generic plain line, never the raw one", () => {
    expect(fallbackWords("easel", "needs")).toEqual({ title: "Easel: an update is ready", body: "Open to see details." });
    expect(fallbackWords("easel", "working")).toEqual({ title: "Easel: work is under way", body: "Open to see details." });
    expect(fallbackWords("easel", "waiting")).toEqual({ title: "Easel: waiting for now", body: "Open to see details." });
    expect(fallbackWords("easel", "done")).toEqual({ title: "Easel: finished", body: "Open to see details." });
    expect(fallbackWords("", "needs")).toEqual({ title: "An update is ready", body: "Open to see details." });
  });

  it("asks the model once per raw line, with the line and project, and caches the reading on disk", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const path = pathFor();
    const source = cardSource("Easel", "Ready for you", "Easel", RAW);
    const ask = vi.fn(async (_prompt: string) => JSON.stringify(PLAIN));
    const onStored = vi.fn();
    await scheduleCardWords([source, source], { path, ask, onStored });
    await scheduleCardWords([source], { path, ask, onStored });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]![0]).toContain(RAW);
    expect(ask.mock.calls[0]![0]).toContain("Easel");
    expect(onStored).toHaveBeenCalledTimes(1);
    expect(readCardWords(path).get(source.key)).toEqual(PLAIN);
  });

  it("stores a failure so the card stays generic, and asks again only after a while", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const path = pathFor();
    const source = cardSource("Easel", "Ready for you", "Easel", RAW);
    let now = NOW;
    const failing = vi.fn(async () => { throw new Error("model unavailable"); });
    await scheduleCardWords([source], { path, ask: failing, now: () => now });
    await scheduleCardWords([source], { path, ask: failing, now: () => now });
    expect(failing).toHaveBeenCalledTimes(1);
    expect(readCardWords(path).has(source.key)).toBe(false);
    const board = jobsFrom({ projects: [easel], show: readyShow, cardWords: readCardWords(path), now: NOW });
    expect(board.jobs.find((job) => job.id === "easel")!.ask).toBe("Open to see details.");

    now += 31 * 60_000;
    const working = vi.fn(async () => JSON.stringify(PLAIN));
    await scheduleCardWords([source], { path, ask: working, now: () => now });
    expect(working).toHaveBeenCalledTimes(1);
    expect(readCardWords(path).get(source.key)).toEqual(PLAIN);
  });
});
