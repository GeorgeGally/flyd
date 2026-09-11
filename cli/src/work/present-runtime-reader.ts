import type { OpenOperationalDecisionFact } from "../runtime/operational-decision-store.js";
import { attachOperationalDecisions } from "./present-operational.js";
import type { WorkHypothesis } from "./work-hypothesis/types.js";

export interface RuntimeAwarePresentDeps {
  readBasePresent(): WorkHypothesis | null;
  listOpenDecisionFacts(): Promise<OpenOperationalDecisionFact[]>;
}

/**
 * The single async boundary where the local work projection is enriched with
 * canonical runtime facts. Present remains read-only: this function cannot
 * mutate tasks, decisions, repositories, or workers.
 */
export async function readRuntimeAwarePresent(
  deps: RuntimeAwarePresentDeps,
): Promise<WorkHypothesis | null> {
  const present = deps.readBasePresent();
  if (!present) return null;

  const facts = await deps.listOpenDecisionFacts();
  return attachOperationalDecisions(
    present,
    facts.map((fact) => fact.decision),
    facts.map((fact) => ({
      taskId: fact.decision.taskId,
      taskKey: fact.taskKey,
      projectName: fact.projectName,
    })),
  );
}
