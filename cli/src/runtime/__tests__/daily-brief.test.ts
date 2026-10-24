import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { configureCoachMemoryDirectory, addGoal, addPattern } from "../coach-memory.js";
import { composeDailyBrief, persistDailyBrief, readLatestBrief, dailyBriefFile } from "../daily-brief.js";
import { formatLocalDateTime } from "../agenda.js";
import type { Edition } from "../../council/scout.js";

describe("daily brief", () => {
  let root: string;
  let prevFlydDir: string | undefined;
  let prevScoutDir: string | undefined;

  beforeEach(() => {
    root = join(tmpdir(), `flyd-brief-${randomUUID()}`);
    prevFlydDir = process.env.FLYD_DIR;
    prevScoutDir = process.env.FLYD_SCOUT_DIR;
    process.env.FLYD_DIR = root;
    process.env.FLYD_SCOUT_DIR = join(root, "scout");
    mkdirSync(join(root, "scout"), { recursive: true });
    configureCoachMemoryDirectory(join(root, "coach"));
  });

  afterEach(() => {
    if (prevFlydDir === undefined) delete process.env.FLYD_DIR;
    else process.env.FLYD_DIR = prevFlydDir;
    if (prevScoutDir === undefined) delete process.env.FLYD_SCOUT_DIR;
    else process.env.FLYD_SCOUT_DIR = prevScoutDir;
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  it("is the composed morning: goals, next action, patterns and today's news, without marking the news told", async () => {
    addGoal("Ship CleanX", "user");
    addPattern("Defers hard calls", "inferred", "retrospective");
    const now = new Date();
    const edition: Edition = { date: formatLocalDateTime(now).slice(0, 10), generatedAt: now.toISOString(), topics: ["Creative Coding"], items: [
      { n: 1, title: "Flow fields from migration data", url: "https://ex.test/flow", source: "r/generative", topic: "Creative Coding", why: "data as a brush", kind: "relevant" },
    ] };
    writeFileSync(join(root, "scout", "edition-latest.json"), JSON.stringify(edition));

    const brief = await composeDailyBrief({
      now: () => now,
      situation: { project: "GeorgeGally/flyd", branch: "main", head: "abc", dirty: false, changedFiles: 0, latestCommit: null, outcome: "Ship CleanX", status: "ready", nextAction: "Run the release tests" },
    });
    const text = brief.lines.join("\n");
    expect(brief.heading).toContain("Daily brief");
    expect(text).toContain("Goals: Ship CleanX");
    expect(text).toContain("Next: Run the release tests.");
    expect(text).toContain("Patterns I'm watching: Defers hard calls");
    expect(text).toContain("Today's news, not yet told him");
    expect(text).toContain("Flow fields from migration data — data as a brush https://ex.test/flow");
    expect(existsSync(join(root, "scout", "briefed-date"))).toBe(false);
  });

  it("notes a blocked task when there is no next action", async () => {
    const brief = await composeDailyBrief({
      situation: { project: "x", branch: "main", head: "a", dirty: false, changedFiles: 0, latestCommit: null, outcome: "Stuck", status: "blocked", nextAction: null },
    });
    expect(brief.lines.join(" ")).toContain("blocked");
  });

  it("persists a brief and reads it back while fresh", () => {
    const file = persistDailyBrief({ heading: "Daily brief — now", lines: ["Next: Ship the release.", "Today's news, not yet told him (/more N, /less N):"] });
    expect(dailyBriefFile()).toBe(file);
    const latest = readLatestBrief();
    expect(latest!.body).toContain("Daily brief");
    expect(latest!.body).toContain("Next: Ship the release.");
    expect(readFileSync(file, "utf8")).toContain("Today's news");
  });
});
