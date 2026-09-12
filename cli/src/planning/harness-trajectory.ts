import { randomUUID } from "node:crypto";
import { captureRuntimeSnapshot } from "./runtime-capture.js";
import { isTransitionCaptureDisabled, recordAction, recordNextState } from "../transitions/writer.js";
import type { TransitionSignal } from "../transitions/types.js";

export interface HarnessTrajectoryHandle {
  invocationId: string;
  sessionId: string;
  projectRoot: string;
  actionCaptured: boolean;
}

/**
 * Start a live coding-harness trajectory immediately before worker execution.
 * This is best-effort telemetry, never execution authority.
 */
export async function beginHarnessTrajectory(input: {
  sessionId: string;
  intent: string;
  projectRoot: string;
  taskId?: string;
  threadId?: string;
  invocationId?: string;
}): Promise<HarnessTrajectoryHandle> {
  const invocationId = input.invocationId ?? `harness:${input.sessionId}:${randomUUID()}`;
  const handle: HarnessTrajectoryHandle = {
    invocationId,
    sessionId: input.sessionId,
    projectRoot: input.projectRoot,
    actionCaptured: false,
  };

  if (isTransitionCaptureDisabled()) return handle;

  try {
    const before = await captureRuntimeSnapshot({
      correlationId: invocationId,
      projectRoot: input.projectRoot,
    });
    const result = recordAction({
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
 * Close a previously-started harness trajectory after repository evidence has
 * been observed. `causalComplete` is true only when the matching action event
 * was actually captured in this process.
 */
export async function completeHarnessTrajectory(input: {
  handle: HarnessTrajectoryHandle;
  signal: TransitionSignal;
  detail?: Record<string, unknown>;
}): Promise<void> {
  if (isTransitionCaptureDisabled()) return;

  try {
    const after = await captureRuntimeSnapshot({
      correlationId: input.handle.invocationId,
      projectRoot: input.handle.projectRoot,
    });
    const result = recordNextState({
      sessionId: input.handle.sessionId,
      invocationId: input.handle.invocationId,
      surface: "harness",
      origin: "verifier",
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
