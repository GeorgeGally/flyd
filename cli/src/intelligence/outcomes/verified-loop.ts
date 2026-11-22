import type { StoredEvent, IntelligenceEventStore } from "../event-store.js";

/**
 * Read-only diagnostic projection over the existing canonical event spine.
 * Does not grant authority, copy sensitive source text, mark interventions
 * successful, or create a second durable truth store.
 */
export type EffectVerification = "verified" | "failed" | "pending" | "unknown" | "not_applicable";
export type DeliveryVerification =
  | "shown" | "briefed" | "kept" | "idle" | "backstage" | "placeholder"
  | "repeat" | "undelivered" | "seeded" | "withdrawn"
  | "pending" | "not_attempted" | "not_correlated";

export interface VerifiedLoopItem {
  id: string;
  source: "cos.report" | "executive.cycle";
  objectiveId?: string;
  reportKind?: string;
  occurredAt: string;
  policyVersion?: string;
  evidenceRefCount: number;
  effect: EffectVerification;
  delivery: DeliveryVerification;
  impact: "unknown";
  usefulness: "unknown";
}

export interface VerifiedLoopSummary {
  interventions: number;
  verifiedEffects: number;
  failedEffects: number;
  pendingEffects: number;
  unknownEffects: number;
  delivered: number;
  pendingDelivery: number;
  unknownImpact: number;
  /** Explicitly do not call this a successful task completion rate. */
  verificationCoverage: { known: number; eligible: number };
}

const DELIVERY_OUTCOMES = new Set<DeliveryVerification>([
  "shown", "briefed", "kept", "idle", "backstage", "placeholder",
  "repeat", "undelivered", "seeded", "withdrawn",
]);

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function sourceEvents(events: StoredEvent[], source: string): StoredEvent[] {
  return events.filter((event) => !event.erased && event.sourceId === source && !!event.payload)
    .sort((a, b) => a.sequence - b.sequence);
}

function deliveryStates(events: StoredEvent[]): Map<string, DeliveryVerification> {
  const states = new Map<string, DeliveryVerification>();
  for (const event of sourceEvents(events, "flyd.delivered")) {
    const record = object(event.payload?.delivered);
    if (!record || typeof record.key !== "string" || !record.key) continue;
    const state: DeliveryVerification = typeof record.outcome === "string" && DELIVERY_OUTCOMES.has(record.outcome as DeliveryVerification)
      ? record.outcome as DeliveryVerification : "pending";
    states.set(record.key, state);
  }
  return states;
}

export function projectVerifiedLoop(events: StoredEvent[]): VerifiedLoopItem[] {
  const delivery = deliveryStates(events);
  const byId = new Map<string, VerifiedLoopItem>();

  for (const event of sourceEvents(events, "cos.report")) {
    const report = object(event.payload?.report);
    if (!report || typeof report.id !== "string" || typeof report.objectiveId !== "string") continue;
    if (typeof report.kind !== "string") continue;
    // CoS acceptance or a worker's "done" report is NOT independent effect
    // verification. The report may be checked for completeness but the
    // intended real-world impact is still unknown.
    byId.set("cos:" + report.id, {
      id: "cos:" + report.id, source: "cos.report",
      objectiveId: report.objectiveId, reportKind: report.kind,
      occurredAt: event.capturedAt, policyVersion: event.policyVersion,
      evidenceRefCount: event.evidenceRefs.length,
      effect: report.kind === "decision" ? "not_applicable" : "unknown",
      delivery: delivery.get("cos:" + report.id) ?? "not_attempted",
      impact: "unknown", usefulness: "unknown",
    });
  }

  for (const event of sourceEvents(events, "executive.cycle")) {
    const decision = object(event.payload?.decision);
    const verification = object(decision?.verification);
    if (!decision || typeof decision.decisionId !== "string") continue;
    const status = verification?.status;
    const refs = Array.isArray(verification?.evidenceRefs) ? verification.evidenceRefs : [];
    const effect: EffectVerification =
      status === "verified" && refs.length > 0 && refs.every((ref) => typeof ref === "string")
        ? "verified" : status === "failed" ? "failed" : status === "pending" ? "pending" : "unknown";
    byId.set("executive:" + decision.decisionId, {
      id: "executive:" + decision.decisionId, source: "executive.cycle",
      occurredAt: event.capturedAt, policyVersion: event.policyVersion,
      evidenceRefCount: event.evidenceRefs.length,
      effect, delivery: "not_correlated",
      impact: "unknown", usefulness: "unknown",
    });
  }
  return [...byId.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
}

export function verifiedLoopFromStore(store: IntelligenceEventStore): VerifiedLoopItem[] {
  return projectVerifiedLoop([
    ...store.readSource("cos.report"),
    ...store.readSource("executive.cycle"),
    ...store.readSource("flyd.delivered"),
  ]);
}

export function summarizeVerifiedLoop(items: VerifiedLoopItem[]): VerifiedLoopSummary {
  const eligible = items.filter((item) => item.effect !== "not_applicable");
  const verifiedEffects = eligible.filter((item) => item.effect === "verified").length;
  const failedEffects = eligible.filter((item) => item.effect === "failed").length;
  return {
    interventions: items.length,
    verifiedEffects,
    failedEffects,
    pendingEffects: eligible.filter((item) => item.effect === "pending").length,
    unknownEffects: eligible.filter((item) => item.effect === "unknown").length,
    delivered: items.filter((item) => item.delivery === "shown" || item.delivery === "briefed").length,
    pendingDelivery: items.filter((item) => item.delivery === "pending" || item.delivery === "undelivered").length,
    unknownImpact: items.length,
    verificationCoverage: { known: verifiedEffects + failedEffects, eligible: eligible.length },
  };
}
