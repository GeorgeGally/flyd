import { randomUUID } from "node:crypto";
import { IntelligenceEventStore } from "../intelligence/event-store.js";
import type { WorldStateSnapshot } from "../intelligence/world/types.js";
import { EmpiricalFutureModel } from "../planning/empirical-future-model.js";
import { buildPlanningTrace } from "../planning/future-model.js";
import { decideHarnessEntry } from "../planning/harness-decision.js";
import { buildPlanningInspection, buildTrajectoryViews, readAllEvents } from "../planning/inspection.js";
import { captureRuntimeSnapshot } from "../planning/runtime-capture.js";
import { PlanningStore } from "../planning/store.js";

interface OutputOptions {
  json?: boolean;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function stateSummary(state: WorldStateSnapshot) {
  return {
    capturedAt: state.capturedAt,
    activeProjects: state.activeProjects.value,
    activeTasks: state.activeTasks.value,
    repositories: state.repoStates.value,
    blockers: state.blockers.value,
    decisions: state.decisions.value,
  };
}

export async function runFuture(goal?: string, opts: OutputOptions = {}): Promise<void> {
  const correlationId = `future:${randomUUID()}`;
  const state = await captureRuntimeSnapshot({ correlationId, projectRoot: process.cwd() });
  if (!state) throw new Error("Could not capture current planning state");

  const store = new PlanningStore();
  try {
    const futureModel = new EmpiricalFutureModel({ examples: () => store.learningExamples() });
    const decision = await decideHarnessEntry(
      { state, ...(goal?.trim() ? { requestedOutcome: goal.trim() } : {}) },
      { futureModel },
    );
    const trace = buildPlanningTrace({
      snapshotId: state.id,
      goal: decision.intent || goal?.trim() || "current coding task",
      candidates: decision.evaluations,
      uncertainty: [
        ...decision.recommendation.blockingGaps.map((gap) => gap.description),
        ...decision.evaluations.flatMap((evaluation) => [
          ...evaluation.prediction.assumptions,
          ...evaluation.prediction.risks,
        ]),
      ],
    });
    trace.chosenActionId = decision.recommendation.actionId;
    trace.rejectedActionIds = decision.evaluations
      .map((candidate) => candidate.action.id)
      .filter((id) => id !== decision.recommendation.actionId);
    store.saveTrace(trace, correlationId);

    const candidates = decision.evaluations.map((evaluation) => ({
      id: evaluation.action.id,
      description: evaluation.action.description,
      kind: evaluation.action.kind,
      score: evaluation.score,
      scores: evaluation.scores,
      confidence: evaluation.prediction.confidence,
      expectedEffects: evaluation.prediction.expectedEffects,
      assumptions: evaluation.prediction.assumptions,
      risks: evaluation.prediction.risks,
      outcomeForecast: evaluation.prediction.outcomeForecast,
    }));
    const result = {
      correlationId,
      current: stateSummary(state),
      goal: decision.intent || goal?.trim() || null,
      recommendation: decision.recommendation,
      candidates,
    };

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log("CURRENT");
    const primaryRepo = state.repoStates.value[0];
    if (primaryRepo) {
      console.log(`  repo: ${primaryRepo.root}${primaryRepo.branch ? ` @ ${primaryRepo.branch}` : ""}${primaryRepo.dirty ? " (dirty)" : ""}`);
    } else {
      console.log("  repo: unknown");
    }
    const activeTask = state.activeTasks.value[0];
    console.log(`  task: ${activeTask ? `${activeTask.description} [${activeTask.status}]` : "none"}`);
    console.log(`  blockers: ${state.blockers.value.length ? state.blockers.value.join("; ") : "none"}`);

    console.log("\nGOAL");
    console.log(`  ${decision.intent || goal?.trim() || "needs a concrete coding outcome"}`);

    console.log("\nOPTIONS");
    if (decision.evaluations.length === 0) console.log("  none");
    decision.evaluations.forEach((evaluation, index) => {
      console.log(`  ${index + 1}. ${evaluation.action.description}`);
      console.log(`     score ${percent(evaluation.score)} · progress ${percent(evaluation.scores.progress)} · reach ${percent(evaluation.scores.reachability)} · risk ${percent(evaluation.scores.risk)} · confidence ${evaluation.prediction.confidence.level}`);
      if (evaluation.prediction.expectedEffects.length > 0) {
        console.log(`     predicts: ${evaluation.prediction.expectedEffects.map((effect) => `${effect.path} → ${JSON.stringify(effect.after)}`).join("; ")}`);
      }
      if (evaluation.prediction.outcomeForecast) {
        console.log(`     history: ${percent(evaluation.prediction.outcomeForecast.successRate)} success across ${evaluation.prediction.outcomeForecast.samples} comparable runs`);
      }
    });

    const chosen = decision.evaluations.find((candidate) => candidate.action.id === decision.recommendation.actionId);
    console.log("\nCHOICE");
    console.log(`  ${decision.recommendation.mode}${chosen ? ` — ${chosen.action.description}` : ""}`);
    for (const reason of decision.recommendation.reasons) console.log(`  ${reason}`);
    for (const gap of decision.recommendation.blockingGaps) console.log(`  gap: ${gap.description}`);
    console.log(`\ntrace: ${trace.id}`);
  } finally {
    store.close();
  }
}

export async function runTrajectory(
  opts: OutputOptions & { limit?: number; repositoryRoot?: string } = {},
): Promise<void> {
  const store = new IntelligenceEventStore();
  try {
    const trajectories = buildTrajectoryViews(readAllEvents(store), {
      limit: opts.limit,
      repositoryRoot: opts.repositoryRoot,
    });
    if (opts.json) {
      console.log(JSON.stringify(trajectories, null, 2));
      return;
    }
    console.log(`TRAJECTORIES (${trajectories.length})\n`);
    if (trajectories.length === 0) {
      console.log("  none");
      return;
    }
    for (const trajectory of trajectories) {
      console.log(`  ${trajectory.intent || "(no intent)"}`);
      console.log(`    ${trajectory.surface}${trajectory.repositoryRoot ? ` · ${trajectory.repositoryRoot}` : ""}${trajectory.taskId ? ` · task ${trajectory.taskId}` : ""}`);
      console.log(`    ${trajectory.stateBeforeId ? "state captured" : "no before-state"} → ${trajectory.signal ?? "pending"} → ${trajectory.stateAfterId ? "state captured" : "no after-state"}`);
      if (trajectory.correction) console.log(`    correction: ${trajectory.correction}`);
      console.log(`    ${trajectory.correlationId}`);
    }
  } finally {
    store.close();
  }
}

export async function runDecisions(
  opts: OutputOptions & { limit?: number } = {},
): Promise<void> {
  const store = new IntelligenceEventStore();
  try {
    const inspection = buildPlanningInspection(readAllEvents(store), opts.limit ?? 20);
    if (opts.json) {
      console.log(JSON.stringify(inspection, null, 2));
      return;
    }

    const metrics = inspection.metrics;
    console.log("PLANNING FEEDBACK");
    console.log(`  predictions: ${metrics.predictionCount} (${metrics.resolvedPredictions} resolved, ${metrics.unresolvedPredictions} unresolved)`);
    console.log(`  prediction correctness: ${metrics.correctPredictions}/${metrics.scoredPredictions} (${percent(metrics.predictionSuccessRate)})`);
    console.log(`  supervised action success: ${metrics.successfulActions}/${metrics.actionOutcomes} (${percent(metrics.actionSuccessRate)})`);
    console.log(`  user corrections: ${metrics.userCorrections}/${metrics.transitionOutcomes} outcomes (${percent(metrics.userCorrectionRate)})`);
    if (metrics.confidenceBuckets.length > 0) {
      console.log(`  calibration: ${metrics.confidenceBuckets.map((bucket) => `${bucket.confidence} ${bucket.correct}/${bucket.scored}`).join(" · ")}`);
    }

    console.log(`\nRECENT DECISIONS (${inspection.decisions.length})\n`);
    if (inspection.decisions.length === 0) {
      console.log("  none");
      return;
    }
    for (const decision of inspection.decisions) {
      console.log(`  ${decision.goal}`);
      console.log(`    choice: ${decision.chosenAction?.description ?? "no action selected"}`);
      if (decision.chosenAction) {
        console.log(`    score ${percent(decision.chosenAction.score)} · confidence ${decision.chosenAction.confidence} · ${decision.candidates.length} candidate${decision.candidates.length === 1 ? "" : "s"}`);
      }
      if (decision.outcome) {
        console.log(`    outcome: ${decision.outcome.category}${decision.outcome.executionStatus ? ` · ${decision.outcome.executionStatus}` : ""}`);
      } else {
        console.log("    outcome: unresolved");
      }
      if (decision.uncertainty.length > 0) console.log(`    uncertainty: ${decision.uncertainty.join("; ")}`);
      console.log(`    trace ${decision.traceId}`);
    }
  } finally {
    store.close();
  }
}
