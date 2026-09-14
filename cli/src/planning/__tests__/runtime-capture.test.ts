import { describe, expect, it, vi } from "vitest";
import type { PresentModel } from "../../lib/present-model.js";
import type { ManagedRepository } from "../../work/repository-registry.js";
import type { WorkHypothesis } from "../../work/work-hypothesis/types.js";
import { captureRuntimeSnapshot } from "../runtime-capture.js";

const present: PresentModel = {
  generatedAt: "2026-09-12T00:00:00.000Z",
  repository: {
    root: "/work/flyd",
    name: "flyd",
    remote: "https://github.com/GeorgeGally/flyd.git",
    branch: "main",
    head: "abc123",
    dirty: false,
    statusLines: [],
    statusDigest: "clean",
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
  epistemicClass: "inference",
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

function repository(overrides: Partial<ManagedRepository>): ManagedRepository {
  return {
    id: "repo-1",
    name: "flyd",
    root: "/work/flyd",
    projectFileExists: false,
    agentsFileExists: true,
    enabled: true,
    ...overrides,
  };
}

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

  it("projects fresh canonical secondary repositories without duplicating the foreground repo", async () => {
    const richerWork: WorkHypothesis = {
      ...work,
      secondaryThreads: [{
        root: "/work/cleanx",
        name: "CleanX",
        isDirty: true,
        hasTasks: false,
        isForeground: false,
        signals: [],
        demoted: false,
      }],
    };
    const snapshot = await captureRuntimeSnapshot(
      { correlationId: "inv-multirepo", projectRoot: "/work/flyd" },
      {
        buildPresent: async () => present,
        readWork: () => richerWork,
        readRepositories: () => [
          repository({ observedAt: "2026-09-11T23:30:00.000Z", observedDirty: true, observedBranch: "stale-branch", lastSeenHead: "old-head" }),
          repository({
            id: "repo-2",
            name: "cleanx",
            root: "/work/cleanx",
            observedAt: "2026-09-11T23:45:00.000Z",
            observedDirty: true,
            observedBranch: "main",
            lastSeenHead: "cleanx-head",
          }),
        ],
        persist: vi.fn(),
        now: () => new Date("2026-09-12T00:01:00.000Z"),
      },
    );

    expect(snapshot?.repoStates.value).toEqual([
      expect.objectContaining({ root: "/work/flyd", branch: "main", head: "abc123", dirty: false }),
      expect.objectContaining({ root: "/work/cleanx", branch: "main", head: "cleanx-head", dirty: true }),
    ]);
    expect(snapshot?.repoStates.provenance).toContain("work-index:repository-registry");
  });

  it("excludes stale secondary repository observations", async () => {
    const richerWork: WorkHypothesis = {
      ...work,
      secondaryThreads: [{
        root: "/work/old-project",
        name: "Old Project",
        isDirty: true,
        hasTasks: false,
        isForeground: false,
        signals: [],
        demoted: false,
      }],
    };
    const snapshot = await captureRuntimeSnapshot(
      { correlationId: "inv-stale", projectRoot: "/work/flyd" },
      {
        buildPresent: async () => present,
        readWork: () => richerWork,
        readRepositories: () => [repository({
          id: "old",
          root: "/work/old-project",
          observedAt: "2026-09-01T00:00:00.000Z",
          observedDirty: true,
        })],
        persist: vi.fn(),
        now: () => new Date("2026-09-12T00:01:00.000Z"),
      },
    );

    expect(snapshot?.repoStates.value.map((repo) => repo.root)).toEqual(["/work/flyd"]);
  });

  it("projects authoritative blocked worker reasons into blockers", async () => {
    const blockedWork: WorkHypothesis = {
      ...work,
      workerObservations: [{
        epistemicClass: "observation",
        workerKey: "worker-1",
        taskId: "task-1",
        projectRoot: "/work/flyd",
        state: "blocked",
        action: "run tests",
        reason: "CI requires unavailable signing credentials",
        observedAt: "2026-09-12T00:00:30.000Z",
        consequential: true,
      }],
    };
    const snapshot = await captureRuntimeSnapshot(
      { correlationId: "inv-blocked", projectRoot: "/work/flyd" },
      {
        buildPresent: async () => ({ ...present, activeTask: present.activeTask ? { ...present.activeTask, status: "blocked" } : null }),
        readWork: () => blockedWork,
        persist: vi.fn(),
        now: () => new Date("2026-09-12T00:01:00.000Z"),
      },
    );

    expect(snapshot?.blockers.value).toEqual(["CI requires unavailable signing credentials"]);
    expect(snapshot?.blockers.confidence).toBe("high");
    expect(snapshot?.blockers.provenance).toEqual(["work-hypothesis:worker-observations"]);
  });

  it("uses a factual blocked-task marker when no blocker reason exists", async () => {
    const snapshot = await captureRuntimeSnapshot(
      { correlationId: "inv-blocked-generic", projectRoot: "/work/flyd" },
      {
        buildPresent: async () => ({ ...present, activeTask: present.activeTask ? { ...present.activeTask, status: "blocked" } : null }),
        readWork: () => work,
        persist: vi.fn(),
        now: () => new Date("2026-09-12T00:01:00.000Z"),
      },
    );
    expect(snapshot?.blockers.value).toEqual(["Blocked task: Link runtime trajectories"]);
    expect(snapshot?.blockers.confidence).toBe("medium");
  });

  it("keeps the foreground snapshot usable when repository registry reads fail", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const snapshot = await captureRuntimeSnapshot(
        { correlationId: "inv-registry-failed", projectRoot: "/work/flyd" },
        {
          buildPresent: async () => present,
          readWork: () => work,
          readRepositories: () => { throw new Error("work index unavailable"); },
          persist: vi.fn(),
          now: () => new Date("2026-09-12T00:01:00.000Z"),
        },
      );
      expect(snapshot?.repoStates.value).toHaveLength(1);
      expect(snapshot?.repoStates.value[0].root).toBe("/work/flyd");
    } finally {
      warn.mockRestore();
    }
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
