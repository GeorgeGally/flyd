import { describe, expect, it } from "vitest";
import { reconcileWorker } from "../worker-reconciler.js";
import type { WorkerSession } from "../types.js";

function worker(overrides: Partial<WorkerSession> = {}): WorkerSession {
  return {
    id: "1",
    workerKey: "worker-1",
    agentTaskId: "task-1",
    taskGrantId: "grant-1",
    taskAssignmentId: "assignment-1",
    status: "running",
    adapter: "codex",
    capabilities: ["implementation"],
    executablePath: "/usr/local/bin/codex",
    executableVersion: "1",
    workingDirectory: "/work/flyd",
    externalSessionId: "session-1",
    processId: 123,
    processIdentity: "identity",
    errorSummary: null,
    output: null,
    exitStatus: null,
    startedAt: "2026-09-11T06:00:00.000Z",
    endedAt: null,
    lastObservedAt: "2026-09-11T06:01:00.000Z",
    stopReason: null,
    ...overrides,
  };
}

const reality = {
  observedAt: "2026-09-11T06:02:00.000Z",
  processAlive: true,
  processIdentityMatches: true,
  worktreeExists: true,
};

describe("reconcileWorker", () => {
  it("stays silent for a healthy worker", () => {
    expect(reconcileWorker(worker(), reality)).toMatchObject({
      state: "healthy",
      action: "noop",
      consequential: false,
    });
  });

  it("reattaches a live worker whose durable state is not yet running", () => {
    expect(reconcileWorker(worker({ status: "starting" }), reality)).toMatchObject({
      state: "healthy",
      action: "reattach",
    });
  });

  it("never kills or adopts a live process whose identity is ambiguous", () => {
    expect(reconcileWorker(worker(), { ...reality, processIdentityMatches: false })).toMatchObject({
      state: "unknown",
      action: "recheck",
      consequential: false,
    });
  });

  it("preserves recoverable work when the process died but worktree survived", () => {
    expect(reconcileWorker(worker(), { ...reality, processAlive: false, processIdentityMatches: false })).toMatchObject({
      state: "interrupted",
      action: "resume",
      consequential: true,
    });
  });

  it("treats completion as verifying until the verifier settles it", () => {
    expect(reconcileWorker(worker({ status: "completed" }), {
      ...reality,
      completionReported: true,
      verificationPending: true,
    })).toMatchObject({
      state: "verifying",
      action: "verify",
    });
  });

  it("routes a failed verification to a retry decision, not to silent noop", () => {
    expect(reconcileWorker(worker({ status: "completed" }), {
      ...reality,
      completionReported: true,
      verificationPending: false,
      verificationFailed: true,
    })).toMatchObject({
      state: "verifying",
      action: "retry",
      consequential: true,
    });
  });

  it("moves a verified worker into integrating while output lands", () => {
    expect(reconcileWorker(worker({ status: "completed" }), {
      ...reality,
      verificationPending: false,
      integrationPending: true,
    })).toMatchObject({
      state: "integrating",
      action: "noop",
      consequential: false,
    });
  });

  it("marks a worker landed once verified output is in the source repository", () => {
    expect(reconcileWorker(worker({ status: "completed" }), {
      ...reality,
      verificationPending: false,
      integrationLanded: true,
    })).toMatchObject({
      state: "landed",
      action: "noop",
      consequential: false,
    });
  });

  it("demands replacement when a failed worker's worktree is gone", () => {
    expect(reconcileWorker(worker({ status: "failed" }), {
      ...reality,
      processAlive: false,
      worktreeExists: false,
    })).toMatchObject({
      state: "failed",
      action: "replace",
      consequential: true,
    });
  });

  it("cleans up when a cancelled worker's worktree is gone", () => {
    expect(reconcileWorker(worker({ status: "cancelled" }), {
      ...reality,
      processAlive: false,
      worktreeExists: false,
    })).toMatchObject({
      state: "failed",
      action: "cleanup",
      consequential: true,
    });
  });

  it("keeps an explicit open decision above routine worker health", () => {
    expect(reconcileWorker(worker(), { ...reality, openDecision: true })).toMatchObject({
      state: "waiting_decision",
      action: "ask_user",
      consequential: true,
    });
  });

  it("does not escalate an explicit external wait", () => {
    expect(reconcileWorker(worker(), { ...reality, externalWait: true })).toMatchObject({
      state: "waiting_external",
      action: "noop",
      consequential: false,
    });
  });
});
