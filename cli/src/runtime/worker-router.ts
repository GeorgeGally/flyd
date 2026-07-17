import type { WorkerCapability, WorkerHealth } from "./worker-adapter.js";

export function routeWorker(input: {
  requirements: WorkerCapability[];
  adapters: WorkerHealth[];
  activeCounts: Record<string, number>;
  excludedAdapters: string[];
}): WorkerHealth {
  const excluded = new Set(input.excludedAdapters);
  const candidates = input.adapters.filter((adapter) => (
    adapter.healthy &&
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
