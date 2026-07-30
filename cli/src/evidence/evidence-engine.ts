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

export interface EvidenceResearchOptions {
  locators?: readonly string[];
  includeSearch?: boolean;
}

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

function capabilityForLocator(locator: string): CapabilityName {
  try {
    const url = new URL(locator);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "github.com") return "github";
    if (host === "youtube.com" || host === "youtu.be") return "youtube";
    if (/\.(rss|atom|xml)$/i.test(url.pathname) || /\/(feed|rss|atom)(\/|$)/i.test(url.pathname)) return "rss";
  } catch {
    // Invalid locators fall through to web where the adapter reports the error.
  }
  return "web";
}

function addGapOnce(gaps: EvidenceGap[], gap: EvidenceGap): void {
  const key = `${gap.capability ?? "general"}:${gap.code}:${gap.message}`;
  const exists = gaps.some((candidate) =>
    `${candidate.capability ?? "general"}:${candidate.code}:${candidate.message}` === key
  );
  if (!exists) gaps.push(gap);
}

export class EvidenceEngine {
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async research(
    query: string,
    depth: ResearchDepth = "quick",
    options: EvidenceResearchOptions = {},
  ): Promise<EvidenceBundle> {
    const includeSearch = options.includeSearch ?? true;
    const locators = [...new Set((options.locators ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 3);
    const registered = this.registry.capabilities();
    const gaps: EvidenceGap[] = [];
    const streams: EvidenceStream[] = [];
    const capabilityHealth: CapabilityHealth[] = [];

    const directEntries = await Promise.all(locators.map(async (locator, index) => {
      const capability = capabilityForLocator(locator);
      const inspection = await this.registry.inspect(capability, "read");
      capabilityHealth.push(inspection.health);
      const read = inspection.adapter?.read;
      if (!read) {
        const healthGap = gapFromHealth(inspection.health);
        addGapOnce(gaps, healthGap ?? {
          capability,
          code: "capability_unavailable",
          message: `${capability} has no healthy read backend for ${locator}`,
        });
        return null;
      }

      try {
        const items = await read.call(inspection.adapter, { locator });
        return {
          label: `direct_${index + 1}`,
          capability,
          weight: 1.25,
          items,
        } satisfies EvidenceStream;
      } catch (error) {
        addGapOnce(gaps, {
          capability,
          code: "search_failed",
          message: `${capability} read failed: ${error instanceof Error ? error.message : "unknown error"}`,
        });
        return null;
      }
    }));
    streams.push(...directEntries.filter((entry): entry is EvidenceStream => Boolean(entry)));

    let plan = planEvidence(query, [], depth);

    if (includeSearch && query.trim()) {
      const candidates = inspectionCandidates(query, depth, registered);
      const inspectionEntries = await Promise.all(
        candidates.map(async (capability) => [capability, await this.registry.inspect(capability, "search")] as const),
      );
      const inspectionByCapability = new Map(inspectionEntries);
      capabilityHealth.push(...inspectionEntries.map(([, inspection]) => inspection.health));
      const available = inspectionEntries
        .filter(([, inspection]) => Boolean(inspection.adapter?.search))
        .map(([capability]) => capability);
      plan = planEvidence(query, available, depth);

      for (const capability of desiredCapabilities(query, depth)) {
        if (!registered.includes(capability)) {
          addGapOnce(gaps, {
            capability,
            code: "capability_unavailable",
            message: `${capability} has no registered search backend`,
          });
          continue;
        }
        const inspection = inspectionByCapability.get(capability);
        if (!inspection) continue;
        const gap = gapFromHealth(inspection.health);
        if (gap) addGapOnce(gaps, gap);
      }

      await Promise.all(plan.subqueries.flatMap((subquery) =>
        subquery.capabilities.map(async (capability) => {
          const inspection = inspectionByCapability.get(capability);
          const search = inspection?.adapter?.search;
          if (!search) {
            addGapOnce(gaps, {
              capability,
              code: "capability_unavailable",
              message: `${capability} has no healthy search backend`,
            });
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
            addGapOnce(gaps, {
              capability,
              code: "search_failed",
              message: `${capability} search failed: ${error instanceof Error ? error.message : "unknown error"}`,
            });
          }
        }),
      ));
    }

    const fusionPlan = streams.length > 0 && Object.keys(plan.sourceWeights).length === 0
      ? {
          ...plan,
          sourceWeights: Object.fromEntries(streams.map((stream) => [stream.capability, 1])),
          maxResults: depth === "quick" ? 12 : plan.maxResults,
          maxPerStream: depth === "quick" ? 6 : plan.maxPerStream,
        }
      : plan;
    const evidence = fuseEvidence(streams, fusionPlan);
    if (evidence.length === 0) {
      addGapOnce(gaps, {
        code: "insufficient_evidence",
        message: "No external evidence was retrieved for this query",
      });
    }

    return {
      query: fusionPlan.query,
      intent: fusionPlan.intent,
      generatedAt: this.now().toISOString(),
      plan: fusionPlan,
      evidence,
      conflicts: [],
      gaps,
      capabilityHealth,
    };
  }
}
