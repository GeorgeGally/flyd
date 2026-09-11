import type { OperationalDecision } from "../runtime/operational-decision.js";
import type { PresentDecision, WorkHypothesis } from "./work-hypothesis/types.js";

export interface PresentTaskIdentity {
  taskId: string;
  taskKey: string;
  projectName: string;
}

/**
 * Compose canonical runtime facts into the existing work hypothesis without
 * allowing Present to become an authority or query/mutate the runtime itself.
 */
export function attachOperationalDecisions(
  present: WorkHypothesis,
  decisions: OperationalDecision[],
  tasks: PresentTaskIdentity[] = [],
): WorkHypothesis {
  const taskById = new Map(tasks.map((task) => [task.taskId, task]));
  const openDecisions: PresentDecision[] = decisions
    .filter((decision) => decision.status === "open")
    .map((decision) => {
      const task = taskById.get(decision.taskId);
      return {
        decisionId: decision.decisionId,
        taskId: decision.taskId,
        taskKey: task?.taskKey,
        projectName: task?.projectName,
        question: decision.question,
        context: decision.context,
        requestedAt: decision.requestedAt,
      };
    })
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));

  return {
    ...present,
    openDecisions,
    evidenceRefs: [
      ...present.evidenceRefs,
      ...openDecisions.map((decision) => `decision:${decision.decisionId}`),
    ],
  };
}
