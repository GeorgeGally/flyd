import type { WorkHypothesis } from "./work-hypothesis/types.js";

export interface PresentRuntimeTaskFact {
  epistemicClass: "fact";
  taskId: string;
  taskKey: string;
  projectName: string;
  projectRoot: string;
  status: string;
  intendedOutcome: string;
  recommendedNextAction: string | null;
  updatedAt: string;
}

export interface RuntimeAwarePresent extends WorkHypothesis {
  activeRuntimeTasks?: PresentRuntimeTaskFact[];
}
