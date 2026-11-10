import { sendRunMessage } from "../messages.js";
import { readDomainRun } from "../store.js";
import type { DomainId, DomainRun } from "../types.js";
import { listObjectives, mutateObjective, readObjective } from "./objectives.js";
import type { Objective } from "./types.js";

// Steering and status (split plan Phase 4, behind FLYD_COS=1). `tell_work` replaces the in-turn fast path: the Chief
// of Staff resolves which objective and run George's message is for and delivers it through `sendRunMessage`; when
// two or more objectives genuinely match it asks one question instead of guessing. `work_status` is read-only and
// answers from the objectives and their retained results, so a follow-up question never dispatches anything.

export type SteerKind = "correction" | "decision" | "priority_change" | "cancel";

export interface SteerOutcome {
  delivered: boolean;
  objectiveId?: string;
  /** The one question to ask him when the message could be for more than one piece of work. */
  ask?: string;
  reason?: "no_active_work" | "ambiguous" | "not_steerable" | "delivery_failed";
}

const OPEN = new Set<Objective["status"]>(["intake", "working", "needs_george"]);
const STEERABLE = new Set<DomainRun["status"]>(["queued", "accepted", "working", "needs_decision"]);

function short(words: string, max = 60): string {
  const line = words.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : line;
}

/** The run of an objective that can still take a message: its latest domain run that is still open. */
function steerableRun(objective: Objective): DomainRun | null {
  for (const ref of [...objective.runs].reverse()) {
    if (ref.includes(":")) continue;
    const run = readDomainRun(ref);
    if (run && STEERABLE.has(run.status)) return run;
  }
  return null;
}

/** Delivers George's message about work under way to the one objective it is for. */
export async function tellWork(
  input: { message: string; objectiveId?: string; kind?: SteerKind; team?: DomainId },
  send: typeof sendRunMessage = sendRunMessage,
): Promise<SteerOutcome> {
  const message = input.message.trim();
  const kind = input.kind ?? "correction";
  const open = listObjectives().filter((objective) => OPEN.has(objective.status));
  let candidates = input.objectiveId ? open.filter((objective) => objective.id === input.objectiveId) : open;
  // The team is a hint: it narrows the list when it names some of them, and never empties it.
  if (!input.objectiveId && input.team) {
    const byTeam = candidates.filter((objective) => objective.brief?.team === input.team);
    if (byTeam.length) candidates = byTeam;
  }
  if (!message || candidates.length === 0) return { delivered: false, reason: "no_active_work" };
  if (candidates.length > 1) {
    return { delivered: false, reason: "ambiguous", ask: `Which is this for: ${candidates.map((objective) => `“${short(objective.words)}”`).join(" or ")}?` };
  }
  const objective = candidates[0]!;
  const run = steerableRun(objective);
  if (!run) {
    // Still being briefed: intake reads it with his words. Otherwise there is nothing left that can take it.
    if (objective.status !== "intake") return { delivered: false, objectiveId: objective.id, reason: "not_steerable" };
    mutateObjective(objective.id, (current) => current && { ...current, flydNotes: [current.flydNotes, `Later from George (${kind}): ${message}`].filter(Boolean).join("\n") });
    return { delivered: true, objectiveId: objective.id };
  }
  const outcome = await send({ run, kind, body: message }).catch(() => ({ delivered: false }));
  if (!outcome.delivered) return { delivered: false, objectiveId: objective.id, reason: "delivery_failed" };
  if (kind === "cancel") mutateObjective(objective.id, (current) => current && { ...current, status: "cancelled" });
  return { delivered: true, objectiveId: objective.id };
}

const STAGE: Record<Objective["status"], string> = {
  intake: "being briefed", working: "under way", needs_george: "waiting on you", done: "done", failed: "didn't finish", cancelled: "cancelled",
};

/** How long finished objectives stay in the overview. */
const RECENT_MS = 48 * 60 * 60_000;

/** What his handed-off work is doing, or one objective's retained result for a follow-up. Read-only. */
export function workStatus(objectiveId?: string, now = new Date()): string {
  if (objectiveId) {
    const objective = readObjective(objectiveId);
    if (!objective) return `Error: no objective ${objectiveId}`;
    const lines = [`He asked: ${objective.words}`, `Stage: ${STAGE[objective.status]}`];
    if (objective.brief) lines.push(`Brief: ${objective.brief.outcome}`, `Done when: ${objective.brief.doneWhen.join("; ")}`);
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
  return shown.map((objective) => `- ${objective.id}: “${short(objective.words)}” — ${STAGE[objective.status]}`).join("\n");
}
