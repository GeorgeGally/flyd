import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { configureCoachMemoryDirectory, addGoal } from "../coach-memory.js";
import { configureOutcomeJournalDirectory } from "../../work-intelligence/outcome-journal.js";
import { startBriefScheduler, stopBriefScheduler, runAndPersistBrief } from "../brief-scheduler.js";
import { refreshRepositoryIntelligence } from "../repository-intelligence-refresh.js";
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
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it("refreshes repository intelligence immediately before composing the brief", async () => {
    addGoal("Grow the business", "user");
    const repositoryRefresh = vi.fn(async () => undefined);
    const stop = startBriefScheduler({
      intervalMs: 60_000,
      deps: { situation: null },
      repositoryRefresh,
    });
    expect(stop).toBe(stopBriefScheduler);

    await vi.waitFor(() => expect(repositoryRefresh).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(readLatestBrief()?.body).toContain("Grow the business"));
    stopBriefScheduler();
  });

  it("repeats repository refresh on the maintenance cadence and stops cleanly", async () => {
    vi.useFakeTimers();
    const repositoryRefresh = vi.fn(async () => undefined);
    startBriefScheduler({
      intervalMs: 60_000,
      deps: { situation: null },
      repositoryRefresh,
    });

    await vi.runAllTicks();
    expect(repositoryRefresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(repositoryRefresh).toHaveBeenCalledTimes(2);

    stopBriefScheduler();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(repositoryRefresh).toHaveBeenCalledTimes(2);
  });

  it("keeps repository refresh best-effort when the work index is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await refreshRepositoryIntelligence(async () => {
      throw new Error("work index unavailable");
    });

    expect(result).toEqual({ ok: false });
    expect(warn).toHaveBeenCalledWith(
      "[repository-intelligence] refresh failed:",
      "work index unavailable",
    );
  });
});
