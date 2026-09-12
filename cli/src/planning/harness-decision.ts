import { ActionEvaluator, DeterministicFutureModel, type ActionEvaluation, type ActionScores, type CandidateAction, type FutureModel } from "./future-model.js";
import { DecisionPolicy, type DecisionRecommendation, type GoalSpec, type PlanningGap } from "./decision-policy.js";
import type { WorldStateSnapshot } from "../intelligence/world/types.js";

const RESUMABLE_STATUSES = new Set(["awaiting_grant", "ready", "running", "blocked"]);
const CONTEXTUAL_OUTCOME = /^(?:continue|carry on|resume|go ahead|do it|fix it|implement it|this|that|it)$/i;

type ActiveTask = { id?: string; description: string; status: string };

export interface HarnessDecision {
  recommendation: DecisionRecommendation;
  intent: string;
  activeTask: ActiveTask | null;
  evaluation: ActionEvaluation;
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

function scores(kind: "execute" | "resume"): ActionScores {
  return {
    progress: kind === "resume" ? 0.9 : 0.8,
    reachability: 0.75,
    leverage: 0.7,
    urgency: 0.5,
    userEffort: 0.15,
    risk: 0.25,
    reversibility: 0.7,
    confidence: 0.7,
  };
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

  const action: CandidateAction = {
    id: active && contextual ? "resume-active-task" : "execute-requested-outcome",
    description: active && contextual ? `Resume: ${active.task.description}` : `Execute: ${intent}`,
    kind: active && contextual ? "resume" : "execution",
  };
  const prediction = await (deps.futureModel ?? new DeterministicFutureModel()).predict({
    currentState: input.state,
    candidateAction: action,
  });
  const evaluation = new ActionEvaluator().evaluate(
    action,
    prediction,
    scores(active && contextual ? "resume" : "execute"),
  );
  const recommendation = new DecisionPolicy().decide({
    goal: goalFor(intent, active),
    state: input.state,
    evaluations: [evaluation],
    gaps,
  });

  return { recommendation, intent, activeTask: active?.task ?? null, evaluation };
}
