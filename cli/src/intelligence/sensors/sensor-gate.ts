import { validateEnvelope, type ConsentLookup, type ContextEnvelope } from "../context-envelope.js";

/**
 * Sensor gate (plan U5): the last check before LEARN event creation.
 *
 * Enforces, in order: registered contract → enabled (not paused/revoked/
 * disabled) → not incognito → app not excluded → redaction. Denials are
 * recorded as decisions, never silently dropped.
 */

export type GateDenialReason =
  | "not_a_learn_source"
  | "contract_disabled"
  | "contract_paused"
  | "source_revoked"
  | "incognito"
  | "app_excluded"
  | "redaction_failed"
  | "invalid_envelope";

export interface CaptureContext {
  /** Foreground bundle id at capture time, when the sensor has one. */
  bundleId?: string;
  /** True while the user is in an incognito/private mode. */
  incognito?: boolean;
}

export type GateDecision =
  | { admitted: true }
  | { admitted: false; reason: GateDenialReason; detail?: string };

export class SensorGate {
  constructor(
    private readonly registry: import("./source-contracts.js").SourceContractRegistry,
    private readonly consentLookup: ConsentLookup = {
      isRevoked: (sourceId) => this.registry.status(sourceId) === "revoked",
    },
  ) {}

  admit(envelope: ContextEnvelope, capture: CaptureContext = {}): GateDecision {
    const contract = this.registry.contract(envelope.sourceId);
    if (!contract) return { admitted: false, reason: "not_a_learn_source", detail: `${envelope.sourceId} has no LEARN contract` };

    const status = this.registry.status(envelope.sourceId);
    if (status === "disabled" || status === undefined) return { admitted: false, reason: "contract_disabled" };
    if (status === "paused") return { admitted: false, reason: "contract_paused" };
    if (status === "revoked") return { admitted: false, reason: "source_revoked" };

    if (capture.incognito) return { admitted: false, reason: "incognito" };
    if (capture.bundleId && contractExcludesApp(contract, capture.bundleId)) {
      return { admitted: false, reason: "app_excluded", detail: capture.bundleId };
    }

    // Redaction and structural validation before persistence (PRD §3.3).
    const validation = validateEnvelope(envelope, { consentLookup: this.consentLookup });
    if (!validation.ok) {
      return { admitted: false, reason: validation.rejection === "redaction_failed" ? "redaction_failed" : "invalid_envelope", detail: validation.detail };
    }

    return { admitted: true };
  }
}

/** Per-app exclusion list on the contract; Flyd's own apps always excluded. */
const FLYD_BUNDLE_IDS = ["com.flyd.app", "com.flyd.overlay"];

function contractExcludesApp(contract: import("./source-contracts.js").SourceContract, bundleId: string): boolean {
  const exclusions = (contract as SourceContractWithExclusions).excludedBundleIds ?? [];
  return exclusions.includes(bundleId) || FLYD_BUNDLE_IDS.includes(bundleId);
}

export interface SourceContractWithExclusions {
  excludedBundleIds?: string[];
}
