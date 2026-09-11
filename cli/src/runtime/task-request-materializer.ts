import type { RepositorySnapshot } from "./types.js";
import type { RuntimeTaskRequest } from "./delegation-request.js";

export interface CanonicalTaskMaterialization {
  createTask: {
    projectName: string;
    projectRoot: string;
    intendedOutcome: string;
    repository: RepositorySnapshot;
    idempotencyKey: string;
  };
  orientation: {
    contextSnapshot: Record<string, unknown>;
    repositorySnapshot: Record<string, unknown>;
    recommendedNextAction: string;
    idempotencyKey: string;
  };
}

/**
 * Materialize a confirmed RuntimeTaskRequest into the two canonical persistence
 * steps used by the runtime today: createTask() followed by recordOrientation().
 *
 * Repository identity comes from an independently observed snapshot, never from
 * the request payload. This prevents intent/context from becoming authority.
 */
export function materializeRuntimeTaskRequest(
  request: RuntimeTaskRequest,
  repository: RepositorySnapshot,
): CanonicalTaskMaterialization {
  if (!request.confirmationRequired) {
    throw new Error("Runtime task request must preserve explicit confirmation semantics");
  }
  if (!repository.root.trim()) throw new Error("Repository snapshot requires a root");
  if (!repository.name.trim()) throw new Error("Repository snapshot requires a name");

  if (request.projectRoot && request.projectRoot !== repository.root) {
    throw new Error("Runtime task request project root disagrees with observed repository root");
  }

  const contextSnapshot = {
    ...request.contextSnapshot,
    runtime_task_request: {
      request_id: request.requestId,
      invocation_id: request.invocationId ?? null,
      task_intent: request.taskIntent,
      observation_refs: request.observationRefs,
      source: request.source,
    },
  };

  const repositorySnapshot = {
    root: repository.root,
    branch: repository.branch,
    head: repository.head,
    dirty: repository.dirty,
    status_lines: repository.statusLines,
    status_digest: repository.statusDigest,
  };

  return {
    createTask: {
      projectName: repository.name,
      projectRoot: repository.root,
      intendedOutcome: request.intendedOutcome,
      repository,
      idempotencyKey: `runtime-task-request:${request.requestId}:create`,
    },
    orientation: {
      contextSnapshot,
      repositorySnapshot,
      recommendedNextAction: request.taskIntent === "scout"
        ? "Investigate and return evidence without modifying the repository"
        : "Plan the requested outcome and request the minimum required grant",
      idempotencyKey: `runtime-task-request:${request.requestId}:orient`,
    },
  };
}
