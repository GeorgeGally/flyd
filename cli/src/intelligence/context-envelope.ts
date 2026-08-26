import { createHash, randomUUID } from "node:crypto";

/**
 * Shared ContextEnvelope (flyd-personal-intelligence-prd.md §2.3).
 *
 * Every ingress and egress crosses this boundary. The validator binds
 * correlation, consent snapshot, evidence references, applicable policy,
 * authority/budget, and receipt-or-decision semantics for every path kind.
 */

export const ENVELOPE_SCHEMA_VERSION = 1;

export type EnvelopePathKind = "sensor" | "interface" | "executive" | "capability";

/** Epistemic separation (PRD §2.2): distinct kinds, never conflated. */
export type EpistemicKind =
  | "observation"
  | "inferred_belief"
  | "user_confirmed_intention"
  | "proposed_action"
  | "verified_outcome"
  | "executive_decision"
  | "policy_event"
  | "egress_receipt";

export type RetentionClass = "ephemeral" | "local_default" | "extended";
export type PayloadClassification = "operational" | "personal" | "sensitive";

export interface ConsentSnapshot {
  grantedAt: string;
  scopes: string[];
}

export interface ContextEnvelope {
  pathKind: EnvelopePathKind;
  kind: EpistemicKind;
  sourceId: string;
  consent: ConsentSnapshot;
  retentionClass: RetentionClass;
  payloadClassification: PayloadClassification;
  provenance: string;
  idempotencyKey: string;
  correlationId?: string;
  causationIds?: string[];
  evidenceRefs?: string[];
  policyVersion?: string;
  authorityGrantId?: string;
  authorityExpiresAt?: string;
  budgetKey?: string;
  payload?: Record<string, unknown>;
}

export type EnvelopeRejection =
  | "invalid"
  | "consent_revoked"
  | "consent_expired"
  | "authority_expired"
  | "authority_missing"
  | "redaction_failed";

export interface ConsentLookup {
  /** Returns false once a source is revoked. */
  isRevoked(sourceId: string): boolean;
}

const KINDS: ReadonlySet<EpistemicKind> = new Set<EpistemicKind>([
  "observation",
  "inferred_belief",
  "user_confirmed_intention",
  "proposed_action",
  "verified_outcome",
  "executive_decision",
  "policy_event",
  "egress_receipt",
]);

/** High-sensitivity fields (PRD §3.4) require an explicit matching scope. */
const SENSITIVE_FIELD_SCOPES: Record<string, string> = {
  screen_text: "screen.raw_text",
  clipboard: "clipboard",
  audio_content: "microphone.content",
  communications: "communications",
  location: "location",
  health: "health",
  finance: "finance",
};

function findSensitiveField(value: unknown, path = ""): string | null {
  if (value === null || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const fieldPath = path ? `${path}.${key}` : key;
    if (key in SENSITIVE_FIELD_SCOPES) return fieldPath;
    const nested = findSensitiveField(child, fieldPath);
    if (nested) return nested;
  }
  return null;
}

function isExpired(iso: string | undefined, now: Date): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t <= now.getTime();
}

export interface EnvelopeValidationContext {
  now?: Date;
  consentLookup?: ConsentLookup;
}

/**
 * Validate one envelope against the single contract. Rejected envelopes
 * never reach persistence or projections.
 */
export function validateEnvelope(
  envelope: ContextEnvelope,
  ctx: EnvelopeValidationContext = {},
): { ok: true } | { ok: false; rejection: EnvelopeRejection; detail: string } {
  const now = ctx.now ?? new Date();

  if (!envelope || typeof envelope !== "object") {
    return { ok: false, rejection: "invalid", detail: "envelope missing" };
  }
  if (!KINDS.has(envelope.kind)) {
    return { ok: false, rejection: "invalid", detail: `unknown kind: ${String((envelope as { kind?: unknown }).kind)}` };
  }
  if (!envelope.sourceId?.trim() || !envelope.provenance?.trim() || !envelope.idempotencyKey?.trim()) {
    return { ok: false, rejection: "invalid", detail: "sourceId, provenance and idempotencyKey are required" };
  }
  if (!envelope.consent?.grantedAt || !Array.isArray(envelope.consent.scopes)) {
    return { ok: false, rejection: "invalid", detail: "consent snapshot required" };
  }

  const lookup = ctx.consentLookup;
  if (lookup?.isRevoked(envelope.sourceId)) {
    return { ok: false, rejection: "consent_revoked", detail: `source ${envelope.sourceId} is revoked` };
  }
  if (isExpired(envelope.authorityExpiresAt, now)) {
    return { ok: false, rejection: "authority_expired", detail: "capability grant expired" };
  }
  if (envelope.pathKind === "capability" && !envelope.authorityGrantId) {
    return { ok: false, rejection: "authority_missing", detail: "capability path requires an authority grant id" };
  }

  const sensitivePath = findSensitiveField(envelope.payload);
  if (sensitivePath) {
    const field = sensitivePath.split(".").pop() as string;
    const requiredScope = SENSITIVE_FIELD_SCOPES[field];
    const classificationAllows =
      envelope.payloadClassification === "sensitive" && envelope.consent.scopes.includes(requiredScope);
    if (!classificationAllows) {
      return {
        ok: false,
        rejection: "redaction_failed",
        detail: `sensitive field "${sensitivePath}" present without scope ${requiredScope}`,
      };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Egress decisions (PRD §2.3): every egress produces a receipt or a recorded
// denial decision. Pure assertion logic over the envelope — no network here.
// ---------------------------------------------------------------------------

export interface EgressRequest {
  destination: string;
  purpose: string;
  fields: string[];
}

export interface EgressDecision {
  decisionId: string;
  allowed: boolean;
  destination: string;
  purpose: string;
  deniedFields: string[];
  reason?: string;
  decidedAt: string;
}

/**
 * Field-level egress gate: a field may leave only when its source consent
 * explicitly grants a scope covering it. Denied fields are stripped from the
 * request; the returned decision is always durable enough to record.
 */
export function decideEgress(
  envelope: ContextEnvelope,
  request: EgressRequest,
  consentLookup?: ConsentLookup,
  now = new Date(),
): EgressDecision {
  const deniedFields: string[] = [];
  const revoked = consentLookup?.isRevoked(envelope.sourceId) ?? false;

  for (const field of request.fields) {
    const requiredScope = SENSITIVE_FIELD_SCOPES[field];
    const covered = !requiredScope || envelope.consent.scopes.includes(requiredScope);
    if (revoked || !covered) deniedFields.push(field);
  }

  const blockedEntirely = revoked;
  // Fail-closed: a provider never receives a partially-redacted payload.
  const allowed = !blockedEntirely && deniedFields.length === 0;

  return {
    decisionId: randomUUID(),
    allowed,
    destination: request.destination,
    purpose: request.purpose,
    deniedFields: blockedEntirely ? request.fields.slice() : deniedFields,
    ...(blockedEntirely
      ? { reason: `source ${envelope.sourceId} consent revoked` }
      : deniedFields.length > 0
        ? { reason: `fields lack consent scope: ${deniedFields.join(", ")}` }
        : {}),
    decidedAt: now.toISOString(),
  };
}

/** Stable digest of a validated envelope's durable identity (receipts, tests). */
export function envelopeDigest(envelope: ContextEnvelope): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        envelope.kind,
        envelope.sourceId,
        envelope.idempotencyKey,
        envelope.consent,
        envelope.payload ?? null,
      ]),
    )
    .digest("hex");
}
