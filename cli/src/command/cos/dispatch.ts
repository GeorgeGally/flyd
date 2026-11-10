import { refuseLeakedLaunch } from "../../runtime/launch-guard.js";
import type { CosBrief, Objective } from "./types.js";

// Dispatch: the objective's brief to its team, through each team's existing entry point and nothing new inside
// them. The request id is the objective's own (`<objective>-r1`), so a restart that dispatches again is replayed
// by the team (FirstMate's inbox, Librarian and Design Mate by request id) instead of starting the work twice.

export type Dispatched = { ref: string } | { refused: string };
export type Dispatch = (objective: Objective, brief: CosBrief) => Promise<Dispatched>;

/** The request id of an objective's first run. */
export function runRequestId(objective: Pick<Objective, "id">, index = 1): string {
  return `${objective.id}-r${index}`;
}

export const dispatchBrief: Dispatch = async (objective, brief) => {
  const refusal = refuseLeakedLaunch([brief.outcome, objective.words]);
  if (refusal) return { refused: refusal };
  const common = {
    originalMessage: objective.words,
    intendedOutcome: brief.outcome,
    doneWhen: brief.doneWhen,
    requestId: runRequestId(objective),
    objectiveId: objective.id,
    decisions: brief.decisions,
    ...(objective.contextRefs.length ? { contextRefs: objective.contextRefs } : {}),
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
      const { dispatchCrewTask } = await import("../../crew/crew.js");
      const task = await dispatchCrewTask({ repo: brief.project?.root ?? process.cwd(), outcome: brief.outcome, doneWhen: brief.doneWhen, afterLand: [], source: "chat" });
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
      const { decisionsLines } = await import("../types.js");
      const task = [brief.outcome, ...decisionsLines(brief.decisions)].join("\n");
      return { ref: `job:${jobs.startBackgroundJob({ task, doneWhen: brief.doneWhen, objectiveId: objective.id }, { run: jobs.runJobTurn, verify: jobs.verifyJobTurn })}` };
    }
  }
};
