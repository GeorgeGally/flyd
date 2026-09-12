import { buildPresentModel, type PresentModel } from "../lib/present-model.js";
import { listRepositories, type ManagedRepository } from "../work/repository-registry.js";
import { readPresentModel, type WorkHypothesis } from "../work/work-hypothesis/index.js";
import type { WorldStateSnapshot } from "../intelligence/world/types.js";
import { projectInvocationContext } from "./invocation-context.js";
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
  /** Canonical cached work-index observations; this path must not scan disk. */
  readRepositories?: () => ManagedRepository[];
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
  readRepositories: () => listRepositories(),
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
    let repositories: ManagedRepository[] = [];
    try {
      repositories = deps.readRepositories?.() ?? [];
    } catch (error) {
      console.warn(
        "[planning] work-index repository projection unavailable:",
        error instanceof Error ? error.message : error,
      );
    }
    const now = deps.now();
    const context = projectInvocationContext({ present, work, repositories, now });
    const snapshot = snapshotFromPresent({
      present,
      work,
      repoStates: context.repoStates,
      blockerFact: context.blockers,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      now,
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
