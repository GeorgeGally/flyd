import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatLocalDateTime } from "../agenda.js";
import { agendaTaskMessage } from "../agenda-runner.js";
import { carriesUntoldNews, composeMorning, isMorningBriefTask, markNewsTold, UNTOLD_NEWS } from "../session-briefing.js";
import type { Edition } from "../../council/scout.js";

// One morning: every surface (session opening, prepared morning, daily brief,
// the weekday agenda brief that reaches him as a notification) renders the
// lines composeMorning gathers, and today's news is in them until he is told.

const FULL_PROFILE = "## About me\n- x\n## People\n- x\n## Routines\n- x\n## Goals\n- x\n";

describe("the morning brief agenda job", () => {
  let dir: string;
  let previous: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-morning-"));
    previous = process.env.FLYD_SCOUT_DIR;
    process.env.FLYD_SCOUT_DIR = dir;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.FLYD_SCOUT_DIR;
    else process.env.FLYD_SCOUT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });

  function writeEdition(now: Date): void {
    const edition: Edition = { date: formatLocalDateTime(now).slice(0, 10), generatedAt: now.toISOString(), topics: ["Hardware Hacking"], items: [
      { n: 1, title: "DOOM on a $30 clamp meter", url: "https://hackaday.test/doom", source: "Hackaday", topic: "Hardware Hacking", why: "any screen becomes a console", kind: "relevant" },
    ] };
    writeFileSync(join(dir, "edition-latest.json"), JSON.stringify(edition));
  }

  it("recognises George's morning brief, however he worded the rest", () => {
    expect(isMorningBriefTask("Morning brief: today's calendar and reminders (flag anything overdue), what changed in my active repos since yesterday")).toBe(true);
    expect(isMorningBriefTask("morning briefing please")).toBe(true);
    expect(isMorningBriefTask("DIR nudge for George — one line")).toBe(false);
  });

  it("writes the brief from the composed morning and always carries the untold news", async () => {
    const now = new Date();
    writeEdition(now);
    const morning = await composeMorning({ now: () => now, peek: true, loadReminders: async () => [], loadCalendar: async () => ["10:00 Call with Sam"], readProfile: () => FULL_PROFILE });
    expect(carriesUntoldNews(morning)).toBe(true);
    const message = agendaTaskMessage("Morning brief: today's news, calendar and reminders", { repeat: "weekdays" }, morning);
    expect(message).toContain("His morning, already gathered");
    expect(message).toContain(`| ${UNTOLD_NEWS}`);
    expect(message).toContain("DOOM on a $30 clamp meter — any screen becomes a console https://hackaday.test/doom");
    expect(message).toContain("| Calendar today: 10:00 Call with Sam");
    expect(message).toContain("Include today's news");
    // Gathering it told him nothing yet.
    expect(existsSync(join(dir, "briefed-date"))).toBe(false);
  });

  it("leaves other agenda tasks as they were", () => {
    const message = agendaTaskMessage("Check whether the PR merged", { repeat: "none" });
    expect(message).not.toContain("His morning");
    expect(message).toContain("at most 6 short lines");
  });

  it("once delivered, the next session hears the news as already told", async () => {
    const now = new Date();
    writeEdition(now);
    await markNewsTold(now);
    expect(readFileSync(join(dir, "briefed-date"), "utf8")).toBe(now.toISOString());
    const later = new Date(now.getTime() + 60_000);
    const lines = await composeMorning({ now: () => later, peek: true, loadReminders: async () => [], loadCalendar: async () => [], readProfile: () => FULL_PROFILE });
    expect(carriesUntoldNews(lines)).toBe(false);
    expect(lines.some((line) => line.startsWith("News he already heard"))).toBe(true);
  });
});
