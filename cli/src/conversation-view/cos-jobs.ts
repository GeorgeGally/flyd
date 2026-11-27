import type { DomainRun } from "../command/types.js";
import type { CosReport, Objective } from "../command/cos/types.js";
import { planRequestId } from "../command/cos/plan.js";
import { runNames } from "../command/run-closure.js";
import { existsSync } from "node:fs";
import { IntelligenceEventStore } from "../intelligence/event-store.js";
import { jobRunFromDomain, type JobRun } from "./jobs.js";

export function readCosReports(path: string): CosReport[] {
  if (!existsSync(path)) return [];
  let store: IntelligenceEventStore | undefined;
  try {
    store = new IntelligenceEventStore({ path });
    return store.readSource("cos.report").flatMap((event) => {
      const report = event.payload?.report;
      return report && typeof report === "object" && typeof (report as CosReport).id === "string" ? [report as CosReport] : [];
    });
  } catch { return []; } finally { store?.close(); }
}

/** A decision can name a run only when its own reviewed report points to exactly one of this objective's runs. */
export function cosDecisionRun(objective: Objective, reports: CosReport[]): string | undefined {
  const wait = objective.waitingOn;
  if (!wait || wait.kind !== "run" || !objective.reportIds.includes(wait.reportId)) return undefined;
  const report = reports.find((item) => item.id === wait.reportId && item.objectiveId === objective.id);
  const refs = Array.isArray(report?.evidenceRefs) ? report.evidenceRefs : [];
  const matches = objective.runs.filter((id) => refs.includes(`domain-run:${id}`));
  return matches.length === 1 ? matches[0] : undefined;
}

/** Project an objective once, only from its own durable state and reviewed reports. */
export function cosJobRuns(runs: DomainRun[], objectives: Objective[], reports: CosReport[], now = Date.now(), enabled = true): JobRun[] {
  const projected = new Map<string, JobRun>();
  const byReport = new Map(reports.map((report) => [report.id, report]));
  for (const objective of objectives) {
    if (objective.status === "cancelled") continue;
    const waiting = objective.status === "needs_george" ? objective.waitingOn : undefined;
    const reportId = waiting?.reportId ?? (objective.status === "done" ? objective.reportIds.at(-1) : undefined);
    const report = reportId && objective.reportIds.includes(reportId) ? byReport.get(reportId) : undefined;
    const unverified = Boolean(((waiting || objective.status === "done") && (!report || report.objectiveId !== objective.id))
      || (objective.status === "needs_george" && !waiting));
    const snoozed = Boolean(waiting && objective.snooze && Date.parse(objective.snooze.until) > now);
    const shownWait = snoozed || unverified ? undefined : waiting;
    const status = unverified ? "incomplete" : shownWait ? "needs_decision" : objective.status === "done" ? "completed" : enabled ? "working" : "incomplete";
    projected.set(objective.id, {
      id: objective.id,
      cosObjective: true,
      status,
      ...(objective.project?.name ? { project: objective.project.name } : {}),
      outcome: (!unverified && !snoozed && report?.outcome) || objective.brief?.outcome || objective.words,
      owner: "Flyd",
      updatedAt: waiting?.at ?? objective.updatedAt,
      started: objective.createdAt,
      ...(shownWait ? { question: shownWait.question, questionIdentity: shownWait.question, persistentDecision: true } : {}),
      ...(shownWait?.options?.length ? { options: shownWait.options } : {}),
      ...(!unverified && report?.recommendation ? { recommended: report.recommendation } : {}),
      ...(!unverified && !snoozed && report?.detail ? { report: report.detail } : {}),
      artifacts: snoozed || unverified ? [] : report?.artefacts ?? [],
    });
  }
  const objectiveIds = new Set(objectives.map((objective) => objective.id));
  for (const run of runs) {
    const id = run.request.objectiveId;
    if (!id || objectiveIds.has(id) || projected.has(id)) continue;
    projected.set(id, { id, cosObjective: true, status: "incomplete", outcome: run.request.originalMessage, owner: "Flyd", updatedAt: run.updatedAt, started: run.createdAt, artifacts: [] });
  }
  const legacy = runs.filter((run) => !run.request.objectiveId).map(jobRunFromDomain);
  return [...legacy, ...projected.values()];
}

/** Keep every known objective-owned request backstage, including when its report is unavailable. */
export function cosRequestIds(runs: DomainRun[], objectives: Objective[]): Set<string> {
  const known = runs.flatMap((run) => run.request.objectiveId && run.transport.kind === "firstmate" && run.transport.requestId ? [run.transport.requestId] : []);
  const inFlight = objectives.flatMap((objective) => (objective.plan ?? [])
    .filter((run) => run.team === "coding" && run.attempt > 0 && ["dispatching", "dispatched", "unknown"].includes(run.state) && !run.ref?.startsWith("crew:"))
    .map((run) => planRequestId(objective.id, run)));
  return new Set([...known, ...inFlight]);
}

/** Every name objective-owned Firstmate work is known by: its objective, its run, its request and its inbox note. */
export function cosOwnedNames(runs: DomainRun[], objectives: Objective[]): Set<string> {
  const owned = runs.filter((run) => run.request.objectiveId && run.transport.kind === "firstmate");
  return new Set([...cosRequestIds(runs, objectives), ...owned.flatMap((run) => [...runNames(run), run.request.objectiveId!])]);
}
