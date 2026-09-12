import type { StoredEvent } from "../intelligence/event-store.js";
import type { PlanningConfidence } from "../intelligence/world/types.js";
import type { PlanningTrace, PredictionOutcome } from "./future-model.js";

export interface TrajectoryView {
  correlationId: string;
  surface: string;
  intent: string;
  repositoryRoot?: string;
  taskId?: string;
  threadId?: string;
  stateBeforeId?: string;
  stateAfterId?: string;
  actionSequence?: number;
  actionAt?: string;
  outcomeSequence?: number;
  outcomeAt?: string;
  signal?: string;
  correction?: string;
  causalComplete?: boolean;
  latestSequence: number;
}

export interface PlanningDecisionCandidateView {
  id: string;
  description: string;
  kind?: string;
  score: number;
  confidence: PlanningConfidence;
  expectedEffects: number;
  risks: string[];
}

export interface PlanningDecisionView {
  sequence: number;
  traceId: string;
  createdAt: string;
  goal: string;
  chosenAction?: PlanningDecisionCandidateView;
  candidates: PlanningDecisionCandidateView[];
  rejectedActionIds: string[];
  uncertainty: string[];
  outcome?: {
    category: PredictionOutcome["category"];
    executionStatus?: string;
    executionSignal?: string;
    reconciledAt: string;
  };
}

export interface PlanningInspectionMetrics {
  predictionCount: number;
  resolvedPredictions: number;
  unresolvedPredictions: number;
  scoredPredictions: number;
  correctPredictions: number;
  predictionSuccessRate: number;
  actionOutcomes: number;
  successfulActions: number;
  actionSuccessRate: number;
  transitionOutcomes: number;
  userCorrections: number;
  userCorrectionRate: number;
  confidenceBuckets: Array<{
    confidence: PlanningConfidence;
    total: number;
    scored: number;
    correct: number;
    correctRate: number;
  }>;
}

export interface PlanningInspection {
  metrics: PlanningInspectionMetrics;
  decisions: PlanningDecisionView[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function rate(numerator: number, denominator: number): number {
  return denominator ? Math.round((numerator / denominator) * 1000) / 1000 : 0;
}

export function readAllEvents(store: { readFrom(afterSequence: number, limit?: number): StoredEvent[] }): StoredEvent[] {
  const events: StoredEvent[] = [];
  let cursor = 0;
  while (true) {
    const batch = store.readFrom(cursor, 1000);
    if (batch.length === 0) break;
    events.push(...batch);
    cursor = batch[batch.length - 1]!.sequence;
    if (batch.length < 1000) break;
  }
  return events;
}

export function buildTrajectoryViews(
  events: StoredEvent[],
  options: { limit?: number; repositoryRoot?: string } = {},
): TrajectoryView[] {
  const byCorrelation = new Map<string, TrajectoryView>();

  for (const event of events) {
    if (event.erased || !event.correlationId || !event.sourceId.startsWith("transition.")) continue;
    const payload = record(event.payload);
    if (!payload) continue;
    const action = record(payload.action);
    const nextState = record(payload.nextState);
    if (!action && !nextState) continue;

    const actor = record(payload.actor);
    const existing: TrajectoryView = byCorrelation.get(event.correlationId) ?? {
      correlationId: event.correlationId,
      surface: text(actor?.surface) ?? event.sourceId.replace(/^transition\./, ""),
      intent: "",
      latestSequence: event.sequence,
    };

    existing.latestSequence = Math.max(existing.latestSequence, event.sequence);
    if (action) {
      existing.intent = text(action.intent) ?? existing.intent;
      existing.surface = text(actor?.surface) ?? existing.surface;
      existing.repositoryRoot = text(payload.repositoryRoot) ?? existing.repositoryRoot;
      existing.taskId = text(payload.taskId) ?? existing.taskId;
      existing.threadId = text(payload.threadId) ?? existing.threadId;
      existing.stateBeforeId = text(payload.stateBeforeId) ?? existing.stateBeforeId;
      existing.actionSequence = event.sequence;
      existing.actionAt = event.capturedAt;
    }
    if (nextState) {
      existing.signal = text(nextState.signal) ?? existing.signal;
      existing.correction = text(nextState.correction) ?? existing.correction;
      existing.causalComplete = bool(nextState.causalComplete) ?? existing.causalComplete;
      existing.stateAfterId = text(payload.stateAfterId) ?? existing.stateAfterId;
      existing.outcomeSequence = event.sequence;
      existing.outcomeAt = event.capturedAt;
    }
    byCorrelation.set(event.correlationId, existing);
  }

  const repositoryFilter = options.repositoryRoot?.trim();
  return [...byCorrelation.values()]
    .filter((trajectory) => !repositoryFilter || trajectory.repositoryRoot?.includes(repositoryFilter))
    .sort((a, b) => b.latestSequence - a.latestSequence)
    .slice(0, Math.max(1, options.limit ?? 20));
}

function candidateView(candidate: PlanningTrace["candidates"][number]): PlanningDecisionCandidateView {
  return {
    id: candidate.action.id,
    description: candidate.action.description,
    ...(candidate.action.kind ? { kind: candidate.action.kind } : {}),
    score: candidate.score,
    confidence: candidate.prediction.confidence.level,
    expectedEffects: candidate.prediction.expectedEffects.length,
    risks: candidate.prediction.risks,
  };
}

export function buildPlanningInspection(events: StoredEvent[], limit = 20): PlanningInspection {
  const traceEvents: Array<{ sequence: number; trace: PlanningTrace }> = [];
  const outcomes = new Map<string, PredictionOutcome>();

  for (const event of events) {
    if (event.erased || event.sourceId !== "planning.runtime") continue;
    const payload = record(event.payload);
    if (payload?.type === "planning_trace" && payload.trace) {
      traceEvents.push({ sequence: event.sequence, trace: payload.trace as unknown as PlanningTrace });
    } else if (payload?.type === "prediction_outcome" && payload.outcome) {
      const outcome = payload.outcome as unknown as PredictionOutcome;
      outcomes.set(outcome.predictionId, outcome);
    }
  }

  const decisions = traceEvents
    .sort((a, b) => b.sequence - a.sequence)
    .slice(0, Math.max(1, limit))
    .map(({ sequence, trace }): PlanningDecisionView => {
      const chosen = trace.candidates.find((candidate) => candidate.action.id === trace.chosenActionId);
      const outcome = chosen ? outcomes.get(chosen.prediction.id) : undefined;
      return {
        sequence,
        traceId: trace.id,
        createdAt: trace.createdAt,
        goal: trace.goal,
        ...(chosen ? { chosenAction: candidateView(chosen) } : {}),
        candidates: trace.candidates.map(candidateView),
        rejectedActionIds: trace.rejectedActionIds,
        uncertainty: trace.uncertainty,
        ...(outcome ? {
          outcome: {
            category: outcome.category,
            ...(outcome.executionStatus ? { executionStatus: outcome.executionStatus } : {}),
            ...(outcome.executionSignal ? { executionSignal: outcome.executionSignal } : {}),
            reconciledAt: outcome.reconciledAt,
          },
        } : {}),
      };
    });

  const chosenPredictions = traceEvents
    .map(({ trace }) => trace.candidates.find((candidate) => candidate.action.id === trace.chosenActionId)?.prediction.id)
    .filter((id): id is string => Boolean(id));
  const chosenSet = new Set(chosenPredictions);
  const resolved = [...outcomes.values()].filter((outcome) => chosenSet.has(outcome.predictionId));
  const scored = resolved.filter((outcome) => outcome.category !== "insufficient_evidence");
  const correct = scored.filter((outcome) => outcome.category === "correct");
  const actionOutcomes = resolved.filter((outcome) => typeof outcome.executionStatus === "string");
  const successfulActions = actionOutcomes.filter((outcome) => outcome.executionStatus === "completed");

  const transitionNextStates = events.filter((event) => {
    if (event.erased || !event.sourceId.startsWith("transition.")) return false;
    return Boolean(record(event.payload)?.nextState);
  });
  const userCorrections = transitionNextStates.filter((event) => {
    const nextState = record(record(event.payload)?.nextState);
    return Boolean(text(nextState?.correction));
  });

  const confidenceMap = new Map<PlanningConfidence, { total: number; scored: number; correct: number }>();
  for (const outcome of resolved) {
    const level = outcome.confidenceAtPrediction.level;
    const bucket = confidenceMap.get(level) ?? { total: 0, scored: 0, correct: 0 };
    bucket.total += 1;
    if (outcome.category !== "insufficient_evidence") {
      bucket.scored += 1;
      if (outcome.category === "correct") bucket.correct += 1;
    }
    confidenceMap.set(level, bucket);
  }
  const confidenceOrder: PlanningConfidence[] = ["high", "medium", "low", "unknown"];
  const confidenceBuckets = confidenceOrder
    .filter((level) => confidenceMap.has(level))
    .map((confidence) => {
      const bucket = confidenceMap.get(confidence)!;
      return {
        confidence,
        total: bucket.total,
        scored: bucket.scored,
        correct: bucket.correct,
        correctRate: rate(bucket.correct, bucket.scored),
      };
    });

  return {
    metrics: {
      predictionCount: chosenPredictions.length,
      resolvedPredictions: resolved.length,
      unresolvedPredictions: Math.max(0, chosenPredictions.length - resolved.length),
      scoredPredictions: scored.length,
      correctPredictions: correct.length,
      predictionSuccessRate: rate(correct.length, scored.length),
      actionOutcomes: actionOutcomes.length,
      successfulActions: successfulActions.length,
      actionSuccessRate: rate(successfulActions.length, actionOutcomes.length),
      transitionOutcomes: transitionNextStates.length,
      userCorrections: userCorrections.length,
      userCorrectionRate: rate(userCorrections.length, transitionNextStates.length),
      confidenceBuckets,
    },
    decisions,
  };
}
