import type { AgentTask } from "../runtime/types.js";
import type { RuntimeAwarePresent, PresentRuntimeTaskFact } from "./runtime-present-types.js";

const ACTIVE_TASK_STATUSES = new Set(["awaiting_grant", "ready", "running", "blocked"]);

export function attachRuntimeTasks(
  present: RuntimeAwarePresent,
  tasks: AgentTask[],
): RuntimeAwarePresent {
  const activeRuntimeTasks: PresentRuntimeTaskFact[] = tasks
    .filter((task) => ACTIVE_TASK_STATUSES.has(task.status))
    .map((task) => ({
      epistemicClass: "fact",
      taskId: task.id,
      taskKey: task.taskKey,
      projectName: task.projectName,
      projectRoot: task.projectRoot,
      status: task.status,
      intendedOutcome: task.intendedOutcome,
      recommendedNextAction: task.recommendedNextAction,
      updatedAt: task.updatedAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    ...present,
    activeRuntimeTasks,
    evidenceRefs: [
      ...present.evidenceRefs,
      ...activeRuntimeTasks.map((task) => `runtime-task:${task.taskKey}:${task.updatedAt}`),
    ],
  };
}
