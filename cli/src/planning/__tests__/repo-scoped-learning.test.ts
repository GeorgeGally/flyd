import { describe, expect, it, vi } from "vitest";
import type { WorldStateSnapshot } from "../../intelligence/world/types.js";
import type { ActionProposal, CurrentWork } from "../../work-intelligence/types.js";
import { selectWorkIntelligenceAction } from "../../work-intelligence/planner.js";
import { ActionEvaluator, DeterministicFutureModel, buildPlanningTrace, reconcilePrediction, type CandidateAction, type FutureModel } from "../future-model.js";
import { EmpiricalFutureModel } from "../empirical-future-model.js";
import type { PlanningLearningExample } from "../store.js";

function fact<T>(value: T) {
  return { value, confidence: "high" as const, provenance: ["test"] };
}

function state(flydDirty = false, cleanxDirty = false): WorldStateSnapshot {
  return {
    id: `state-${Math.random()}`,
    capturedAt: new Date().toISOString(),
    activeProjects: fact(["flyd", "cleanx"]),
    activeTasks: fact([]),
    repoStates: fact([
      { root: "/flyd", branch: "main", dirty: flydDirty },
      { root: "/cleanx", branch: "main", dirty: cleanxDirty },
    ]),
    blockers: fact([]), decisions: fact([]), commitments: fact([]), entities: fact([]), deadlines: fact([]), agentWork: fact([]),
  };
}

async function example(index: number, action: CandidateAction, before: WorldStateSnapshot, after: WorldStateSnapshot): Promise<PlanningLearningExample> {
  const prediction = await new DeterministicFutureModel().predict({ currentState: before, candidateAction: action });
  const evaluation = new ActionEvaluator().evaluate(action, prediction, {
    progress: .8, reachability: .8, leverage: .7, urgency: .5, userEffort: .1, risk: .2, reversibility: .8, confidence: .7,
  });
  const trace = buildPlanningTrace({ snapshotId: before.id, goal: action.description, candidates: [evaluation] });
  const outcome = reconcilePrediction(prediction, after);
  return { correlationId: `repo-run-${index}`, trace, outcome };
}

function scopedAction(root: string): CandidateAction {
  return {
    id: "execute-requested-outcome",
    description: "Execute: fix repository integration",
    kind: "execution",
    metadata: { targetRepoRoot: root },
  };
}

function currentWork(): CurrentWork {
  const evidence = <T>(value: T) => ({
    value,
    source: "foreground" as const,
    confidence: "high" as const,
    provenance: "test",
    sourceTimestamp: new Date().toISOString(),
    isHypothesis: false,
  });
  return {
    project: evidence("flyd"),
    objective: evidence("Improve planning"),
    artifact: { kind: "code", title: "planner.ts", contentDigest: "digest" },
    stage: evidence("execution" as const),
    constraints: evidence([]),
    openLoops: [],
    nextAction: evidence({ description: "continue", readiness: "ready" as const }),
    evidenceSummary: {
      sources: ["foreground", "repository"],
      snapshotTimestamp: new Date().toISOString(),
      foregroundApp: "Terminal",
      repositoryRoot: "/flyd",
      branch: "main",
      headDigest: "abc",
      statusDigest: "clean",
      activeWindowTitle: "flyd",
    },
    uncertainty: [],
    confidence: [{ field: "project", confidence: "high" }],
  };
}

describe("repository-scoped empirical planning", () => {
  it("learns only the owned repository effect when collateral repos also change", async () => {
    const action = scopedAction("/cleanx");
    const examples = await Promise.all([1, 2, 3].map((index) => example(index, action, state(false, false), state(true, true))));
    const prediction = await new EmpiricalFutureModel({ examples: () => examples }).predict({ currentState: state(false, false), candidateAction: action });

    expect(prediction.expectedEffects).toEqual([expect.objectContaining({ path: "repoStates.value.1.dirty", after: true })]);
    expect(prediction.predictedState.repoStates.value[0].dirty).toBe(false);
    expect(prediction.predictedState.repoStates.value[1].dirty).toBe(true);
  });

  it("does not borrow same-family history from a different repository", async () => {
    const flydAction = scopedAction("/flyd");
    const cleanxAction = scopedAction("/cleanx");
    const examples = await Promise.all([1, 2, 3].map((index) => example(index, flydAction, state(false, false), state(true, false))));
    const prediction = await new EmpiricalFutureModel({ examples: () => examples }).predict({ currentState: state(false, false), candidateAction: cleanxAction });

    expect(prediction.expectedEffects).toEqual([]);
    expect(prediction.outcomeForecast).toBeUndefined();
  });

  it("stamps normal Work Intelligence candidates with the foreground repository", async () => {
    const seen: CandidateAction[] = [];
    const futureModel: FutureModel = {
      predict: async (input) => {
        seen.push(input.candidateAction);
        return new DeterministicFutureModel().predict(input);
      },
    };
    const proposal: ActionProposal = {
      actionId: "edit",
      kind: "text_edit",
      description: "Tighten the current wording",
      targetFingerprint: {},
      workSessionRevision: 0,
      diagnosedIssueId: "issue",
      finishCondition: "The wording is updated",
      expiryMs: 120000,
      allowedOperation: "replace_text",
    };

    await selectWorkIntelligenceAction({
      intent: "Tighten this",
      interactionId: "scope-test",
      currentWork: currentWork(),
      candidates: [proposal],
      projectRoot: "/flyd",
    }, {
      capture: vi.fn(async () => state(false, false)),
      futureModel,
      saveTrace: vi.fn(),
    });

    expect(seen[0]?.metadata?.targetRepoRoot).toBe("/flyd");
  });
});
