import { runContinuityHarness as runRuntimeHarness } from "../runtime/harness.js";
import type { TransitionSignal } from "../transitions/types.js";
import { decideHarnessEntry } from "./harness-decision.js";
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

  let runtimeInput = input;
  if (trajectory.stateBefore) {
    const decision = await decideHarnessEntry({
      state: trajectory.stateBefore,
      requestedOutcome: input.outcome,
    });

    if (decision.recommendation.mode === "ask_user") {
      const clarified = (await input.deps.terminal.ask("What outcome should Flyd accomplish?")).trim();
      if (!clarified) {
        await completeHarnessTrajectory({
          handle: trajectory,
          origin: "user",
          signal: "cancelled",
          detail: { decisionMode: "ask_user", reason: "missing_intended_outcome" },
        });
        throw new Error("An intended outcome is required");
      }
      runtimeInput = { ...input, outcome: clarified };
    }
  }

  try {
    const result = await runRuntimeHarness(runtimeInput);
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
