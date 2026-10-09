import { dispatchCodingDomain } from "./coding.js";
import { dispatchKnowledgeDomain } from "./librarian.js";
import { readDomainRun } from "./store.js";
import type { DomainRun } from "./types.js";

function parentContext(parent: DomainRun): string {
  const result = parent.result;
  if (!result) return `Prior run ${parent.id} has no completed result yet.`;
  return [
    `Prior run ${parent.id} brief: ${result.brief}`,
    result.recommendation ? `Prior recommendation: ${result.recommendation.action}${result.recommendation.reasoning ? ` — ${result.recommendation.reasoning}` : ""}` : "",
    `Prior detailed report:\n${result.detailedReport}`,
    result.evidence.length ? `Prior evidence:\n${result.evidence.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

export async function dispatchDomainFollowup(input: {
  parentRunId: string;
  question: string;
}): Promise<DomainRun> {
  const parent = readDomainRun(input.parentRunId);
  if (!parent) throw new Error(`Unknown domain run ${input.parentRunId}`);
  const question = input.question.trim();
  if (!question) throw new Error("Follow-up question is required");
  const context = parentContext(parent);
  const intendedOutcome = [
    `Answer George's follow-up about prior domain run ${parent.id}: ${question}`,
    "Do not redo unrelated work. Inspect the prior reasoning/evidence, ask specialists only where needed, and explain any change of conclusion.",
    context,
  ].join("\n\n");
  const doneWhen = [
    "the follow-up question is answered directly",
    "material reasoning and evidence from the prior run are preserved or explicitly corrected",
    "remaining uncertainty or a required decision is explicit",
  ];

  if (parent.request.domain === "coding") {
    return dispatchCodingDomain({
      originalMessage: question,
      intendedOutcome,
      doneWhen,
      source: "system",
      parentRequestId: parent.id,
      contextRefs: [`domain:${parent.id}`],
      ...(parent.request.project ? { project: parent.request.project } : {}),
    });
  }
  if (parent.request.domain === "knowledge") {
    return dispatchKnowledgeDomain({
      originalMessage: question,
      intendedOutcome,
      doneWhen,
      parentRequestId: parent.id,
      contextRefs: [`domain:${parent.id}`],
    });
  }
  throw new Error(`No domain boss supports follow-ups for ${parent.request.domain} yet`);
}
