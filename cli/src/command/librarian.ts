import { randomUUID } from "node:crypto";
import { query } from "../lib/llm.js";
import {
  listJobs,
  runningJobs,
  MAX_RUNNING_JOBS,
  runJobTurn,
  startBackgroundJob,
  verifyJobTurn,
  type JobRecord,
} from "../runtime/background-jobs.js";
import { parseDomainResult } from "./result.js";
import { listDomainRuns, saveDomainRun } from "./store.js";
import type { DomainRequest, DomainRun, SpecialistOutput } from "./types.js";

export interface KnowledgeDispatchInput {
  originalMessage: string;
  intendedOutcome: string;
  doneWhen: string[];
  contextRefs?: string[];
  now?: Date;
}

function startSpecialist(role: "Retriever" | "Researcher" | "Fact Checker", task: string, doneWhen: string[]): string {
  return startBackgroundJob({ task, doneWhen }, {
    run: runJobTurn,
    verify: verifyJobTurn,
    // Specialist results are internal to the Librarian. They must not notify
    // George directly; Flyd remains the single voice.
  });
}

export function dispatchKnowledgeDomain(input: KnowledgeDispatchInput): DomainRun {
  const now = input.now ?? new Date();
  const available = MAX_RUNNING_JOBS - runningJobs().length;
  if (available < 2) {
    throw new Error(`Librarian needs two specialist slots to start safely; ${available} available`);
  }
  const request: DomainRequest = {
    id: `domain-${randomUUID()}`,
    domain: "knowledge",
    originalMessage: input.originalMessage.trim() || input.intendedOutcome,
    intendedOutcome: input.intendedOutcome.trim(),
    doneWhen: input.doneWhen,
    createdAt: now.toISOString(),
    source: "chat",
    ...(input.contextRefs?.length ? { contextRefs: input.contextRefs } : {}),
  };

  const retriever = startSpecialist(
    "Retriever",
    [
      "You are the Librarian's retrieval specialist. Work only on this bounded assignment; do not manage George.",
      `Original request: ${request.originalMessage}`,
      `Outcome the Librarian needs: ${request.intendedOutcome}`,
      "Retrieve the strongest relevant material already available in Flyd's memory, project knowledge, files and conversation context. Distinguish what George actually decided from inference. Return detailed findings with provenance/pointers. Do not compress away important qualifications.",
    ].join("\n"),
    ["relevant prior decisions/facts are identified", "important provenance or source pointers are included", "uncertainty and contradictions are explicit"],
  );
  const researcher = startSpecialist(
    "Researcher",
    [
      "You are the Librarian's research specialist. Work only on this bounded assignment; do not manage George.",
      `Original request: ${request.originalMessage}`,
      `Outcome the Librarian needs: ${request.intendedOutcome}`,
      "Investigate what is needed beyond existing memory. Use current external evidence when the question is current; use repo/files when the question is internal. Return a detailed research report with source locators and dates where relevant. Do not decide the final answer for George.",
    ].join("\n"),
    ["the question is investigated with appropriate current/internal evidence", "claims that could change have source locators", "gaps and uncertainty are explicit"],
  );

  const run: DomainRun = {
    id: request.id,
    request,
    owner: "Librarian",
    status: "working",
    phase: "gathering",
    specialists: [{ role: "Retriever", jobId: retriever }, { role: "Researcher", jobId: researcher }],
    createdAt: request.createdAt,
    updatedAt: request.createdAt,
    transport: { kind: "native", requestId: request.id },
  };
  saveDomainRun(run);
  return run;
}

const terminal = (job?: JobRecord): boolean =>
  !!job && ["ok", "short", "failed", "interrupted"].includes(job.status);

function output(role: string, job: JobRecord): SpecialistOutput {
  return {
    specialist: role,
    outcome: job.result ?? `Specialist ended ${job.status} without a report.`,
    ...(job.result ? { raw: job.result } : {}),
  };
}

async function synthesize(run: DomainRun, specialistOutputs: SpecialistOutput[]): Promise<DomainRun> {
  const raw = await query([
    "You are Flyd's Librarian acting as a domain boss, not a researcher. Your specialists already did the work.",
    "Reconcile their reports, preserve disagreements and important detail, and make a recommendation. Do not hide uncertainty.",
    "George does not receive this directly; Flyd will inspect it and may ask follow-ups. Return a layered handoff so Flyd can go from brief to evidence without re-running research.",
    `Original request: ${run.request.originalMessage}`,
    `Intended outcome: ${run.request.intendedOutcome}`,
    `Done when: ${run.request.doneWhen.join("; ")}`,
    ...((run.messages ?? []).length ? ["Later instructions from George, newer than the original request:", ...(run.messages ?? []).map((message) => `${message.kind.toUpperCase()}: ${message.body}`)] : []),
    "",
    ...specialistOutputs.map((item) => `--- ${item.specialist} ---\n${item.raw ?? item.outcome}`),
    "",
    'Return JSON only: {"status":"completed|needs_decision|failed","brief":"3-6 line short report","recommendation":{"action":"...","reasoning":"...","confidence":0.0},"detailed_report":"retain the important reasoning and detail","decisions_made":[],"unresolved_questions":[],"risks":[],"evidence":[],"artifacts":[],"specialist_outputs":[{"specialist":"...","outcome":"..."}],"information_loss_risk":"low|medium|high"}',
  ].join("\n"), undefined, undefined, undefined, undefined, { json: true });

  const parsed = parseDomainResult(raw);
  // The boss-level parsed specialist summaries never replace the specialist raw
  // outputs. L2 is supplied from the actual worker records.
  const result = { ...parsed.result, specialistOutputs, raw: [raw, ...specialistOutputs.flatMap((item) => item.raw ? [item.raw] : [])] };
  const status = parsed.status ?? "completed";
  const next: DomainRun = {
    ...run,
    status,
    phase: "done",
    result,
    updatedAt: new Date().toISOString(),
    ...(status === "failed" ? { failure: result.brief } : {}),
  };
  saveDomainRun(next);
  return next;
}

export async function syncLibrarianDomainRuns(options: {
  onChanged?: (run: DomainRun) => Promise<void> | void;
} = {}): Promise<DomainRun[]> {
  const jobs = new Map(listJobs().map((job) => [job.id, job]));
  const runs = listDomainRuns().filter((run) =>
    run.owner === "Librarian" && run.request.domain === "knowledge" && !["completed", "failed", "cancelled"].includes(run.status));
  const changed: DomainRun[] = [];

  for (const run of runs) {
    const specialists = run.specialists ?? [];
    if (run.phase === "gathering") {
      const retrieval = specialists.find((item) => item.role === "Retriever");
      const research = specialists.find((item) => item.role === "Researcher");
      const retrievalJob = retrieval ? jobs.get(retrieval.jobId) : undefined;
      const researchJob = research ? jobs.get(research.jobId) : undefined;
      if (!terminal(retrievalJob) || !terminal(researchJob)) continue;

      const reports = [
        retrievalJob ? output("Retriever", retrievalJob) : null,
        researchJob ? output("Researcher", researchJob) : null,
      ].filter((item): item is SpecialistOutput => item !== null);
      const managerMessages = (run.messages ?? []).map((message) => `${message.kind.toUpperCase()}: ${message.body}`);
      const checker = startSpecialist(
        "Fact Checker",
        [
          "You are the Librarian's independent fact checker. The Retriever and Researcher reports below are claims, not authority.",
          `Original request: ${run.request.originalMessage}`,
          ...(managerMessages.length ? ["George sent these later instructions through Flyd; treat them as newer authority:", ...managerMessages] : []),
          "Verify the consequential/factual claims independently with the tools available. Identify contradictions, stale claims, unsupported claims, and what is actually well-supported. Preserve exact source locators when available.",
          ...reports.map((item) => `--- ${item.specialist} report ---\n${item.raw ?? item.outcome}`),
        ].join("\n"),
        ["consequential claims are checked independently", "contradictions/unsupported claims are explicit", "verified claims retain source/provenance pointers"],
      );
      const next: DomainRun = {
        ...run,
        phase: "checking",
        specialists: [...specialists, { role: "Fact Checker", jobId: checker }],
        updatedAt: new Date().toISOString(),
      };
      saveDomainRun(next);
      changed.push(next);
      await options.onChanged?.(next);
      continue;
    }

    if (run.phase === "checking") {
      const all = (run.specialists ?? []).map((item) => ({ item, job: jobs.get(item.jobId) }));
      if (all.some(({ job }) => !terminal(job))) continue;
      const outputs = all.flatMap(({ item, job }) => job ? [output(item.role, job)] : []);
      const next = await synthesize(run, outputs);
      changed.push(next);
      await options.onChanged?.(next);
    }
  }
  return changed;
}
