import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { useWorkIndexPath, resetWorkIndexPath, closeDb, getDb } from "../../database.js";
import {
  derivePresentInsights,
  formatPresentModelText,
  isConcreteMove,
} from "../insights.js";
import type { WorkThread } from "../types.js";

const NOW = new Date(2026, 7, 12, 12, 0, 0, 0); // Wednesday 12 August 2026, local noon
const TODAY_PREFIX = "Today is Wednesday 12 August 2026.";

function thread(partial: Partial<WorkThread> & Pick<WorkThread, "name" | "root">): WorkThread {
  return {
    isDirty: false,
    hasTasks: false,
    isForeground: false,
    signals: [],
    demoted: false,
    ...partial,
  };
}

describe("present insights", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-insights-"));
    useWorkIndexPath(join(dir, "work-index.sqlite"));
  });

  afterEach(() => {
    closeDb();
    resetWorkIndexPath();
    rmSync(dir, { recursive: true, force: true });
  });

  it("suppresses non-concrete moves that only restate the project", () => {
    expect(isConcreteMove("CleanX", "CleanX")).toBe(false);
    expect(isConcreteMove("CleanX", "fix(credits): Gate unfollows")).toBe(true);
  });

  it("keeps workstreams compact and latest moves event-specific", () => {
    const primary = [
      thread({
        name: "Flyd",
        root: "/tmp/flyd",
        lastCommitAt: "2026-08-12T11:00:00.000Z",
        latestSubject: "feat: present model insights",
        signals: ["commit:x"],
      }),
      thread({
        name: "CleanX",
        root: "/tmp/cleanx",
        lastCommitAt: "2026-08-12T10:00:00.000Z",
        latestSubject: "fix(credits): Gate unfollows at selection",
        signals: ["commit:x"],
      }),
    ];
    const secondary = [
      thread({
        name: "Robots",
        root: "/tmp/robots",
        demoted: true,
        lastCommitAt: "2026-08-11T10:00:00.000Z",
        latestSubject: "docs",
      }),
      thread({
        name: "Jobs",
        root: "/tmp/jobs",
        lastCommitAt: "2026-07-01T10:00:00.000Z",
        latestSubject: "old work",
        hasTasks: true,
        isDirty: true,
      }),
    ];

    const insights = derivePresentInsights(primary, secondary, {
      preferCoreHome: true,
      now: NOW,
    });

    expect(insights.workstreams).toEqual(["CleanX", "Jobs"]);
    expect(insights.workstreams).not.toContain("Robots");
    expect(insights.workstreams).not.toContain("Flyd");
    expect(insights.finishedProjects).toContain("Robots");
    expect(insights.latestMoves.map((m) => m.name)).toEqual(["Flyd", "CleanX"]);
    expect(insights.latestMoves.map((m) => m.name)).not.toContain("Jobs");
    expect(insights.stalledThreads).toContain("Jobs");
    expect(insights.tensions.some((t) => /Attention split|Uncommitted/i.test(t))).toBe(true);

    const text = formatPresentModelText(insights, { preferCoreHome: true, now: NOW });
    expect(text).toBe(
      `${TODAY_PREFIX} Uncommitted work sitting on Jobs without recent commits. Jobs still hasn't moved.`,
    );
    expect(text).not.toMatch(/Active:|Watch:|Moved:|Finished:|Insights:/);
    expect(text).not.toMatch(/Flyd/);
  });

  it("promotes known project aliases from confirmed to-dos into workstreams", async () => {
    const { replaceConfirmedTodos } = await import("../confirmed-todos.js");
    replaceConfirmedTodos(["dead internet radio", "post about sea silo"]);

    const insights = derivePresentInsights(
      [
        thread({
          name: "CleanX",
          root: "/tmp/cleanx",
          lastCommitAt: "2026-08-12T10:00:00.000Z",
          latestSubject: "fix(credits): Gate unfollows at selection",
        }),
      ],
      [],
      { preferCoreHome: true, now: NOW },
    );

    expect(insights.workstreams).toContain("CleanX");
    expect(insights.workstreams).toContain("Dead Internet Radio (DIR)");
    expect(insights.workstreams).not.toContain("post about sea silo");
    expect(insights.nextTodo).toBe("Dead Internet Radio (DIR)");
    expect(insights.nextLeverage).toMatch(/dead internet radio/i);

    const text = formatPresentModelText(insights, { preferCoreHome: true, now: NOW });
    expect(text).toBe(`${TODAY_PREFIX} Next: Dead Internet Radio.`);
    expect(text).not.toMatch(/\(DIR\)/);
    expect(text).not.toMatch(/Active:|Moved:/);
  });

  it("does not let an old undated to-do become the opening brief's next action", async () => {
    const { replaceConfirmedTodos } = await import("../confirmed-todos.js");
    replaceConfirmedTodos(["Apply for jobs and fix resume", "Add DIR to portfolio"]);
    getDb().prepare("UPDATE confirmed_todos SET updated_at = ? WHERE status = 'open'").run("2026-06-01T12:00:00.000Z");

    const insights = derivePresentInsights([], [], { preferCoreHome: true, now: NOW });

    expect(insights.workstreams).toEqual([]);
    expect(insights.nextTodo).toBeUndefined();
    expect(formatPresentModelText(insights, { now: NOW })).toBe(`${TODAY_PREFIX} Nothing urgent on the board.`);
  });

  it("puts a dated commitment first in the spoken brief", async () => {
    const { replaceConfirmedTodos } = await import("../confirmed-todos.js");
    replaceConfirmedTodos([
      "Get GNM sponsor outreach moving 2026-09-05",
      "Apply for jobs and fix resume",
      "Add DIR to portfolio",
    ]);

    const insights = derivePresentInsights([], [], { preferCoreHome: true, now: NOW });
    expect(insights.nextDueAt).toBe("2026-09-05");
    expect(insights.nextTodo).toMatch(/GNM sponsor/i);
    expect(insights.nextLeverage).toMatch(/due 5 September/);
    expect(formatPresentModelText(insights, { now: NOW })).toMatch(/is due 5 September/);
  });

  it("reports a passed deadline as overdue instead of upcoming", async () => {
    const { replaceConfirmedTodos } = await import("../confirmed-todos.js");
    replaceConfirmedTodos(["Get visitors to GNM event 2026-09-13"]);

    const now = new Date(2026, 8, 15, 12, 0, 0, 0); // 15 September 2026
    const insights = derivePresentInsights([], [], { preferCoreHome: true, now });

    expect(insights.nextTodo).toMatch(/Get visitors to GNM event/);
    expect(insights.nextLeverage).toMatch(/was due 13 September, 2 days overdue/);

    const text = formatPresentModelText(insights, { now });
    expect(text).toContain("was due 13 September (2 days overdue)");
    expect(text).not.toMatch(/is due 13 September/);
  });

  it("stops naming a date that expired, and never calls it due", async () => {
    const { replaceConfirmedTodos } = await import("../confirmed-todos.js");
    replaceConfirmedTodos([
      "Get visitors to GNM event 2026-09-05",
      "Get GNM sponsor outreach moving 2026-09-20",
    ]);

    const now = new Date(2026, 8, 15, 12, 0, 0, 0); // 15 September 2026
    const insights = derivePresentInsights([], [], { preferCoreHome: true, now });

    expect(insights.nextTodo).toMatch(/sponsor outreach/i);
    expect(insights.nextLeverage).toMatch(/due 20 September/);

    const text = formatPresentModelText(insights, { now });
    expect(text).not.toContain("Get visitors to GNM event");
    expect(text).not.toMatch(/overdue/);
  });

  it("names a deadline that falls today without a date", async () => {
    const { replaceConfirmedTodos } = await import("../confirmed-todos.js");
    replaceConfirmedTodos(["Get GNM sponsor outreach 2026-09-15"]);

    const now = new Date(2026, 8, 15, 12, 0, 0, 0);
    const insights = derivePresentInsights([], [], { preferCoreHome: true, now });
    const text = formatPresentModelText(insights, { now });
    expect(text).toContain("is due today");
  });

  it("states today's date first, so relative counts can be checked", async () => {
    const { replaceConfirmedTodos } = await import("../confirmed-todos.js");
    replaceConfirmedTodos(["Get visitors to GNM event 2026-09-13"]);

    const now = new Date(2026, 8, 15, 12, 0, 0, 0); // 15 September 2026
    const insights = derivePresentInsights([], [], { preferCoreHome: true, now });
    const text = formatPresentModelText(insights, { now });

    expect(text.startsWith("Today is Tuesday 15 September 2026.")).toBe(true);
    expect(text).toContain("was due 13 September (2 days overdue)");
  });

  it("keeps the day line on an empty board", () => {
    const insights = derivePresentInsights([], [], { preferCoreHome: true, now: NOW });
    const text = formatPresentModelText(insights, { now: NOW });
    expect(text).toBe(`${TODAY_PREFIX} Nothing urgent on the board.`);
  });
});
