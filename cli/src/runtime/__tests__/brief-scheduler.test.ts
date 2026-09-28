import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { configureCoachMemoryDirectory, addGoal } from "../coach-memory.js";
import { configureOutcomeJournalDirectory } from "../../work-intelligence/outcome-journal.js";
import {
  startBriefScheduler,
  stopBriefScheduler,
  runAndPersistBrief,
  briefDueNow,
  localDayKey,
  isBriefWindow,
  isLocalWeekday,
} from "../brief-scheduler.js";
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
      force: true,
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
      force: true,
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

  it("only considers a brief due on a local weekday inside the local morning window", () => {
    const sundayAfternoon = new Date(2026, 8, 27, 16, 18);
    const mondayMorning = new Date(2026, 8, 28, 8, 40);
    const mondayNight = new Date(2026, 8, 28, 22, 0);
    const mondayEarly = new Date(2026, 8, 28, 5, 30);

    expect(isLocalWeekday(sundayAfternoon)).toBe(false);
    expect(isBriefWindow(sundayAfternoon)).toBe(false);
    expect(briefDueNow(sundayAfternoon)).toBe(false);

    expect(isLocalWeekday(mondayMorning)).toBe(true);
    expect(briefDueNow(mondayMorning, undefined)).toBe(true);
    expect(briefDueNow(mondayMorning, localDayKey(mondayMorning))).toBe(false);

    expect(briefDueNow(mondayNight)).toBe(false);
    expect(briefDueNow(mondayEarly)).toBe(false);
  });

  it("does not compose off-hours on start or on a fixed interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 27, 16, 18)); // Sunday afternoon
    const repositoryRefresh = vi.fn(async () => undefined);
    startBriefScheduler({ intervalMs: 60_000, deps: { situation: null }, repositoryRefresh });

    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(repositoryRefresh).not.toHaveBeenCalled();

    stopBriefScheduler();
  });

  it("composes once when the local clock reaches the morning window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 27, 16, 18));
    addGoal("Ship CleanX", "user");
    const repositoryRefresh = vi.fn(async () => undefined);
    startBriefScheduler({ intervalMs: 60_000, deps: { situation: null }, repositoryRefresh });

    await vi.runAllTicks();
    expect(repositoryRefresh).not.toHaveBeenCalled();

    vi.setSystemTime(new Date(2026, 8, 28, 8, 0)); // Monday 08:00
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    await vi.waitFor(() => expect(repositoryRefresh).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(readLatestBrief()?.body).toContain("Ship CleanX"));

    // Same day, later in the window: still just the one brief.
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(repositoryRefresh).toHaveBeenCalledTimes(1);

    stopBriefScheduler();
  });
});
