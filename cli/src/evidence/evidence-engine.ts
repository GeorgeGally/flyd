import { CapabilityRegistry } from "./capability-registry.js";
import { fuseEvidence } from "./fusion.js";
import { classifyResearchIntent, planEvidence, sourcePriorityFor } from "./query-planner.js";
import type {
  CapabilityHealth,
  CapabilityName,
  EvidenceBundle,
  EvidenceGap,
  EvidenceStream,
  ResearchDepth,
} from "./types.js";

function desiredCapabilities(query: string, depth: ResearchDepth): CapabilityName[] {
  const intent = classifyResearchIntent(query);
  const ordered = [...sourcePriorityFor(intent)];
  return depth === "quick" ? ordered.slice(0, 3) : ordered;
}

function inspectionCandidates(
  query: string,
  depth: ResearchDepth,
  registered: readonly CapabilityName[],
): CapabilityName[] {
  const preferred = [...sourcePriorityFor(classifyResearchIntent(query))];
  const registeredSet = new Set(registered);
  const ordered = preferred.filter((capability) => registeredSet.has(capability));
  const alreadyIncluded = new Set(ordered);
  ordered.push(...registered.filter((capability) => !alreadyIncluded.has(capability)).sort());
  return depth === "quick" ? ordered.slice(0, 5) : ordered;
}

function gapFromHealth(health: CapabilityHealth): EvidenceGap | null {
  if (health.status === "ready" || health.status === "degraded") return null;
  if (health.status === "auth_required") {
    return {
      capability: health.capability,
      code: "capability_auth_required",
      message: `${health.capability} requires authentication${health.reason ? `: ${health.reason}` : ""}`,
    };
  }
  return {
    capability: health.capability,
    code: "capability_unavailable",
    message: `${health.capability} is ${health.status}${health.reason ? `: ${health.reason}` : ""}`,
  };
}

export class EvidenceEngine {
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async research(query: string, depth: ResearchDepth = "quick"): Promise<EvidenceBundle> {
    const registered = this.registry.capabilities();
    const candidates = inspectionCandidates(query, depth, registered);
    const inspectionEntries = await Promise.all(
      candidates.map(async (capability) => [capability, await this.registry.inspect(capability, "search")] as const),
    );
    const inspectionByCapability = new Map(inspectionEntries);
    const registeredHealth = inspectionEntries.map(([, inspection]) => inspection.health);
    const available = inspectionEntries
      .filter(([, inspection]) => Boolean(inspection.adapter?.search))
      .map(([capability]) => capability);
    const plan = planEvidence(query, available, depth);
    const gaps: EvidenceGap[] = [];

    for (const capability of desiredCapabilities(query, depth)) {
      if (!registered.includes(capability)) {
        gaps.push({
          capability,
          code: "capability_unavailable",
          message: `${capability} has no registered search backend`,
        });
        continue;
      }
      const inspection = inspectionByCapability.get(capability);
      if (!inspection) continue;
      const gap = gapFromHealth(inspection.health);
      if (gap) gaps.push(gap);
    }

    const streams: EvidenceStream[] = [];
    await Promise.all(plan.subqueries.flatMap((subquery) =>
      subquery.capabilities.map(async (capability) => {
        const inspection = inspectionByCapability.get(capability);
        const search = inspection?.adapter?.search;
        if (!search) {
          if (!gaps.some((gap) => gap.capability === capability)) {
            gaps.push({
              capability,
              code: "capability_unavailable",
              message: `${capability} has no healthy search backend`,
            });
          }
          return;
        }

        try {
          const items = await search.call(inspection.adapter, {
            query: subquery.query,
            queryLabel: subquery.label,
            limit: plan.maxPerStream,
          });
          streams.push({
            label: subquery.label,
            capability,
            weight: subquery.weight,
            items,
          });
        } catch (error) {
          gaps.push({
            capability,
            code: "search_failed",
            message: `${capability} search failed: ${error instanceof Error ? error.message : "unknown error"}`,
          });
        }
      }),
    ));

    const evidence = fuseEvidence(streams, plan);
    if (evidence.length === 0) {
      gaps.push({
        code: "insufficient_evidence",
        message: "No external evidence was retrieved for this query",
      });
    }

    return {
      query: plan.query,
      intent: plan.intent,
      generatedAt: this.now().toISOString(),
      plan,
      evidence,
      conflicts: [],
      gaps,
      capabilityHealth: registeredHealth,
    };
  }
}
