import type { AgentTask } from "./types.js";

export type DeliveryMode = "integrate" | "review";
export type MergeAuthority = "runtime" | "user";

export interface DeliveryContract {
  mode: DeliveryMode;
  mergeAuthority: MergeAuthority;
}

export const DEFAULT_DELIVERY_CONTRACT: DeliveryContract = { mode: "integrate", mergeAuthority: "runtime" };

const MODES = new Set<DeliveryMode>(["integrate", "review"]);
const AUTHORITIES = new Set<MergeAuthority>(["runtime", "user"]);

export function parseDeliveryContract(value: unknown): DeliveryContract | null {
  if (!value || typeof value !== "object") return null;
  const { mode, mergeAuthority } = value as Record<string, unknown>;
  if (typeof mode !== "string" || !MODES.has(mode as DeliveryMode)) return null;
  if (typeof mergeAuthority !== "string" || !AUTHORITIES.has(mergeAuthority as MergeAuthority)) return null;
  return { mode: mode as DeliveryMode, mergeAuthority: mergeAuthority as MergeAuthority };
}

export function deliveryContractOf(task: Pick<AgentTask, "contextSnapshot">): DeliveryContract | null {
  return parseDeliveryContract(task.contextSnapshot?.delivery);
}

export function deliveryContractForTaskIntent(taskIntent: "scout" | "ship"): DeliveryContract {
  return taskIntent === "scout"
    ? { mode: "review", mergeAuthority: "user" }
    : DEFAULT_DELIVERY_CONTRACT;
}

export function authorizesRuntimeIntegration(contract: DeliveryContract | null): boolean {
  return contract?.mode === "integrate" && contract.mergeAuthority === "runtime";
}