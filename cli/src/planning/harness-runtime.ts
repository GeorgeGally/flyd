import { runContinuityHarness as runRuntimeHarness } from "../runtime/harness.js";
import type { TransitionSignal } from "../transitions/types.js";
import { decideHarnessEntry, type HarnessDecision } from "./harness-decision.js";
import { reconcileHarnessPrediction, recordHarnessPrediction } from "./harness-learning.js";
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
  let executedDecision: HarnessDecision | null = null;
  if (trajectory.stateBefore) {
    let decision = await decideHarnessEntry({
      state: trajectory.stateBefore,
      requestedOutcome: input.outcome,
    });

    if (decision.recommendation.actionId === "resume-active-task") {
      // A contextual utterance such as "continue" names no new outcome. Let
      // the existing harness resolve its durable resumable task instead of
      // misclassifying the contextual phrase as a replacement outcome.
      runtimeInput = { ...input, outcome: undefined };
      executedDecision = decision;
    } else if (decision.recommendation.mode === "ask_user") {
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
      // The prediction must describe the action Flyd will actually execute,
      // not the unresolved contextual phrase that caused the clarification.
      decision = await decideHarnessEntry({
        state: trajectory.stateBefore,
        requestedOutcome: clarified,
      });
      executedDecision = decision.recommendation.mode === "act" ? decision : null;
    } else if (decision.recommendation.mode === "act") {
      executedDecision = decision;
    }
  }

  if (executedDecision) {
    recordHarnessPrediction(executedDecision, trajectory.invocationId);
  }

  try {
    const result = await runRuntimeHarness(runtimeInput);
    const observed = await completeHarnessTrajectory({
      handle: trajectory,
      origin: "tool",
      signal: harnessSignalForStatus(result.status),
      detail: { status: result.status, taskKey: result.taskKey },
    });
    reconcileHarnessPrediction(executedDecision, observed, trajectory.invocationId);
    return result;
  } catch (error) {
    const observed = await completeHarnessTrajectory({
      handle: trajectory,
      origin: "tool",
      signal: "failed",
      detail: { errorClass: error instanceof Error ? error.name : "unknown" },
    });
    reconcileHarnessPrediction(executedDecision, observed, trajectory.invocationId);
    throw error;
  }
}
