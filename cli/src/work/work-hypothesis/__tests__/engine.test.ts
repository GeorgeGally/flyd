import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { useWorkIndexPath, resetWorkIndexPath, closeDb } from "../../database.js";
import { buildPresentModelBelief } from "../engine.js";
import { appendCorrection, activeDemotions } from "../store.js";
import type { CandidateRepoInput } from "../types.js";

const NOW = new Date("2026-08-12T12:00:00.000Z");

const R12_REPOS: CandidateRepoInput[] = [
  {
    id: "gn",
    name: "Good Neighbours",
    root: "/Users/george/Documents/Good Neighbours",
    lastCommitAt: "2026-08-12T10:00:00.000Z",
    isDirty: true,
    hasTasks: false,
    isForeground: false,
  },
  {
    id: "cleanx",
    name: "CleanX",
    root: "/Users/george/Documents/CleanX",
    lastCommitAt: "2026-08-12T09:30:00.000Z",
    isDirty: true,
    hasTasks: false,
    isForeground: false,
  },
  {
    id: "flyd",
    name: "flyd",
    root: "/Users/george/Documents/flyd",
    lastCommitAt: "2026-08-10T12:00:00.000Z",
    isDirty: true,
    hasTasks: false,
    isForeground: false,
  },
  {
    id: "aigc",
    name: "aigc",
    root: "/Users/george/Documents/aigc",
    lastCommitAt: "2025-09-01T00:00:00.000Z",
    isDirty: true,
    hasTasks: false,
    isForeground: false,
  },
];

describe("buildPresentModelBelief", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-wh-engine-"));
    useWorkIndexPath(join(dir, "work-index.sqlite"));
  });

  afterEach(() => {
    closeDb();
    resetWorkIndexPath();
    rmSync(dir, { recursive: true, force: true });
  });

  it("R12: prioritizes Good Neighbours and CleanX; excludes aigc; flyd not sole primary", async () => {
    const belief = await buildPresentModelBelief({
      repos: R12_REPOS,
      now: NOW,
      coreCwd: "/Users/george/Documents/flyd/cli",
    });

    const primary = belief.primaryThreads.map((t) => t.name);
    expect(primary).toContain("Good Neighbours");
    expect(primary).toContain("CleanX");
    expect(primary).not.toContain("aigc");
    expect(belief.hypothesisText).not.toMatch(/aigc/i);
    // Flyd may appear secondary if within window, but not displace GN/CleanX
    expect(primary[0]).not.toBe("aigc");
  });

  it("no model key: integrity-only text without invented objective narrative", async () => {
    const belief = await buildPresentModelBelief({
      repos: R12_REPOS,
      now: NOW,
    });
    expect(belief.objective).toBeUndefined();
    expect(belief.hypothesisText).toMatch(/Good Neighbours|CleanX/);
  });

  it("claim checks drop cwd-only primary without commit evidence", async () => {
    const belief = await buildPresentModelBelief({
      now: NOW,
      coreCwd: "/tmp/flyd-cwd",
      repos: [
        {
          id: "flyd",
          name: "flyd",
          root: "/tmp/flyd-cwd",
          isDirty: true,
          hasTasks: false,
          isForeground: false,
          // no lastCommitAt
        },
      ],
    });
    expect(belief.primaryThreads).toHaveLength(0);
    expect(belief.uncertainty.some((u) => u.field === "primary")).toBe(true);
  });

  it("demotion keeps flyd out of primary even with fresh commits", async () => {
    appendCorrection({
      kind: "demote",
      projectName: "flyd",
      text: "don't treat flyd as my primary work",
    });
    expect(activeDemotions()).toContain("flyd");

    const belief = await buildPresentModelBelief({
      now: NOW,
      repos: [
        {
          id: "flyd",
          name: "flyd",
          root: "/Users/george/Documents/flyd",
          lastCommitAt: "2026-08-12T11:00:00.000Z",
          isDirty: true,
          hasTasks: false,
          isForeground: false,
        },
        {
          id: "gn",
          name: "Good Neighbours",
          root: "/Users/george/Documents/Good Neighbours",
          lastCommitAt: "2026-08-12T10:00:00.000Z",
          isDirty: false,
          hasTasks: false,
          isForeground: false,
        },
      ],
    });

    expect(belief.primaryThreads.map((t) => t.name)).not.toContain("flyd");
    expect(belief.primaryThreads.map((t) => t.name)).toContain("Good Neighbours");
    expect(belief.demotions.map((d) => d.toLowerCase())).toContain("flyd");
  });
});
