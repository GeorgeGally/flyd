import type { WorldStateSnapshot } from "../intelligence/world/types.js";
import { DecisionPolicy, type PlanningGap } from "../planning/decision-policy.js";
import { EmpiricalFutureModel } from "../planning/empirical-future-model.js";
import {
  ActionEvaluator,
  MultiStepPlanner,
  buildPlanningTrace,
  type ActionEvaluation,
  type ActionScores,
  type CandidateAction,
  type CandidatePlan,
  type FutureModel,
} from "../planning/future-model.js";
import { captureRuntimeSnapshot } from "../planning/runtime-capture.js";
import { PlanningStore } from "../planning/store.js";
import type { ActionProposal, CurrentWork } from "./types.js";

export interface WorkActionSelection {
  proposal?: ActionProposal;
  evaluations: ActionEvaluation[];
  mode: "act" | "investigate" | "ask_user" | "defer" | "fallback";
  reasons: string[];
  /** Advisory lookahead only. Every future step must be replanned after observed reality changes. */
  plannedActionIds?: string[];
}

export interface WorkActionPlannerDependencies {
  capture: (input: { correlationId: string; projectRoot?: string | null }) => Promise<WorldStateSnapshot | null>;
  futureModel: FutureModel;
  saveTrace: (trace: ReturnType<typeof buildPlanningTrace>, correlationId: string) => void;
}

function liveFutureModel(): FutureModel {
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

const defaultDependencies: WorkActionPlannerDependencies = {
  capture: captureRuntimeSnapshot,
  futureModel: liveFutureModel(),
  saveTrace: (trace, correlationId) => {
    const store = new PlanningStore();
    try {
      store.saveTrace(trace, correlationId);
    } finally {
      store.close();
    }
  },
};

function isInformationGathering(proposal: ActionProposal): boolean {
  if (proposal.kind === "file_read" || proposal.kind === "file_grep") return true;
  if (proposal.kind === "shell_execute") {
    const text = `${proposal.description} ${(proposal.shellCommands ?? []).map((command) => command.command).join(" ")}`;
    return /\b(inspect|review|check|status|diff|log|show|list|read|grep|find|test|verify|validate|audit|analyse|analyze)\b/i.test(text)
      && !(proposal.shellCommands ?? []).some((command) => command.isDestructive);
  }
  return false;
}

function candidateAction(proposal: ActionProposal, blockedGapId?: string, targetRepoRoot?: string | null): CandidateAction {
  const informationGathering = isInformationGathering(proposal);
  const ownedRepoRoot = proposal.targetFingerprint.repositoryRoot ?? targetRepoRoot ?? undefined;
  return {
    id: proposal.actionId,
    description: proposal.description,
    kind: informationGathering ? "information_gathering" : proposal.kind,
    metadata: {
      proposalKind: proposal.kind,
      finishCondition: proposal.finishCondition,
      ...(ownedRepoRoot ? { targetRepoRoot: ownedRepoRoot } : {}),
      ...(informationGathering && blockedGapId ? { resolvesGapIds: [blockedGapId] } : {}),
    },
  };
}

function baseScores(proposal: ActionProposal, currentWork: CurrentWork): ActionScores {
  const stage = currentWork.stage.value;
  const destructive = (proposal.shellCommands ?? []).some((command) => command.isDestructive);
  const blocked = currentWork.nextAction.value.readiness === "blocked" || currentWork.openLoops.some((loop) => loop.status === "blocked");
  const informationGathering = isInformationGathering(proposal);

  let scores: ActionScores;
  switch (proposal.kind) {
    case "file_read":
    case "file_grep":
      scores = { progress: 0.48, reachability: 0.96, leverage: 0.68, urgency: 0.62, userEffort: 0.04, risk: 0.03, reversibility: 0.99, confidence: 0.88 };
      break;
    case "task_plan":
      scores = { progress: 0.58, reachability: 0.92, leverage: 0.76, urgency: 0.58, userEffort: 0.08, risk: 0.04, reversibility: 0.98, confidence: 0.84 };
      break;
    case "text_edit":
      scores = { progress: 0.82, reachability: 0.92, leverage: 0.74, urgency: 0.62, userEffort: 0.08, risk: 0.12, reversibility: 0.92, confidence: 0.82 };
      break;
    case "file_write":
      scores = { progress: 0.84, reachability: 0.82, leverage: 0.78, urgency: 0.64, userEffort: 0.12, risk: 0.28, reversibility: 0.72, confidence: 0.76 };
      break;
    case "repository_action":
      scores = { progress: 0.92, reachability: 0.72, leverage: 0.9, urgency: 0.7, userEffort: 0.16, risk: 0.34, reversibility: 0.64, confidence: 0.72 };
      break;
    case "shell_execute":
      scores = destructive
        ? { progress: 0.86, reachability: 0.62, leverage: 0.82, urgency: 0.64, userEffort: 0.12, risk: 0.88, reversibility: 0.22, confidence: 0.54 }
        : { progress: 0.78, reachability: 0.86, leverage: 0.74, urgency: 0.62, userEffort: 0.08, risk: 0.18, reversibility: 0.82, confidence: 0.8 };
      break;
    default:
      scores = { progress: 0.68, reachability: 0.78, leverage: 0.68, urgency: 0.56, userEffort: 0.1, risk: 0.24, reversibility: 0.74, confidence: 0.7 };
  }

  if (blocked) {
    if (informationGathering) {
      scores = { ...scores, progress: Math.max(scores.progress, 0.64), leverage: Math.max(scores.leverage, 0.84), urgency: Math.max(scores.urgency, 0.78) };
    } else {
      scores = { ...scores, reachability: Math.min(scores.reachability, 0.42), risk: Math.max(scores.risk, 0.55), confidence: Math.min(scores.confidence, 0.56) };
    }
  }

  if (stage === "review" && informationGathering) {
    scores = { ...scores, progress: Math.max(scores.progress, 0.7), leverage: Math.max(scores.leverage, 0.8) };
  }
  if (stage === "execution" && !informationGathering) {
    scores = { ...scores, progress: Math.min(1, scores.progress + 0.05), urgency: Math.min(1, scores.urgency + 0.05) };
  }
  return scores;
}

function applyForecast(scores: ActionScores, evaluation: Awaited<ReturnType<FutureModel["predict"]>>): ActionScores {
  const forecast = evaluation.outcomeForecast;
  if (!forecast) return scores;
  return {
    ...scores,
    reachability: Math.max(0.15, Math.min(0.97, 0.35 + 0.62 * forecast.successRate)),
    risk: Math.max(scores.risk, Math.min(0.92, 0.08 + 0.78 * (1 - forecast.successRate))),
    confidence: forecast.samples >= 5 ? Math.max(scores.confidence, 0.84) : Math.max(scores.confidence, 0.72),
  };
}

function lookaheadScores(scores: ActionScores, depth: number): ActionScores {
  const discount = Math.max(0.6, 1 - depth * 0.2);
  return {
    ...scores,
    progress: scores.progress * discount,
    leverage: scores.leverage * discount,
    urgency: scores.urgency * discount,
    userEffort: Math.min(1, scores.userEffort * (1 + depth * 0.1)),
    risk: Math.min(1, scores.risk * (1 + depth * 0.08)),
  };
}

function blockingGap(currentWork: CurrentWork): PlanningGap | undefined {
  const blockedLoop = currentWork.openLoops.find((loop) => loop.status === "blocked");
  if (currentWork.nextAction.value.readiness !== "blocked" && !blockedLoop) return undefined;
  return {
    id: "current-work-blocker",
    kind: "missing_state",
    description: blockedLoop?.description ?? `The current next action is blocked: ${currentWork.nextAction.value.description}`,
    severity: "high",
    blocking: true,
    evidenceNeeded: "Evidence that identifies or clears the current work blocker before mutation",
  };
}

async function boundedLookahead(input: {
  state: WorldStateSnapshot;
  candidates: ActionProposal[];
  actions: CandidateAction[];
  currentWork: CurrentWork;
  selectedActionId?: string;
  futureModel: FutureModel;
}): Promise<CandidatePlan | null> {
  if (!input.selectedActionId || input.actions.length < 2) return null;
  const byId = new Map(input.candidates.map((proposal) => [proposal.actionId, proposal]));
  const plans = await new MultiStepPlanner(input.futureModel).plan({
    state: input.state,
    actions: input.actions,
    maxDepth: Math.min(3, input.actions.length),
    maxCandidates: 8,
    score: (action, prediction, depth) => {
      const proposal = byId.get(action.id);
      if (!proposal) {
        return { progress: 0, reachability: 0, leverage: 0, urgency: 0, userEffort: 1, risk: 1, reversibility: 0, confidence: 0 };
      }
      return lookaheadScores(applyForecast(baseScores(proposal, input.currentWork), prediction), depth);
    },
  });
  return plans.find((plan) => plan.steps[0]?.action.id === input.selectedActionId) ?? null;
}

export async function selectWorkIntelligenceAction(input: {
  intent: string;
  interactionId: string;
  currentWork: CurrentWork;
  candidates: ActionProposal[];
  projectRoot?: string | null;
}, deps: WorkActionPlannerDependencies = defaultDependencies): Promise<WorkActionSelection> {
  if (input.candidates.length === 0) {
    return { evaluations: [], mode: "fallback", reasons: ["no executable action candidates were proposed"] };
  }

  let state: WorldStateSnapshot | null = null;
  try {
    state = await deps.capture({ correlationId: `work:${input.interactionId}`, projectRoot: input.projectRoot });
  } catch {
    // Planning must never make the interaction unavailable.
  }
  if (!state) {
    return {
      proposal: input.candidates[0],
      evaluations: [],
      mode: "fallback",
      reasons: ["no canonical world snapshot was available; retained the model's first bounded proposal"],
    };
  }

  const boundedCandidates = input.candidates.slice(0, 3);
  const gap = blockingGap(input.currentWork);
  const evaluator = new ActionEvaluator();
  const actions = boundedCandidates.map((proposal) => candidateAction(proposal, gap?.id, input.projectRoot));
  const evaluations = await Promise.all(actions.map(async (action) => {
    const proposal = boundedCandidates.find((candidate) => candidate.actionId === action.id)!;
    const prediction = await deps.futureModel.predict({ currentState: state!, candidateAction: action });
    return evaluator.evaluate(action, prediction, applyForecast(baseScores(proposal, input.currentWork), prediction));
  }));

  const recommendation = new DecisionPolicy().decide({
    goal: {
      id: `work:${input.interactionId}`,
      statement: input.intent,
      successCriteria: [],
      constraints: input.currentWork.constraints.value,
    },
    state,
    evaluations,
    gaps: gap ? [gap] : [],
  });
  const selected = recommendation.actionId
    ? boundedCandidates.find((proposal) => proposal.actionId === recommendation.actionId)
    : undefined;

  let plannedActionIds: string[] | undefined;
  try {
    const plan = await boundedLookahead({
      state,
      candidates: boundedCandidates,
      actions,
      currentWork: input.currentWork,
      selectedActionId: recommendation.actionId,
      futureModel: deps.futureModel,
    });
    if (plan && plan.steps.length > 1) {
      plannedActionIds = plan.steps.map((step) => step.action.id);
      const selectedEvaluation = evaluations.find((item) => item.action.id === recommendation.actionId);
      if (selectedEvaluation) {
        selectedEvaluation.action.metadata = {
          ...selectedEvaluation.action.metadata,
          lookaheadActionIds: plannedActionIds,
          lookaheadHorizon: plannedActionIds.length,
          lookaheadAdvisory: true,
        };
      }
    }
  } catch {
    // Lookahead is optional planning intelligence; immediate policy still stands.
  }

  const trace = buildPlanningTrace({
    snapshotId: state.id,
    goal: input.intent,
    candidates: evaluations,
    uncertainty: [
      ...input.currentWork.uncertainty.map((item) => `${item.field}: ${item.reason}`),
      ...(gap ? [gap.description] : []),
    ],
  });
  trace.chosenActionId = recommendation.actionId;
  trace.rejectedActionIds = evaluations.map((item) => item.action.id).filter((id) => id !== recommendation.actionId);
  try {
    deps.saveTrace(trace, `work:${input.interactionId}`);
  } catch {
    // Planning telemetry is best-effort and cannot fail the interaction.
  }

  return {
    proposal: selected,
    evaluations,
    mode: recommendation.mode,
    reasons: [
      ...recommendation.reasons,
      ...(plannedActionIds ? [`bounded lookahead: ${plannedActionIds.join(" -> ")}; only step 1 is eligible for approval`] : []),
    ],
    ...(plannedActionIds ? { plannedActionIds } : {}),
  };
}
