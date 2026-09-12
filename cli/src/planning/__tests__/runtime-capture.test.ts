import { describe, expect, it, vi } from "vitest";
import type { PresentModel } from "../../lib/present-model.js";
import type { WorkHypothesis } from "../../work/work-hypothesis/types.js";
import { captureRuntimeSnapshot } from "../runtime-capture.js";

const present: PresentModel = {
  generatedAt: "2026-09-12T00:00:00.000Z",
  repository: {
    root: "/work/flyd",
    branch: "main",
    head: "abc123",
    dirty: false,
    statusLines: [],
  },
  activeTask: {
    taskKey: "task-1",
    projectName: "Flyd",
    status: "running",
    intendedOutcome: "Link runtime trajectories",
    updatedAt: "2026-09-12T00:00:00.000Z",
  },
  recentCommits: [],
  gaps: [],
};

const work: WorkHypothesis = {
  id: "work-1",
  hypothesisText: "Flyd is active",
  primaryThreads: [{
    root: "/work/flyd",
    name: "Flyd",
    isDirty: false,
    hasTasks: true,
    isForeground: true,
    signals: [],
    demoted: false,
  }],
  secondaryThreads: [],
  confidence: "high",
  uncertainty: [],
  evidenceRefs: [],
  demotions: [],
  revisedAt: "2026-09-12T00:00:00.000Z",
  generatedAt: "2026-09-12T00:00:00.000Z",
  fromCache: false,
};

describe("captureRuntimeSnapshot", () => {
  it("persists an explicit snapshot correlated to the invocation", async () => {
    const persist = vi.fn();
    const snapshot = await captureRuntimeSnapshot(
      { correlationId: "inv-1", projectRoot: "/work/flyd" },
      {
        buildPresent: async () => present,
        readWork: () => work,
        persist,
        now: () => new Date("2026-09-12T00:01:00.000Z"),
      },
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot?.capturedAt).toBe("2026-09-12T00:01:00.000Z");
    expect(snapshot?.repoStates.value[0]).toMatchObject({ root: "/work/flyd", branch: "main", head: "abc123" });
    expect(snapshot?.activeTasks.value[0]).toMatchObject({ id: "task-1", status: "running" });
    expect(persist).toHaveBeenCalledWith(snapshot, "inv-1");
  });

  it("degrades to null when observation or persistence fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const snapshot = await captureRuntimeSnapshot(
        { correlationId: "inv-failed" },
        {
          buildPresent: async () => { throw new Error("repo unavailable"); },
          readWork: () => work,
          persist: vi.fn(),
          now: () => new Date(),
        },
      );
      expect(snapshot).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });
});
