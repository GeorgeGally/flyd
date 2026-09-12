import { runContinuityHarness as runRuntimeHarness } from "../runtime/harness.js";
import type { TransitionSignal } from "../transitions/types.js";
import { EmpiricalFutureModel } from "./empirical-future-model.js";
import { decideHarnessEntry, type HarnessDecision } from "./harness-decision.js";
import { reconcileHarnessPrediction, recordHarnessPrediction } from "./harness-learning.js";
import {
  beginHarnessTrajectory,
  completeHarnessTrajectory,
  type HarnessTrajectoryHandle,
} from "./harness-trajectory.js";
import { PlanningStore } from "./store.js";

export function harnessSignalForStatus(status: string): TransitionSignal {
  if (status === "completed") return "verified";
  if (status === "cancelled") return "cancelled";
  if (status === "failed" || status === "blocked" || status === "interrupted") return "failed";
  if (status === "running" || status === "ready" || status === "awaiting_grant") return "partial";
  return "ambiguous";
}

function liveFutureModel(): EmpiricalFutureModel {
  return new EmpiricalFutureModel({
    examples: () => {
      const store = new PlanningStore();
      try {
        return store.learningExamples();
      } finally {
        store.close();
      }
    },
  });
}

type RuntimeInput = Parameters<typeof runRuntimeHarness>[0];
type RuntimeResult = Awaited<ReturnType<typeof runRuntimeHarness>>;

function keepTerminalOpen(input: RuntimeInput): RuntimeInput {
  const terminal = input.deps.terminal;
  return {
    ...input,
    deps: {
      ...input.deps,
      terminal: {
        write: (message: string) => terminal.write(message),
        ask: (prompt: string) => terminal.ask(prompt),
        confirm: (prompt: string) => terminal.confirm(prompt),
        close: async () => undefined,
      },
    },
  };
}

function runtimeInputForDecision(
  input: RuntimeInput,
  decision: HarnessDecision,
  preserveTerminal = false,
): RuntimeInput {
  let runtimeInput: RuntimeInput;
  if (decision.recommendation.mode === "investigate") {
    runtimeInput = {
      ...input,
      outcome: undefined,
      focusedAssignment: decision.evaluation.action.description,
    };
  } else if (decision.recommendation.actionId === "resume-active-task") {
    // Use the durable task outcome instead of the contextual word ("continue")
    // so the harness resumes without treating the contextual request as a
    // replacement correction or asking for another focus prompt.
    runtimeInput = {
      ...input,
      outcome: decision.activeTask?.description,
      focusedAssignment: undefined,
    };
  } else {
    runtimeInput = { ...input, focusedAssignment: undefined };
  }
  return preserveTerminal ? keepTerminalOpen(runtimeInput) : runtimeInput;
}

async function executeDecision(input: {
  runtimeInput: RuntimeInput;
  decision: HarnessDecision;
  trajectory: HarnessTrajectoryHandle;
}): Promise<{ result: RuntimeResult; observed: Awaited<ReturnType<typeof completeHarnessTrajectory>> }> {
  recordHarnessPrediction(input.decision, input.trajectory.invocationId);
  try {
    const result = await runRuntimeHarness(input.runtimeInput);
    const signal = harnessSignalForStatus(result.status);
    const observed = await completeHarnessTrajectory({
      handle: input.trajectory,
      origin: "tool",
      signal,
      detail: { status: result.status, taskKey: result.taskKey },
    });
    reconcileHarnessPrediction(
      input.decision,
      observed,
      input.trajectory.invocationId,
      undefined,
      { status: result.status, signal },
    );
    return { result, observed };
  } catch (error) {
    const observed = await completeHarnessTrajectory({
      handle: input.trajectory,
      origin: "tool",
      signal: "failed",
      detail: { errorClass: error instanceof Error ? error.name : "unknown" },
    });
    reconcileHarnessPrediction(
      input.decision,
      observed,
      input.trajectory.invocationId,
      undefined,
      { status: "failed", signal: "failed" },
    );
    throw error;
  }
}

/**
 * Planning-aware boundary around the existing supervised coding harness.
 * The wrapped harness remains the sole owner of task grants, workers,
 * verification, integration, and execution authority.
 *
 * A blocker investigation may trigger exactly one fresh policy decision and,
 * if the refreshed world state says the gap is resolved, one automatic
 * continuation. This is intentionally bounded rather than a recursive agent
 * loop.
 */
export async function runContinuityHarness(
  input: RuntimeInput,
): ReturnType<typeof runRuntimeHarness> {
  const repository = await input.deps.inspectRepository(input.cwd);
  const trajectory = await beginHarnessTrajectory({
    sessionId: `code:${process.pid}`,
    intent: input.outcome?.trim() || "resume current supervised coding task",
    projectRoot: repository.root,
  });
  const futureModel = liveFutureModel();

  if (!trajectory.stateBefore) return runRuntimeHarness(input);

  let requestedOutcome = input.outcome;
  let decision = await decideHarnessEntry({
    state: trajectory.stateBefore,
    requestedOutcome,
  }, { futureModel });

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
    requestedOutcome = clarified;
    decision = await decideHarnessEntry({
      state: trajectory.stateBefore,
      requestedOutcome: clarified,
    }, { futureModel });
  }

  if (decision.recommendation.mode !== "act" && decision.recommendation.mode !== "investigate") {
    return runRuntimeHarness({ ...input, outcome: requestedOutcome });
  }

  const investigated = decision.recommendation.mode === "investigate";
  const first = await executeDecision({
    runtimeInput: runtimeInputForDecision(
      { ...input, outcome: requestedOutcome },
      decision,
      investigated,
    ),
    decision,
    trajectory,
  });

  if (!investigated) return first.result;

  // The focused investigation deliberately kept the real terminal open so a
  // successful re-plan can continue in the same user invocation.
  if (!first.observed) {
    await input.deps.terminal.close();
    return first.result;
  }

  const replanned = await decideHarnessEntry({
    state: first.observed,
    requestedOutcome,
  }, { futureModel });

  // One investigation is the hard bound. If evidence still says investigate,
  // defer, or ask, stop here rather than recursively spawning more work.
  if (replanned.recommendation.mode !== "act") {
    await input.deps.terminal.close();
    return first.result;
  }

  const followupTrajectory = await beginHarnessTrajectory({
    sessionId: `code:${process.pid}`,
    intent: replanned.intent,
    projectRoot: repository.root,
  });

  if (!followupTrajectory.stateBefore) {
    return runRuntimeHarness(runtimeInputForDecision({ ...input, outcome: requestedOutcome }, replanned));
  }

  const followup = await executeDecision({
    runtimeInput: runtimeInputForDecision({ ...input, outcome: requestedOutcome }, replanned),
    decision: replanned,
    trajectory: followupTrajectory,
  });
  return followup.result;
}
