import { randomUUID } from "node:crypto";
import { ActionEvaluator, DeterministicFutureModel, type ActionScores, type CandidateAction, type WorldStateSnapshot } from "./world-model.js";

interface BenchmarkAction {
  action: CandidateAction;
  scores: ActionScores;
}

export interface PlanningBenchmarkScenario {
  name: string;
  goal: string;
  expectedActionId: string;
  actions: BenchmarkAction[];
}

function baseState(): WorldStateSnapshot {
  const fact = <T>(value: T) => ({ value, confidence: "high" as const, provenance: ["planning-benchmark"] });
  return {
    id: randomUUID(), capturedAt: new Date(0).toISOString(),
    activeProjects: fact(["flyd"]), activeTasks: fact([]), repoStates: fact([]), blockers: fact([]),
    decisions: fact([]), commitments: fact([]), entities: fact([]), deadlines: fact([]), agentWork: fact([]),
  };
}

const score = (overrides: Partial<ActionScores>): ActionScores => ({
  progress: 0.5, reachability: 0.7, leverage: 0.5, urgency: 0.5,
  userEffort: 0.3, risk: 0.2, reversibility: 0.8, confidence: 0.7, ...overrides,
});

const action = (id: string, description: string): CandidateAction => ({ id, description });

export const PLANNING_BENCHMARK: PlanningBenchmarkScenario[] = [
  { name: "dirty repo: finish active fix", goal: "ship fix", expectedActionId: "finish", actions: [{ action: action("finish", "finish active fix"), scores: score({ progress: .9, urgency: .8 }) }, { action: action("research", "research alternatives"), scores: score({ progress: .3 }) }] },
  { name: "failing build: repair before feature", goal: "restore shippable state", expectedActionId: "repair", actions: [{ action: action("repair", "repair build"), scores: score({ progress: .9, urgency: 1 }) }, { action: action("feature", "add feature"), scores: score({ progress: .5, risk: .8 }) }] },
  { name: "urgent external dependency", goal: "unblock launch", expectedActionId: "ping", actions: [{ action: action("ping", "resolve external dependency"), scores: score({ urgency: 1, leverage: .9 }) }, { action: action("polish", "polish UI"), scores: score({ progress: .5 }) }] },
  { name: "reachable beats superficially close", goal: "complete migration", expectedActionId: "reachable", actions: [{ action: action("close", "attempt final migration"), scores: score({ progress: 1, reachability: .05, risk: .9 }) }, { action: action("reachable", "remove migration blocker"), scores: score({ progress: .7, reachability: .95, leverage: .9 }) }] },
  { name: "low risk beats risky shortcut", goal: "deploy safely", expectedActionId: "safe", actions: [{ action: action("shortcut", "force deploy"), scores: score({ progress: .9, risk: 1, reversibility: .1 }) }, { action: action("safe", "verify then deploy"), scores: score({ progress: .75, risk: .1, confidence: .9 }) }] },
  { name: "user effort penalty", goal: "resolve automatically", expectedActionId: "automatic", actions: [{ action: action("ask", "ask user for manual work"), scores: score({ progress: .8, userEffort: 1 }) }, { action: action("automatic", "use existing evidence"), scores: score({ progress: .7, userEffort: .05 }) }] },
  { name: "reversible experiment", goal: "test uncertain hypothesis", expectedActionId: "experiment", actions: [{ action: action("experiment", "run reversible experiment"), scores: score({ leverage: .8, reversibility: 1, risk: .1 }) }, { action: action("rewrite", "rewrite subsystem"), scores: score({ leverage: .8, reversibility: .1, risk: .8 }) }] },
  { name: "stale context lowers confidence", goal: "choose current task", expectedActionId: "refresh", actions: [{ action: action("guess", "act on stale context"), scores: score({ progress: .7, confidence: .1 }) }, { action: action("refresh", "refresh state first"), scores: score({ progress: .5, confidence: 1, reachability: 1 }) }] },
  { name: "decision has leverage", goal: "unstick implementation", expectedActionId: "decide", actions: [{ action: action("decide", "resolve architectural decision"), scores: score({ leverage: 1, urgency: .8 }) }, { action: action("cleanup", "cleanup tests"), scores: score({ leverage: .2 }) }] },
  { name: "blocker removal", goal: "resume blocked task", expectedActionId: "unblock", actions: [{ action: action("unblock", "remove blocker"), scores: score({ progress: .8, leverage: 1 }) }, { action: action("side", "start side task"), scores: score({ progress: .3 }) }] },
  { name: "approval boundary", goal: "prepare destructive action", expectedActionId: "prepare", actions: [{ action: action("execute", "execute unapproved action"), scores: score({ progress: 1, reachability: .1, risk: 1 }) }, { action: action("prepare", "prepare approval request"), scores: score({ progress: .6, reachability: 1, risk: .05 }) }] },
  { name: "failed previous action", goal: "recover", expectedActionId: "alternative", actions: [{ action: action("retry", "blindly retry"), scores: score({ reachability: .2, confidence: .2 }) }, { action: action("alternative", "use diagnosed alternative"), scores: score({ reachability: .9, confidence: .9 }) }] },
  { name: "urgent email vs cleanup", goal: "protect commitment", expectedActionId: "reply", actions: [{ action: action("reply", "reply to urgent dependency"), scores: score({ urgency: 1, leverage: .8 }) }, { action: action("cleanup", "cleanup code"), scores: score({ urgency: .1 }) }] },
  { name: "commitment beats novelty", goal: "honor commitment", expectedActionId: "commitment", actions: [{ action: action("novel", "explore new idea"), scores: score({ leverage: .5, urgency: .1 }) }, { action: action("commitment", "finish promised deliverable"), scores: score({ progress: .9, urgency: .9 }) }] },
  { name: "high confidence execution", goal: "make progress", expectedActionId: "known", actions: [{ action: action("known", "perform known transition"), scores: score({ confidence: 1, reachability: .95 }) }, { action: action("speculative", "speculative transition"), scores: score({ confidence: .1, reachability: .4, leverage: .8 }) }] },
  { name: "leverage over busywork", goal: "move project", expectedActionId: "leverage", actions: [{ action: action("busy", "format files"), scores: score({ progress: .4, leverage: .1 }) }, { action: action("leverage", "resolve root cause"), scores: score({ progress: .7, leverage: 1 }) }] },
  { name: "deadline urgency", goal: "meet deadline", expectedActionId: "deadline", actions: [{ action: action("deadline", "finish due task"), scores: score({ urgency: 1, progress: .8 }) }, { action: action("later", "work on later task"), scores: score({ urgency: .1, progress: .8 }) }] },
  { name: "reversible before irreversible", goal: "validate approach", expectedActionId: "probe", actions: [{ action: action("irreversible", "commit irreversible change"), scores: score({ reversibility: 0, risk: .8 }) }, { action: action("probe", "run reversible probe"), scores: score({ reversibility: 1, risk: .1 }) }] },
  { name: "external actor uncertainty", goal: "advance while waiting", expectedActionId: "internal", actions: [{ action: action("wait", "depend on external actor"), scores: score({ reachability: .3, confidence: .3 }) }, { action: action("internal", "advance independent work"), scores: score({ reachability: .95, confidence: .9 }) }] },
  { name: "information gap", goal: "avoid wrong action", expectedActionId: "inspect", actions: [{ action: action("assume", "act on assumption"), scores: score({ progress: .8, confidence: .1, risk: .7 }) }, { action: action("inspect", "inspect authoritative state"), scores: score({ progress: .45, confidence: 1, risk: .05, reachability: 1 }) }] },
];

export async function runPlanningBenchmark(): Promise<{ passed: number; total: number; failures: Array<{ scenario: string; expected: string; actual?: string }> }> {
  const model = new DeterministicFutureModel();
  const evaluator = new ActionEvaluator();
  const failures: Array<{ scenario: string; expected: string; actual?: string }> = [];
  for (const scenario of PLANNING_BENCHMARK) {
    const state = baseState();
    const evaluations = [];
    for (const candidate of scenario.actions) {
      const prediction = await model.predict({ currentState: state, candidateAction: candidate.action });
      evaluations.push(evaluator.evaluate(candidate.action, prediction, candidate.scores));
    }
    const actual = evaluator.rank(evaluations)[0]?.action.id;
    if (actual !== scenario.expectedActionId) failures.push({ scenario: scenario.name, expected: scenario.expectedActionId, actual });
  }
  return { passed: PLANNING_BENCHMARK.length - failures.length, total: PLANNING_BENCHMARK.length, failures };
}
