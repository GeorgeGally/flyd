import { runContinuityHarness as runRuntimeHarness } from "../runtime/harness.js";
import type { TransitionSignal } from "../transitions/types.js";
import { beginHarnessTrajectory, completeHarnessTrajectory } from "./harness-trajectory.js";

export function harnessSignalForStatus(status: string): TransitionSignal {
  if (status === "completed") return "verified";
  if (status === "cancelled") return "cancelled";
  if (status === "failed" || status === "blocked" || status === "interrupted") return "failed";
  if (status === "running" || status === "ready" || status === "awaiting_grant") return "partial";
  return "ambiguous";
}

/**
 * Planning-aware boundary around the existing supervised coding harness.
 * The wrapped harness remains the sole owner of task grants, workers,
 * verification, integration, and execution authority.
 */
export async function runContinuityHarness(
  input: Parameters<typeof runRuntimeHarness>[0],
): ReturnType<typeof runRuntimeHarness> {
  const repository = await input.deps.inspectRepository(input.cwd);
  const trajectory = await beginHarnessTrajectory({
    sessionId: `code:${process.pid}`,
    intent: input.outcome?.trim() || "resume current supervised coding task",
    projectRoot: repository.root,
  });

  try {
    const result = await runRuntimeHarness(input);
    await completeHarnessTrajectory({
      handle: trajectory,
      origin: "tool",
      signal: harnessSignalForStatus(result.status),
      detail: { status: result.status, taskKey: result.taskKey },
    });
    return result;
  } catch (error) {
    await completeHarnessTrajectory({
      handle: trajectory,
      origin: "tool",
      signal: "failed",
      detail: { errorClass: error instanceof Error ? error.name : "unknown" },
    });
    throw error;
  }
}
