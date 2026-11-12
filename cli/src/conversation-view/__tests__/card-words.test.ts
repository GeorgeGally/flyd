import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cardSource, cardWordsFromModel, fallbackWords, MAX_TRIES, readCardWords, scheduleCardWords } from "../card-words.js";
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
    expect(card).toMatchObject({ title: "Easel: ready for you to look over", ask: "This is finished. Have a look when you can and tell me if anything should change.", state: "Ready for you", project: "" });
    const shown = JSON.stringify([card.title, card.state, card.project, card.next, card.ask]);
    expect(shown).not.toMatch(/satisfied|6d98921|main|land|product/i);
    // The rewrite is asked for once, with the raw line and the project.
    expect(board.untranslated).toEqual([expect.objectContaining({ project: "Easel", line: RAW })]);
    // The raw line is nowhere on the job, its Timeline included: the Timeline says the same plain words.
    expect(JSON.stringify(card)).not.toContain("6d98921");
    expect(JSON.stringify(card)).not.toMatch(/satisfied/i);
    expect(card.threads.map((thread) => thread.title)).toContain("Easel: ready for you to look over");
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
    expect(card.title).toBe("Easel: ready for you to look over");
  });

  it("leaves a decision's own question alone", () => {
    const show = {
      ...screen,
      calls: [{ id: "call:pick", kind: "call", headline: "Which hero image?", why: "", task: "pick", project: "/code/easel", detail: "Pick A or B",
        decision: { task: "pick", question: "Which hero image?", choices: ["A", "B"] } }],
    } as unknown as ShowScreen;
    const board = jobsFrom({ projects: [easel], show, cardWords: new Map(), now: NOW });
    expect(board.jobs.find((job) => job.id === "easel")).toMatchObject({ title: "Easel: needs your answer", ask: "Which hero image?", choices: ["A", "B"] });
    expect(board.untranslated.map((source) => source.line)).toEqual(["Pick A or B"]);
  });

  it("says a ready run's question asked in developer words plainly, and keeps its answers", () => {
    const question = "Say merge to ship the crop tool, or tell me to wait";
    const board = jobsFrom({
      projects: [easel],
      runs: [{ id: "run-q", status: "completed", project: "Easel", outcome: "Crop images on the canvas", question, owner: "FirstMate", updatedAt: "2026-11-12T11:30:00.000Z", artifacts: [], work: "ready" }],
      cardWords: new Map(),
      now: NOW,
    });
    const card = board.jobs.find((job) => job.group === "needs")!;
    expect(card).toMatchObject({ title: "Easel: ready for you to look over", ask: "This is finished. Have a look when you can and tell me if anything should change." });
    expect(card.choices?.length).toBeGreaterThan(0);
    expect(board.untranslated.map((source) => source.line)).toEqual([question]);
    const said = jobsFrom({
      projects: [easel],
      runs: [{ id: "run-q", status: "completed", project: "Easel", outcome: "Crop images on the canvas", question, owner: "FirstMate", updatedAt: "2026-11-12T11:30:00.000Z", artifacts: [], work: "ready" }],
      cardWords: new Map([[board.untranslated[0]!.key, PLAIN]]),
      now: NOW,
    }).jobs.find((job) => job.group === "needs")!;
    expect(said).toMatchObject({ title: PLAIN.title, ask: PLAIN.body, choices: card.choices });
  });

  it("keeps a ready fleet item's decision question instead of rewriting it", () => {
    const show = {
      ...screen,
      ready: [{ id: "ready:easel-crop", kind: "ready", headline: "Easel", why: "", task: "easel-crop", project: "/code/easel", detail: RAW, at: "2026-11-12T11:00:00.000Z",
        decision: { task: "easel-crop", question: "Try the crop tool now?", choices: ["Yes", "Later"] } }],
    } as unknown as ShowScreen;
    const board = jobsFrom({ projects: [easel], show, cardWords: new Map(), now: NOW });
    expect(board.jobs.find((job) => job.id === "easel")).toMatchObject({ title: "Easel: ready for you to look over", ask: "Try the crop tool now?", choices: ["Yes", "Later"] });
    expect(board.untranslated.map((source) => source.line)).toEqual([RAW]);
  });

  it("says a working card is under way while its plain words are pending", () => {
    const board = jobsFrom({
      projects: [easel],
      runs: [{ id: "run-w", status: "running", project: "Easel", outcome: "Wiring 005 into mode-pill.tsx", owner: "FirstMate", updatedAt: "2026-11-12T11:59:00.000Z", artifacts: [], work: "moving" }],
      cardWords: new Map(),
      now: NOW,
    });
    const card = board.jobs.find((job) => job.group === "working")!;
    expect(card).toMatchObject({ title: "Easel: work is under way", next: "I'm working on this now." });
  });

  it("says every run's Timeline entry plainly, not only the lead's", () => {
    const older = "Wiring 005 into mode-pill.tsx";
    const newer = "Crop images on the canvas";
    const board = jobsFrom({
      projects: [easel],
      runs: [
        { id: "run-a", status: "completed", project: "Easel", outcome: newer, owner: "FirstMate", updatedAt: "2026-11-12T11:00:00.000Z", artifacts: [], work: "landed" },
        { id: "run-b", status: "completed", project: "Easel", outcome: older, owner: "FirstMate", updatedAt: "2026-11-12T10:00:00.000Z", artifacts: [], work: "landed" },
      ],
      cardWords: new Map(),
      now: NOW,
    });
    const card = board.jobs.find((job) => job.id === "easel")!;
    expect(card.threads).toHaveLength(2);
    const shown = JSON.stringify(card.threads);
    expect(shown).not.toContain("mode-pill");
    expect(shown).not.toContain("005");
    expect(shown).not.toContain("Crop images");
    expect(board.untranslated.map((source) => source.line).sort()).toEqual([newer, older].sort());
  });

  it("rewrites a finished run's card too, with its brief as the raw line", () => {
    const board = jobsFrom({
      projects: [easel],
      runs: [{ id: "run-1", status: "completed", project: "Easel", outcome: "Crop images on the canvas", owner: "FirstMate", updatedAt: "2026-11-12T11:00:00.000Z", artifacts: [], work: "landed" }],
      cardWords: new Map(),
      now: NOW,
    });
    expect(board.jobs.find((job) => job.id === "easel")).toMatchObject({ title: "Easel: finished", next: "This is done." });
    expect(board.untranslated.map((source) => source.line)).toEqual(["Crop images on the canvas"]);
    const card = board.jobs.find((job) => job.id === "easel")!;
    expect(card.threads).toHaveLength(1);
    expect(card.threads[0]).toMatchObject({ id: "run-1", title: "Easel: finished" });
    expect(card.threads[0]!.full).toBeUndefined();
  });

  it("queues only Timeline entries that are shown: not runs past the first eight, nor long-finished cards", () => {
    const runs = Array.from({ length: 10 }, (_, index) => ({
      id: `run-${index}`, status: "completed", project: "Easel", outcome: `Brief number ${index}`, owner: "FirstMate",
      updatedAt: new Date(NOW - (index + 1) * 60_000).toISOString(), artifacts: [], work: "landed" as const,
    }));
    const old = { id: "run-old", status: "completed", project: "Garden", outcome: "Old garden brief", owner: "FirstMate", updatedAt: "2026-09-01T00:00:00.000Z", artifacts: [], work: "landed" as const };
    const board = jobsFrom({ projects: [easel], runs: [...runs, old], cardWords: new Map(), now: NOW });
    const lines = board.untranslated.map((source) => source.line);
    expect(lines).toHaveLength(8);
    expect(lines).not.toContain("Brief number 8");
    expect(lines).not.toContain("Brief number 9");
    expect(lines).not.toContain("Old garden brief");
  });

  it("names an unregistered repo's card after the repo, so two such cards are told apart", () => {
    const show = {
      ...screen,
      ready: [
        { id: "ready:garden", kind: "ready", headline: "Garden beds", why: "", task: "garden-1", project: "/code/garden", detail: "007 satisfied in abc1234f", at: "2026-11-12T11:00:00.000Z" },
        { id: "ready:notes", kind: "ready", headline: "Notes sync", why: "", task: "notes-1", project: "/code/notes", detail: "008 satisfied in def5678a", at: "2026-11-12T11:00:00.000Z" },
      ],
    } as unknown as ShowScreen;
    const board = jobsFrom({ projects: [], show, cardWords: new Map(), now: NOW });
    expect(board.jobs.map((job) => job.title).sort()).toEqual(["Garden: ready for you to look over", "Notes: ready for you to look over"]);
    expect(board.untranslated.map((source) => source.project).sort()).toEqual(["garden", "notes"]);
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
    expect(cardWordsFromModel(JSON.stringify({ title: "Easel: the landing page has a new hero image", body: "Open the main menu to see it." }))).not.toBeNull();
    expect(cardWordsFromModel(JSON.stringify({ title: "Easel: crop tool is ready to land", body: "Try it now." }))).toBeNull();
    expect(cardWordsFromModel(JSON.stringify({ title: "Easel: crop tool", body: "It is now on main." }))).toBeNull();
    for (const plain of ["Head to the gallery to try it.", "The master bedroom photo is brighter.", "Go back to the main menu to see it.", "You can merge the two photos now.", "Item 3 on the list is done."]) {
      expect(cardWordsFromModel(JSON.stringify({ title: "Easel: a small change", body: plain }))).not.toBeNull();
    }
    for (const developer of ["It is ready to land.", "It is now on main.", "This was note 005.", "Done in 6d98921.", "It was merged into the release."]) {
      expect(cardWordsFromModel(JSON.stringify({ title: "Easel: a small change", body: developer }))).toBeNull();
    }
  });

  it("falls back to a plain line for its state, never the raw one, and says what a card needing him needs", () => {
    expect(fallbackWords("easel", "needs")).toEqual({ title: "Easel: needs your answer", body: "I need your answer on this before it can go any further." });
    expect(fallbackWords("easel", "needs", "Ready for you")).toEqual({ title: "Easel: ready for you to look over", body: "This is finished. Have a look when you can and tell me if anything should change." });
    expect(fallbackWords("easel", "working")).toEqual({ title: "Easel: work is under way", body: "I'm working on this now." });
    expect(fallbackWords("easel", "waiting")).toEqual({ title: "Easel: waiting for now", body: "Nothing needs you on this yet." });
    expect(fallbackWords("easel", "waiting", "Blocked")).toEqual({ title: "Easel: held up for now", body: "This is held up. I'll tell you if it needs you." });
    expect(fallbackWords("easel", "done")).toEqual({ title: "Easel: finished", body: "This is done." });
    expect(fallbackWords("", "needs")).toEqual({ title: "Needs your answer", body: "I need your answer on this before it can go any further." });
    for (const group of ["needs", "working", "waiting", "done"] as const) {
      for (const state of ["", "Ready for you", "Report ready", "Blocked", "Paused", "Queued"]) {
        expect(JSON.stringify(fallbackWords("easel", group, state))).not.toMatch(/an update is ready|Open to see details/i);
      }
    }
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
    expect(board.jobs.find((job) => job.id === "easel")!.ask).toBe("This is finished. Have a look when you can and tell me if anything should change.");

    now += 31 * 60_000;
    const working = vi.fn(async () => JSON.stringify(PLAIN));
    await scheduleCardWords([source], { path, ask: working, now: () => now });
    expect(working).toHaveBeenCalledTimes(1);
    expect(readCardWords(path).get(source.key)).toEqual(PLAIN);
  });
});

describe("what the review found still reaching him", () => {
  const needsRun = { id: "run-41", status: "needs_decision", project: "Easel", owner: "FirstMate", updatedAt: "2026-11-12T11:30:00.000Z", artifacts: [], work: "needs_you" as const };

  it("never shows a decision run's raw line as its ask when it has no question of its own", () => {
    const outcome = "005 blocked: needs PR #41 rebased onto main before deploy";
    const board = jobsFrom({ projects: [easel], runs: [{ ...needsRun, outcome }], cardWords: new Map(), now: NOW });
    const card = board.jobs.find((job) => job.group === "needs")!;
    expect(card.ask).toBe("I need your answer on this before it can go any further.");
    expect(JSON.stringify([card.title, card.ask, card.next, card.threads])).not.toMatch(/PR|#41|rebase|main|deploy|005/);
    expect(board.untranslated.map((source) => source.line)).toContain(outcome);
    const said = { title: "Easel: one call before it goes live", body: "I need you to say whether the new crop tool can go live." };
    const plain = jobsFrom({ projects: [easel], runs: [{ ...needsRun, outcome }], cardWords: new Map([[board.untranslated[0]!.key, said]]), now: NOW });
    expect(plain.jobs.find((job) => job.group === "needs")).toMatchObject({ title: said.title, ask: said.body });
  });

  it("says a decision asked in developer words plainly, and keeps one asked in plain words", () => {
    const jargon = jobsFrom({ projects: [easel], runs: [{ ...needsRun, outcome: "Crop images on the canvas", question: "Should I rebase onto main first?" }], cardWords: new Map(), now: NOW });
    expect(jargon.jobs.find((job) => job.group === "needs")!.ask).not.toMatch(/rebase|main/);
    expect(jargon.untranslated.map((source) => source.line)).toContain("Should I rebase onto main first?");
    const plain = jobsFrom({ projects: [easel], runs: [{ ...needsRun, outcome: "Crop images on the canvas", question: "Which price should go live?" }], cardWords: new Map(), now: NOW });
    expect(plain.jobs.find((job) => job.group === "needs")!.ask).toBe("Which price should go live?");
  });

  it("never titles a decision card 'an update is ready' or asks 'Open to see details'", () => {
    const show = { ...screen, calls: [{ id: "call:pierre", kind: "call", headline: "Pierre lab", why: "", task: "pierre", project: "/code/pierre", detail: "Pick V1 or V2",
      decision: { task: "pierre", question: "Which Pierre version?", choices: ["V1", "V2"] } }] } as unknown as ShowScreen;
    const board = jobsFrom({ projects: [], show, cardWords: new Map(), now: NOW });
    const card = board.jobs.find((job) => job.group === "needs")!;
    expect(card.title).toBe("Pierre: needs your answer");
    expect(JSON.stringify(card)).not.toMatch(/an update is ready|Open to see details/i);
  });

  it("refuses a reading that merges, checks, builds, deploys, ships or names a worker", () => {
    expect(cardWordsFromModel(JSON.stringify({ title: "Flyd: ready to merge", body: "All checks passed; the worker finished the build." }))).toBeNull();
    for (const developer of ["The tests pass now.", "It shipped this morning.", "I deployed it.", "The build is green.", "It is merged."]) {
      expect(cardWordsFromModel(JSON.stringify({ title: "Easel: a small change", body: developer }))).toBeNull();
    }
    expect(cardWordsFromModel(JSON.stringify({ title: "Easel: photos combined", body: "You can merge the two photos now." }))).not.toBeNull();
  });

  it("stops asking the model for a line it keeps failing on", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const path = pathFor();
    const source = cardSource("Easel", "Ready for you", "Easel", RAW);
    let now = NOW;
    const always = vi.fn(async () => JSON.stringify({ title: "Easel: PR ready", body: "Merge the PR." }));
    for (let round = 0; round < 6; round += 1) {
      await scheduleCardWords([source], { path, ask: always, now: () => now });
      now += 31 * 60_000;
    }
    expect(always).toHaveBeenCalledTimes(MAX_TRIES);
  });

  it("never sends a board placeholder to the model, and asks once for a card and its Timeline entry", () => {
    const board = jobsFrom({
      projects: [easel],
      runs: [
        { id: "run-empty", status: "running", project: "Easel", outcome: "", owner: "FirstMate", updatedAt: "2026-11-12T11:59:00.000Z", artifacts: [], work: "moving" },
        { id: "run-q", status: "queued", project: "Easel", outcome: "", owner: "FirstMate", updatedAt: "2026-11-12T11:58:00.000Z", artifacts: [] },
        { id: "run-done", status: "completed", project: "Easel", outcome: "Crop images on the canvas", owner: "FirstMate", updatedAt: "2026-11-12T11:00:00.000Z", artifacts: [], work: "landed" },
      ],
      show: { ...screen, underway: [{ id: "live:easel", kind: "live", headline: "Easel", why: "", task: "easel", project: "/code/easel", detail: "Under way", at: "2026-11-12T11:59:30.000Z" }] } as unknown as ShowScreen,
      cardWords: new Map(),
      now: NOW,
    });
    const lines = board.untranslated.map((source) => source.line);
    for (const placeholder of ["Under way", "Queued", "Landed", "Not finished yet"]) expect(lines).not.toContain(placeholder);
    expect(new Set(board.untranslated.map((source) => source.key)).size).toBe(board.untranslated.length);
    expect(lines.filter((line) => line === "Crop images on the canvas")).toHaveLength(1);
  });

  it("asks once for a run's card and its Timeline entry: both are said from the same line", () => {
    const board = jobsFrom({ projects: [easel], runs: [{ ...needsRun, outcome: "Crop images on the canvas", question: "Should I rebase onto main first?" }], cardWords: new Map(), now: NOW });
    expect(board.untranslated).toHaveLength(1);
    const words = new Map([[board.untranslated[0]!.key, { title: "Easel: one question first", body: "Do you want the crop tool tidied up before you see it?" }]]);
    const said = jobsFrom({ projects: [easel], runs: [{ ...needsRun, outcome: "Crop images on the canvas", question: "Should I rebase onto main first?" }], cardWords: words, now: NOW });
    expect(said.untranslated).toEqual([]);
    expect(said.jobs.find((job) => job.group === "needs")!.threads[0]).toMatchObject({ title: "Easel: one question first" });
  });
});
