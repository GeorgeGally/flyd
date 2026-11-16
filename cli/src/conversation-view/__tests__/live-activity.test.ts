import { describe, expect, it } from "vitest";
import { liveActivityOf } from "../live-activity.js";
import { jobsFrom, type Job } from "../jobs.js";
import type { ShowItem, ShowScreen } from "../show.js";

const NOW = Date.parse("2026-11-06T12:00:00.000Z");
const screen = (over: Partial<ShowScreen> = {}): ShowScreen => ({ title: "", summary: "", items: [], counts: {}, live: true, read: "2026-11-06T11:59:00.000Z", ...over } as ShowScreen);
const item = (kind: ShowItem["kind"], id: string, over: Partial<ShowItem> = {}): ShowItem => ({ id: `${kind}:${id}`, kind, headline: id, why: "", task: id, ...over });
/** The feed as the server builds it: from the board Core placed for the same screen. */
const liveOf = (show: ShowScreen, extra: Job[] = []) => liveActivityOf(show, [...jobsFrom({ show, now: NOW }).jobs, ...extra], NOW);
const job = (over: Partial<Job>): Job => ({ id: "j", group: "moving", state: "Working", title: "Work", project: "", at: "2026-11-06T11:00:00.000Z", next: "", owner: "", ask: "", because: "", shots: [], links: [], files: [], threads: [], digest: null, ...over });

describe("liveActivityOf", () => {
  it("counts exactly the work the board has under way, with when it started", () => {
    const live = liveOf(screen({ underway: [
      item("live", "a", { detail: "Rebuilding the header", started: "2026-11-06T11:40:00.000Z", at: "2026-11-06T11:50:00.000Z" }),
      item("live", "b", { detail: "Under way", at: "2026-11-06T11:45:00.000Z" }),
    ] }));
    expect(live.counts.running).toBe(2);
    expect(live.running.find((row) => row.id === "live:a")).toMatchObject({ state: "running", since: "2026-11-06T11:40:00.000Z", status: "Working" });
  });

  it("says each row in the board's words, never the worker's own status line", () => {
    const live = liveActivityOf(screen(), [job({ id: "run:1", title: "Header rework", next: "I'm rebuilding the header now." })], NOW);
    expect(live.running[0]).toMatchObject({ title: "Header rework", step: "I'm rebuilding the header now." });
  });

  it("keeps a paused worker visible without counting it as running or as needing him", () => {
    const live = liveOf(screen({ held: [item("waiting", "p", { status: "paused" })] }));
    expect(live.counts).toEqual({ running: 0, needs: 0 });
    expect(live.paused.map((row) => row.status)).toEqual(["Paused"]);
  });

  it("orders what needs him newest first, folds what is older than a week, and still counts it", () => {
    const live = liveActivityOf(screen(), [
      job({ id: "new", group: "needs", state: "Needs you", at: "2026-11-06T10:00:00.000Z" }),
      job({ id: "mid", group: "needs", state: "Needs you", at: "2026-11-05T10:00:00.000Z" }),
      job({ id: "old", group: "needs", state: "Needs you", at: "2026-10-01T10:00:00.000Z" }),
    ], NOW);
    expect(live.counts.needs).toBe(3);
    expect(live.needs.map((row) => row.id)).toEqual(["new", "mid"]);
    expect(live.older.map((row) => row.id)).toEqual(["old"]);
  });

  it("says finished work is ready, and a finished report is a report, in the one set of state words", () => {
    const live = liveActivityOf(screen(), [job({ id: "lab", group: "needs", state: "Ready for you" }), job({ id: "scout", group: "needs", state: "Report ready" })], NOW);
    expect(live.needs.map((row) => [row.id, row.state, row.status])).toEqual(expect.arrayContaining([["lab", "ready", "Ready for you"], ["scout", "ready", "Report ready"]]));
  });

  it("shows pictures of what landed first, newest first", () => {
    const live = liveActivityOf(screen(), [
      job({ id: "a", group: "done", state: "Done", at: "2026-11-06T10:00:00.000Z" }),
      job({ id: "b", group: "done", state: "Done", at: "2026-11-06T09:00:00.000Z", shots: [{ src: "/b.png", label: "b" }] }),
    ], NOW);
    expect(live.landed.map((row) => row.id)).toEqual(["a", "b"]);
    expect(live.landed.find((row) => row.id === "b")!.shots).toHaveLength(1);
  });

  it("never reads as calm before the fleet has been read", () => {
    expect(liveActivityOf(screen({ read: undefined }), [], NOW).known).toBe(false);
  });
});
