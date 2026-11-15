import type { WorkerCapability, WorkerHealth } from "./worker-adapter.js";
import { spendsChatGptAllowance } from "./chatgpt-allowance.js";

export function routeWorker(input: {
  requirements: WorkerCapability[];
  adapters: WorkerHealth[];
  activeCounts: Record<string, number>;
  excludedAdapters: string[];
}): WorkerHealth {
  const excluded = new Set(input.excludedAdapters);
  const candidates = input.adapters.filter((adapter) => (
    adapter.healthy &&
    // Every routed job is text, code or review work, which never goes to the ChatGPT/Codex allowance.
    !spendsChatGptAllowance(adapter.name) &&
    !excluded.has(adapter.name) &&
    input.requirements.every((requirement) => adapter.capabilities.includes(requirement))
  ));
  if (candidates.length === 0) {
    throw new Error(`No healthy worker satisfies: ${input.requirements.join(", ")}`);
  }
  return candidates.sort((left, right) => (
    (input.activeCounts[left.name] ?? 0) - (input.activeCounts[right.name] ?? 0) ||
    left.name.localeCompare(right.name)
  ))[0];
}
