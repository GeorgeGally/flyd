import { projectHypothesisLine } from "./work-hypothesis/index.js";
import type { WorkHypothesis } from "./work-hypothesis/types.js";

function activeProjectsAnswer(present: WorkHypothesis): string {
  const lines = [
    ...present.primaryThreads.map((thread) => `${thread.name}${thread.isDirty ? " [dirty]" : ""} — ${thread.root}`),
    ...present.secondaryThreads.slice(0, 2).map((thread) => `${thread.name}${thread.demoted ? " [demoted]" : " [secondary]"} — ${thread.root}`),
  ];

  const attention = present.openDecisions?.length
    ? `\nNeeds you:\n${present.openDecisions.map((decision) => `- ${decision.projectName ?? "Work"}: ${decision.question}`).join("\n")}`
    : "";

  const workers = present.workerObservations?.filter((worker) => worker.consequential) ?? [];
  const operational = workers.length
    ? `\nOperational attention:\n${workers.map((worker) => `- ${worker.state}: ${worker.reason}`).join("\n")}`
    : "";

  return `${projectHypothesisLine(present).trim()}\n${lines.join("\n")}${attention}${operational}`.trim();
}

function attentionAnswer(present: WorkHypothesis): string {
  const lines: string[] = [];
  for (const decision of present.openDecisions ?? []) {
    lines.push(`${decision.projectName ?? "Work"}: ${decision.question}`);
  }
  for (const worker of present.workerObservations ?? []) {
    if (!worker.consequential || worker.action === "ask_user") continue;
    lines.push(`${worker.state}: ${worker.reason}`);
  }
  return lines.length > 0 ? lines.join("\n") : "Nothing currently needs your attention.";
}

/**
 * Fast deterministic answers for the two core status questions. The caller
 * falls back to the legacy recall router for other query shapes.
 */
export function answerFromCanonicalPresent(query: string, present: WorkHypothesis | null): string | null {
  if (!present) return null;
  if (/what (am i|are you) (working on|doing)|active projects|current projects|what else|resume (work|where i was)/i.test(query)) {
    return activeProjectsAnswer(present);
  }
  if (/what needs me|needs my attention|what needs my attention|what('?s| is) blocked|what('?s| is) waiting on me/i.test(query)) {
    return attentionAnswer(present);
  }
  return null;
}
