import { IntelligenceEventStore, type StoredEvent } from "../intelligence/event-store.js";
import { validateEnvelope, type ContextEnvelope } from "../intelligence/context-envelope.js";
import { SourceContractRegistry, type SourceContract } from "../intelligence/sensors/source-contracts.js";
import type { WorldStateSnapshot } from "../intelligence/world/types.js";
import type { PlanningTrace, PredictionOutcome } from "./future-model.js";

export const PLANNING_RUNTIME_SOURCE_ID = "planning.runtime";
export const PLANNING_RUNTIME_CONTRACT: SourceContract = {
  sourceId: PLANNING_RUNTIME_SOURCE_ID,
  displayName: "Planning runtime",
  sensitivity: "low",
  scopes: [PLANNING_RUNTIME_SOURCE_ID],
  retentionClass: "local_default",
  retentionDays: 90,
  egressDestinations: [],
  purpose: "Retain structured planning snapshots, predictions and reconciliation outcomes for calibration.",
  enabledByDefault: true,
};

export interface PlanningStoreOptions {
  dbPath?: string;
  registryPath?: string;
}

export interface CalibrationBucket {
  confidence: string;
  /** All reconciled predictions observed at this confidence, including unscorable ones. */
  total: number;
  /** Predictions that declared at least one effect and can therefore be scored. */
  scored: number;
  /** Observed runs retained for learning but excluded from prediction accuracy. */
  unscored: number;
  correct: number;
  correctRate: number;
}

type PlanningPayload =
  | { type: "world_state_snapshot"; snapshot: WorldStateSnapshot }
  | { type: "planning_trace"; trace: PlanningTrace }
  | { type: "prediction_outcome"; outcome: PredictionOutcome };

/**
 * Planning persistence is a governed projection on Flyd's canonical
 * IntelligenceEventStore. Action/outcome trajectories remain owned by the
 * existing transition spine; this store deliberately does not duplicate them.
 */
export class PlanningStore {
  private readonly store: IntelligenceEventStore;
  private readonly registry: SourceContractRegistry;

  constructor(options: PlanningStoreOptions = {}) {
    this.store = new IntelligenceEventStore({ path: options.dbPath });
    this.registry = new SourceContractRegistry(options.registryPath ? { path: options.registryPath } : {});
    this.registry.register(PLANNING_RUNTIME_CONTRACT);
  }

  close(): void {
    this.store.close();
  }

  saveSnapshot(snapshot: WorldStateSnapshot, correlationId?: string): StoredEvent {
    return this.append(`snapshot:${snapshot.id}`, { type: "world_state_snapshot", snapshot }, correlationId);
  }

  getSnapshot(id: string): WorldStateSnapshot | null {
    const event = this.events().find((candidate) => {
      const payload = candidate.payload as unknown as PlanningPayload | undefined;
      return payload?.type === "world_state_snapshot" && payload.snapshot.id === id;
    });
    const payload = event?.payload as unknown as PlanningPayload | undefined;
    return payload?.type === "world_state_snapshot" ? payload.snapshot : null;
  }

  saveTrace(trace: PlanningTrace, correlationId?: string): StoredEvent {
    return this.append(`trace:${trace.id}`, { type: "planning_trace", trace }, correlationId);
  }

  getTrace(id: string): PlanningTrace | null {
    const event = this.events().find((candidate) => {
      const payload = candidate.payload as unknown as PlanningPayload | undefined;
      return payload?.type === "planning_trace" && payload.trace.id === id;
    });
    const payload = event?.payload as unknown as PlanningPayload | undefined;
    return payload?.type === "planning_trace" ? payload.trace : null;
  }

  savePredictionOutcome(outcome: PredictionOutcome, correlationId?: string): StoredEvent {
    return this.append(
      `prediction-outcome:${outcome.id}`,
      { type: "prediction_outcome", outcome },
      correlationId,
    );
  }

  calibrationReport(): CalibrationBucket[] {
    const buckets = new Map<string, { total: number; scored: number; correct: number }>();
    for (const event of this.events()) {
      const payload = event.payload as unknown as PlanningPayload | undefined;
      if (payload?.type !== "prediction_outcome") continue;
      const outcome = payload.outcome;
      const key = outcome.confidenceAtPrediction.level;
      const bucket = buckets.get(key) ?? { total: 0, scored: 0, correct: 0 };
      bucket.total += 1;
      if (outcome.category !== "insufficient_evidence") {
        bucket.scored += 1;
        if (outcome.category === "correct") bucket.correct += 1;
      }
      buckets.set(key, bucket);
    }
    return [...buckets.entries()].map(([confidence, bucket]) => ({
      confidence,
      total: bucket.total,
      scored: bucket.scored,
      unscored: bucket.total - bucket.scored,
      correct: bucket.correct,
      correctRate: bucket.scored ? bucket.correct / bucket.scored : 0,
    }));
  }

  private append(idempotencyKey: string, payload: PlanningPayload, correlationId?: string): StoredEvent {
    if (this.registry.status(PLANNING_RUNTIME_SOURCE_ID) !== "enabled") {
      throw new Error(`Planning runtime source is ${this.registry.status(PLANNING_RUNTIME_SOURCE_ID) ?? "unregistered"}`);
    }
    const envelope: ContextEnvelope = {
      pathKind: "executive",
      kind: "observation",
      sourceId: PLANNING_RUNTIME_SOURCE_ID,
      consent: {
        grantedAt: new Date().toISOString(),
        scopes: PLANNING_RUNTIME_CONTRACT.scopes,
      },
      retentionClass: PLANNING_RUNTIME_CONTRACT.retentionClass,
      payloadClassification: "personal",
      provenance: "planning:runtime",
      idempotencyKey,
      ...(correlationId ? { correlationId } : {}),
      payload: payload as unknown as Record<string, unknown>,
    };
    const validation = validateEnvelope(envelope, {
      consentLookup: { isRevoked: (sourceId) => this.registry.status(sourceId) === "revoked" },
    });
    if (!validation.ok) {
      throw new Error(`Planning event rejected: ${validation.rejection}: ${validation.detail}`);
    }
    const event = this.store.append(envelope);
    if (!event) throw new Error("Planning event store returned no event");
    return event;
  }

  private events(): StoredEvent[] {
    const result: StoredEvent[] = [];
    let cursor = 0;
    while (true) {
      const batch = this.store.readFrom(cursor, 1000);
      if (batch.length === 0) break;
      result.push(...batch.filter((event) => event.sourceId === PLANNING_RUNTIME_SOURCE_ID && !event.erased));
      cursor = batch[batch.length - 1].sequence;
      if (batch.length < 1000) break;
    }
    return result;
  }
}