import { validateEnvelope } from "../../intelligence/context-envelope.js";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import type { ExecutiveDecisionRecord } from "../../intelligence/executive/decision-step.js";
import { reportFromRun, unfitForHim } from "../../runtime/delivery.js";
import { plainLine } from "../../lib/reaches-george.js";
import { TEAMS } from "../../runtime/turn-plan.js";
import { sendRunMessage } from "../messages.js";
import { readDomainRun } from "../store.js";
import type { DomainRun } from "../types.js";
import { dispatchBrief, type Dispatch, type Dispatched, type SentBrief } from "./dispatch.js";
import { intakeObjective, readRun, type Complete } from "./intake.js";
import { cosEnabled, listObjectives, mutateObjective, readObjective } from "./objectives.js";
import { awaitsDecision, isActive, isGone, isValid, maxActive, planFromBrief, planOf, planRequestId, releasable, requeue, sinks } from "./plan.js";
import type { Adaptation, CosReport, CosReportKind, Objective, PlannedRun, RunBrief, WaitKind } from "./types.js";

// The Chief of Staff's tick (split plan Phase 3, v8 Phase 6; behind FLYD_COS=1). Called from the command tick, and
// kicked at once by hand_off. For each objective it:
// - in intake: briefs it (one JSON query, kept on the objective) into a plan of runs;
// - working: reconciles runs a dead process left `dispatching` (by request id, never blindly), reviews each run that
//   settles (the executive review every run gets: a send-back stays with its boss), gives a failed run its one
//   alternative, releases queued runs whose dependencies are done while fewer than FLYD_COS_MAX_ACTIVE are active (a
//   join's brief written from its dependencies' results), and, once every run holds for the latest revision and the
//   result meets done_when, writes the one `cos.report` George is told.
// Intake that fails or is refused becomes a `blocked` report; it never fails silently.

export const COS_REPORT_SOURCE = "cos.report";
const COS_REPORT_SCHEMA = "cos.report.v1";
/** A process's claim on an objective's intake, or on a run it is dispatching; an older one (it died) is taken over. */
const CLAIM_LEASE_MS = 2 * 60_000;

export interface CosTickDeps {
  /** One JSON query: intake, a join's brief, and the acceptance check. */
  complete?: Complete;
  dispatch?: Dispatch;
  /** The executive review of a settled run (scheduler.ts `decideRun`). */
  decide?: (run: DomainRun) => Promise<ExecutiveDecisionRecord>;
  /** Tells George a reviewed run's report (scheduler.ts `tellRun`). */
  tell?: (run: DomainRun, decision: ExecutiveDecisionRecord, key: string) => Promise<unknown>;
  /** Tells George a report with no run behind it: a refused intake, a background job's result. */
  say?: (report: CosReport) => Promise<unknown>;
  /** Passes a message on to a run (messages.ts `sendRunMessage`). */
  send?: typeof sendRunMessage;
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

/** The objective's work in a few words, for a report's lead line. */
function workOf(objective: Objective): string {
  return shortWords(objective.brief?.outcome ?? objective.words);
}

/**
 * One report, recorded on the objective and told; nothing when it was told already. A report that leaves the objective
 * waiting on George records what it waits on (`wait`), so his reply resumes it; any other ends the wait.
 */
async function report(objective: Objective, made: CosReport, deps: CosTickDeps, store: IntelligenceEventStore, tell: () => Promise<unknown>, status: Objective["status"], wait?: { kind: WaitKind; question?: string }): Promise<void> {
  if (objective.reportIds.includes(made.id)) return;
  await tell();
  recordCosReport(made, store, deps.now?.());
  mutateObjective(objective.id, (current) => {
    if (!current) return null;
    const { waitingOn: _waiting, snooze: _snooze, ...rest } = current;
    const waiting = status === "needs_george" && wait
      ? { waitingOn: { reportId: made.id, kind: wait.kind, question: wait.question ?? made.outcome, ...(made.options?.length ? { options: made.options } : {}), at: new Date().toISOString() } }
      : status === "needs_george" ? { ...(current.waitingOn ? { waitingOn: current.waitingOn } : {}), ...(current.snooze ? { snooze: current.snooze } : {}) } : {};
    return {
      ...rest, ...waiting, status: current.status === "cancelled" ? current.status : status,
      reportIds: current.reportIds.includes(made.id) ? current.reportIds : [...current.reportIds, made.id],
    };
  });
}

async function blocked(objective: Objective, reason: string, deps: CosTickDeps, store: IntelligenceEventStore, kind: "intake" | "retry", key: string): Promise<void> {
  if (readObjective(objective.id)?.status === "cancelled") return;
  // One plain sentence: what happened. The reason stays on the record.
  const made = { ...plainReport(objective, "blocked", `I couldn't get “${shortWords(objective.words)}” started; tell me a bit more and I'll set it going.`, key), detail: reason };
  await report(objective, made, deps, store, async () => (deps.say ?? defaultSay)(made), "needs_george", { kind });
}

/** Under the objective's lock: the plan as it is now, changed; null writes nothing. The first write keeps an older objective's plan. */
function mutatePlan(id: string, change: (objective: Objective, plan: PlannedRun[]) => Partial<Objective> | null): Objective | null {
  let changed = false;
  const saved = mutateObjective(id, (current) => {
    if (!current) return null;
    const plan = planOf(current).map((run) => ({ ...run }));
    const next = change(current, plan);
    if (!next) return null;
    changed = true;
    return { ...current, plan, progressAt: new Date().toISOString(), ...next };
  });
  return changed ? saved : null;
}

/** One run of the plan changed in place; null leaves it. */
function changeRun(id: string, key: string, change: (run: PlannedRun, objective: Objective) => Partial<PlannedRun> | null, more?: (objective: Objective) => Partial<Objective>): Objective | null {
  return mutatePlan(id, (objective, plan) => {
    const index = plan.findIndex((run) => run.key === key);
    if (index < 0) return null;
    const next = change(plan[index]!, objective);
    if (!next) return null;
    plan[index] = { ...plan[index]!, ...next };
    return more ? more(objective) : {};
  });
}

function adaptation(run: string, action: Adaptation["action"], reason: string): Adaptation {
  return { run, at: new Date().toISOString(), action, reason };
}

async function intake(objective: Objective, deps: CosTickDeps, store: IntelligenceEventStore, now: Date): Promise<void> {
  // Claimed, so a second process ticking at once never briefs it as well.
  const claimed = mutateObjective(objective.id, (current) => {
    if (!current || current.status !== "intake") return null;
    if (current.claim && current.claim.pid !== process.pid && now.getTime() - Date.parse(current.claim.at) < CLAIM_LEASE_MS) return null;
    return { ...current, claim: { pid: process.pid, at: now.toISOString() } };
  });
  if (!claimed || claimed.claim?.pid !== process.pid || claimed.status !== "intake") return;
  let brief = claimed.brief;
  if (!brief) {
    const read = await intakeObjective(claimed, deps.complete ?? defaultComplete).catch((error: unknown) => ({ refused: error instanceof Error ? error.message : String(error) }));
    if ("refused" in read) return blocked(claimed, read.refused, deps, store, "intake", `intake:${claimed.progressAt ?? ""}`);
    brief = read;
  }
  // The plan is kept with the brief, every run queued under its own request id; release dispatches them.
  const made = brief;
  mutateObjective(claimed.id, (current) => {
    if (!current || current.status !== "intake") return null;
    const { claim: _claim, ...rest } = current;
    return { ...rest, brief: made, ...planFromBrief({ brief: made, briefRevision: rest.briefRevision ?? 0 }), status: "working" };
  });
}

/** The brief a run is sent: its outcome with what the work before it found, his corrections, its earlier result and why it was redone. */
function sentBrief(objective: Objective, run: PlannedRun, found?: { synthesis: string; refs: string[] }): SentBrief {
  const plan = planOf(objective);
  const deps = (objective.after?.[run.key] ?? []).map((key) => plan.find((other) => other.key === key)).filter((other): other is PlannedRun => Boolean(other?.ref));
  const refs = [...deps.map((dep) => linkOf(dep.ref!)), ...(run.prior ?? []).map(linkOf)];
  const text = run.sent ?? [
    run.outcome,
    ...(found?.synthesis ? [`What the work before this found:\n${found.synthesis}`] : []),
    ...(found && found.refs.length > 1 ? [`Full results: ${found.refs.join(", ")}`] : []),
    ...(objective.corrections?.length ? [`George's corrections since he asked:\n${objective.corrections.map((item) => `- ${item.text}`).join("\n")}`] : []),
    ...(run.prior?.length ? ["Your earlier result is attached as prior work; keep what still holds."] : []),
    ...(run.failure ? [`Last attempt: ${run.failure}. Take that into account this time.`] : []),
  ].join("\n\n");
  return {
    team: run.team, outcome: text, doneWhen: run.doneWhen, ...(run.project ? { project: run.project } : {}),
    decisions: objective.brief?.decisions ?? { comesBack: [], settledByPolicy: [] }, ...(refs.length ? { contextRefs: [...new Set(refs)] } : {}),
  };
}

function linkOf(ref: string): string {
  return ref.includes(":") ? ref : `domain-run:${ref}`;
}

/** A run's retained result as text: a domain run's layered result, or a job's. */
function resultText(ref: string, jobs?: Array<{ id: string; result?: string }>): string {
  if (ref.startsWith("job:")) return jobs?.find((job) => job.id === ref.slice(4))?.result ?? "";
  const result = readDomainRun(ref)?.result;
  return result ? [result.brief, result.detailedReport].filter((part) => part.trim()).join("\n\n") : "";
}

/** Asks the executor where a run left `dispatching` stands, by its request id; one that can't answer leaves it `unknown`. */
async function reconcile(objective: Objective, run: PlannedRun, deps: CosTickDeps, store: IntelligenceEventStore): Promise<void> {
  const answer = await (deps.dispatch ?? dispatchBrief)(objective, sentBrief(objective, run), planRequestId(objective.id, run), { replay: true })
    .catch((error: unknown): Dispatched => ({ unknown: error instanceof Error ? error.message : String(error) }));
  await dispatched(objective.id, run.key, answer, deps, store, true);
}

/** Records what the executor answered for a run: its receipt, `unknown`, or a refusal (a blocked report). */
async function dispatched(id: string, key: string, answer: Dispatched, deps: CosTickDeps, store: IntelligenceEventStore, reconciled = false): Promise<void> {
  if ("ref" in answer) {
    const ref = answer.ref;
    const recorded = changeRun(id, key, () => ({ state: "dispatched", ref, dispatching: undefined, ...(reconciled ? { reconciled: true } : {}) }), (objective) => ({
      runs: objective.runs.includes(ref) ? objective.runs : [...objective.runs, ref],
    }));
    // He cancelled while it was being sent: the run is stopped as well.
    const run = recorded?.status === "cancelled" && !ref.includes(":") ? readDomainRun(ref) : null;
    if (run) await (deps.send ?? sendRunMessage)({ run, kind: "cancel", body: "George cancelled this." }).catch(() => undefined);
    return;
  }
  if ("unknown" in answer) {
    // Never sent again: a later look (the stuck-work chase) settles where it stands.
    changeRun(id, key, () => ({ state: "unknown", dispatching: undefined, failure: answer.unknown }));
    return;
  }
  const refused = changeRun(id, key, () => ({ state: "failed", dispatching: undefined, failure: answer.refused }));
  const attempt = refused && planOf(refused).find((run) => run.key === key)?.attempt;
  if (refused) await blocked(refused, answer.refused, deps, store, "retry", `dispatch:${key}:${attempt ?? ""}`);
}

const SETTLED = new Set<DomainRun["status"]>(["completed", "failed", "needs_decision"]);
const AT_WORK = new Set<DomainRun["status"]>(["queued", "accepted", "working"]);

/** A dispatched run that has settled: reviewed once, then completed, re-briefed once, or raised with George. */
async function settle(objective: Objective, run: PlannedRun, deps: CosTickDeps, store: IntelligenceEventStore, decisions: Map<string, ExecutiveDecisionRecord>): Promise<void> {
  const ref = run.ref!;
  if (ref.startsWith("job:")) {
    const { listJobs } = await import("../../runtime/background-jobs.js");
    const job = listJobs().find((record) => record.id === ref.slice(4));
    if (!job || ["queued", "running", "verifying"].includes(job.status)) return;
    const key = `${ref}:${job.status}`;
    if (run.reviewed === key) return;
    if (job.status === "ok") return completed(objective, run, key);
    const why = job.status === "short" || job.status === "blocked" ? plainLine(job.unresolved?.[0] ?? /(?:short on|blocked on): (.+?)\.?\s*$/.exec(job.result ?? "")?.[1] ?? "") : "";
    // A one-off job may have acted outside (booked, sent, bought): it is never run again on its own.
    return failed(objective, run, key, why, job.result ?? job.lastError ?? "", deps, store, false);
  }
  // The compatibility crew tells George itself when its work is ready; the objective just follows it.
  if (ref.startsWith("crew:")) return;
  const domain = readDomainRun(ref);
  if (!domain) return;
  if (domain.status === "cancelled") { changeRun(objective.id, run.key, () => ({ state: "cancelled" })); return; }
  if (!domain.result || !SETTLED.has(domain.status)) {
    // Back at work after his decision: the objective is working again unless something else still waits on him.
    if (AT_WORK.has(domain.status) && run.reviewed?.includes(":needs_decision:")) {
      changeRun(objective.id, run.key, () => ({ reviewed: undefined }), (current) => (
        current.status === "needs_george" && !planOf(current).some((other) => other.state === "failed") && !awaitsDecision(current)
          ? { status: "working", waitingOn: undefined, snooze: undefined } : {}
      ));
    }
    return;
  }
  const key = `${ref}:${domain.status}:${domain.updatedAt}`;
  if (run.reviewed === key) return;
  // Overtaken by a correction: kept as prior work and run again, never reviewed or delivered.
  if (domain.status === "completed" && run.validFor !== (objective.briefRevision ?? 0)) return completed(objective, run, key);
  // Told already (before a restart could record it): recorded as told, never said again.
  const told = domain.notified && domain.told ? domain.told : null;
  const decision = told ? null : await (deps.decide ?? defaultDecide)(domain);
  // Sent back to its boss: it stays working, and the boss's next reply is reviewed afresh.
  if (decision?.action && decision.verification.status === "verified") return;
  if (decision) decisions.set(ref, decision);
  if (domain.status === "completed") return completed(objective, run, key);
  if (domain.status === "failed") return failed(objective, run, key, plainLine(domain.failure ?? domain.result.brief ?? ""), domain.result.brief, deps, store, true);
  // A call only he can make: told now, while the rest of the objective carries on.
  const id = `${objective.id}:${key}`;
  const made = told ? { ...plainReport(objective, "decision", told.line, ""), id, evidenceRefs: [`domain-run:${ref}`] } : runReport(objective, domain, decision!, id);
  await report(objective, made, deps, store, async () => told ? undefined : (deps.tell ?? defaultTell)(domain, decision!, `cos:${id}`), "needs_george", { kind: "run" });
  changeRun(objective.id, run.key, () => ({ reviewed: key }));
}

function runReport(objective: Objective, run: DomainRun, decision: ExecutiveDecisionRecord, id: string): CosReport {
  const shaped = reportFromRun(run, decision);
  return {
    id, objectiveId: objective.id, kind: shaped.kind, outcome: shaped.outcome, detail: shaped.detail,
    ...(shaped.recommendation ? { recommendation: shaped.recommendation } : {}), ...(shaped.options?.length ? { options: shaped.options } : {}),
    evidenceRefs: [`domain-run:${run.id}`, ...decision.evidenceRefs], shape: shaped.shape, artefacts: shaped.artefacts, urgency: objective.urgency ?? shaped.urgency,
  };
}

/** A completed run: kept as done, or, when a correction overtook it, kept as prior work and run again; never delivered stale. */
function completed(objective: Objective, run: PlannedRun, key: string): void {
  changeRun(objective.id, run.key, (current, now) => current.validFor === (now.briefRevision ?? 0) ? { state: "completed", reviewed: key } : requeue(current));
}

/**
 * A failed run gets one alternative: re-briefed to its team with why it failed. A second failure, or a run that may
 * have acted outside (a one-off job), becomes one decision for George; nothing is tried a third time.
 */
async function failed(objective: Objective, run: PlannedRun, key: string, why: string, detail: string, deps: CosTickDeps, store: IntelligenceEventStore, retryable: boolean): Promise<void> {
  const reason = why && !unfitForHim(why).length ? why : "";
  if (retryable && !run.adapted) {
    changeRun(objective.id, run.key, (current) => current.reviewed === key ? null : requeue(current, { adapted: true, failure: reason ? `it didn't finish (${reason})` : "it didn't finish" }), (current) => ({
      adaptations: [...(current.adaptations ?? []), adaptation(run.key, "rebrief", `It didn't finish${reason ? ` (${reason})` : ""}, so it was briefed again once with that.`)],
    }));
    return;
  }
  const work = shortWords(run.outcome);
  const outcome = run.adapted
    ? `${work} didn't finish on the second try either${reason ? `: ${reason}` : ""}. Try another way, or drop it?`
    : reason ? `${work} didn't finish: ${reason}` : `${work} didn't finish.`;
  const made: CosReport = { ...plainReport(objective, "decision", outcome, key), detail, evidenceRefs: [linkOf(run.ref!)], options: ["Try another way", "Drop it"] };
  changeRun(objective.id, run.key, () => ({ state: "failed", reviewed: key }));
  await report(objective, made, deps, store, async () => (deps.say ?? defaultSay)(made), "needs_george", { kind: "retry" });
}

/** Runs dispatched and not yet settled, across every open objective. */
function activeNow(): number {
  return listObjectives().filter((objective) => OPEN.has(objective.status)).flatMap(planOf).filter(isActive).length;
}

const OPEN = new Set<Objective["status"]>(["intake", "working", "needs_george"]);

/** What the work a run waits on found: a join's synthesis (or one dependency's result), links to each, and what the join changed. */
interface Found { synthesis: string; refs: string[]; cancel: Array<{ key: string; reason: string }>; add: RunBrief[] }

export function joinPrompt(objective: Objective, run: PlannedRun, results: Array<{ run: PlannedRun; text: string }>, queued: PlannedRun[]): string {
  return [
    "You are Flyd's Chief of Staff, writing the brief for the next step of George's work from the results of the steps it waits on.",
    `George's exact words: ${objective.words}`,
    `This step (${run.team}): ${run.outcome}`,
    `Done when: ${run.doneWhen.join("; ")}`,
    "",
    "Results it builds on:",
    ...results.map(({ run: dep, text }) => `--- ${dep.key} (${dep.team}): ${dep.outcome}\n${text.slice(0, 4_000) || "(no written result)"}`),
    ...(queued.length ? ["", "Steps queued but not started:", ...queued.map((other) => `- ${other.key} (${other.team}): ${other.outcome}`)] : []),
    "",
    "brief: what this step needs from those results, short and concrete, in his terms. cancel: queued steps these results make pointless (none is usual). then: steps that should follow this one now that the results are in (none is usual).",
    'Return JSON only: {"brief":"...","cancel":[{"id":"...","reason":"..."}],"then":[{"team":"coding|knowledge|creative|life","outcome":"...","done_when":["..."]}]}',
  ].join("\n");
}

/**
 * What the work a run waits on found. One dependency: its retained result. Several: a join, written in one query from
 * their retained results; when that can't be written, their own results stand in, so a model outage never stalls it.
 */
async function foundBefore(objective: Objective, run: PlannedRun, deps: CosTickDeps): Promise<Found | undefined> {
  const plan = planOf(objective);
  const depKeys = objective.after?.[run.key] ?? [];
  if (!depKeys.length) return undefined;
  const { listJobs } = await import("../../runtime/background-jobs.js");
  const jobs = depKeys.some((key) => plan.find((found) => found.key === key)?.ref?.startsWith("job:")) ? listJobs() : [];
  const results = depKeys.map((key) => plan.find((found) => found.key === key)!).map((dep) => ({ run: dep, text: resultText(dep.ref!, jobs) }));
  const refs = results.map(({ run: dep }) => linkOf(dep.ref!));
  const own = results.map(({ run: dep, text }) => results.length > 1 ? `${dep.outcome}: ${text.slice(0, 1_500)}` : text.slice(0, 4_000)).join("\n\n");
  if (results.length === 1) return { synthesis: own, refs, cancel: [], add: [] };
  const queued = plan.filter((other) => other.state === "queued" && other.key !== run.key && !depKeys.includes(other.key));
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse((await (deps.complete ?? defaultComplete)(joinPrompt(objective, run, results, queued))).replace(/^```(?:json)?\s*|\s*```$/g, "")) as Record<string, unknown>;
  } catch {
    // Their own results stand in for the synthesis.
  }
  const synthesis = String(parsed.brief ?? "").trim();
  if (!synthesis) return { synthesis: own, refs, cancel: [], add: [] };
  const cancel = (Array.isArray(parsed.cancel) ? parsed.cancel : []).flatMap((item) => {
    const given = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const key = String(given.id ?? "");
    return queued.some((other) => other.key === key) ? [{ key, reason: String(given.reason ?? "").trim() || "the joined results made it pointless" }] : [];
  });
  const project = objective.brief?.project ?? {};
  let next = plan.length;
  const add = (Array.isArray(parsed.then) ? parsed.then : []).slice(0, 3).flatMap((item) => {
    const read = readRun((item && typeof item === "object" ? item : {}) as Record<string, unknown>, `r${next + 1}`, [run.key], project);
    if ("refused" in read || !Object.hasOwn(TEAMS, read.team)) return [];
    next += 1;
    return [read];
  });
  return { synthesis, refs, cancel, add };
}

/** Dispatches queued runs whose dependencies are done, while fewer than the limit are active. Each by its own request id. */
async function release(id: string, deps: CosTickDeps, store: IntelligenceEventStore, now: Date): Promise<void> {
  for (const candidate of releasable(readObjective(id)!)) {
    const objective = readObjective(id);
    if (!objective || !["working", "needs_george"].includes(objective.status)) return;
    if (activeNow() >= maxActive()) return;
    const join = await foundBefore(objective, candidate, deps);
    // Written `dispatching` before the executor is called, with the brief it is sent: a restart replays exactly this.
    const claimed = mutatePlan(id, (current, plan) => {
      const run = plan.find((found) => found.key === candidate.key);
      if (!run || run.state !== "queued" || !["working", "needs_george"].includes(current.status)) return null;
      const attempt = run.attempt + 1;
      Object.assign(run, { state: "dispatching", attempt, dispatching: { pid: process.pid, at: now.toISOString() }, validFor: current.briefRevision ?? 0 });
      run.sent = sentBrief(current, { ...run, sent: undefined }, join).outcome;
      const adaptations = [...(current.adaptations ?? [])];
      for (const cut of join?.cancel ?? []) {
        const other = plan.find((found) => found.key === cut.key);
        if (other?.state !== "queued") continue;
        other.state = "cancelled";
        adaptations.push(adaptation(cut.key, "cancel", cut.reason));
      }
      const after = { ...(current.after ?? {}) };
      for (const added of join?.add ?? []) {
        if (plan.some((found) => found.key === added.key)) continue;
        const { after: waits, ...rest } = added;
        plan.push({ ...rest, state: "queued", attempt: 0, validFor: current.briefRevision ?? 0 });
        after[added.key] = waits;
        adaptations.push(adaptation(added.key, "add", `Added after the results it waits on came in: ${added.outcome}`));
      }
      return { adaptations, after };
    });
    const run = claimed && planOf(claimed).find((found) => found.key === candidate.key);
    if (!claimed || !run || run.state !== "dispatching" || run.dispatching?.pid !== process.pid) continue;
    let answer: Dispatched;
    try {
      answer = await (deps.dispatch ?? dispatchBrief)(claimed, sentBrief(claimed, run), planRequestId(id, run));
    } catch {
      // Whether it reached the team is unknown: left `dispatching`, the next pass reconciles it by request id.
      continue;
    }
    await dispatched(id, run.key, answer, deps, store);
  }
}

export function acceptancePrompt(objective: Objective, finals: Array<{ run: PlannedRun; text: string }>): string {
  return [
    "You are Flyd's Chief of Staff. Before George hears his work is done, check the finished result against what done means.",
    `George's exact words: ${objective.words}`,
    `The outcome: ${objective.brief?.outcome ?? objective.words}`,
    `Done when: ${(objective.brief?.doneWhen ?? []).join("; ")}`,
    ...(objective.corrections?.length ? [`His corrections since: ${objective.corrections.map((item) => item.text).join("; ")}`] : []),
    "",
    "The finished result:",
    ...finals.map(({ run, text }) => `--- ${run.team}: ${run.outcome}\n${text.slice(0, 6_000) || "(no written result)"}`),
    "",
    'Return JSON only: {"met":true|false,"missing":"what is still missing, in his terms, when not met"}',
  ].join("\n");
}

/** Whether the finished result meets done_when; a check that can't be read lets it through, said so in the report's detail. */
async function accept(objective: Objective, finals: PlannedRun[], deps: CosTickDeps): Promise<{ met: boolean; missing: string; checked: boolean }> {
  const { listJobs } = await import("../../runtime/background-jobs.js");
  const jobs = finals.some((run) => run.ref?.startsWith("job:")) ? listJobs() : [];
  try {
    const parsed = JSON.parse((await (deps.complete ?? defaultComplete)(acceptancePrompt(objective, finals.map((run) => ({ run, text: resultText(run.ref!, jobs) })))))
      .replace(/^```(?:json)?\s*|\s*```$/g, "")) as Record<string, unknown>;
    if (typeof parsed.met !== "boolean") return { met: true, missing: "", checked: false };
    return { met: parsed.met, missing: plainLine(String(parsed.missing ?? "")), checked: true };
  } catch {
    // The domain's own review (FirstMate's checks, the Creative Director) still stands; acceptance is the extra look.
    return { met: true, missing: "", checked: false };
  }
}

/**
 * The one delivery: only once every run holds for the latest revision (the delivery rule, in code), and the result
 * meets done_when. Short of it, the final run gets its one alternative; after that, George gets one decision.
 */
async function finish(id: string, deps: CosTickDeps, store: IntelligenceEventStore, decisions: Map<string, ExecutiveDecisionRecord>): Promise<void> {
  const objective = readObjective(id);
  if (!objective || !["working", "needs_george"].includes(objective.status)) return;
  const live = planOf(objective).filter((run) => !isGone(run));
  if (!live.length || !live.every((run) => isValid(run, objective))) return;
  const finals = sinks(objective);
  const reportId = `${id}:${finals.map((run) => run.reviewed).join("+")}`;
  const finalsKey = finals.map((run) => run.reviewed).join("+");
  const shortKey = `short:${finalsKey}`;
  if (objective.reportIds.includes(reportId)) return;
  // He took a result that fell short as it is: delivered without asking the check again.
  const taken = objective.takenAsIs === finalsKey;
  if (!taken && objective.reportIds.includes(`${id}:${shortKey}`)) return;
  const verdict = taken ? { met: true, missing: "", checked: true } : await accept(objective, finals, deps);
  if (!verdict.met) {
    const retry = finals.find((run) => !run.adapted && !run.ref?.startsWith("job:"));
    const missing = verdict.missing || "it doesn't yet meet what done means";
    if (retry) {
      changeRun(id, retry.key, (current) => current.state === "completed" ? requeue(current, { adapted: true, failure: `it fell short of done: ${missing}` }) : null, (current) => ({
        adaptations: [...(current.adaptations ?? []), adaptation(retry.key, "rebrief", `The result fell short (${missing}), so it was briefed again once with that.`)],
      }));
      return;
    }
    const made: CosReport = { ...plainReport(objective, "decision", `${workOf(objective)} is close but not there: ${missing}. Take it as it is, or try another way?`, shortKey), options: ["Take it as it is", "Try another way"], evidenceRefs: finals.map((run) => linkOf(run.ref!)) };
    await report(objective, made, deps, store, async () => (deps.say ?? defaultSay)(made), "needs_george", { kind: "accept" });
    return;
  }
  const unchecked = verdict.checked ? "" : "Not checked against done_when (the check couldn't be read).";
  const final = finals.length === 1 && finals[0]!.ref && !finals[0]!.ref.includes(":") ? readDomainRun(finals[0]!.ref) : null;
  if (final) {
    // Told already (before a restart could record it): recorded as told, never said again.
    if (final.notified && final.told) {
      const made = { ...plainReport(objective, "done", final.told.line, ""), id: reportId, evidenceRefs: [`domain-run:${final.id}`] };
      return report(objective, made, deps, store, async () => undefined, "done");
    }
    const decision = decisions.get(final.id) ?? await (deps.decide ?? defaultDecide)(final);
    const made = runReport(objective, final, decision, reportId);
    return report(objective, { ...made, detail: [made.detail, unchecked].filter(Boolean).join("\n") }, deps, store, async () => (deps.tell ?? defaultTell)(final, decision, `cos:${reportId}`), "done");
  }
  const { listJobs } = await import("../../runtime/background-jobs.js");
  const jobs = finals.some((run) => run.ref?.startsWith("job:")) ? listJobs() : [];
  const made: CosReport = {
    ...plainReport(objective, "done", `${workOf(objective)} is done.`, ""), id: reportId,
    detail: [...finals.map((run) => resultText(run.ref!, jobs)), unchecked].filter(Boolean).join("\n\n"), evidenceRefs: finals.map((run) => linkOf(run.ref!)),
  };
  await report(objective, made, deps, store, async () => (deps.say ?? defaultSay)(made), "done");
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** A working objective, one pass: reconcile, settle, finish, release. */
async function advance(id: string, deps: CosTickDeps, store: IntelligenceEventStore, now: Date): Promise<void> {
  const decisions = new Map<string, ExecutiveDecisionRecord>();
  const start = readObjective(id);
  if (!start) return;
  for (const run of planOf(start)) {
    // Left `dispatching` by a pass that died (this process's own earlier pass, or a dead or long-silent one).
    const left = run.dispatching;
    if (run.state === "dispatching" && (!left || left.pid === process.pid || !alive(left.pid) || now.getTime() - Date.parse(left.at) > CLAIM_LEASE_MS)) {
      await reconcile(start, run, deps, store);
    }
  }
  for (const run of planOf(readObjective(id) ?? start)) {
    if (run.state === "dispatched" && run.ref) await settle(readObjective(id) ?? start, run, deps, store, decisions);
    // A second result after the first was kept: the first stands, and work_status can say so.
    if (run.state === "completed" && run.ref && !run.ref.includes(":") && !run.reportedTwice) {
      const domain = readDomainRun(run.ref);
      if (domain?.status === "completed" && `${run.ref}:completed:${domain.updatedAt}` !== run.reviewed) changeRun(id, run.key, () => ({ reportedTwice: true }));
    }
  }
  await finish(id, deps, store, decisions);
  await release(id, deps, store, now);
  await attend(id, deps, store, now);
}

/** Work with no progress this long is settled by the Chief of Staff: chased, parked, or put to George when it can't tell. */
export const STUCK_MS = 24 * 60 * 60_000;

/** When anything last moved on it: its own record, the last triage, or its teams' runs. */
function lastProgress(objective: Objective): number {
  const marks = [objective.progressAt ?? objective.createdAt, objective.triage?.at(-1)?.at ?? "",
    ...planOf(objective).flatMap((run) => (run.ref && !run.ref.includes(":") ? [readDomainRun(run.ref)?.updatedAt ?? ""] : []))];
  return Math.max(...marks.map((mark) => Date.parse(mark)).filter(Number.isFinite));
}

/**
 * What waits on George, and what has gone quiet (v8 Phase 7). A snoozed wait raises nothing until its time, then comes
 * back once. A wait with no question gets one ("X is waiting on you for Y"). Work quiet for a day is settled here:
 * nudged (FirstMate's runs are chased by the fleet monitor; the Librarian gets a note), parked when it waits on
 * something outside, or, when that can't be told, one decision for George. Staff silence alone never reaches him.
 */
async function attend(id: string, deps: CosTickDeps, store: IntelligenceEventStore, now: Date): Promise<void> {
  const objective = readObjective(id);
  if (!objective || !["working", "needs_george"].includes(objective.status)) return;
  const work = workOf(objective);
  if (objective.snooze) {
    if (now.getTime() < Date.parse(objective.snooze.until)) return;
    const waiting = objective.waitingOn;
    if (waiting && objective.status === "needs_george" && waiting.reportId === objective.snooze.reportId) {
      const made: CosReport = { ...plainReport(objective, "decision", `Back as you asked: ${waiting.question}`, `back:${objective.snooze.until}`), ...(waiting.options ? { options: waiting.options } : {}) };
      return report(objective, made, deps, store, async () => (deps.say ?? defaultSay)(made), "needs_george", { kind: waiting.kind, question: waiting.question });
    }
    mutateObjective(id, (current) => current && { ...current, snooze: undefined });
    return;
  }
  if (objective.status === "needs_george") {
    if (objective.waitingOn) return;
    const asked = planOf(objective).map((run) => (run.ref && !run.ref.includes(":") ? readDomainRun(run.ref) : null)).find((run) => run?.status === "needs_decision");
    const question = plainLine(asked?.result?.unresolvedQuestions[0] ?? "");
    const made = plainReport(objective, "decision", `“${work}” is waiting on you for ${question && !unfitForHim(question).length ? question.replace(/[.?!]+$/, "") : "a decision"}.`, `waiting:${objective.progressAt ?? objective.updatedAt}`);
    return report(objective, made, deps, store, async () => (deps.say ?? defaultSay)(made), "needs_george", { kind: asked ? "run" : "question" });
  }
  if (objective.parked || objective.ongoing || now.getTime() - lastProgress(objective) < STUCK_MS) return;
  const out = planOf(objective).filter((run) => ["dispatching", "dispatched", "unknown"].includes(run.state));
  if (!out.length) return;
  let cannotTell = "";
  let nudged = "";
  let parked = "";
  for (const run of out) {
    if (run.state !== "dispatched" || !run.ref) { cannotTell = "a team never confirmed it has the work"; continue; }
    if (run.ref.startsWith("job:")) { cannotTell = "a one-off job has been running for a day"; continue; }
    if (run.ref.startsWith("crew:")) { parked = "the crew tells him itself when it is ready"; continue; }
    const domain = readDomainRun(run.ref);
    if (!domain) { cannotTell = "a run's record is missing"; continue; }
    if (domain.status === "needs_decision") continue;
    if (domain.transport.kind === "firstmate") { nudged = "FirstMate is being chased for it"; continue; }
    const sent = await (deps.send ?? sendRunMessage)({ run: domain, kind: "question", from: "flyd", body: "Where does this stand? It has been quiet for a day." }).catch(() => ({ delivered: false }));
    if (sent.delivered) nudged = `${domain.owner} was asked where it stands`;
    else cannotTell = `${domain.owner} can't be asked where it stands`;
  }
  const at = now.toISOString();
  if (cannotTell) {
    const made: CosReport = { ...plainReport(objective, "decision", `“${work}” has gone quiet and I can't tell why. Nudge it, park it, or is it meant to keep running?`, `stuck:${at}`), options: ["Nudge", "Park it", "It's ongoing"] };
    mutateObjective(id, (current) => current && { ...current, triage: [...(current.triage ?? []), { at, choice: "asked", reason: cannotTell }] });
    return report(objective, made, deps, store, async () => (deps.say ?? defaultSay)(made), "needs_george", { kind: "stuck" });
  }
  const choice = nudged ? "nudge" : parked ? "park" : null;
  if (!choice) return;
  const reason = nudged || parked;
  mutateObjective(id, (current) => current && {
    ...current, triage: [...(current.triage ?? []), { at, choice, reason }], ...(choice === "park" ? { parked: { at, reason } } : {}),
  });
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
        const current = readObjective(objective.id);
        if (current && (current.status === "working" || current.status === "needs_george")) await advance(current.id, deps, store, now);
      } catch {
        // One objective's failure never stops the others; it is tried again next tick.
      }
    }
  } finally {
    ticking = false;
    if (deps.store === undefined) store.close();
  }
}
