import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  configureCoachMemoryDirectory,
  addGoal,
  listGoals,
  getGoal,
  adjustGoal,
  archiveGoal,
  addPattern,
  listPatterns,
  clearCoachMemory,
} from "../coach-memory.js";

describe("coach memory", () => {
  let root: string;
  let prevFlydDir: string | undefined;

  beforeEach(() => {
    root = join(tmpdir(), `flyd-coach-${randomUUID()}`);
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

  it("persists a goal and reloads it (survives restart)", () => {
    const goal = addGoal("Launch the coach pilot", "user");
    expect(listGoals()).toHaveLength(1);
    expect(getGoal(goal.id)?.statement).toBe("Launch the coach pilot");
  });

  it("adjusts a goal and updates adjustedAt without destroying it", () => {
    const goal = addGoal("Original goal", "user");
    const adjusted = adjustGoal(goal.id, "Revised goal");
    expect(adjusted?.statement).toBe("Revised goal");
    expect(adjusted?.adjustedAt >= goal.adjustedAt).toBe(true);
    expect(getGoal(goal.id)?.statement).toBe("Revised goal");
  });

  it("archives a goal and excludes it from active listing", () => {
    const goal = addGoal("A goal", "user");
    archiveGoal(goal.id);
    expect(listGoals(true)).toHaveLength(0);
    expect(listGoals(false)).toHaveLength(1);
  });

  it("preserves epistemic status on patterns through read/write", () => {
    addPattern("Corrected focus drift", "correction", "user");
    addPattern("Morning deep work", "inferred", "retrospective");
    const patterns = listPatterns();
    expect(patterns.find((p) => p.epistemicStatus === "correction")).toBeTruthy();
    expect(patterns.find((p) => p.epistemicStatus === "inferred")).toBeTruthy();
  });

  it("returns empty for a clean store with no files", () => {
    clearCoachMemory();
    expect(listGoals()).toHaveLength(0);
    expect(listPatterns()).toHaveLength(0);
  });
});
