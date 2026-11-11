import { sendRunMessage } from "../messages.js";
import { readDomainRun } from "../store.js";
import type { DomainId, DomainRun } from "../types.js";
import { listObjectives, mutateObjective, readObjective } from "./objectives.js";
import { downstreamOf, isGone, planOf, requeue, sinks } from "./plan.js";
import type { Adaptation, Objective, PlannedRun } from "./types.js";

// Steering and status (split plan Phase 4, behind FLYD_COS=1). `tell_work` replaces the in-turn fast path: the Chief
// of Staff resolves which objective and run George's message is for and delivers it through `sendRunMessage`; when
// two or more objectives genuinely match it asks one question instead of guessing. `work_status` is read-only and
// answers from the objectives and their retained results, so a follow-up question never dispatches anything.
// A correction (v8 Phase 6) bumps the objective's `briefRevision` and invalidates only the run it targets and what is
// downstream of it: other runs keep their results, moved forward to the new revision. When it can't tell which run a
// correction is for, it asks one question rather than redoing everything.
// Waiting work (v8 Phase 7): his reply to what an objective waits on resumes that same objective through its record,
// never a new task; a snooze sets the wait aside until the time he picks.

export type SteerKind = "correction" | "decision" | "priority_change" | "cancel" | "snooze";

export interface SteerOutcome {
  delivered: boolean;
  objectiveId?: string;
  /** The one question to ask him when the message could be for more than one piece of work. */
  ask?: string;
  /** When a snoozed wait comes back. */
  until?: string;
  reason?: "no_active_work" | "ambiguous" | "not_steerable" | "delivery_failed" | "invalid_time";
}

const OPEN = new Set<Objective["status"]>(["intake", "working", "needs_george"]);
const STEERABLE = new Set<DomainRun["status"]>(["queued", "accepted", "working", "needs_decision"]);

function short(words: string, max = 60): string {
  const line = words.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : line;
}

/** The domain runs of an objective that can still take a message, the one waiting on his decision first. */
function steerableRuns(objective: Objective): DomainRun[] {
  const runs = [...objective.runs].reverse().filter((ref) => !ref.includes(":")).map((ref) => readDomainRun(ref))
    .filter((run): run is DomainRun => Boolean(run && STEERABLE.has(run.status)));
  return [...runs.filter((run) => run.status === "needs_decision"), ...runs.filter((run) => run.status !== "needs_decision")];
}

/** The run a correction is for: the one run, or the one the team hint names; null when that can't be told. */
function correctionTarget(plan: PlannedRun[], team?: DomainId): PlannedRun | null {
  const live = plan.filter((run) => !isGone(run));
  if (live.length === 1) return live[0]!;
  const named = team ? live.filter((run) => run.team === team) : [];
  return named.length === 1 ? named[0]! : null;
}

/** Whether a dispatched run is a domain run that can take his message now. */
function steerable(run: PlannedRun): DomainRun | null {
  if (run.state !== "dispatched" || !run.ref || run.ref.includes(":")) return null;
  const found = readDomainRun(run.ref);
  return found && STEERABLE.has(found.status) ? found : null;
}

/** Started one-off job states a correction would re-run or leave stale. */
const LIFE_STARTED = new Set<PlannedRun["state"]>(["dispatching", "dispatched", "completed", "failed"]);

function isJob(run: PlannedRun): boolean {
  return run.team === "life" || Boolean(run.ref?.startsWith("job:"));
}

async function correct(objective: Objective, message: string, team: DomainId | undefined, send: typeof sendRunMessage): Promise<SteerOutcome> {
  const plan = planOf(objective);
  const target = correctionTarget(plan, team);
  if (!target) {
    const live = plan.filter((run) => !isGone(run));
    return { delivered: false, objectiveId: objective.id, reason: "ambiguous", ask: `Which part is this for: ${live.map((run) => `“${short(run.outcome, 40)}”`).join(" or ")}?` };
  }
  const affected = downstreamOf(objective.after ?? {}, target.key);
  // A one-off job may have booked, sent or paid: a correction never runs it again on its own, so he decides.
  const gone = plan.find((run) => affected.has(run.key) && isJob(run) && LIFE_STARTED.has(run.state));
  if (gone) {
    return { delivered: false, objectiveId: objective.id, reason: "not_steerable", ask: `“${short(gone.outcome, 40)}” has already gone ahead, so I can't change it. Want it done again with this?` };
  }
  // Under way: the team gets it first, and nothing changes when it can't be passed on.
  const active = steerable(target);
  if (active) {
    const outcome = await send({ run: active, kind: "correction", body: message }).catch(() => ({ delivered: false }));
    if (!outcome.delivered) return { delivered: false, objectiveId: objective.id, reason: "delivery_failed" };
  } else if (target.ref?.startsWith("crew:") || target.state === "unknown") {
    return { delivered: false, objectiveId: objective.id, reason: "not_steerable" };
  }
  const downstream: DomainRun[] = [];
  const saved = mutateObjective(objective.id, (current) => {
    if (!current || !OPEN.has(current.status)) return null;
    const was = current.briefRevision ?? 0;
    const revision = was + 1;
    const runs = planOf(current).map((run): PlannedRun => {
      if (isGone(run)) return run;
      // Untouched by it: the result still holds, now for the new revision.
      if (!affected.has(run.key)) return run.validFor === was ? { ...run, validFor: revision } : run;
      if (run.key === target.key && active) return { ...run, validFor: revision };
      if (run.state === "completed" || run.state === "failed") {
        const { ref: _ref, sent: _sent, reviewed: _reviewed, ...rest } = run;
        return { ...rest, state: "queued", prior: run.ref ? [...new Set([...(run.prior ?? []), run.ref])] : run.prior };
      }
      if (run.key !== target.key) { const found = steerable(run); if (found) downstream.push(found); }
      return run;
    });
    const waiting = runs.some((run) => run.state === "failed");
    const resumed = current.status === "needs_george" && !waiting;
    return {
      ...current, plan: runs, briefRevision: revision, status: resumed ? "working" : current.status,
      ...(resumed ? { waitingOn: undefined, snooze: undefined } : {}), progressAt: new Date().toISOString(),
      corrections: [...(current.corrections ?? []), { revision, run: target.key, text: message, at: new Date().toISOString() }],
    };
  });
  if (!saved) return { delivered: false, objectiveId: objective.id, reason: "not_steerable" };
  // Downstream work under way hears it too; its result is still redone from the corrected work it waits on.
  for (const run of downstream) await send({ run, kind: "correction", body: message }).catch(() => undefined);
  return { delivered: true, objectiveId: objective.id };
}

async function cancel(objective: Objective, message: string, send: typeof sendRunMessage): Promise<SteerOutcome> {
  const plan = planOf(objective);
  // Never a cancel reported for work it cannot stop (a one-off job, the crew, a run whose executor can't be asked).
  const unstoppable = plan.some((run) => (run.state === "dispatched" && Boolean(run.ref?.includes(":"))) || run.state === "unknown");
  if (unstoppable) return { delivered: false, objectiveId: objective.id, reason: "not_steerable" };
  for (const run of plan.map(steerable).filter((found): found is DomainRun => Boolean(found))) {
    const outcome = await send({ run, kind: "cancel", body: message }).catch(() => ({ delivered: false }));
    if (!outcome.delivered) return { delivered: false, objectiveId: objective.id, reason: "delivery_failed" };
  }
  const closed = mutateObjective(objective.id, (current) => current && OPEN.has(current.status) ? {
    ...current, status: "cancelled", ...(current.plan ? { plan: current.plan.map((run) => run.state === "queued" ? { ...run, state: "cancelled" as const } : run) } : {}),
  } : null);
  return closed?.status === "cancelled" ? { delivered: true, objectiveId: objective.id } : { delivered: false, objectiveId: objective.id, reason: "not_steerable" };
}

/** When "this evening", "tomorrow morning" or a given time falls; null when it isn't a time still to come. */
export function snoozeUntil(when: string | undefined, now = new Date()): Date | null {
  const said = (when ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const at = (days: number, hour: number) => { const date = new Date(now); date.setDate(date.getDate() + days); date.setHours(hour, 0, 0, 0); return date; };
  if (said === "this_evening") return new Date(Math.max(at(0, 18).getTime(), now.getTime() + 60 * 60_000));
  if (said === "tomorrow_morning" || said === "tomorrow") return at(1, 8);
  const given = Date.parse(when ?? "");
  return Number.isFinite(given) && given > now.getTime() ? new Date(given) : null;
}

function snooze(objective: Objective, when: string | undefined, now = new Date()): SteerOutcome {
  const until = snoozeUntil(when, now);
  if (!until) return { delivered: false, objectiveId: objective.id, reason: "invalid_time" };
  if (objective.status !== "needs_george") return { delivered: false, objectiveId: objective.id, reason: "not_steerable" };
  const saved = mutateObjective(objective.id, (current) => current && current.status === "needs_george" ? {
    ...current, snooze: { until: until.toISOString(), ...(current.waitingOn ? { reportId: current.waitingOn.reportId } : {}), at: now.toISOString() },
  } : null);
  return saved?.snooze ? { delivered: true, objectiveId: objective.id, until: saved.snooze.until } : { delivered: false, objectiveId: objective.id, reason: "not_steerable" };
}

/** The option his answer names, from the question's options. */
function picked(options: string[] | undefined, said: string): string | undefined {
  const text = said.trim().toLowerCase();
  return text ? options?.find((option) => text === option.toLowerCase() || text.includes(option.toLowerCase())) : undefined;
}

/**
 * His reply to what the objective waits on, resuming that objective: work gone quiet is nudged, parked or left running
 * as he says; work that couldn't start is briefed again with his answer; a result he takes as it is is delivered;
 * otherwise what didn't make it is tried again with his words, or dropped when he says so.
 */
async function resume(objective: Objective, message: string, choice: string | undefined, send: typeof sendRunMessage): Promise<SteerOutcome> {
  const waiting = objective.waitingOn!;
  const option = picked(waiting.options, choice ?? "") ?? picked(waiting.options, message);
  const at = new Date().toISOString();
  const done = { delivered: true, objectiveId: objective.id };
  const back = { waitingOn: undefined, snooze: undefined, progressAt: at };
  if (waiting.kind === "question") {
    const run = steerableRuns(objective)[0];
    if (run) {
      const outcome = await send({ run, kind: "decision", body: message }).catch(() => ({ delivered: false }));
      if (!outcome.delivered) return { delivered: false, objectiveId: objective.id, reason: "delivery_failed" };
      mutateObjective(objective.id, (current) => current && { ...current, ...back });
      return done;
    }
  }
  if (waiting.kind === "stuck") {
    const choice = option === "Park it" ? "park" : option === "It's ongoing" ? "ongoing" : "nudge";
    mutateObjective(objective.id, (current) => current && {
      ...current, ...back, status: "working", triage: [...(current.triage ?? []), { at, choice, reason: "his call" }],
      ...(choice === "park" ? { parked: { at, reason: "he parked it" } } : {}), ...(choice === "ongoing" ? { ongoing: true } : {}),
    });
    if (choice === "nudge") {
      for (const run of steerableRuns(objective).filter((found) => found.transport.kind !== "firstmate")) {
        await send({ run, kind: "question", from: "flyd", body: "Where does this stand? George asked." }).catch(() => undefined);
      }
    }
    return done;
  }
  if (waiting.kind === "intake") {
    mutateObjective(objective.id, (current) => {
      if (!current) return null;
      const { brief: _brief, plan: _plan, after: _after, ...rest } = current;
      return { ...rest, ...back, status: "intake", flydNotes: [current.flydNotes, `His answer when asked for more: ${message}`].filter(Boolean).join("\n") };
    });
    return done;
  }
  if (waiting.kind === "accept" && option === "Take it as it is") {
    mutateObjective(objective.id, (current) => current && { ...current, ...back, status: "working", takenAsIs: sinks(current).map((run) => run.reviewed).join("+") });
    return done;
  }
  // Tried again with his words, or dropped when he says so: what didn't make it, or the result that fell short.
  const drop = waiting.kind === "retry" && option === "Drop it";
  mutateObjective(objective.id, (current) => {
    if (!current) return null;
    const plan = planOf(current).map((run) => ({ ...run }));
    const targets = new Set((waiting.kind === "accept" ? sinks(current) : plan.filter((run) => run.state === "failed")).map((run) => run.key));
    const adaptations: Adaptation[] = [...(current.adaptations ?? [])];
    if (drop) {
      const gone = new Set([...targets].flatMap((key) => [...downstreamOf(current.after ?? {}, key)]));
      for (const run of plan) if (gone.has(run.key) && !isGone(run)) { run.state = "dropped"; adaptations.push({ run: run.key, at, action: "drop", reason: "he said to drop it" }); }
    } else {
      for (const [index, run] of plan.entries()) {
        if (!targets.has(run.key)) continue;
        plan[index] = { ...run, ...requeue(run, { adapted: true, failure: [run.failure, `George said: ${message}`].filter(Boolean).join(". ") }) };
      }
    }
    const left = plan.some((run) => !isGone(run));
    return { ...current, ...back, plan, adaptations, status: left ? "working" : "cancelled" };
  });
  return done;
}

/** Delivers George's message about work under way to the one objective it is for. */
export async function tellWork(
  input: { message: string; objectiveId?: string; kind?: SteerKind; team?: DomainId; until?: string; choice?: string },
  send: typeof sendRunMessage = sendRunMessage,
  now = new Date(),
): Promise<SteerOutcome> {
  const message = input.message.trim();
  const kind = input.kind ?? "correction";
  const open = listObjectives().filter((objective) => OPEN.has(objective.status));
  // A snooze is about something waiting on him.
  const pool = kind === "snooze" ? open.filter((objective) => objective.status === "needs_george") : open;
  let candidates = input.objectiveId ? pool.filter((objective) => objective.id === input.objectiveId) : pool;
  // The team is a hint: it narrows the list when it names some of them, and never empties it.
  if (!input.objectiveId && input.team) {
    const byTeam = candidates.filter((objective) => objective.brief?.team === input.team || planOf(objective).some((run) => run.team === input.team));
    if (byTeam.length) candidates = byTeam;
  }
  if (!message || candidates.length === 0) return { delivered: false, reason: "no_active_work" };
  if (candidates.length > 1) {
    return { delivered: false, reason: "ambiguous", ask: `Which is this for: ${candidates.map((objective) => `“${short(objective.words)}”`).join(" or ")}?` };
  }
  const objective = candidates[0]!;
  if (objective.status === "intake") {
    // Still being briefed: intake reads it with his words, and a cancel closes it before anything is sent.
    if (kind === "cancel") return cancel(objective, message, send);
    mutateObjective(objective.id, (current) => current && { ...current, flydNotes: [current.flydNotes, `Later from George (${kind}): ${message}`].filter(Boolean).join("\n") });
    return { delivered: true, objectiveId: objective.id };
  }
  if (kind === "cancel") return cancel(objective, message, send);
  if (kind === "snooze") return snooze(objective, input.until, now);
  // His answer to what it waits on resumes this same objective; a run's own call goes to the run, as below.
  if (objective.status === "needs_george" && objective.waitingOn && objective.waitingOn.kind !== "run" && (kind === "decision" || kind === "correction")) {
    return resume(objective, message, input.choice, send);
  }
  if (kind === "correction") return correct(objective, message, input.team, send);
  const run = steerableRuns(objective)[0];
  if (!run) return { delivered: false, objectiveId: objective.id, reason: "not_steerable" };
  const outcome = await send({ run, kind, body: message }).catch(() => ({ delivered: false }));
  if (!outcome.delivered) return { delivered: false, objectiveId: objective.id, reason: "delivery_failed" };
  return { delivered: true, objectiveId: objective.id };
}

const STAGE: Record<Objective["status"], string> = {
  intake: "being briefed", working: "under way", needs_george: "waiting on you", done: "done", failed: "didn't finish", cancelled: "cancelled",
};

const RUN_STAGE: Record<PlannedRun["state"], string> = {
  queued: "queued", dispatching: "being handed over", dispatched: "under way", unknown: "handed over, not confirmed",
  completed: "done", failed: "didn't finish", dropped: "dropped", cancelled: "cancelled",
};

/** A run's plain status, for when he asks how it went; nothing when there is nothing to say. Pure. */
export function plainStatus(run: PlannedRun, objective: Pick<Objective, "triage">): string | null {
  const active = run.state === "dispatching" || run.state === "dispatched";
  if (run.reportedTwice) return "reported twice (one result kept)";
  if (active && run.reconciled) return "interrupted, retrying";
  if (active && objective.triage?.at(-1)?.choice === "nudge") return "still finishing (gone quiet; the chaser is on it)";
  if (run.state === "completed" && run.attempt > 1 && run.failure) return "picked up (a retry finished it)";
  if (run.prior?.length && !run.failure) return "replaced (a newer revision took over)";
  return null;
}

/** How long finished objectives stay in the overview. */
const RECENT_MS = 48 * 60 * 60_000;

/** What his handed-off work is doing, or one objective's retained result for a follow-up. Read-only. */
export function workStatus(objectiveId?: string, now = new Date()): string {
  if (objectiveId) {
    const objective = readObjective(objectiveId);
    if (!objective) return `Error: no objective ${objectiveId}`;
    const lines = [`He asked: ${objective.words}`, `Stage: ${STAGE[objective.status]}`];
    if (objective.brief) lines.push(`Brief: ${objective.brief.outcome}`, `Done when: ${objective.brief.doneWhen.join("; ")}`);
    const plan = planOf(objective);
    if (plan.length > 1) {
      lines.push("Plan:", ...plan.map((run) => {
        const waits = objective.after?.[run.key] ?? [];
        const stage = run.state === "queued" && waits.length ? `waiting on ${waits.join(", ")}` : RUN_STAGE[run.state];
        return `- ${run.key} (${run.team}): ${short(run.outcome, 80)} — ${stage}`;
      }));
    }
    if (objective.waitingOn) lines.push(`Waiting on him: ${objective.waitingOn.question}`);
    if (objective.snooze) lines.push(`Snoozed until ${objective.snooze.until}`);
    if (objective.parked) lines.push(`Parked: ${objective.parked.reason}`);
    if (objective.ongoing) lines.push("Meant to keep running");
    const runStatus = plan.flatMap((run) => { const said = plainStatus(run, objective); return said ? [`${plan.length > 1 ? `${run.key}: ` : ""}${said}`] : []; });
    if (runStatus.length) lines.push(`How it went: ${runStatus.join("; ")}`);
    for (const item of objective.corrections ?? []) lines.push(`He corrected (${item.run}): ${item.text}`);
    for (const item of objective.adaptations ?? []) lines.push(`Adapted ${item.run}: ${item.reason}`);
    for (const ref of objective.runs) {
      const run = ref.includes(":") ? null : readDomainRun(ref);
      if (!run) continue;
      lines.push(`Run status: ${run.status}`);
      const result = run.result;
      if (result) {
        lines.push(`Brief report: ${result.brief}`);
        if (result.detailedReport) lines.push(`Detailed report:\n${result.detailedReport.slice(0, 6_000)}`);
        if (result.decisionsMade.length) lines.push(`Decided: ${result.decisionsMade.join("; ")}`);
        if (result.unresolvedQuestions.length) lines.push(`Open questions: ${result.unresolvedQuestions.join("; ")}`);
        if (result.artifacts.length) lines.push(`Artefacts: ${result.artifacts.join(", ")}`);
      }
      if (run.told) lines.push(`Told him: ${run.told.line}`);
    }
    return lines.join("\n");
  }
  const shown = listObjectives().filter((objective) => OPEN.has(objective.status) || now.getTime() - Date.parse(objective.updatedAt) < RECENT_MS);
  if (!shown.length) return "No work handed off lately.";
  return shown.map((objective) => {
    const stage = objective.snooze ? `snoozed until ${objective.snooze.until}` : objective.parked ? "parked" : STAGE[objective.status];
    return `- ${objective.id}: “${short(objective.words)}” — ${stage}`;
  }).join("\n");
}
