import { describe, expect, it } from "vitest";
import { formatMetrics, formatTask, formatWorker } from "../task.js";
import type { AgentTask, WorkerSession } from "../../runtime/types.js";

const task: AgentTask = {
  id: "1", taskKey: "task-12345678", projectId: "1", projectName: "GeorgeGally/flyd",
  projectRoot: "/work/flyd", status: "ready", intendedOutcome: "Make Flyd continuous",
  successCriteria: [], verificationCriteria: [], plan: {},
  contextSnapshot: {}, repositorySnapshot: { head: "abc" },
  recommendedNextAction: "Resume the interrupted OpenCode session", outcomeSummary: null,
  verificationResult: {}, revision: 4, startedAt: "2026-07-17T00:00:00.000Z",
  completedAt: null, updatedAt: "2026-07-17T01:00:00.000Z",
};

const worker: WorkerSession = {
  id: "2", workerKey: "worker-12345678", agentTaskId: "1", taskGrantId: "3",
  taskAssignmentId: "4", status: "running", adapter: "codex",
  capabilities: ["implementation", "testing"], executablePath: "/bin/codex",
  executableVersion: "codex-cli 0.144.2", workingDirectory: "/tmp/flyd/worktree",
  externalSessionId: "thread-1", processId: 42, errorSummary: null, output: null,
  exitStatus: null, startedAt: "2026-07-17T00:00:00.000Z", endedAt: null,
  lastObservedAt: "2026-07-17T00:01:00.000Z", stopReason: null,
};

describe("task command formatting", () => {
  it("shows durable state and the exact re-entry point", () => {
    expect(formatTask(task)).toContain("Make Flyd continuous");
    expect(formatTask(task)).toContain("Resume the interrupted OpenCode session");
    expect(formatTask(task)).toContain("task-12345678");
  });

  it("shows controllable worker identity, assignment, adapter, and worktree", () => {
    const output = formatWorker(worker);

    expect(output).toContain("worker-12345678");
    expect(output).toContain("Assignment: 4");
    expect(output).toContain("codex");
    expect(output).toContain("/tmp/flyd/worktree");
    expect(output).toContain("2026-07-17T00:01:00.000Z");
  });

  it("reports missing trial data honestly", () => {
    expect(formatMetrics({
      windowStartedAt: "2026-07-13T16:00:00.000Z",
      tasks: 0, completedTasks: 0, sessions: 0, resumedSessions: 0, resumedWithoutRestatement: 0,
      acceptedInterpretations: 0, correctedInterpretations: 0,
      replacedInterpretations: 0,
      manualContextRestatements: 0, toolEscapes: 0,
    })).toContain("No coding sessions recorded yet");
  });

  it("measures successful resumes against resumed sessions", () => {
    const output = formatMetrics({
      windowStartedAt: "2026-07-14T00:00:00.000Z",
      tasks: 2, completedTasks: 1, sessions: 5, resumedSessions: 4, resumedWithoutRestatement: 3,
      acceptedInterpretations: 2, correctedInterpretations: 1,
      replacedInterpretations: 1, manualContextRestatements: 1, toolEscapes: 0,
    });

    expect(output).toContain("Resumed without context restatement: 75% (3/4)");
    expect(output).not.toContain("Resume rate: 80%");
  });
});
