import { describe, expect, it } from "vitest";
import { buildTaskPlanResponse, intakeLiveTask, isTaskContinuation, resolveLiveTaskIntent, trackLiveTaskAndPlan } from "../live-task-intake.js";
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
  resumableError?: Error;
  createError?: Error;
  inspect?: () => Promise<RepositorySnapshot>;
} = {}) {
  const calls = { created: 0, resumed: 0, started: 0, oriented: 0 };
  let task = fakeTask();
  const store = {
    findResumableTask: async () => {
      calls.resumed += 1;
      if (overrides.resumableError) throw overrides.resumableError;
      return overrides.resumable ?? null;
    },
    createTask: async (input: { intendedOutcome: string }) => {
      calls.created += 1;
      if (overrides.createError) throw overrides.createError;
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

describe("isTaskContinuation", () => {
  const task = fakeTask({ intendedOutcome: "Deploy the landing page" });

  it("treats a re-issued identical outcome as a continuation", () => {
    expect(isTaskContinuation("Deploy the landing page", task)).toBe(true);
    expect(isTaskContinuation("  deploy the LANDING page. ", task)).toBe(true);
  });

  it("treats a pure continuation cue as a continuation", () => {
    expect(isTaskContinuation("keep going", task)).toBe(true);
    expect(isTaskContinuation("Continue", task)).toBe(true);
    expect(isTaskContinuation("ok, carry on", task)).toBe(true);
  });

  it("treats a distinct utterance as a new task", () => {
    expect(isTaskContinuation("Fix the Instagram pull issue", task)).toBe(false);
    expect(isTaskContinuation("continue fixing the Instagram pull issue", task)).toBe(false);
    expect(isTaskContinuation("", task)).toBe(false);
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

  it("reuses the resumable task when the utterance re-issues the same outcome", async () => {
    const existing = fakeTask({ status: "running", intendedOutcome: "Fix the Instagram pull issue" });
    const { deps, calls } = fakeDeps({ resumable: existing });
    const result = await intakeLiveTask(decision, repository.root, {}, deps);

    expect(result.created).toBe(false);
    expect(result.task.taskKey).toBe(existing.taskKey);
    expect(calls.created).toBe(0);
    expect(calls.started).toBe(0);
    expect(calls.oriented).toBe(0);
  });

  it("resumes the resumable task when the utterance is a continuation cue", async () => {
    const existing = fakeTask({ status: "running", intendedOutcome: "Deploy the landing page" });
    const { deps, calls } = fakeDeps({ resumable: existing });
    const result = await intakeLiveTask(
      { intendedOutcome: "keep going", taskIntent: "ship" },
      repository.root,
      {},
      deps,
    );

    expect(result.created).toBe(false);
    expect(result.task.taskKey).toBe(existing.taskKey);
    expect(calls.created).toBe(0);
  });

  it("does not fold a distinct utterance into an unrelated resumable task", async () => {
    const existing = fakeTask({ status: "awaiting_grant", intendedOutcome: "Deploy the landing page" });
    const { deps, calls } = fakeDeps({ resumable: existing });
    const result = await intakeLiveTask(decision, repository.root, {}, deps);

    expect(result.created).toBe(true);
    expect(result.task.intendedOutcome).toBe("Fix the Instagram pull issue");
    expect(calls.created).toBe(1);
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

describe("trackLiveTaskAndPlan", () => {
  const decision = { intendedOutcome: "Fix the Instagram pull issue", taskIntent: "ship" as const };

  it("tracks a distinct utterance as a new task and never labels it as a continuation", async () => {
    const existing = fakeTask({ status: "awaiting_grant", intendedOutcome: "Deploy the landing page" });
    const { deps, calls } = fakeDeps({ resumable: existing });

    const outcome = await trackLiveTaskAndPlan({
      decision,
      projectRoot: repository.root,
      intakeOptions: {},
      currentWork: "the work",
      plan: async () => ({ planId: "plan-1" }),
      deps,
    });

    expect(calls.created).toBe(1);
    expect(outcome.trackingFailed).toBe(false);
    expect(outcome.planned).toBe(true);
    expect(outcome.delegatedTask?.created).toBe(true);

    const contents = outcome.augmentations.map((a) => String(a.content));
    expect(contents).toContain("Task created: Fix the Instagram pull issue");
    expect(contents.some((c) => c.startsWith("Continuing existing task"))).toBe(false);
    expect(outcome.augmentations.some((a) => a.kind === "task_plan")).toBe(true);
  });

  it("keeps an existing-task conflict out of the user-facing plan", async () => {
    const existing = fakeTask({ status: "awaiting_grant", intendedOutcome: "Deploy the landing page" });
    const { deps } = fakeDeps({
      resumable: existing,
      createError: new Error('duplicate key value violates unique constraint "index_agent_tasks_one_unfinished_per_project"'),
    });

    const outcome = await trackLiveTaskAndPlan({
      decision,
      projectRoot: repository.root,
      intakeOptions: {},
      currentWork: "the work",
      plan: async () => ({ planId: "plan-1" }),
      deps,
    });

    expect(outcome.trackingFailed).toBe(true);
    expect(outcome.planned).toBe(true);
    expect(outcome.augmentations).toHaveLength(1);
    expect(outcome.augmentations[0]).toMatchObject({ kind: "task_plan", content: "the work" });
  });

  it("renders only the usable plan when task tracking is unavailable", async () => {
    const { deps } = fakeDeps({ resumableError: new Error("connect ECONNREFUSED 127.0.0.1:5432") });

    const outcome = await trackLiveTaskAndPlan({
      decision,
      projectRoot: repository.root,
      intakeOptions: {},
      currentWork: "the work",
      plan: async (intent) => ({ planId: "plan-1", intent }),
      deps,
    });

    expect(outcome.trackingFailed).toBe(true);
    expect(outcome.planned).toBe(true);
    expect(outcome.delegatedTask).toBeNull();
    expect(outcome.augmentations.some((a) => a.kind === "task_plan")).toBe(true);

    expect(outcome.augmentations).toHaveLength(1);
    expect(outcome.augmentations[0]).toMatchObject({ kind: "task_plan", content: "the work" });
  });

  it("reports a plain failure when the plan cannot be produced", async () => {
    const { deps } = fakeDeps();

    const outcome = await trackLiveTaskAndPlan({
      decision,
      projectRoot: repository.root,
      intakeOptions: {},
      currentWork: "the work",
      plan: async () => { throw new Error("model unavailable"); },
      deps,
    });

    expect(outcome.planned).toBe(false);
    const failure = outcome.augmentations.map((a) => String(a.content)).join(" ");
    expect(failure).toContain("Task planning failed");
    expect(failure).not.toContain("model unavailable");
  });
});

describe("buildTaskPlanResponse", () => {
  const decision = { intendedOutcome: "Fix the Instagram pull issue", taskIntent: "ship" as const };
  const planFor = async (intent: string) => ({ planId: "plan-1", intent });

  it("puts the produced plan on the top-level taskPlan field when tracking succeeds", async () => {
    const { deps } = fakeDeps();

    const response = await buildTaskPlanResponse({
      decision,
      projectRoot: repository.root,
      intakeOptions: {},
      currentWork: "the work",
      plan: planFor,
      deps,
    });

    expect(response.taskPlan).toEqual({ planId: "plan-1", intent: "Fix the Instagram pull issue" });
    expect(response.mode).toBe("requires_task");
    expect(response.delegatedTask?.taskKey).toBe("task-key-1");
  });

  it("puts the plan on the top-level taskPlan field when tracking fails", async () => {
    const { deps } = fakeDeps({ resumableError: new Error("connect ECONNREFUSED 127.0.0.1:5432") });

    const response = await buildTaskPlanResponse({
      decision,
      projectRoot: repository.root,
      intakeOptions: {},
      currentWork: "the work",
      plan: planFor,
      deps,
    });

    expect(response.taskPlan).toEqual({ planId: "plan-1", intent: "Fix the Instagram pull issue" });
    expect(response.mode).toBe("requires_task");
    expect(response.delegatedTask).toBeNull();
  });

  it("keeps taskPlan unset and forces augment mode when the plan cannot be produced", async () => {
    const { deps } = fakeDeps();

    const response = await buildTaskPlanResponse({
      decision,
      projectRoot: repository.root,
      intakeOptions: {},
      currentWork: "the work",
      plan: async () => { throw new Error("model unavailable"); },
      deps,
    });

    expect(response.taskPlan).toBeNull();
    expect(response.mode).toBe("requires_augment");
  });
});
