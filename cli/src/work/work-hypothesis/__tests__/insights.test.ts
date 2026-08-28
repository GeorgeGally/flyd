import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { useWorkIndexPath, resetWorkIndexPath, closeDb } from "../../database.js";
import {
  derivePresentInsights,
  formatPresentModelText,
  isConcreteMove,
} from "../insights.js";
import type { WorkThread } from "../types.js";

const NOW = new Date("2026-08-12T12:00:00.000Z");

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

    const text = formatPresentModelText(insights, { preferCoreHome: true });
    expect(text).toBe("Uncommitted work sitting on Jobs without recent commits. Jobs still hasn't moved.");
    expect(text).not.toMatch(/Today:|Active:|Watch:|Moved:|Finished:|Insights:/);
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

    const text = formatPresentModelText(insights, { preferCoreHome: true });
    expect(text).toBe("Next: Dead Internet Radio.");
    expect(text).not.toMatch(/\(DIR\)/);
    expect(text).not.toMatch(/Today:|Active:|Moved:/);
  });

  it("puts a dated commitment first in the spoken brief", async () => {
    const { replaceConfirmedTodos } = await import("../confirmed-todos.js");
    replaceConfirmedTodos([
      "Get GNM sponsor outreach moving by 5 September",
      "Apply for jobs and fix resume",
      "Add DIR to portfolio",
    ]);

    const insights = derivePresentInsights([], [], { preferCoreHome: true, now: NOW });
    expect(insights.nextDueAt).toBe("2026-09-05");
    expect(insights.nextTodo).toMatch(/GNM sponsor/i);
    expect(formatPresentModelText(insights)).toMatch(/due 5 September/);
  });
});
