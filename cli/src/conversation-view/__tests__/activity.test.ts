import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kindVisual } from "../cards.js";
import { ActivityReader, activityFromJob, activityFromLogLine, activityFromRecords, activityRecordPath, composeActivity, MAX_RECENT, recordActivity } from "../activity.js";

const NOW = Date.parse("2026-10-17T12:00:00.000Z");
const minutesAgo = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();

describe("activity from the agenda log", () => {
  it("says each kind of background work in plain words", () => {
    expect(activityFromLogLine("2026-10-17T03:58:43.648Z self-review: reviewed, 10 reviewed, 0 short")).toMatchObject({ title: "Read back its own answers", line: "10 recent answers checked; all held up." });
    expect(activityFromLogLine("2026-10-17T03:53:36.321Z self-review: reviewed, 4 reviewed, 1 short")?.line).toBe("4 recent answers checked; 1 to do better on.");
    expect(activityFromLogLine("2026-10-17T04:02:32.232Z scout: watch: 0 must-know")).toMatchObject({ kind: "news", title: "Watched the news for you", line: "Nothing urgent." });
    expect(activityFromLogLine("2026-10-17T04:02:32.232Z scout: watch: 2 must-know")?.line).toBe("2 stories you should not miss.");
    expect(activityFromLogLine("2026-10-17T03:33:20.579Z council: 3 turns, 1 captures, 1 advisories")).toMatchObject({ kind: "memory", title: "Kept its memory of you up to date", line: "Read 3 conversations and 1 note; 1 thing worth your attention." });
    expect(activityFromLogLine("2026-10-16T22:44:03.159Z scout: edition: 12 items, 1 sources failed")?.line).toBe("12 stories from your sources.");
    expect(activityFromLogLine("2026-10-17T01:00:00.000Z investigator: done")?.title).toBe("Filled gaps in what it knows about you");
    expect(activityFromLogLine("2026-10-16T09:35:20.960Z self-improve: dispatched")?.title).toBe("Started fixing something it noticed in itself");
  });

  it("names a scheduled task by its heading, not its whole instruction", () => {
    const ran = activityFromLogLine("2026-10-16T00:05:59.649Z ok ade9cf81 Morning brief: today's calendar and reminders (flag anything overdue), what changed");
    expect(ran).toMatchObject({ kind: "routine", title: "Ran a scheduled task", line: "Morning brief." });
    expect(activityFromLogLine("2026-10-14T10:00:43.036Z ok 48c689b4 DIR nudge for George — one line, warm and specific")?.line).toBe("DIR nudge for you.");
    expect(activityFromLogLine("2026-10-14T10:00:43.036Z failed 48c689b4 Weekly review: look back")?.title).toBe("A scheduled task didn't finish");
  });

  it("drops the lines that only report upkeep or errors", () => {
    for (const line of [
      "2026-10-17T03:00:00.000Z self-improve: awaiting_george",
      "2026-10-17T03:00:00.000Z scout: locked",
      "2026-10-17T03:00:00.000Z council: 0 turns, 0 captures, 0 advisories",
      "2026-10-17T03:00:00.000Z self-review: reviewed, 0 reviewed, 0 short",
      "2026-10-17T03:00:00.000Z crew: mum3xutl-rework-the-morning-b failed",
      "Cannot find package 'marked' imported from /Users/x",
      "",
    ]) expect(activityFromLogLine(line)).toBeNull();
  });
});

describe("activity from jobs", () => {
  const job = { id: "9423ba28", startedAt: minutesAgo(10), updatedAt: minutesAgo(2), contract: { task: "Own the Canva import end to end. Put two decks into Canva." } };

  it("shows a running job as under way, with its first sentence", () => {
    const made = activityFromJob({ ...job, status: "running" }, NOW)!;
    expect(made.live).toBe(true);
    expect(made.item).toMatchObject({ id: "job:9423ba28", title: "Working on a job for you", line: "Own the Canva import end to end.", at: minutesAgo(10) });
  });

  it("does not call a job under way when whatever ran it is long gone", () => {
    expect(activityFromJob({ ...job, status: "running", startedAt: minutesAgo(300), updatedAt: minutesAgo(200) }, NOW)).toBeNull();
  });

  it("says how a finished job ended", () => {
    expect(activityFromJob({ ...job, status: "ok", result: "Done. The file is ready." }, NOW)!.item).toMatchObject({ title: "Finished a job for you", line: "Done." });
    expect(activityFromJob({ ...job, status: "short" }, NOW)!.item.title).toBe("Finished a job, with something left open");
    expect(activityFromJob({ ...job, status: "failed" }, NOW)!.item.title).toBe("A job couldn't be finished");
    expect(activityFromJob({ ...job, status: "interrupted" }, NOW)!.item.title).toBe("Stopped a job before it finished");
  });

  it("chips a finished job as done and an unfinished one as held up, never under way", () => {
    expect(kindVisual(activityFromJob({ ...job, status: "running" }, NOW)!.item.kind).word).toBe("Under way");
    expect(kindVisual(activityFromJob({ ...job, status: "ok" }, NOW)!.item.kind).word).toBe("Done");
    expect(kindVisual(activityFromJob({ ...job, status: "short" }, NOW)!.item.kind).word).toBe("Done");
    expect(kindVisual(activityFromJob({ ...job, status: "failed" }, NOW)!.item.kind).word).toBe("Held up");
    expect(kindVisual(activityFromJob({ ...job, status: "interrupted" }, NOW)!.item.kind).word).toBe("Held up");
  });

  it("leaves out detail that names the machinery behind the work", () => {
    const made = activityFromJob({ ...job, status: "ok", contract: { task: "Ask firstmate to land the branch fm/flyd-x." }, result: "Crewmates finished." }, NOW)!;
    expect(made.item.line).toBeUndefined();
    expect(made.item.title).toBe("Finished a job for you");
  });
});

describe("activity records", () => {
  it("holds a keyed now-record as under way until a done-record with the same key ends it", () => {
    const records = [{ key: "watch", kind: "watching", title: "Checking on your staff", state: "now", at: minutesAgo(5) }];
    expect(activityFromRecords(records, NOW).now.map((item) => item.title)).toEqual(["Checking on your staff"]);
    const ended = [...records, { key: "watch", kind: "watching", title: "Checked on your staff", line: "Everyone is on track", state: "done", at: minutesAgo(1) }];
    const out = activityFromRecords(ended, NOW);
    expect(out.now).toEqual([]);
    expect(out.done).toEqual([{ id: "record:watch", kind: "watching", title: "Checked on your staff", line: "Everyone is on track.", at: minutesAgo(1) }]);
  });

  it("lets a now-record nobody ended go stale", () => {
    expect(activityFromRecords([{ key: "x", kind: "watching", title: "Checking", state: "now", at: minutesAgo(45) }], NOW).now).toEqual([]);
  });

  it("keeps one-offs as separate decisions and ignores malformed lines", () => {
    const out = activityFromRecords([
      { kind: "decided", title: "Chose the faster option for your staff", at: minutesAgo(30) },
      { kind: "decided", title: "Told your staff to carry on", at: minutesAgo(20) },
      { kind: "nonsense", title: "Odd", at: minutesAgo(1) },
      { kind: "decided", at: minutesAgo(1) },
      { kind: "decided", title: "No time" },
      null,
    ], NOW);
    expect(out.done.map((item) => item.title)).toEqual(["Chose the faster option for your staff", "Told your staff to carry on"]);
  });
});

describe("composeActivity", () => {
  it("shows repeating upkeep once, newest first, and keeps under-way work apart", () => {
    const panel = composeActivity({
      log: [
        "2026-10-17T03:53:36.321Z self-review: reviewed, 4 reviewed, 1 short",
        "2026-10-17T03:58:43.648Z self-review: reviewed, 10 reviewed, 0 short",
        "2026-10-17T04:02:32.232Z scout: watch: 0 must-know",
        "2026-10-17T04:02:33.232Z self-improve: awaiting_george",
      ],
      jobs: [{ id: "a1", status: "running", startedAt: minutesAgo(3), updatedAt: minutesAgo(1), contract: { task: "Tidy the notes." } }],
      advice: [],
      records: [{ kind: "decided", title: "Answered your staff's question", at: "2026-10-17T11:00:00.000Z" }],
    }, NOW);
    expect(panel.now.map((item) => item.title)).toEqual(["Working on a job for you"]);
    expect(panel.recent.map((item) => item.title)).toEqual(["Answered your staff's question", "Watched the news for you", "Read back its own answers"]);
    expect(panel.recent[2]!.line).toBe("10 recent answers checked; all held up.");
  });

  it("drops what is older than a week and caps the list", () => {
    const records = Array.from({ length: 30 }, (_, index) => ({ kind: "noted", title: `Note ${index}`, at: minutesAgo(index + 1) }));
    const old = { kind: "noted", title: "Ancient", at: minutesAgo(60 * 24 * 8) };
    const panel = composeActivity({ log: [], jobs: [], advice: [], records: [...records, old] }, NOW);
    expect(panel.recent).toHaveLength(14);
    expect(panel.recent[0]!.title).toBe("Note 0");
    expect(panel.recent.some((item) => item.title === "Ancient")).toBe(false);
  });

  it("turns the council's advice into a calm card that does not say who had it", () => {
    const panel = composeActivity({ log: [], jobs: [], advice: [{ id: "9a8c7377", at: minutesAgo(30), text: "GNM's Christmas site kept absorbing days. Smallest step: name a sponsor." }], records: [] }, NOW);
    expect(panel.recent).toEqual([{ id: "thought:9a8c7377", kind: "noted", title: "Noticed something about your projects", line: "GNM's Christmas site kept absorbing days.", at: minutesAgo(30) }]);
  });

  it("counts a bar a day for the week, oldest first, today last", () => {
    const panel = composeActivity({
      log: [],
      jobs: [],
      advice: [],
      records: [
        { kind: "noted", title: "Today", at: minutesAgo(5) },
        { kind: "noted", title: "Also today", at: minutesAgo(90) },
        { kind: "noted", title: "Yesterday", at: "2026-10-16T09:00:00.000Z" },
      ],
    }, NOW);
    expect(panel.week).toHaveLength(7);
    expect(panel.week.map((day) => day.day)).toEqual(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]);
    expect(panel.week.map((day) => day.count)).toEqual([0, 0, 0, 0, 0, 1, 2]);
  });

  it("counts the whole week in its bars, not only the cards the list keeps", () => {
    const records = [
      ...Array.from({ length: 20 }, (_, index) => ({ kind: "noted", title: `Today ${index}`, at: minutesAgo(index + 1) })),
      ...Array.from({ length: 5 }, (_, index) => ({ kind: "noted", title: `Yesterday ${index}`, at: minutesAgo(24 * 60 + index) })),
    ];
    const panel = composeActivity({ log: [], jobs: [], advice: [], records }, NOW);
    expect(panel.recent).toHaveLength(MAX_RECENT);
    expect(panel.week.slice(-2).map((day) => day.count)).toEqual([5, 20]);
  });
});

describe("the record file and reader", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "flyd-activity-")); });
  afterEach(() => { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); });

  it("writes a record anyone can append, and reads it back into the panel", () => {
    recordActivity({ key: "watch", kind: "watching", title: "Checking on your staff", state: "now" }, dir, new Date(NOW - 60_000));
    const reader = new ActivityReader({ dir, now: () => NOW });
    expect(reader.current().now).toMatchObject([{ id: "record:watch", title: "Checking on your staff" }]);
    expect(activityRecordPath(dir)).toBe(join(dir, "activity", "records.jsonl"));
  });

  it("reads the agenda log, jobs and advice already on disk", () => {
    mkdirSync(join(dir, "logs"), { recursive: true });
    mkdirSync(join(dir, "jobs"), { recursive: true });
    mkdirSync(join(dir, "council"), { recursive: true });
    writeFileSync(join(dir, "logs", "agenda.log"), "2026-10-17T11:30:00.000Z scout: watch: 0 must-know\n");
    writeFileSync(join(dir, "jobs", "a1.json"), JSON.stringify({ id: "a1", status: "ok", startedAt: minutesAgo(40), updatedAt: minutesAgo(35), contract: { task: "Tidy the notes." }, result: "Tidied." }));
    writeFileSync(join(dir, "jobs", "bad.json"), "{not json");
    const panel = new ActivityReader({ dir, now: () => NOW }).current();
    expect(panel.recent.map((item) => item.title)).toEqual(["Watched the news for you", "Finished a job for you"]);
  });

  it("tells a listener when the panel changes, and polls only while someone listens", () => {
    vi.useFakeTimers();
    const reader = new ActivityReader({ dir, now: () => NOW, pollMs: 1000 });
    const changed = vi.fn();
    const stop = reader.onChange(changed);
    vi.advanceTimersByTime(1000);
    expect(changed).not.toHaveBeenCalled();
    recordActivity({ kind: "decided", title: "Answered a question for you" }, dir, new Date(NOW - 1000));
    vi.advanceTimersByTime(1000);
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
    recordActivity({ kind: "decided", title: "Answered another" }, dir, new Date(NOW - 500));
    vi.advanceTimersByTime(5000);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("never throws when the record cannot be written", () => {
    writeFileSync(join(dir, "activity"), "a file where the folder should be");
    expect(() => recordActivity({ kind: "noted", title: "x" }, dir)).not.toThrow();
  });
});
