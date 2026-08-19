import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  configureCoachMemoryDirectory,
  addGoal,
  addPattern,
} from "../coach-memory.js";
import {
  composeStateBrief, composeDailyBrief,
  persistDailyBrief, readLatestBrief, dailyBriefFile,
} from "../daily-brief.js";

describe("daily brief", () => {
  let root: string;
  let prevFlydDir: string | undefined;

  beforeEach(() => {
    root = join(tmpdir(), `flyd-brief-${randomUUID()}`);
    prevFlydDir = process.env.FLYD_DIR;
    process.env.FLYD_DIR = root;
    mkdirSync(root, { recursive: true });
    configureCoachMemoryDirectory(join(root, "coach"));
  });

  afterEach(() => {
    if (prevFlydDir === undefined) delete process.env.FLYD_DIR;
    else process.env.FLYD_DIR = prevFlydDir;
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  it("composes local value: goals, next action, patterns", () => {
    addGoal("Ship CleanX", "user");
    addPattern("Defers hard calls", "inferred", "retrospective");
    const lines = composeStateBrief({
      project: "GeorgeGally/flyd",
      branch: "main",
      head: "abc",
      dirty: false,
      changedFiles: 0,
      latestCommit: null,
      outcome: "Ship CleanX",
      status: "ready",
      nextAction: "Run the release tests",
    });
    expect(lines.join(" ")).toContain("Ship CleanX");
    expect(lines.join(" ")).toContain("Run the release tests");
    expect(lines.join(" ")).toContain("Defers hard calls");
  });

  it("is instant and local-only when no last30days script is configured", async () => {
    const brief = await composeDailyBrief({ situation: null });
    expect(brief.degraded).toBe(false);
    expect(brief.external).toHaveLength(0);
    expect(brief.heading).toContain("Daily brief");
  });

  it("notes a blocked task when there is no next action", () => {
    const lines = composeStateBrief({
      project: "x",
      branch: "main",
      head: "a",
      dirty: false,
      changedFiles: 0,
      latestCommit: null,
      outcome: "Stuck",
      status: "blocked",
      nextAction: null,
    });
    expect(lines.join(" ")).toContain("blocked");
  });

  it("persists a brief and reads it back while fresh", () => {
    const brief = {
      heading: "Daily brief — now",
      state: ["Next: Ship the release."],
      external: ["— ai agents: momentum"],
      degraded: false,
    };
    const file = persistDailyBrief(brief);
    expect(dailyBriefFile()).toBe(file);
    const latest = readLatestBrief();
    expect(latest).not.toBeNull();
    expect(latest!.body).toContain("Daily brief");
    expect(latest!.body).toContain("Next: Ship the release.");
    expect(latest!.body).toContain("ai agents");
  });
});
