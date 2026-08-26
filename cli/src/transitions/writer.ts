import { IntelligenceEventStore, type StoredEvent } from "../intelligence/event-store.js";
import {
  validateEnvelope,
  type ContextEnvelope,
  type EnvelopePathKind,
  type EpistemicKind,
  type PayloadClassification,
} from "../intelligence/context-envelope.js";
import {
  SourceContractRegistry,
  TRANSITION_SOURCE_CONTRACTS,
} from "../intelligence/sensors/source-contracts.js";
import type { JudgmentInput, TransitionActionInput, TransitionNextStateInput } from "./types.js";

/**
 * Transition spine writer (transition-log plan U1).
 *
 * The first production writer on the IntelligenceEventStore. Every public
 * function checks the FLYD_TRANSITIONS_DISABLED kill switch first and
 * degrades to a success no-op; failures never throw into live request
 * paths but validation rejections are surfaced on the result.
 */

export type TransitionWriteResult =
  | { ok: true; event: StoredEvent; skipped?: undefined }
  | { ok: true; skipped: true; event?: undefined }
  | { ok: false; rejection: string; detail?: string };

let storeInstance: IntelligenceEventStore | null = null;
let registryInstance: SourceContractRegistry | null = null;
let dbPathOverride: string | undefined;
let registryPathOverride: string | undefined;

/** Test/dogfood injection point, mirroring configureOutcomeJournalDirectory. */
export function configureTransitionStore(options: { dbPath?: string; registryPath?: string } = {}): void {
  if (storeInstance) {
    try { storeInstance.close(); } catch { /* closing a fresh test instance is best-effort */ }
  }
  storeInstance = null;
  registryInstance = null;
  dbPathOverride = options.dbPath;
  registryPathOverride = options.registryPath;
}

function getStore(): IntelligenceEventStore {
  if (!storeInstance) storeInstance = new IntelligenceEventStore({ path: dbPathOverride });
  return storeInstance;
}

function getRegistry(): SourceContractRegistry {
  if (!registryInstance) {
    const options = registryPathOverride ? { path: registryPathOverride } : {};
    registryInstance = new SourceContractRegistry(options);
    for (const contract of TRANSITION_SOURCE_CONTRACTS) registryInstance.register(contract);
  }
  return registryInstance;
}

/** Exposed for governance surfaces (U9) that need the shared registry. */
export function transitionSourceRegistry(): SourceContractRegistry {
  return getRegistry();
}

export function isTransitionCaptureDisabled(): boolean {
  const value = process.env.FLYD_TRANSITIONS_DISABLED?.trim().toLowerCase();
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

const DETERMINISTIC_SIGNALS: ReadonlySet<string> = new Set([
  "succeeded",
  "rejected",
  "failed",
  "cancelled",
  "verified",
  "partial",
]);

const SURFACE_SOURCE_IDS: Record<TransitionActionInput["surface"], string> = {
  overlay: "transition.overlay",
  cli_chat: "transition.cli-chat",
  harness: "transition.harness",
};

function admit(
  envelope: ContextEnvelope,
): { ok: true } | { ok: false; rejection: string; detail: string } {
  const registry = getRegistry();
  const status = registry.status(envelope.sourceId);
  if (status === "revoked") {
    return { ok: false, rejection: "consent_revoked", detail: `source ${envelope.sourceId} is revoked` };
  }
  if (status !== "enabled") {
    return { ok: false, rejection: "contract_disabled", detail: `source ${envelope.sourceId} is ${status ?? "unregistered"}` };
  }
  const validation = validateEnvelope(envelope, {
    consentLookup: { isRevoked: (sourceId) => registry.status(sourceId) === "revoked" },
  });
  return validation.ok ? { ok: true } : { ok: false, rejection: validation.rejection, detail: validation.detail };
}

function appendTransition(envelope: ContextEnvelope): TransitionWriteResult {
  const gate = admit(envelope);
  if (!gate.ok) return gate;
  try {
    const event = getStore().append(envelope);
    if (!event) return { ok: false, rejection: "internal_error", detail: "store returned no event" };
    return { ok: true, event };
  } catch (error) {
    console.warn("[transitions] append failed:", error instanceof Error ? error.message : error);
    return { ok: false, rejection: "internal_error", detail: String(error) };
  }
}

function consentSnapshot(sourceId: string) {
  const contract = getRegistry().contract(sourceId)!;
  return { grantedAt: new Date().toISOString(), scopes: contract.scopes };
}

export function recordAction(input: TransitionActionInput): TransitionWriteResult {
  if (isTransitionCaptureDisabled()) return { ok: true, skipped: true };

  const sourceId = SURFACE_SOURCE_IDS[input.surface];
  const envelope: ContextEnvelope = {
    pathKind: "interface",
    kind: "proposed_action",
    sourceId,
    consent: consentSnapshot(sourceId),
    retentionClass: "local_default",
    payloadClassification: "personal",
    provenance: "transitions:writer",
    idempotencyKey: `action:${input.invocationId}`,
    correlationId: input.invocationId,
    payload: {
      sessionId: input.sessionId,
      invocationId: input.invocationId,
      actor: { surface: input.surface },
      action: {
        intent: input.intent,
        routeKind: input.routeKind,
        resolutionMode: input.resolutionMode,
        model: input.model,
        appSummary: input.appSummary,
      },
    },
  };
  return appendTransition(envelope);
}

export function recordNextState(input: TransitionNextStateInput): TransitionWriteResult {
  if (isTransitionCaptureDisabled()) return { ok: true, skipped: true };

  const deterministic = DETERMINISTIC_SIGNALS.has(input.signal);
  const sourceId =
    input.origin === "verifier"
      ? "transition.harness"
      : SURFACE_SOURCE_IDS[input.surface ?? "overlay"];
  const envelope: ContextEnvelope = {
    pathKind: (input.origin === "verifier" ? "sensor" : "interface") as EnvelopePathKind,
    kind: (deterministic ? "verified_outcome" : "observation") as EpistemicKind,
    sourceId,
    consent: consentSnapshot(sourceId),
    retentionClass: "local_default",
    payloadClassification: "personal",
    provenance: "transitions:writer",
    idempotencyKey: `next:${input.invocationId}:${input.signal}`,
    correlationId: input.invocationId,
    payload: {
      sessionId: input.sessionId,
      invocationId: input.invocationId,
      nextState: {
        origin: input.origin,
        signal: input.signal,
        correction: input.correction,
        causalComplete: input.causalComplete,
        ...(input.detail ? { detail: input.detail } : {}),
      },
    },
  };
  return appendTransition(envelope);
}

export function recordJudgment(input: JudgmentInput): TransitionWriteResult {
  if (isTransitionCaptureDisabled()) return { ok: true, skipped: true };

  if (!Number.isInteger(input.transitionSeq) || input.transitionSeq <= 0) {
    return { ok: false, rejection: "invalid", detail: `invalid transitionSeq ${String(input.transitionSeq)}` };
  }
  if (input.verdict !== -1 && input.verdict !== 0 && input.verdict !== 1) {
    return { ok: false, rejection: "invalid", detail: `verdict must be -1|0|1, got ${String(input.verdict)}` };
  }
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    return { ok: false, rejection: "invalid", detail: `confidence must be within 0..1, got ${String(input.confidence)}` };
  }
  if (!input.rationale?.trim()) {
    return { ok: false, rejection: "invalid", detail: "rationale required" };
  }

  const target = getStore().getBySequence(input.transitionSeq);
  if (!target || !target.sourceId.startsWith("transition.")) {
    return { ok: false, rejection: "invalid", detail: `no transition at sequence ${input.transitionSeq}` };
  }

  const envelope: ContextEnvelope = {
    pathKind: "executive",
    kind: "observation",
    sourceId: "transition.judge",
    consent: consentSnapshot("transition.judge"),
    retentionClass: "local_default",
    payloadClassification: "operational" as PayloadClassification,
    provenance: "transitions:judge",
    idempotencyKey: `judgment:${input.transitionSeq}`,
    correlationId: target.correlationId ?? String(target.sequence),
    causationIds: [target.id],
    payload: {
      transitionSeq: input.transitionSeq,
      verdict: input.verdict,
      confidence: input.confidence,
      rationale: input.rationale,
    },
  };
  return appendTransition(envelope);
}
