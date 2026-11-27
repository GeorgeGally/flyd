import type { DomainRun } from "../command/types.js";
import type { CosReport, Objective } from "../command/cos/types.js";
import { planRequestId } from "../command/cos/plan.js";
import { firstmateTasksOfRun, runNames, type TaskRecord } from "../command/run-closure.js";
import { listObjectives } from "../command/cos/objectives.js";
import { listDomainRuns } from "../command/store.js";
import { firstmateHome } from "../lib/firstmate-home.js";
import { firstmateRecord } from "./retire.js";
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

/**
 * Every name objective-owned work is known by (its objective, its planned requests, its run, its inbox note and the
 * Firstmate tasks bound to that run), each to the run or objective that owns it.
 */
export function cosOwners(runs: DomainRun[], objectives: Objective[], entries: ReadonlyMap<string, TaskRecord> = new Map()): Map<string, string> {
  const owners = new Map<string, string>();
  for (const objective of objectives) {
    owners.set(objective.id, objective.id);
    for (const run of objective.plan ?? []) if (run.team === "coding") owners.set(planRequestId(objective.id, run), objective.id);
  }
  for (const run of runs) {
    if (!run.request.objectiveId) continue;
    for (const name of [...runNames(run), ...(run.transport.kind === "firstmate" ? firstmateTasksOfRun(run, entries) : [])]) owners.set(name, run.id);
  }
  return owners;
}

const ownedNamePatterns = new WeakMap<ReadonlyMap<string, string>, RegExp | null>();

/** Whether the text names objective-owned work by any name it goes by, as a whole word; one pattern per owners map. */
export function namesOwnedWork(text: string, owners: ReadonlyMap<string, string>): boolean {
  if (!ownedNamePatterns.has(owners)) {
    const names = [...owners.keys()].sort((a, b) => b.length - a.length).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    ownedNamePatterns.set(owners, names.length ? new RegExp(`(?<![\\w-])(?:${names.join("|")})(?![\\w-])`) : null);
  }
  return ownedNamePatterns.get(owners)?.test(text) ?? false;
}

/** Who owns objective work by every name it goes by, read now; null when the record cannot be read. */
export function readCosOwners(home = firstmateHome()): ReadonlyMap<string, string> | null {
  try {
    return cosOwners(listDomainRuns(undefined, true), listObjectives(undefined, true), firstmateRecord(home));
  } catch {
    return null;
  }
}
