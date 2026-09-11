import type { RepositorySnapshot } from "./types.js";
import type { RuntimeTaskRequest } from "./delegation-request.js";

export interface CanonicalTaskCreateInput {
  projectName: string;
  projectRoot: string;
  intendedOutcome: string;
  repository: RepositorySnapshot;
  idempotencyKey: string;
  contextSnapshot: Record<string, unknown>;
  taskIntent: RuntimeTaskRequest["taskIntent"];
}

/**
 * Materialize a confirmed RuntimeTaskRequest into canonical task creation data.
 *
 * Repository identity comes from an independently observed snapshot, never from
 * the request payload. This prevents intent/context from becoming authority.
 */
export function materializeRuntimeTaskRequest(
  request: RuntimeTaskRequest,
  repository: RepositorySnapshot,
): CanonicalTaskCreateInput {
  if (!request.confirmationRequired) {
    throw new Error("Runtime task request must preserve explicit confirmation semantics");
  }
  if (!repository.root.trim()) throw new Error("Repository snapshot requires a root");
  if (!repository.name.trim()) throw new Error("Repository snapshot requires a name");

  if (request.projectRoot && request.projectRoot !== repository.root) {
    throw new Error("Runtime task request project root disagrees with observed repository root");
  }

  return {
    projectName: repository.name,
    projectRoot: repository.root,
    intendedOutcome: request.intendedOutcome,
    repository,
    idempotencyKey: `runtime-task-request:${request.requestId}`,
    contextSnapshot: {
      ...request.contextSnapshot,
      runtime_task_request: {
        request_id: request.requestId,
        invocation_id: request.invocationId ?? null,
        task_intent: request.taskIntent,
        observation_refs: request.observationRefs,
        source: request.source,
      },
    },
    taskIntent: request.taskIntent,
  };
}
