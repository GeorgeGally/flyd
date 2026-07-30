import type {
  CapabilityAdapter,
  CapabilityHealth,
  CapabilityName,
  CapabilityOperation,
  CapabilityProbe,
  CapabilityStatus,
} from "./types.js";

export interface ResolvedCapability {
  adapter: CapabilityAdapter;
  health: CapabilityHealth;
}

const STATUS_PRIORITY: Record<CapabilityStatus, number> = {
  ready: 5,
  degraded: 4,
  auth_required: 3,
  unavailable: 2,
  disabled: 1,
};

function probeFailure(error: unknown): CapabilityProbe {
  return {
    status: "unavailable",
    reason: error instanceof Error ? error.message : "Capability probe failed",
  };
}

export class CapabilityRegistry {
  private readonly adapters = new Map<CapabilityName, CapabilityAdapter[]>();

  constructor(
    initialAdapters: CapabilityAdapter[] = [],
    private readonly now: () => Date = () => new Date(),
  ) {
    for (const adapter of initialAdapters) this.register(adapter);
  }

  register(adapter: CapabilityAdapter): void {
    const existing = this.adapters.get(adapter.capability) ?? [];
    const withoutDuplicate = existing.filter((candidate) => candidate.id !== adapter.id);
    withoutDuplicate.push(adapter);
    withoutDuplicate.sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
    this.adapters.set(adapter.capability, withoutDuplicate);
  }

  capabilities(): CapabilityName[] {
    return [...this.adapters.keys()].sort();
  }

  adaptersFor(capability: CapabilityName): readonly CapabilityAdapter[] {
    return this.adapters.get(capability) ?? [];
  }

  async resolve(capability: CapabilityName, operation: CapabilityOperation): Promise<ResolvedCapability | null> {
    const checkedAt = this.now().toISOString();
    for (const adapter of this.adaptersFor(capability)) {
      if (!adapter.operations.includes(operation)) continue;
      const probe = await this.safeProbe(adapter);
      if (probe.status !== "ready" && probe.status !== "degraded") continue;
      return {
        adapter,
        health: {
          capability,
          activeBackend: adapter.id,
          checkedAt,
          ...probe,
        },
      };
    }
    return null;
  }

  async health(capability: CapabilityName, operation?: CapabilityOperation): Promise<CapabilityHealth> {
    const checkedAt = this.now().toISOString();
    const candidates = this.adaptersFor(capability).filter(
      (adapter) => !operation || adapter.operations.includes(operation),
    );

    if (candidates.length === 0) {
      return {
        capability,
        status: "unavailable",
        checkedAt,
        reason: operation
          ? `No backend registered for ${capability}.${operation}`
          : `No backend registered for ${capability}`,
      };
    }

    let best: CapabilityHealth | null = null;
    for (const adapter of candidates) {
      const probe = await this.safeProbe(adapter);
      const health: CapabilityHealth = {
        capability,
        checkedAt,
        activeBackend: probe.status === "ready" || probe.status === "degraded" ? adapter.id : undefined,
        ...probe,
      };
      if (!best || STATUS_PRIORITY[health.status] > STATUS_PRIORITY[best.status]) best = health;
      if (health.status === "ready") return health;
    }

    return best!;
  }

  async healthAll(operation?: CapabilityOperation): Promise<CapabilityHealth[]> {
    return Promise.all(this.capabilities().map((capability) => this.health(capability, operation)));
  }

  private async safeProbe(adapter: CapabilityAdapter): Promise<CapabilityProbe> {
    try {
      return await adapter.probe();
    } catch (error) {
      return probeFailure(error);
    }
  }
}
