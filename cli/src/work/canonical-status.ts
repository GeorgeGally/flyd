import { projectHypothesisLine } from "./work-hypothesis/index.js";
import type { RuntimeAwarePresent } from "./runtime-present-types.js";

export function canonicalStatusAnswer(query: string, present: RuntimeAwarePresent | null): string | null {
  if (!present) return null;

  const currentWork = /what (am i|are you) (working on|doing)|active projects|current projects|what else|resume (work|where i was)/i.test(query);
  if (currentWork) {
    const lines = [
      projectHypothesisLine(present).trim(),
      ...present.primaryThreads.map((thread) => `${thread.name}${thread.isDirty ? " [dirty]" : ""} — ${thread.root}`),
      ...present.secondaryThreads.slice(0, 2).map((thread) => `${thread.name}${thread.demoted ? " [demoted]" : " [secondary]"} — ${thread.root}`),
    ];
    if (present.activeRuntimeTasks?.length) {
      lines.push("", "Active runtime work:");
      for (const task of present.activeRuntimeTasks) {
        lines.push(`- ${task.projectName} [${task.status}]: ${task.intendedOutcome}`);
      }
    }
    if (present.openDecisions?.length) {
      lines.push("", "Needs you:");
      for (const decision of present.openDecisions) {
        lines.push(`- ${decision.projectName ?? "Work"}: ${decision.question}`);
      }
    }
    for (const worker of present.workerObservations ?? []) {
      if (worker.consequential && worker.action !== "ask_user") {
        lines.push(`- ${worker.state}: ${worker.reason}`);
      }
    }
    return lines.filter((line, index) => line || index > 0).join("\n").trim();
  }

  const attention = /what needs me|needs my attention|what needs my attention|what('?s| is) blocked|what('?s| is) waiting on me/i.test(query);
  if (!attention) return null;

  const lines: string[] = [];
  for (const decision of present.openDecisions ?? []) {
    lines.push(`${decision.projectName ?? "Work"}: ${decision.question}`);
  }
  for (const task of present.activeRuntimeTasks ?? []) {
    if (task.status === "blocked" || task.status === "awaiting_grant") {
      lines.push(`${task.projectName} [${task.status}]: ${task.recommendedNextAction ?? task.intendedOutcome}`);
    }
  }
  for (const worker of present.workerObservations ?? []) {
    if (worker.consequential && worker.action !== "ask_user") {
      lines.push(`${worker.state}: ${worker.reason}`);
    }
  }
  return lines.length ? lines.join("\n") : "Nothing currently needs your attention.";
}
