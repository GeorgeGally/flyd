import { validateEnvelope } from "../../intelligence/context-envelope.js";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import type { ExecutiveDecisionRecord } from "../../intelligence/executive/decision-step.js";
import { reportFromRun, unfitForHim } from "../../runtime/delivery.js";
import { plainLine } from "../../lib/reaches-george.js";
import { sendRunMessage } from "../messages.js";
import { readDomainRun } from "../store.js";
import type { DomainRun } from "../types.js";
import { dispatchBrief, type Dispatch } from "./dispatch.js";
import { intakeObjective, type Complete } from "./intake.js";
import { cosEnabled, listObjectives, mutateObjective, readObjective } from "./objectives.js";
import type { CosReport, CosReportKind, Objective } from "./types.js";

// The Chief of Staff's tick (split plan Phase 3, behind FLYD_COS=1). Called from the command tick, and kicked at
// once by hand_off. For each objective it:
// - in intake: briefs it (one JSON query, kept on the objective) and dispatches the brief by the objective's own
//   request id, so a restart mid-intake replays rather than starting the work twice;
// - working: reviews its run when the run settles (the same executive review step every run gets: a send-back stays
//   with its boss) and writes one `cos.report`, told to George through Flyd's delivery (scheduler.ts `tellRun`).
// Intake that fails or is refused becomes a `blocked` report; it never fails silently.

export const COS_REPORT_SOURCE = "cos.report";
const COS_REPORT_SCHEMA = "cos.report.v1";
/** A process's claim on an objective's intake; an older one (the process died) is taken over. */
const CLAIM_LEASE_MS = 2 * 60_000;

export interface CosTickDeps {
  complete?: Complete;
  dispatch?: Dispatch;
  /** The executive review of a settled run (scheduler.ts `decideRun`). */
  decide?: (run: DomainRun) => Promise<ExecutiveDecisionRecord>;
  /** Tells George a reviewed run's report (scheduler.ts `tellRun`). */
  tell?: (run: DomainRun, decision: ExecutiveDecisionRecord, key: string) => Promise<unknown>;
  /** Tells George a report with no run behind it: a refused intake, a background job's result. */
  say?: (report: CosReport) => Promise<unknown>;
  store?: IntelligenceEventStore;
  now?: () => Date;
}

function openStore(store?: IntelligenceEventStore): IntelligenceEventStore {
  return store ?? new IntelligenceEventStore(process.env.VITEST && !process.env.FLYD_DIR ? { path: ":memory:" } : {});
}

/** Records a report once, under its id. Returns false when it was recorded already. */
export function recordCosReport(report: CosReport, store: IntelligenceEventStore, now = new Date()): boolean {
  if (store.findByIdempotencyKey(COS_REPORT_SOURCE, report.id)) return false;
  const envelope = {
    pathKind: "interface" as const, kind: "observation" as const, sourceId: COS_REPORT_SOURCE,
    consent: { grantedAt: now.toISOString(), scopes: ["delivery"] }, retentionClass: "local_default" as const,
    payloadClassification: "operational" as const, provenance: `cos:${COS_REPORT_SCHEMA}`, idempotencyKey: report.id,
    correlationId: report.objectiveId, evidenceRefs: report.evidenceRefs, policyVersion: COS_REPORT_SCHEMA, payload: { report },
  };
  const validation = validateEnvelope(envelope, { consentLookup: store });
  if (!validation.ok) throw new Error(`cos.report rejected: ${validation.detail}`);
  store.append(envelope);
  return true;
}

/** The objective's reports, oldest first. */
export function cosReports(objectiveId: string, store: IntelligenceEventStore): CosReport[] {
  return store.readSource(COS_REPORT_SOURCE)
    .map((event) => event.payload?.report as CosReport | undefined)
    .filter((report): report is CosReport => report?.objectiveId === objectiveId);
}

function plainReport(objective: Objective, kind: CosReportKind, outcome: string, key: string): CosReport {
  return { id: `${objective.id}:${key}`, objectiveId: objective.id, kind, outcome, detail: "", evidenceRefs: [`objective:${objective.id}`], shape: "words", artefacts: [], urgency: objective.urgency ?? "whenever" };
}

function shortWords(words: string): string {
  const line = words.replace(/\s+/g, " ").trim();
  return line.length > 60 ? `${line.slice(0, 59).replace(/\s+\S*$/, "")}…` : line;
}

/** One report, recorded on the objective and told; nothing when it was told already. */
async function report(objective: Objective, made: CosReport, deps: CosTickDeps, store: IntelligenceEventStore, tell: () => Promise<unknown>, status: Objective["status"]): Promise<void> {
  if (objective.reportIds.includes(made.id)) return;
  await tell();
  recordCosReport(made, store, deps.now?.());
  mutateObjective(objective.id, (current) => current && {
    ...current, status, reportIds: current.reportIds.includes(made.id) ? current.reportIds : [...current.reportIds, made.id],
  });
}

async function blocked(objective: Objective, reason: string, deps: CosTickDeps, store: IntelligenceEventStore): Promise<void> {
  // One plain sentence: what happened. The reason stays on the record.
  const made = { ...plainReport(objective, "blocked", `I couldn't get “${shortWords(objective.words)}” started; tell me a bit more and I'll set it going.`, "intake"), detail: reason };
  await report(objective, made, deps, store, async () => (deps.say ?? defaultSay)(made), "needs_george");
}

async function intake(objective: Objective, deps: CosTickDeps, store: IntelligenceEventStore, now: Date): Promise<void> {
  // Claimed, so a second process ticking at once never briefs or dispatches it as well.
  const claimed = mutateObjective(objective.id, (current) => {
    if (!current || current.status !== "intake") return null;
    if (current.claim && current.claim.pid !== process.pid && now.getTime() - Date.parse(current.claim.at) < CLAIM_LEASE_MS) return null;
    return { ...current, claim: { pid: process.pid, at: now.toISOString() } };
  });
  if (!claimed || claimed.claim?.pid !== process.pid || claimed.status !== "intake") return;
  let brief = claimed.brief;
  if (!brief) {
    const read = await intakeObjective(claimed, deps.complete ?? defaultComplete).catch((error: unknown) => ({ refused: error instanceof Error ? error.message : String(error) }));
    if ("refused" in read) return blocked(claimed, read.refused, deps, store);
    brief = read;
    // Kept before dispatch: a restart from here dispatches this same brief, by the same request id.
    mutateObjective(claimed.id, (current) => current && { ...current, brief: read });
  }
  if (readObjective(claimed.id)?.status !== "intake") return;
  const dispatched = await (deps.dispatch ?? dispatchBrief)(claimed, brief).catch((error: unknown) => ({ refused: error instanceof Error ? error.message : String(error) }));
  if ("refused" in dispatched) return blocked(claimed, dispatched.refused, deps, store);
  mutateObjective(claimed.id, (current) => {
    if (!current) return null;
    const { claim: _claim, ...rest } = current;
    return { ...rest, status: rest.status === "intake" ? "working" : rest.status, runs: rest.runs.includes(dispatched.ref) ? rest.runs : [...rest.runs, dispatched.ref] };
  });
}

const SETTLED_STATUS: Record<string, Objective["status"]> = { completed: "done", failed: "failed", needs_decision: "needs_george" };

/** A working objective: its run reviewed and reported once it settles. */
async function follow(objective: Objective, deps: CosTickDeps, store: IntelligenceEventStore): Promise<void> {
  for (const ref of objective.runs) {
    if (ref.startsWith("job:")) {
      const { listJobs } = await import("../../runtime/background-jobs.js");
      const job = listJobs().find((record) => record.id === ref.slice(4));
      if (!job || ["queued", "running", "verifying"].includes(job.status)) continue;
      const ok = job.status === "ok";
      const work = shortWords(objective.brief?.outcome ?? objective.words);
      const why = job.status === "short" || job.status === "blocked" ? plainLine(job.unresolved?.[0] ?? /(?:short on|blocked on): (.+?)\.?\s*$/.exec(job.result ?? "")?.[1] ?? "") : "";
      const short = why && !unfitForHim(why).length ? `${work} didn't finish: ${why}` : `${work} didn't finish.`;
      const made = {
        ...plainReport(objective, ok ? "done" : "blocked", ok ? `${work} is done.` : short, `job:${job.status}`),
        detail: job.result ?? job.lastError ?? "", evidenceRefs: [`job:${job.id}`],
      };
      await report(objective, made, deps, store, async () => (deps.say ?? defaultSay)(made), ok ? "done" : "failed");
      continue;
    }
    // The compatibility crew tells George itself when its work is ready; the objective just follows it.
    if (ref.startsWith("crew:")) continue;
    const run = readDomainRun(ref);
    const status = run && SETTLED_STATUS[run.status];
    if (!run?.result || !status) {
      // Back at work after his decision: the objective is working again.
      if (run && objective.status === "needs_george" && ["queued", "accepted", "working"].includes(run.status)) mutateObjective(objective.id, (current) => current && { ...current, status: "working" });
      continue;
    }
    const id = `${objective.id}:${run.id}:${run.status}:${run.updatedAt}`;
    if (objective.reportIds.includes(id)) continue;
    // Told already (before a restart could record it): recorded as told, never said again.
    if (run.notified && run.told) {
      const kind = run.status === "completed" ? "done" : run.status === "failed" ? "blocked" : "decision";
      const made = { ...plainReport(objective, kind, run.told.line, ""), id, evidenceRefs: [`domain-run:${run.id}`] };
      await report(objective, made, deps, store, async () => undefined, status);
      continue;
    }
    const decision = await (deps.decide ?? defaultDecide)(run);
    // Sent back to its boss: it stays working, and the boss's next reply is reviewed afresh.
    if (decision.action && decision.verification.status === "verified") continue;
    const shaped = reportFromRun(run, decision);
    const made: CosReport = {
      id, objectiveId: objective.id, kind: shaped.kind, outcome: shaped.outcome, detail: shaped.detail,
      ...(shaped.recommendation ? { recommendation: shaped.recommendation } : {}), ...(shaped.options?.length ? { options: shaped.options } : {}),
      evidenceRefs: [`domain-run:${run.id}`, ...decision.evidenceRefs], shape: shaped.shape, artefacts: shaped.artefacts, urgency: objective.urgency ?? shaped.urgency,
    };
    await report(objective, made, deps, store, async () => (deps.tell ?? defaultTell)(run, decision, `cos:${id}`), status);
  }
}

const defaultComplete: Complete = async (prompt) => (await import("../../lib/llm.js")).quickQuery(prompt, { json: true });
const defaultDecide = async (run: DomainRun): Promise<ExecutiveDecisionRecord> => (await import("../scheduler.js")).decideRun(run, sendRunMessage);
const defaultTell = async (run: DomainRun, decision: ExecutiveDecisionRecord, key: string): Promise<unknown> => (await import("../scheduler.js")).tellRun(run, decision, { key });

/** A report with no run behind it, told once as its own line. */
const defaultSay = async (made: CosReport): Promise<unknown> => (await import("../../runtime/delivered.js")).deliverOnce([{
  key: `cos:${made.id}`, line: made.outcome, kind: made.kind === "done" ? "deliverable" : "blocker", evidenceRefs: made.evidenceRefs,
}]);

let ticking = false;

/** One pass over the open objectives. A no-op unless FLYD_COS=1 (or a test passes its own deps). */
export async function cosTick(deps: CosTickDeps = {}): Promise<void> {
  if (ticking || (!cosEnabled() && !deps.dispatch)) return;
  ticking = true;
  const store = openStore(deps.store);
  try {
    const now = deps.now?.() ?? new Date();
    for (const objective of listObjectives()) {
      try {
        if (objective.status === "intake") await intake(objective, deps, store, now);
        else if (objective.status === "working" || objective.status === "needs_george") await follow(objective, deps, store);
      } catch {
        // One objective's failure never stops the others; it is tried again next tick.
      }
    }
  } finally {
    ticking = false;
    if (deps.store === undefined) store.close();
  }
}
