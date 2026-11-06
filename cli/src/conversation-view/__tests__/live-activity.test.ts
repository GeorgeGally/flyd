import { describe, expect, it } from "vitest";
import { liveActivityOf } from "../live-activity.js";
import type { Job } from "../jobs.js";
import type { SemanticObject } from "../semantic.js";
import type { ShowItem, ShowScreen } from "../show.js";

const NOW = Date.parse("2026-11-06T12:00:00.000Z");
const screen = (over: Partial<ShowScreen> = {}): ShowScreen => ({ title: "", summary: "", items: [], counts: {}, live: true, read: "2026-11-06T11:59:00.000Z", ...over } as ShowScreen);
const item = (kind: ShowItem["kind"], id: string, over: Partial<ShowItem> = {}): ShowItem => ({ id: `${kind}:${id}`, kind, headline: id, why: "", task: id, ...over });
const object = (id: string, over: Partial<SemanticObject> = {}): SemanticObject => ({
  id, kind: "activity", lifecycle: "active", subject: id, summary: "", evidence: [], actions: [], source: { showItemId: `show:${id}` }, ...over,
} as SemanticObject);

describe("liveActivityOf", () => {
  it("counts exactly the workers the screen lists, with where each stands and when it started", () => {
    const live = liveActivityOf(screen({ underway: [
      item("live", "a", { detail: "Rebuilding the header", started: "2026-11-06T11:40:00.000Z", shots: [{ src: "/s.png", label: "s" }] }),
      item("live", "b", { detail: "A worker is on it" }),
    ] }), undefined, NOW);
    expect(live.counts.running).toBe(2);
    expect(live.running[0]).toMatchObject({ state: "running", step: "Rebuilding the header", since: "2026-11-06T11:40:00.000Z" });
    expect(live.running[1]!.step).toBeUndefined();
  });

  it("keeps a paused worker visible without counting it as running or as needing him", () => {
    const live = liveActivityOf(screen({ held: [item("waiting", "p", { status: "paused" }), item("waiting", "gone", { status: "needs attention" })] }), undefined, NOW);
    expect(live.counts).toEqual({ running: 0, needs: 0 });
    expect(live.paused.map((row) => row.task)).toEqual(["p"]);
  });

  it("orders what needs him newest first, folds what is older than a week, and still counts it", () => {
    const calls = [
      item("call", "old", { at: "2026-10-22" }),
      item("call", "new", { at: "2026-11-06T08:30:00.000Z" }),
      item("call", "mid", { at: "2026-11-03" }),
    ];
    const live = liveActivityOf(screen({ calls }), undefined, NOW);
    expect(live.needs.map((row) => row.task)).toEqual(["new", "mid"]);
    expect(live.older.map((row) => row.task)).toEqual(["old"]);
    expect(live.counts.needs).toBe(3);
  });

  it("says finished work is ready, and a finished report is a report", () => {
    const live = liveActivityOf(screen({ ready: [
      item("ready", "lab", { at: "2026-11-06T08:00:00.000Z", status: "done" }),
      item("ready", "scout", { at: "2026-11-06T07:00:00.000Z", status: "report available", headline: "Earlier report: The findings" }),
    ] }), undefined, NOW);
    expect(live.needs.map((row) => [row.state, row.status, row.title])).toEqual([
      ["ready", "Ready to land", "lab"],
      ["ready", "Report ready", "The findings"],
    ]);
  });

  it("reads Core's one list of what needs him, a fleet card behind a row when it has one", () => {
    const call = item("call", "pick", { at: "2026-11-05T08:00:00.000Z", decision: { task: "pick", question: "Which?", choices: ["A", "B"] } });
    const lab = object("lab:7", { subject: "Five versions", kind: "activity", lifecycle: "interrupted", createdAt: "2026-11-06T08:00:00.000Z", evidence: [{ kind: "image", ref: "/lab.png", label: "v1" }] });
    const focus = object("task:pick", { kind: "decision", source: { showItemId: "call:pick", task: "pick" } });
    const live = liveActivityOf(screen({ calls: [call], focus, needs: [lab] }), undefined, NOW);
    expect(live.needs.map((row) => row.title)).toEqual(["pick", "Five versions"]);
    expect(live.needs[1]!.shots).toEqual([{ src: "/lab.png", label: "v1" }]);
    expect(live.needs[0]!.decision?.choices).toEqual(["A", "B"]);
    expect(live.counts.needs).toBe(2);
  });

  it("counts an open run the board shows beside the fleet's workers, so the two never disagree", () => {
    const jobs = [
      { id: "live:live-a", group: "working", title: "a", project: "", at: "", next: "", shots: [], links: [] },
      { id: "writer", group: "working", title: "Draft the note", project: "", at: "2026-11-06T11:00:00.000Z", next: "Reading sources", shots: [], links: [] },
      { id: "idle", group: "waiting", title: "Idle", project: "", at: "", next: "", shots: [], links: [] },
    ] as unknown as Job[];
    const live = liveActivityOf(screen({ underway: [item("live", "a")] }), jobs, NOW);
    expect(live.running.map((row) => row.title)).toEqual(["a", "Draft the note"]);
    expect(live.counts.running).toBe(2);
  });

  it("keeps a run's start distinct from its latest update", () => {
    const board = [{ id: "run:1", group: "working", title: "Work", project: "", at: "2026-11-06T11:59:00Z", started: "2026-11-06T10:00:00Z", next: "", shots: [], links: [] }] as Job[];
    expect(liveActivityOf(screen(), board, NOW).running[0]).toMatchObject({ at: "2026-11-06T11:59:00Z", since: "2026-11-06T10:00:00Z" });
  });

  it("shows pictures of what landed first, one row per task, newest first", () => {
    const shots = [{ src: "/x.png", label: "x" }];
    const live = liveActivityOf(screen({
      done: [item("landed", "one", { at: "2026-11-06T09:00:00.000Z", shots }), item("landed", "plain", { at: "2026-11-06T11:00:00.000Z" })],
      landedWeek: [item("landed", "one", { id: "landed:landed-week-one", at: "2026-11-06T09:00:00.000Z" }), item("landed", "two", { at: "2026-11-05T09:00:00.000Z", shots })],
    }), undefined, NOW);
    expect(live.landed.map((row) => row.task)).toEqual(["plain", "one", "two"]);
  });

  it("never reads as calm before the fleet has been read", () => {
    expect(liveActivityOf(screen({ read: undefined }), undefined, NOW).known).toBe(false);
    expect(liveActivityOf(screen(), undefined, NOW).known).toBe(true);
  });
});
