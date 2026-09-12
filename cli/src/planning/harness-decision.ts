import { ActionEvaluator, DeterministicFutureModel, type ActionEvaluation, type ActionScores, type CandidateAction, type ExecutionForecast, type FutureModel } from "./future-model.js";
import { DecisionPolicy, type DecisionRecommendation, type GoalSpec, type PlanningGap } from "./decision-policy.js";
import type { WorldStateSnapshot } from "../intelligence/world/types.js";

const RESUMABLE_STATUSES = new Set(["awaiting_grant", "ready", "running", "blocked"]);
const CONTEXTUAL_OUTCOME = /^(?:continue|carry on|resume|go ahead|do it|fix it|implement it|this|that|it)$/i;

type ActiveTask = { id?: string; description: string; status: string };

export interface HarnessDecision {
  recommendation: DecisionRecommendation;
  intent: string;
  activeTask: ActiveTask | null;
  /** Evaluation selected by policy. Kept for existing learning callers. */
  evaluation: ActionEvaluation;
  /** All legitimate candidates considered at the live decision boundary. */
  evaluations: ActionEvaluation[];
}

export interface HarnessDecisionDependencies {
  futureModel?: FutureModel;
}

function activeTask(state: WorldStateSnapshot): { task: ActiveTask; index: number } | null {
  const index = state.activeTasks.value.findIndex((task) => RESUMABLE_STATUSES.has(task.status));
  return index === -1 ? null : { task: state.activeTasks.value[index], index };
}

function goalFor(intent: string, active: ReturnType<typeof activeTask>): GoalSpec {
  if (active) {
    return {
      id: active.task.id ? `task:${active.task.id}` : `task:${intent}`,
      statement: active.task.description || intent,
      successCriteria: [{
        id: "task-completed",
        description: "the active task is completed",
        path: `activeTasks.value.${active.index}.status`,
        operator: "equals",
        value: "completed",
      }],
    };
  }
  return {
    id: `outcome:${intent || "unspecified"}`,
    statement: intent || "Clarify the intended coding outcome",
    successCriteria: [],
  };
}

function scores(kind: "execute" | "resume" | "investigate", forecast?: ExecutionForecast): ActionScores {
  const base: ActionScores = kind === "investigate"
    ? {
        progress: 0.55,
        reachability: 0.9,
        leverage: 0.75,
        urgency: 0.7,
        userEffort: 0.1,
        risk: 0.1,
        reversibility: 0.95,
        confidence: 0.8,
      }
    : {
        progress: kind === "resume" ? 0.9 : 0.8,
        reachability: 0.75,
        leverage: 0.7,
        urgency: 0.5,
        userEffort: 0.15,
        risk: 0.25,
        reversibility: 0.7,
        confidence: 0.7,
      };
  if (!forecast) return base;
  // Keep empirical execution reliability influential but bounded. Historical
  // success informs ranking; it never becomes execution authority.
  return {
    ...base,
    reachability: Math.max(0.2, Math.min(0.95, 0.35 + 0.6 * forecast.successRate)),
    risk: Math.max(0.05, Math.min(0.9, 0.1 + 0.75 * (1 - forecast.successRate))),
    confidence: forecast.samples >= 5 ? 0.85 : 0.72,
  };
}

async function evaluateCandidate(
  state: WorldStateSnapshot,
  action: CandidateAction,
  kind: "execute" | "resume" | "investigate",
  futureModel: FutureModel,
): Promise<ActionEvaluation> {
  const prediction = await futureModel.predict({
    currentState: state,
    candidateAction: action,
  });
  return new ActionEvaluator().evaluate(
    action,
    prediction,
    scores(kind, prediction.outcomeForecast),
  );
}

export async function decideHarnessEntry(input: {
  state: WorldStateSnapshot;
  requestedOutcome?: string;
}, deps: HarnessDecisionDependencies = {}): Promise<HarnessDecision> {
  const requested = input.requestedOutcome?.trim() ?? "";
  const active = activeTask(input.state);
  const contextual = !requested || CONTEXTUAL_OUTCOME.test(requested);
  const intent = contextual && active ? active.task.description : requested;
  const gaps: PlanningGap[] = [];
  const futureModel = deps.futureModel ?? new DeterministicFutureModel();
  const candidates: Array<{ action: CandidateAction; kind: "execute" | "resume" | "investigate" }> = [];

  if (contextual && !active) {
    gaps.push({
      id: "coding-outcome",
      kind: "user_preference",
      description: "No active task exists to resolve the contextual coding request",
      severity: "high",
      blocking: true,
      evidenceNeeded: "A concrete intended outcome from the user",
    });
  }

  if (active && contextual) {
    candidates.push({
      action: {
        id: "resume-active-task",
        description: `Resume: ${active.task.description}`,
        kind: "resume",
      },
      kind: "resume",
    });

    const blocker = input.state.blockers.value[0];
    const hasUnresolvedBlocker = active.task.status === "blocked" || input.state.blockers.value.length > 0;
    if (hasUnresolvedBlocker) {
      gaps.push({
        id: "active-task-blocker",
        kind: "missing_state",
        description: blocker
          ? `The active task still has a blocker: ${blocker}`
          : "The active task is blocked but the resolution is not yet known",
        severity: "high",
        blocking: true,
        evidenceNeeded: blocker
          ? "Evidence that identifies whether the blocker is actually resolved"
          : "The concrete cause of the active task blocker",
      });
      candidates.push({
        action: {
          id: "investigate-active-task-blocker",
          description: blocker
            ? `Investigate the active-task blocker before resuming: ${blocker}`
            : `Investigate why the active task is blocked before resuming: ${active.task.description}`,
          kind: "information_gathering",
          metadata: { resolvesGapIds: ["active-task-blocker"] },
        },
        kind: "investigate",
      });
    }
  } else {
    candidates.push({
      action: {
        id: "execute-requested-outcome",
        description: `Execute: ${intent}`,
        kind: "execution",
      },
      kind: "execute",
    });
  }

  const evaluations = await Promise.all(
    candidates.map(({ action, kind }) => evaluateCandidate(input.state, action, kind, futureModel)),
  );
  const recommendation = new DecisionPolicy().decide({
    goal: goalFor(intent, contextual ? active : null),
    state: input.state,
    evaluations,
    gaps,
  });
  const evaluation = evaluations.find((candidate) => candidate.action.id === recommendation.actionId)
    ?? evaluations[0]!;

  return {
    recommendation,
    intent,
    activeTask: active?.task ?? null,
    evaluation,
    evaluations,
  };
}
