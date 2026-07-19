export const RUNTIME_COMMAND_SCHEMA_VERSION = 1 as const;

export type RuntimeActorSurface = "cli" | "rails";
export type RuntimeCommandAction =
  | "health"
  | "task.status"
  | "task.approve_grant"
  | "task.reject_grant"
  | "task.stop_worker"
  | "task.retry_worker"
  | "task.redirect_worker"
  | "task.replace_worker"
  | "task.correct"
  | "task.confirm_completion";

interface BaseRequest {
  schemaVersion: 1;
  action: RuntimeCommandAction;
  actorSurface: RuntimeActorSurface;
}

interface TaskRequest extends BaseRequest {
  taskKey: string;
}

interface MutationRequest extends TaskRequest {
  expectedTaskRevision: number;
  idempotencyKey: string;
}

export type RuntimeCommandRequest =
  | (BaseRequest & { action: "health" })
  | (TaskRequest & { action: "task.status" })
  | (MutationRequest & { action: "task.approve_grant"; grantKey: string })
  | (MutationRequest & { action: "task.reject_grant"; grantKey: string; reason: string })
  | (MutationRequest & { action: "task.stop_worker" | "task.retry_worker" | "task.replace_worker"; workerKey: string })
  | (MutationRequest & { action: "task.redirect_worker"; workerKey: string; instruction: string })
  | (MutationRequest & { action: "task.correct"; correctedValue: string; originalClaim?: string; surfaceRevision?: number })
  | (MutationRequest & { action: "task.confirm_completion"; summary: string });

export interface RuntimeCommandResult {
  action: RuntimeCommandAction;
  taskKey?: string;
  taskRevision?: number;
  data: Record<string, unknown>;
}

const ACTION_FIELDS: Record<RuntimeCommandAction, readonly string[]> = {
  health: [ "schemaVersion", "action", "actorSurface" ],
  "task.status": [ "schemaVersion", "action", "actorSurface", "taskKey" ],
  "task.approve_grant": [
    "schemaVersion", "action", "actorSurface", "taskKey", "expectedTaskRevision", "grantKey", "idempotencyKey",
  ],
  "task.reject_grant": [
    "schemaVersion", "action", "actorSurface", "taskKey", "expectedTaskRevision", "grantKey", "reason", "idempotencyKey",
  ],
  "task.stop_worker": [
    "schemaVersion", "action", "actorSurface", "taskKey", "expectedTaskRevision", "workerKey", "idempotencyKey",
  ],
  "task.retry_worker": [
    "schemaVersion", "action", "actorSurface", "taskKey", "expectedTaskRevision", "workerKey", "idempotencyKey",
  ],
  "task.redirect_worker": [
    "schemaVersion", "action", "actorSurface", "taskKey", "expectedTaskRevision", "workerKey", "instruction", "idempotencyKey",
  ],
  "task.replace_worker": [
    "schemaVersion", "action", "actorSurface", "taskKey", "expectedTaskRevision", "workerKey", "idempotencyKey",
  ],
  "task.correct": [
    "schemaVersion", "action", "actorSurface", "taskKey", "expectedTaskRevision", "correctedValue",
    "originalClaim", "surfaceRevision", "idempotencyKey",
  ],
  "task.confirm_completion": [
    "schemaVersion", "action", "actorSurface", "taskKey", "expectedTaskRevision", "summary", "idempotencyKey",
  ],
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Runtime command request must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function requiredString(payload: Record<string, unknown>, field: string, maximum = 200): string {
  const value = typeof payload[field] === "string" ? payload[field].trim() : "";
  if (!value) throw new Error(`${field} is required`);
  if (value.length > maximum) throw new Error(`${field} is too long`);
  return value;
}

function optionalString(payload: Record<string, unknown>, field: string, maximum: number): string | undefined {
  if (payload[field] == null) return undefined;
  return requiredString(payload, field, maximum);
}

function requiredRevision(payload: Record<string, unknown>, field: string): number {
  const value = payload[field];
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${field} must be a non-negative integer`);
  return Number(value);
}

export function parseRuntimeCommandRequest(value: unknown): RuntimeCommandRequest {
  const payload = object(value);
  if (payload.schemaVersion !== RUNTIME_COMMAND_SCHEMA_VERSION) {
    throw new Error(`Unsupported runtime command schema version: ${String(payload.schemaVersion)}`);
  }
  const action = requiredString(payload, "action") as RuntimeCommandAction;
  if (!(action in ACTION_FIELDS)) throw new Error(`Unsupported runtime command action: ${action}`);
  const actorSurface = requiredString(payload, "actorSurface") as RuntimeActorSurface;
  if (![ "cli", "rails" ].includes(actorSurface)) throw new Error(`Unsupported actor surface: ${actorSurface}`);
  const allowedFields = new Set(ACTION_FIELDS[action]);
  const unknownField = Object.keys(payload).find((field) => !allowedFields.has(field));
  if (unknownField) throw new Error(`Unknown field for ${action}: ${unknownField}`);

  const base = { schemaVersion: 1 as const, action, actorSurface };
  if (action === "health") return { ...base, action };

  const taskKey = requiredString(payload, "taskKey");
  if (action === "task.status") return { ...base, action, taskKey };

  const mutation = {
    ...base,
    action,
    taskKey,
    expectedTaskRevision: requiredRevision(payload, "expectedTaskRevision"),
    idempotencyKey: requiredString(payload, "idempotencyKey"),
  };
  switch (action) {
    case "task.approve_grant":
      return { ...mutation, action, grantKey: requiredString(payload, "grantKey") };
    case "task.reject_grant":
      return {
        ...mutation,
        action,
        grantKey: requiredString(payload, "grantKey"),
        reason: requiredString(payload, "reason", 1_000),
      };
    case "task.stop_worker":
    case "task.retry_worker":
    case "task.replace_worker":
      return { ...mutation, action, workerKey: requiredString(payload, "workerKey") };
    case "task.redirect_worker":
      return {
        ...mutation,
        action,
        workerKey: requiredString(payload, "workerKey"),
        instruction: requiredString(payload, "instruction", 4_000),
      };
    case "task.correct":
      return {
        ...mutation,
        action,
        correctedValue: requiredString(payload, "correctedValue", 4_000),
        originalClaim: optionalString(payload, "originalClaim", 4_000),
        surfaceRevision: payload.surfaceRevision == null
          ? undefined
          : requiredRevision(payload, "surfaceRevision"),
      };
    case "task.confirm_completion":
      return { ...mutation, action, summary: requiredString(payload, "summary", 4_000) };
  }
}
