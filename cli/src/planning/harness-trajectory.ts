import { randomUUID } from "node:crypto";
import { captureRuntimeSnapshot } from "./runtime-capture.js";
import { isTransitionCaptureDisabled, recordAction, recordNextState } from "../transitions/writer.js";
import type { TransitionActionInput, TransitionNextStateInput, TransitionOrigin, TransitionSignal } from "../transitions/types.js";
import type { WorldStateSnapshot } from "../intelligence/world/types.js";

export interface HarnessTrajectoryHandle {
  invocationId: string;
  sessionId: string;
  projectRoot: string;
  actionCaptured: boolean;
}

export interface HarnessTrajectoryDependencies {
  disabled: () => boolean;
  capture: (input: { correlationId: string; projectRoot?: string | null }) => Promise<WorldStateSnapshot | null>;
  recordAction: (input: TransitionActionInput) => ReturnType<typeof recordAction>;
  recordNextState: (input: TransitionNextStateInput) => ReturnType<typeof recordNextState>;
}

const defaultDependencies: HarnessTrajectoryDependencies = {
  disabled: isTransitionCaptureDisabled,
  capture: captureRuntimeSnapshot,
  recordAction,
  recordNextState,
};

/**
 * Start a live coding-harness trajectory immediately before supervised work.
 * This is best-effort telemetry, never execution authority.
 */
export async function beginHarnessTrajectory(input: {
  sessionId: string;
  intent: string;
  projectRoot: string;
  taskId?: string;
  threadId?: string;
  invocationId?: string;
}, deps: HarnessTrajectoryDependencies = defaultDependencies): Promise<HarnessTrajectoryHandle> {
  const invocationId = input.invocationId ?? `harness:${input.sessionId}:${randomUUID()}`;
  const handle: HarnessTrajectoryHandle = {
    invocationId,
    sessionId: input.sessionId,
    projectRoot: input.projectRoot,
    actionCaptured: false,
  };

  if (deps.disabled()) return handle;

  try {
    const before = await deps.capture({
      correlationId: invocationId,
      projectRoot: input.projectRoot,
    });
    const result = deps.recordAction({
      sessionId: input.sessionId,
      invocationId,
      surface: "harness",
      intent: input.intent,
      resolutionMode: "worker_execution",
      ...(before ? { stateBeforeId: before.id } : {}),
      repositoryRoot: input.projectRoot,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
    });
    handle.actionCaptured = result.ok && !result.skipped;
  } catch (error) {
    console.warn("[planning] harness action trajectory capture failed:", error instanceof Error ? error.message : error);
  }

  return handle;
}

/**
 * Close a previously-started harness trajectory after the supervised runtime
 * produces an observed outcome. `causalComplete` is true only when the matching
 * action event was actually captured in this process.
 */
export async function completeHarnessTrajectory(input: {
  handle: HarnessTrajectoryHandle;
  signal: TransitionSignal;
  origin?: TransitionOrigin;
  detail?: Record<string, unknown>;
}, deps: HarnessTrajectoryDependencies = defaultDependencies): Promise<void> {
  if (deps.disabled()) return;

  try {
    const after = await deps.capture({
      correlationId: input.handle.invocationId,
      projectRoot: input.handle.projectRoot,
    });
    const result = deps.recordNextState({
      sessionId: input.handle.sessionId,
      invocationId: input.handle.invocationId,
      surface: "harness",
      origin: input.origin ?? "verifier",
      signal: input.signal,
      causalComplete: input.handle.actionCaptured,
      ...(after ? { stateAfterId: after.id } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
    });
    if (!result.ok) {
      console.warn("[planning] harness outcome trajectory rejected:", result.rejection);
    }
  } catch (error) {
    console.warn("[planning] harness outcome trajectory capture failed:", error instanceof Error ? error.message : error);
  }
}
