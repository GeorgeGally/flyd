import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { configureCoachMemoryDirectory, addGoal } from "../coach-memory.js";
import { configureOutcomeJournalDirectory } from "../../work-intelligence/outcome-journal.js";
import { startBriefScheduler, stopBriefScheduler, runAndPersistBrief } from "../brief-scheduler.js";
import { readLatestBrief } from "../daily-brief.js";

describe("brief scheduler", () => {
  let root: string;
  let prevFlydDir: string | undefined;

  beforeEach(() => {
    root = join(tmpdir(), `flyd-brief-sched-${randomUUID()}`);
    prevFlydDir = process.env.FLYD_DIR;
    process.env.FLYD_DIR = root;
    mkdirSync(root, { recursive: true });
    configureCoachMemoryDirectory(join(root, "coach"));
    configureOutcomeJournalDirectory(join(root, "overlay", "founder-journal"));
  });

  afterEach(() => {
    stopBriefScheduler();
    if (prevFlydDir === undefined) delete process.env.FLYD_DIR;
    else process.env.FLYD_DIR = prevFlydDir;
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  it("composes and persists a brief with goals on a single run", async () => {
    addGoal("Ship CleanX", "user");
    const result = await runAndPersistBrief({ situation: null });
    expect(result.ok).toBe(true);
    const latest = readLatestBrief();
    expect(latest).not.toBeNull();
    expect(latest!.body).toContain("Ship CleanX");
  });

  it("starts and runs immediately, and stop clears the interval", async () => {
    addGoal("Grow the business", "user");
    const stop = startBriefScheduler({ intervalMs: 60_000, deps: { situation: null } });
    expect(stop).toBe(stopBriefScheduler);
    // first tick is synchronous-ish via the immediate run; give it a beat
    await new Promise((r) => setTimeout(r, 20));
    const latest = readLatestBrief();
    expect(latest?.body).toContain("Grow the business");
    stopBriefScheduler();
  });
});
