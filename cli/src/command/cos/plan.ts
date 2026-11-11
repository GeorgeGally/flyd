import { readDomainRun } from "../store.js";
import type { Objective, PlannedRun, PlannedRunState, RunBrief } from "./types.js";

// The objective's plan (v8 Phase 6): runs that wait on runs of the same objective, released by reconciliation. No
// graph engine and no new store: the plan lives on the objective and changes only through `mutateObjective`.

/** Why a plan's dependencies can't be run (unknown run, itself, or a cycle); null when they can. Pure. */
export function planProblem(runs: Pick<RunBrief, "key" | "after">[]): string | null {
  const keys = new Set(runs.map((run) => run.key));
  if (keys.size !== runs.length) return "the plan names a run twice";
  for (const run of runs) {
    for (const dep of run.after) {
      if (dep === run.key) return `run ${run.key} waits on itself`;
      if (!keys.has(dep)) return `run ${run.key} waits on a run the plan doesn't have (${dep})`;
    }
  }
  const after = new Map(runs.map((run) => [run.key, run.after]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const cyclic = (key: string): boolean => {
    if (done.has(key)) return false;
    if (visiting.has(key)) return true;
    visiting.add(key);
    const found = (after.get(key) ?? []).some(cyclic);
    visiting.delete(key);
    done.add(key);
    return found;
  };
  return runs.some((run) => cyclic(run.key)) ? "the plan's runs wait on each other in a loop" : null;
}

/** The run and every run downstream of it. Pure. */
export function downstreamOf(after: Record<string, string[]>, key: string): Set<string> {
  const found = new Set([key]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [run, deps] of Object.entries(after)) {
      if (!found.has(run) && deps.some((dep) => found.has(dep))) { found.add(run); grew = true; }
    }
  }
  return found;
}

/** The request id a planned run's attempt goes out under. */
export function planRequestId(objectiveId: string, run: Pick<PlannedRun, "key" | "attempt">): string {
  return run.attempt > 1 ? `${objectiveId}-${run.key}-${run.attempt}` : `${objectiveId}-${run.key}`;
}

/** The objective's plan; one written before plans existed (one dispatched run) reads as that one run. */
export function planOf(objective: Objective): PlannedRun[] {
  if (objective.plan) return objective.plan;
  return objective.runs.map((ref, index) => ({
    key: `r${index + 1}`, team: objective.brief?.team ?? (ref.startsWith("job:") ? "life" : "coding"),
    outcome: objective.brief?.outcome ?? objective.words, doneWhen: objective.brief?.doneWhen ?? [],
    state: "dispatched", attempt: 1, ref, validFor: objective.briefRevision ?? 0,
  }));
}

/** The plan intake's brief makes: its runs, or one run for one-team work. Every run starts queued. */
export function planFromBrief(objective: Pick<Objective, "brief" | "briefRevision">): { plan: PlannedRun[]; after: Record<string, string[]> } {
  const brief = objective.brief!;
  const runs: RunBrief[] = brief.runs?.length ? brief.runs : [{
    key: "r1", team: brief.team, outcome: brief.outcome, doneWhen: brief.doneWhen, ...(brief.project ? { project: brief.project } : {}), after: [],
  }];
  return {
    plan: runs.map(({ after: _after, ...run }) => ({ ...run, state: "queued", attempt: 0, validFor: objective.briefRevision ?? 0 })),
    after: Object.fromEntries(runs.filter((run) => run.after.length).map((run) => [run.key, run.after])),
  };
}

/** States that hold one of the active slots. */
const ACTIVE = new Set<PlannedRunState>(["dispatching", "dispatched"]);

/** Holds an active slot; a run handed to the compatibility crew runs on the crew's own capacity, so it holds none. */
export function isActive(run: PlannedRun): boolean {
  return ACTIVE.has(run.state) && !run.ref?.startsWith("crew:");
}

/** Runs no longer part of the work. */
export function isGone(run: PlannedRun): boolean {
  return run.state === "dropped" || run.state === "cancelled";
}

/** Runs active at once across all objectives (v8: a FirstMate run counts as one), `FLYD_COS_MAX_ACTIVE`, default 3. */
export function maxActive(): number {
  const set = Number.parseInt(process.env.FLYD_COS_MAX_ACTIVE ?? "", 10);
  return Number.isFinite(set) && set >= 1 ? set : 3;
}

/** A completed run whose result holds for what he asks now. */
export function isValid(run: PlannedRun, objective: Pick<Objective, "briefRevision">): boolean {
  return run.state === "completed" && run.validFor === (objective.briefRevision ?? 0);
}

/** Queued runs whose every dependency is completed and valid now, in plan order. Pure. */
export function releasable(objective: Objective): PlannedRun[] {
  const plan = planOf(objective);
  const byKey = new Map(plan.map((run) => [run.key, run]));
  return plan.filter((run) => run.state === "queued"
    && (objective.after?.[run.key] ?? []).every((dep) => { const found = byKey.get(dep); return Boolean(found && isValid(found, objective)); }));
}

/** The runs nothing else waits on: the work's final results. */
export function sinks(objective: Objective): PlannedRun[] {
  const waitedOn = new Set(Object.values(objective.after ?? {}).flat());
  return planOf(objective).filter((run) => !isGone(run) && !waitedOn.has(run.key));
}

/** Whether the objective follows this domain run (so its report is the objective's): dispatched, or being dispatched now. */
export function followsRun(objective: Objective, runId: string): boolean {
  return objective.runs.includes(runId) || planOf(objective).some((run) => run.state === "dispatching" && planRequestId(objective.id, run) === runId);
}

/** A run put back in the queue for another attempt, its last result kept as prior work. */
export function requeue(run: PlannedRun, extra: Partial<PlannedRun> = {}): Partial<PlannedRun> {
  return { state: "queued", ref: undefined, sent: undefined, reviewed: undefined, dispatching: undefined, reconciled: undefined, reportedTwice: undefined, unknownAt: undefined, prior: run.ref ? [...new Set([...(run.prior ?? []), run.ref])] : run.prior, ...extra };
}

/** Whether one of its dispatched team runs is still waiting on his decision. */
export function awaitsDecision(objective: Objective): boolean {
  return planOf(objective).some((run) => run.state === "dispatched" && Boolean(run.ref) && !run.ref!.includes(":") && readDomainRun(run.ref!)?.status === "needs_decision");
}

/** Back at work after his answer, unless one of its runs still waits on his decision. */
export function backTo(objective: Objective): Objective["status"] {
  return awaitsDecision(objective) ? "needs_george" : "working";
}
