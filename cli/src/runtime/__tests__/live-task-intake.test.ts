import { describe, expect, it } from "vitest";
import { intakeLiveTask, resolveLiveTaskIntent } from "../live-task-intake.js";
import type { AgentTask, RepositorySnapshot } from "../types.js";

const repository: RepositorySnapshot = {
  root: "/work/bloom",
  name: "bloom",
  remote: "git@github.com:GeorgeGally/bloom.git",
  branch: "main",
  head: "abc123",
  dirty: false,
  statusLines: [],
  statusDigest: "clean",
};

function fakeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "task-1",
    taskKey: "task-key-1",
    projectId: "project-1",
    projectName: repository.name,
    projectRoot: repository.root,
    status: "awaiting_grant",
    intendedOutcome: "Fix the Instagram pull issue",
    successCriteria: [],
    verificationCriteria: [],
    plan: {},
    contextSnapshot: {},
    repositorySnapshot: {},
    recommendedNextAction: null,
    outcomeSummary: null,
    verificationResult: {},
    revision: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function fakeDeps(overrides: {
  resumable?: AgentTask | null;
  inspect?: () => Promise<RepositorySnapshot>;
} = {}) {
  const calls = { created: 0, resumed: 0, started: 0, oriented: 0 };
  let task = fakeTask();
  const store = {
    findResumableTask: async () => {
      calls.resumed += 1;
      return overrides.resumable ?? null;
    },
    createTask: async (input: { intendedOutcome: string }) => {
      calls.created += 1;
      task = fakeTask({ intendedOutcome: input.intendedOutcome });
      return task;
    },
    startTaskSession: async () => {
      calls.started += 1;
      task = { ...task, revision: task.revision + 1 };
      return "session-1";
    },
    findTask: async () => task,
    recordOrientation: async (_taskKey: string, revision: number, input: { recommendedNextAction: string }) => {
      calls.oriented += 1;
      task = { ...task, revision: revision + 1, recommendedNextAction: input.recommendedNextAction };
      return task;
    },
  };
  const deps = {
    store,
    inspectRepository: overrides.inspect ?? (async () => repository),
  };
  return { deps, calls, currentTask: () => task };
}

describe("resolveLiveTaskIntent", () => {
  it("maps a task_plan action to a ship decision", () => {
    const decision = resolveLiveTaskIntent({ kind: "task_plan", taskIntent: "Fix the Instagram pull issue" });
    expect(decision).toEqual({ intendedOutcome: "Fix the Instagram pull issue", taskIntent: "ship" });
  });

  it("returns null for non-task actions", () => {
    expect(resolveLiveTaskIntent({ kind: "repository_action", taskIntent: "Fix it" })).toBeNull();
    expect(resolveLiveTaskIntent({ kind: "explanation" })).toBeNull();
    expect(resolveLiveTaskIntent(undefined)).toBeNull();
  });

  it("returns null for empty or blank taskIntent", () => {
    expect(resolveLiveTaskIntent({ kind: "task_plan", taskIntent: "" })).toBeNull();
    expect(resolveLiveTaskIntent({ kind: "task_plan", taskIntent: "   " })).toBeNull();
  });
});

describe("intakeLiveTask", () => {
  const decision = { intendedOutcome: "Fix the Instagram pull issue", taskIntent: "ship" as const };

  it("creates a canonical task when no task is resumable", async () => {
    const { deps, calls } = fakeDeps();
    const result = await intakeLiveTask(decision, repository.root, {}, deps);

    expect(result.created).toBe(true);
    expect(result.task.taskKey).toBe("task-key-1");
    expect(result.task.intendedOutcome).toBe("Fix the Instagram pull issue");
    expect(result.task.projectRoot).toBe(repository.root);
    expect(calls.resumed).toBe(1);
    expect(calls.created).toBe(1);
    expect(calls.started).toBe(1);
    expect(calls.oriented).toBe(1);
  });

  it("reuses the resumable task instead of creating a second one", async () => {
    const existing = fakeTask({ status: "running", intendedOutcome: "Keep going on Bloom" });
    const { deps, calls } = fakeDeps({ resumable: existing });
    const result = await intakeLiveTask(decision, repository.root, {}, deps);

    expect(result.created).toBe(false);
    expect(result.task.taskKey).toBe(existing.taskKey);
    expect(calls.created).toBe(0);
    expect(calls.started).toBe(0);
    expect(calls.oriented).toBe(0);
  });

  it("fails closed when no repository root is identified", async () => {
    const { deps } = fakeDeps();
    await expect(intakeLiveTask(decision, null, {}, deps)).rejects.toThrow(/no repository identified/);
    await expect(intakeLiveTask(decision, "  ", {}, deps)).rejects.toThrow(/no repository identified/);
  });

  it("fails closed when the repository cannot be inspected", async () => {
    const { deps, calls } = fakeDeps({ inspect: async () => { throw new Error("not a git repository"); } });
    await expect(intakeLiveTask(decision, repository.root, {}, deps)).rejects.toThrow(/not a git repository/);
    expect(calls.created).toBe(0);
  });
});