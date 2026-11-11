import { refuseLeakedLaunch } from "../../runtime/launch-guard.js";
import type { BriefDecisions, DomainId } from "../types.js";
import type { Objective } from "./types.js";

// Dispatch: one planned run's brief to its team, through each team's existing entry point and nothing new inside
// them. The request id is the run's own (`<objective>-r1`), so a restart that dispatches again is replayed by the team
// (FirstMate's inbox, Librarian and Design Mate by request id) instead of starting the work twice. A one-off job and
// the compatibility crew keep the request id on their own record, so a replay finds what it started; one it can't find
// (or one started before they kept it) is never sent again: it answers `unknown`.

export type Dispatched = { ref: string } | { refused: string } | { unknown: string };

/** What one run is sent: its team, the brief as written now, and his decisions field. */
export interface SentBrief {
  team: DomainId;
  outcome: string;
  doneWhen: string[];
  project?: { name?: string; root?: string };
  decisions: BriefDecisions;
  /** Links to results it builds on (each dependency's layered result, its own earlier attempts). */
  contextRefs?: string[];
}

/** `replay`: a restart reconciling a run that may already have been sent; only a team that replays by request id answers. */
export type Dispatch = (objective: Objective, brief: SentBrief, requestId: string, options?: { replay?: boolean }) => Promise<Dispatched>;

/** The request id of an objective's first run. */
export function runRequestId(objective: Pick<Objective, "id">, index = 1): string {
  return `${objective.id}-r${index}`;
}

export const dispatchBrief: Dispatch = async (objective, brief, requestId, options = {}) => {
  const refusal = refuseLeakedLaunch([brief.outcome, objective.words]);
  if (refusal) return { refused: refusal };
  const contextRefs = [...objective.contextRefs, ...(brief.contextRefs ?? [])];
  const common = {
    originalMessage: objective.words,
    intendedOutcome: brief.outcome,
    doneWhen: brief.doneWhen,
    requestId,
    objectiveId: objective.id,
    decisions: brief.decisions,
    ...(contextRefs.length ? { contextRefs } : {}),
  };
  switch (brief.team) {
    case "coding": {
      const { FirstmateDomainTransport } = await import("../firstmate.js");
      const firstmate = new FirstmateDomainTransport();
      if (process.env.FLYD_FIRSTMATE !== "0" && firstmate.available()) {
        const { dispatchCodingDomain } = await import("../coding.js");
        const dispatched = await dispatchCodingDomain({ ...common, source: "chat", ...(brief.project ? { project: brief.project } : {}), transport: firstmate });
        if (dispatched.status === "refused") return { refused: dispatched.reason };
        return { ref: dispatched.run.id };
      }
      // FirstMate not installed: the compatibility crew, which tells George itself when the work is ready.
      const { dispatchCrewTask, listTasks } = await import("../../crew/crew.js");
      if (options.replay) {
        const found = listTasks().find((task) => task.requestId === requestId);
        return found ? { ref: `crew:${found.id}` } : { unknown: "the crew has no task for this request" };
      }
      const task = await dispatchCrewTask({ repo: brief.project?.root ?? process.cwd(), outcome: brief.outcome, doneWhen: brief.doneWhen, afterLand: [], source: "chat", requestId });
      return { ref: `crew:${task.id}` };
    }
    case "knowledge": {
      const { dispatchKnowledgeDomain } = await import("../librarian.js");
      return { ref: dispatchKnowledgeDomain(common).id };
    }
    case "creative": {
      const { dispatchDesignLab } = await import("../design.js");
      return { ref: (await dispatchDesignLab({ ...common, source: "chat", ...(brief.project ? { project: brief.project } : {}) })).run.id };
    }
    case "life": {
      // A one-off job; its result comes back as the objective's report, so the job itself never tells George.
      const jobs = await import("../../runtime/background-jobs.js");
      if (options.replay) {
        const found = jobs.listJobs().find((job) => job.contract.requestId === requestId);
        return found ? { ref: `job:${found.id}` } : { unknown: "no one-off job was found for this request" };
      }
      const { decisionsLines } = await import("../types.js");
      const task = [brief.outcome, ...decisionsLines(brief.decisions)].join("\n");
      return { ref: `job:${jobs.startBackgroundJob({ task, doneWhen: brief.doneWhen, objectiveId: objective.id, requestId }, { run: jobs.runJobTurn, verify: jobs.verifyJobTurn })}` };
    }
  }
};
