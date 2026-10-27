import { join } from "node:path";
import { dispatchCodingDomain, type CodingDomainDispatch } from "./coding.js";
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
  background?: boolean;
}): Promise<DomainRun | Extract<CodingDomainDispatch, { status: "refused" }>> {
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
    const dispatched = await dispatchCodingDomain({
      originalMessage: question,
      intendedOutcome,
      doneWhen,
      source: "system",
      parentRequestId: parent.id,
      contextRefs: [`domain:${parent.id}`],
      ...(parent.request.project ? { project: parent.request.project } : {}),
      ...(parent.request.skill ? { skill: parent.request.skill } : {}),
    });
    return dispatched.status === "accepted" ? dispatched.run : dispatched;
  }
  if (parent.request.domain === "knowledge") {
    return dispatchKnowledgeDomain({
      originalMessage: question,
      intendedOutcome,
      doneWhen,
      parentRequestId: parent.id,
      contextRefs: [`domain:${parent.id}`],
      background: input.background,
    });
  }
  if (parent.request.domain === "creative") return designFollowup(parent, question);
  throw new Error(`No domain boss supports follow-ups for ${parent.request.domain} yet`);
}

/**
 * George's answer to a presented lab goes back to the Creative Director: naming
 * a version with the project known builds it for real; anything else is
 * another round, with his words and the last lab as the new brief.
 */
async function designFollowup(parent: DomainRun, question: string): Promise<DomainRun> {
  const { dispatchDesignMate, labDir, readLab, shotPaths } = await import("./design-mate.js");
  const lab = readLab(parent.id);
  const named = question.match(/\bv(?:ersion)?\s*([1-9])\b/i) ?? question.match(/\b(?:build|go with|take|use|pick|keep)\b[^.]*?\b([1-9])\b/i);
  const version = lab?.versions.find((item) => item.n === Number(named?.[1]));
  const root = parent.request.project?.root;
  const common = {
    originalMessage: question,
    parentRequestId: parent.id,
    contextRefs: [`domain:${parent.id}`],
    ...(parent.request.project ? { project: parent.request.project } : {}),
  };
  if (version && root) {
    return dispatchDesignMate({
      ...common,
      intendedOutcome: `Build "${version.name}" (V${version.n} from the lab "${parent.request.intendedOutcome}") for real in the project. ${version.idea}`,
      doneWhen: [`the project shows ${version.name} as designed`, "the project's own checks still pass"],
      build: { reference: { page: join(labDir(parent.id), `v${version.n}.html`), shot: shotPaths(parent.id, version).desktop, name: version.name } },
    });
  }
  return dispatchDesignMate({
    ...common,
    intendedOutcome: `${parent.request.intendedOutcome} - another round. George said: "${question}"${lab ? `\nLast round's brief: ${lab.brief}\nLast round: ${lab.versions.map((item) => `V${item.n} ${item.name} (${item.score}/10): ${item.idea}`).join("; ")}` : ""}`,
    doneWhen: parent.request.doneWhen,
  });
}
