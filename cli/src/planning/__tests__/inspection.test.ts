import { describe, expect, it } from "vitest";
import type { StoredEvent } from "../../intelligence/event-store.js";
import { buildPlanningInspection, buildTrajectoryViews } from "../inspection.js";

function storedEvent(input: {
  sequence: number;
  sourceId: string;
  kind: string;
  correlationId?: string;
  payload: Record<string, unknown>;
}): StoredEvent {
  return {
    sequence: input.sequence,
    id: `event-${input.sequence}`,
    schemaVersion: 1,
    kind: input.kind,
    sourceId: input.sourceId,
    capturedAt: `2026-09-13T00:00:${String(input.sequence).padStart(2, "0")}.000Z`,
    consentJson: "{}",
    retentionClass: "local_default",
    provenance: "test",
    idempotencyKey: `test-${input.sequence}`,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    causationIds: [],
    evidenceRefs: [],
    payloadDomain: `domain:${input.sourceId}`,
    payload: input.payload,
    redacted: false,
    erased: false,
  };
}

function planningTracePayload() {
  return {
    type: "planning_trace",
    trace: {
      id: "trace-1",
      createdAt: "2026-09-13T00:00:03.000Z",
      snapshotId: "snapshot-before",
      goal: "Fix failing tests",
      chosenActionId: "investigate",
      rejectedActionIds: ["rewrite"],
      uncertainty: ["root cause is not yet verified"],
      candidates: [
        {
          action: { id: "investigate", description: "Investigate failing test", kind: "information_gathering" },
          prediction: {
            id: "prediction-1",
            snapshotId: "snapshot-before",
            actionId: "investigate",
            horizon: 1,
            predictedState: {},
            expectedEffects: [],
            assumptions: [],
            confidence: { level: "medium", reasons: [] },
            risks: [],
            createdAt: "2026-09-13T00:00:03.000Z",
          },
          scores: {
            progress: 0.55,
            reachability: 0.9,
            leverage: 0.75,
            urgency: 0.7,
            userEffort: 0.1,
            risk: 0.1,
            reversibility: 0.95,
            confidence: 0.8,
          },
          score: 0.64,
          reasons: [],
        },
        {
          action: { id: "rewrite", description: "Rewrite subsystem", kind: "execution" },
          prediction: {
            id: "prediction-2",
            snapshotId: "snapshot-before",
            actionId: "rewrite",
            horizon: 1,
            predictedState: {},
            expectedEffects: [],
            assumptions: [],
            confidence: { level: "low", reasons: [] },
            risks: ["large change"],
            createdAt: "2026-09-13T00:00:03.000Z",
          },
          scores: {
            progress: 0.9,
            reachability: 0.4,
            leverage: 0.8,
            urgency: 0.4,
            userEffort: 0.8,
            risk: 0.8,
            reversibility: 0.2,
            confidence: 0.4,
          },
          score: 0.41,
          reasons: [],
        },
      ],
    },
  };
}

describe("planning inspection", () => {
  it("reconstructs a trajectory across action and observed next-state events", () => {
    const events = [
      storedEvent({
        sequence: 1,
        sourceId: "transition.harness",
        kind: "proposed_action",
        correlationId: "run-1",
        payload: {
          stateBeforeId: "snapshot-before",
          repositoryRoot: "/repo/flyd",
          taskId: "task-1",
          actor: { surface: "harness" },
          action: { intent: "Investigate failing test" },
        },
      }),
      storedEvent({
        sequence: 2,
        sourceId: "transition.harness",
        kind: "verified_outcome",
        correlationId: "run-1",
        payload: {
          stateAfterId: "snapshot-after",
          nextState: { origin: "verifier", signal: "verified", causalComplete: true },
        },
      }),
    ];

    const [trajectory] = buildTrajectoryViews(events);
    expect(trajectory).toMatchObject({
      correlationId: "run-1",
      intent: "Investigate failing test",
      repositoryRoot: "/repo/flyd",
      taskId: "task-1",
      stateBeforeId: "snapshot-before",
      stateAfterId: "snapshot-after",
      signal: "verified",
      causalComplete: true,
    });
  });

  it("filters trajectories by repository and keeps newest first", () => {
    const events = [
      storedEvent({ sequence: 1, sourceId: "transition.harness", kind: "proposed_action", correlationId: "old", payload: { repositoryRoot: "/repo/one", action: { intent: "Old" } } }),
      storedEvent({ sequence: 2, sourceId: "transition.harness", kind: "proposed_action", correlationId: "new", payload: { repositoryRoot: "/repo/two", action: { intent: "New" } } }),
    ];

    expect(buildTrajectoryViews(events).map((item) => item.correlationId)).toEqual(["new", "old"]);
    expect(buildTrajectoryViews(events, { repositoryRoot: "one" }).map((item) => item.correlationId)).toEqual(["old"]);
  });

  it("links decisions to reconciled outcomes and reports feedback metrics", () => {
    const events = [
      storedEvent({
        sequence: 3,
        sourceId: "planning.runtime",
        kind: "observation",
        correlationId: "run-1",
        payload: planningTracePayload(),
      }),
      storedEvent({
        sequence: 4,
        sourceId: "planning.runtime",
        kind: "observation",
        correlationId: "run-1",
        payload: {
          type: "prediction_outcome",
          outcome: {
            id: "outcome-1",
            predictionId: "prediction-1",
            observedSnapshotId: "snapshot-after",
            correctEffects: [],
            incorrectEffects: [],
            missedEffects: [],
            confidenceAtPrediction: { level: "medium", reasons: [] },
            horizon: 1,
            category: "correct",
            executionStatus: "completed",
            executionSignal: "verified",
            reconciledAt: "2026-09-13T00:00:04.000Z",
          },
        },
      }),
      storedEvent({
        sequence: 5,
        sourceId: "transition.harness",
        kind: "verified_outcome",
        correlationId: "run-1",
        payload: { nextState: { signal: "verified", correction: "Check config first" } },
      }),
    ];

    const inspection = buildPlanningInspection(events);
    expect(inspection.metrics).toMatchObject({
      predictionCount: 1,
      resolvedPredictions: 1,
      scoredPredictions: 1,
      correctPredictions: 1,
      predictionSuccessRate: 1,
      actionOutcomes: 1,
      successfulActions: 1,
      actionSuccessRate: 1,
      transitionOutcomes: 1,
      userCorrections: 1,
      userCorrectionRate: 1,
    });
    expect(inspection.metrics.confidenceBuckets).toEqual([
      { confidence: "medium", total: 1, scored: 1, correct: 1, correctRate: 1 },
    ]);
    expect(inspection.decisions[0]).toMatchObject({
      goal: "Fix failing tests",
      chosenAction: { id: "investigate", description: "Investigate failing test" },
      outcome: { category: "correct", executionStatus: "completed" },
    });
  });
});
