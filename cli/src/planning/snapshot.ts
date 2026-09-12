import { randomUUID } from "node:crypto";
import type { PresentModel } from "../lib/present-model.js";
import type { WorkHypothesis } from "../work/work-hypothesis/types.js";
import type { PlanningConfidence, StateFact, WorldStateSnapshot } from "../intelligence/world/types.js";

function fact<T>(value: T, confidence: PlanningConfidence, provenance: string[], freshness?: string): StateFact<T> {
  return { value, confidence, provenance, ...(freshness ? { freshness } : {}) };
}

/**
 * Create a durable planning snapshot at an INVOKED/agent-action boundary.
 * This function never observes or persists ambient PRESENT by itself: callers
 * must explicitly supply the already-authorized state they are acting on.
 */
export function snapshotFromPresent(input: {
  present: PresentModel;
  work?: WorkHypothesis | null;
  blockers?: string[];
  commitments?: string[];
  entities?: string[];
  deadlines?: string[];
  agentWork?: string[];
  projectId?: string;
  now?: Date;
}): WorldStateSnapshot {
  const { present, work } = input;
  const confidence: PlanningConfidence = present.gaps.length === 0 ? "high" : "medium";
  const repository = present.repository;
  const projectNames = [
    ...(work?.primaryThreads.map((thread) => thread.name) ?? []),
    ...(work?.secondaryThreads.map((thread) => thread.name) ?? []),
  ];
  const activeProjects = [...new Set(projectNames)];
  const tasks = present.activeTask ? [{
    id: present.activeTask.taskKey,
    description: present.activeTask.intendedOutcome,
    status: present.activeTask.status,
  }] : [];
  const decisions = (work?.openDecisions ?? []).map((decision) => `${decision.question}: ${decision.context}`);
  const repositoryStates = repository ? [{
    root: repository.root,
    branch: repository.branch,
    dirty: repository.dirty,
    head: repository.head,
  }] : [];

  return {
    id: randomUUID(),
    capturedAt: (input.now ?? new Date()).toISOString(),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    activeProjects: fact(activeProjects, work?.confidence ?? confidence, ["work-hypothesis"], work?.generatedAt),
    activeTasks: fact(tasks, confidence, ["present-model:activeTask"], present.generatedAt),
    repoStates: fact(repositoryStates, repository ? confidence : "unknown", ["present-model:repository"], present.generatedAt),
    blockers: fact(input.blockers ?? [], "medium", ["invocation-context"]),
    decisions: fact(decisions, decisions.length ? "high" : "unknown", ["work-hypothesis:openDecisions"], work?.generatedAt),
    commitments: fact(input.commitments ?? [], "medium", ["invocation-context"]),
    entities: fact(input.entities ?? [], "medium", ["invocation-context"]),
    deadlines: fact(input.deadlines ?? [], "medium", ["invocation-context"]),
    agentWork: fact(input.agentWork ?? [], "medium", ["invocation-context"]),
  };
}