import { chmod, mkdir, mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  assertCleanAcceptanceRepository,
  cleanRubyEnvironment,
  formatAcceptanceReport,
  formatMetrics,
  formatTask,
  formatWorker,
  normalizeRailsAcceptanceReport,
  recoverLiveWorkersForStatus,
  resolveRepositoryRuby,
} from "../task.js";
import { buildReleaseAcceptanceReport } from "../../runtime/release-acceptance.js";
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
  externalSessionId: "thread-1", processId: 42, processIdentity: "process-42", errorSummary: null, output: null,
  exitStatus: null, startedAt: "2026-07-17T00:00:00.000Z", endedAt: null,
  lastObservedAt: "2026-07-17T00:01:00.000Z", stopReason: null,
  assignmentRevision: 3, pendingControl: "retry",
};

describe("task command formatting", () => {
  it("refuses to attribute acceptance checks to a commit with uncommitted changes", () => {
    expect(() => assertCleanAcceptanceRepository({ dirty: true, statusLines: [" M cli/src/index.ts"] }))
      .toThrow("requires a clean repository");
    expect(() => assertCleanAcceptanceRepository({ dirty: false, statusLines: [] })).not.toThrow();
  });

  it("normalizes the Rails acceptance authority for CLI presentation", () => {
    const report = normalizeRailsAcceptanceReport({
      status: "insufficient_evidence",
      generated_at: "2026-07-21T00:00:00Z",
      primary_product_trial: { status: "insufficient_evidence", release1c_available_at: null, qualifying_weeks: [], qualifying_working_days: 0 },
      technical_trial: { status: "insufficient_evidence", real_sessions: 0, resumed_sessions: 0 },
      measures: [],
      propagation: { status: "insufficient_evidence", p95_ms: null, sample_size: 0, target_ms: 2_000 },
      automated_acceptance: { status: "insufficient_evidence", runs: 0 },
    });

    expect(report.primaryProductTrial.qualifyingWorkingDays).toBe(0);
    expect(report.propagation.targetMs).toBe(2_000);
  });

  it("removes inherited Ruby and Bundler overrides from acceptance checks", () => {
    const clean = cleanRubyEnvironment({
      PATH: "/usr/bin",
      DATABASE_URL: "postgres://flyd",
      GEM_HOME: "/old/ruby",
      GEM_PATH: "/old/ruby",
      BUNDLE_GEMFILE: "/old/Gemfile",
      RUBYOPT: "-rold",
    });

    expect(clean).toEqual({
      PATH: "/usr/bin",
      DATABASE_URL: "postgres://flyd",
    });
  });

  it("uses the repository's pinned rbenv Ruby when it is executable", async () => {
    const root = await mkdtemp(join(tmpdir(), "flyd-ruby-"));
    const rbenvRoot = join(root, "rbenv");
    const ruby = join(rbenvRoot, "versions", "3.4.4", "bin", "ruby");
    await mkdir(join(root, "repository"), { recursive: true });
    await mkdir(join(rbenvRoot, "versions", "3.4.4", "bin"), { recursive: true });
    await writeFile(join(root, "repository", ".ruby-version"), "3.4.4\n");
    await writeFile(ruby, "#!/bin/sh\n");
    await chmod(ruby, 0o755);

    await expect(resolveRepositoryRuby(
      join(root, "repository"),
      { RBENV_ROOT: rbenvRoot },
      root,
    )).resolves.toBe(ruby);
  });

  it("shows durable state and the exact re-entry point", () => {
    expect(formatTask(task)).toContain("Make Flyd continuous");
    expect(formatTask(task)).toContain("Resume the interrupted OpenCode session");
    expect(formatTask(task)).toContain("task-12345678");
  });

  it("does not print internal blocker strings as next actions", () => {
    expect(formatTask({
      ...task,
      recommendedNextAction: "No healthy worker satisfies: implementation, testing",
    })).toContain("Next: Worker routing is unavailable; Flyd needs to recover or replace its worker before continuing.");

    expect(formatTask({
      ...task,
      recommendedNextAction: "Current repository evidence invalidated the assignment base",
    })).toContain("Next: The repository changed while work was running; Flyd needs to re-check the current files before continuing.");

    expect(formatTask({
      ...task,
      recommendedNextAction: "Flyd already intervened on this exact evidence",
    })).toContain("Next: Flyd already tried the safe automatic move here; review the current state before intervening again.");
  });

  it("recovers dead live workers before status reports them", async () => {
    const store = {
      liveWorkers: async () => [ worker ],
      transitionWorker: async () => worker,
    };
    const transitions: Array<{ workerKey: string; update: Record<string, unknown> }> = [];

    const recovered = await recoverLiveWorkersForStatus(store, "/work/flyd", {
      isProcessAlive: () => false,
      transition: async (workerKey, update) => {
        transitions.push({ workerKey, update });
        return worker;
      },
    });

    expect(recovered).toBe(1);
    expect(transitions).toEqual([
      {
        workerKey: worker.workerKey,
        update: expect.objectContaining({
          status: "interrupted",
          error: "Flyd restarted after the worker process ended",
        }),
      },
    ]);
  });

  it("shows controllable worker identity, assignment, adapter, and worktree", () => {
    const output = formatWorker(worker);

    expect(output).toContain("worker-12345678");
    expect(output).toContain("Assignment: 4");
    expect(output).toContain("Assignment revision: 3");
    expect(output).toContain("codex");
    expect(output).toContain("/tmp/flyd/worktree");
    expect(output).toContain("Last heartbeat: 2026-07-17T00:01:00.000Z");
    expect(output).toContain("Pending control: retry");
  });

  it("reports missing trial data honestly", () => {
    expect(formatMetrics({
      windowStartedAt: "2026-07-13T16:00:00.000Z",
      tasks: 0, completedTasks: 0, sessions: 0, resumedSessions: 0, resumedWithoutRestatement: 0,
      acceptedInterpretations: 0, correctedInterpretations: 0,
      replacedInterpretations: 0,
      manualContextRestatements: 0, toolEscapes: 0,
      routedAssignments: 0, flydAssignments: 0, codexAssignments: 0, openCodeAssignments: 0,
      acceptedInterventions: 0, stopControls: 0, retryControls: 0,
      redirectControls: 0, replaceControls: 0, integrationConflicts: 0,
      permissionRenewals: 0, verifiedIntegrations: 0, manualContextTransfers: 0,
    })).toContain("No coding sessions recorded yet");
  });

  it("prints an explicit insufficient-evidence Release 1 gate", () => {
    const report = buildReleaseAcceptanceReport({
      release1cAvailableAt: null,
      timeZone: "UTC",
      realSessions: 0, resumedSessions: 0, resumedWithoutRestatement: 0,
      acceptedInterpretations: 0, correctedInterpretations: 0, replacedInterpretations: 0,
      recommendedActions: 0, acceptedOrAdaptedActions: 0, acceptedInterventionWeeks: 0,
      acceptedInterventionWeekDates: [],
      completedTasks: 0, completedTasksWithVerifiedOutcomeAndReentry: 0,
      parityEvidenceCount: 0, propagationLatenciesMs: [],
      memorySafetyReviews: [], rationaleReviews: [], automatedAcceptanceRuns: [],
      realSessionDates: [],
    });

    const output = formatAcceptanceReport(report);
    expect(output).toContain("Release 1 acceptance: INSUFFICIENT EVIDENCE");
    expect(output).toContain("Real sessions: 0/10");
    expect(output).toContain("Browser-visible propagation p95: no data");
    expect(output).not.toContain("Release 1 acceptance: QUALIFIED");
  });

  it("measures successful resumes against resumed sessions", () => {
    const output = formatMetrics({
      windowStartedAt: "2026-07-14T00:00:00.000Z",
      tasks: 2, completedTasks: 1, sessions: 5, resumedSessions: 4, resumedWithoutRestatement: 3,
      acceptedInterpretations: 2, correctedInterpretations: 1,
      replacedInterpretations: 1, manualContextRestatements: 1, toolEscapes: 0,
      routedAssignments: 2, flydAssignments: 2, codexAssignments: 0, openCodeAssignments: 0,
      acceptedInterventions: 1, stopControls: 0, retryControls: 1,
      redirectControls: 0, replaceControls: 0, integrationConflicts: 0,
      permissionRenewals: 1, verifiedIntegrations: 1, manualContextTransfers: 1,
    });

    expect(output).toContain("Resumed without context restatement: 75% (3/4)");
    expect(output).toContain("Routed assignments: 2 (Flyd 2)");
    expect(output).not.toContain("Codex");
    expect(output).not.toContain("OpenCode");
    expect(output).toContain("Accepted automatic interventions: 1");
    expect(output).toContain("Controls: stop 0, retry 1, redirect 0, replace 0");
    expect(output).toContain("Verified integrations: 1");
    expect(output).not.toContain("Resume rate: 80%");
  });

  it("labels a session-only trial as insufficient Release 1B evidence", () => {
    const output = formatMetrics({
      windowStartedAt: "2026-07-14T00:00:00.000Z",
      tasks: 1, completedTasks: 0, sessions: 1, resumedSessions: 0, resumedWithoutRestatement: 0,
      acceptedInterpretations: 1, correctedInterpretations: 0, replacedInterpretations: 0,
      manualContextRestatements: 0, toolEscapes: 0,
      routedAssignments: 0, flydAssignments: 0, codexAssignments: 0, openCodeAssignments: 0,
      acceptedInterventions: 0, stopControls: 0, retryControls: 0,
      redirectControls: 0, replaceControls: 0, integrationConflicts: 0,
      permissionRenewals: 0, verifiedIntegrations: 0, manualContextTransfers: 0,
    });

    expect(output).toContain("Release 1B control trial: insufficient evidence");
  });
});
