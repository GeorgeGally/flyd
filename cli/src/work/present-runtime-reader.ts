import type { OpenOperationalDecisionFact } from "../runtime/operational-decision-store.js";
import { attachOperationalDecisions } from "./present-operational.js";
import { attachWorkerObservations, type RuntimeWorkerObservationFact } from "./present-workers.js";
import type { WorkHypothesis } from "./work-hypothesis/types.js";

export interface RuntimeAwarePresentDeps {
  readBasePresent(): WorkHypothesis | null;
  listOpenDecisionFacts(): Promise<OpenOperationalDecisionFact[]>;
  listWorkerObservations?(): Promise<RuntimeWorkerObservationFact[]>;
}

/**
 * The single async boundary where the local work projection is enriched with
 * canonical runtime facts and read-only observations. Present remains read-only:
 * this function cannot mutate tasks, decisions, repositories, or workers.
 */
export async function readRuntimeAwarePresent(
  deps: RuntimeAwarePresentDeps,
): Promise<WorkHypothesis | null> {
  const present = deps.readBasePresent();
  if (!present) return null;

  const [decisionFacts, workerObservations] = await Promise.all([
    deps.listOpenDecisionFacts(),
    deps.listWorkerObservations?.() ?? Promise.resolve([]),
  ]);

  const withDecisions = attachOperationalDecisions(
    present,
    decisionFacts.map((fact) => fact.decision),
    decisionFacts.map((fact) => ({
      taskId: fact.decision.taskId,
      taskKey: fact.taskKey,
      projectName: fact.projectName,
    })),
  );

  return attachWorkerObservations(withDecisions, workerObservations);
}
