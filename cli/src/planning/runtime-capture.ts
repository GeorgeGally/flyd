import { buildPresentModel, type PresentModel } from "../lib/present-model.js";
import { readPresentModel, type WorkHypothesis } from "../work/work-hypothesis/index.js";
import type { WorldStateSnapshot } from "../intelligence/world/types.js";
import { snapshotFromPresent } from "./snapshot.js";
import { PlanningStore } from "./store.js";

export interface RuntimeSnapshotCaptureInput {
  correlationId: string;
  projectRoot?: string | null;
  projectId?: string;
}

export interface RuntimeSnapshotCaptureDependencies {
  buildPresent: (projectRoot?: string | null) => Promise<PresentModel>;
  readWork: () => WorkHypothesis | null;
  persist: (snapshot: WorldStateSnapshot, correlationId: string) => void;
  now: () => Date;
}

const defaultDependencies: RuntimeSnapshotCaptureDependencies = {
  buildPresent: async (projectRoot) => buildPresentModel(
    projectRoot || process.cwd(),
    undefined,
    5,
    projectRoot || undefined,
  ),
  readWork: () => readPresentModel(),
  persist: (snapshot, correlationId) => {
    const store = new PlanningStore();
    try {
      store.saveSnapshot(snapshot, correlationId);
    } finally {
      store.close();
    }
  },
  now: () => new Date(),
};

/**
 * Capture a durable world-state snapshot only at an explicit INVOKED/action
 * boundary. Ambient PRESENT remains ephemeral: this helper is never called by
 * observation or refresh loops.
 *
 * Runtime capture is best-effort by contract. Planning telemetry must never
 * make an overlay action or outcome fail.
 */
export async function captureRuntimeSnapshot(
  input: RuntimeSnapshotCaptureInput,
  deps: RuntimeSnapshotCaptureDependencies = defaultDependencies,
): Promise<WorldStateSnapshot | null> {
  try {
    const present = await deps.buildPresent(input.projectRoot);
    const work = deps.readWork();
    const snapshot = snapshotFromPresent({
      present,
      work,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      now: deps.now(),
    });
    deps.persist(snapshot, input.correlationId);
    return snapshot;
  } catch (error) {
    console.warn(
      "[planning] runtime snapshot capture failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
