import { createHash, randomUUID } from "node:crypto";

/**
 * Authority ledger (flyd-personal-intelligence-prd.md §4, plan U4).
 *
 * Every side effect flows through one minimum-context authority ledger.
 * Observations and read-only investigation never imply action authority.
 * Grants are expiring, scope-bound, target-fingerprinted, and single-use per
 * attempt. Authorization fails closed: forged, replayed, expired, revoked,
 * over-broad, and stale-fingerprint requests are denied before execution,
 * and every decision leaves an inspectable receipt.
 */

export type EffectClass = "reversible" | "high_impact" | "irreversible";

export interface CapabilityManifest {
  capabilityId: string;
  effectClass: EffectClass;
  /** The exact context keys an adapter may receive — nothing more. */
  requiredContextKeys: string[];
  /** Verifier contract id; execution is not complete until it passes. */
  verifierId: string;
}

export interface AuthorityGrant {
  grantId: string;
  capabilityId: string;
  principal: string;
  /** Digest of the exact permitted target; anything else fails. */
  targetFingerprint: string;
  scope: Record<string, unknown>;
  issuedAt: string;
  expiresAt: string;
  status: "active" | "consumed" | "revoked";
}

export type DenialReason =
  | "forged"
  | "replayed"
  | "expired"
  | "revoked"
  | "over_broad"
  | "stale_fingerprint"
  | "unknown_capability";

export interface AuthorizationReceipt {
  receiptId: string;
  attemptId: string;
  grantId?: string;
  capabilityId: string;
  allowed: boolean;
  reason?: DenialReason;
  detail?: string;
  decidedAt: string;
}

export interface AuthorizationRequest {
  attemptId: string;
  grantId: string;
  capabilityId: string;
  /** The fingerprint of the target the caller wants to touch now. */
  targetFingerprint: string;
  /** Context keys the caller wants the adapter to receive. */
  requestedContextKeys: string[];
}

export function fingerprintTarget(target: unknown): string {
  return createHash("sha256").update(JSON.stringify(target)).digest("hex");
}

export class AuthorityLedger {
  private readonly grants = new Map<string, AuthorityGrant>();
  private readonly manifests = new Map<string, CapabilityManifest>();
  /** attemptId → receipt; retries are idempotent against their attempt. */
  private readonly receiptsByAttempt = new Map<string, AuthorizationReceipt>();
  readonly receipts: AuthorizationReceipt[] = [];

  registerManifest(manifest: CapabilityManifest): void {
    this.manifests.set(manifest.capabilityId, manifest);
  }

  manifest(capabilityId: string): CapabilityManifest | undefined {
    return this.manifests.get(capabilityId);
  }

  issueGrant(input: {
    capabilityId: string;
    principal: string;
    target: unknown;
    scope: Record<string, unknown>;
    ttlMs: number;
    now?: Date;
  }): AuthorityGrant {
    const now = input.now ?? new Date();
    const grant: AuthorityGrant = {
      grantId: randomUUID(),
      capabilityId: input.capabilityId,
      principal: input.principal,
      targetFingerprint: fingerprintTarget(input.target),
      scope: input.scope,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + input.ttlMs).toISOString(),
      status: "active",
    };
    this.grants.set(grant.grantId, grant);
    return grant;
  }

  revokeGrant(grantId: string): void {
    const grant = this.grants.get(grantId);
    if (grant) grant.status = "revoked";
  }

  grant(grantId: string): AuthorityGrant | undefined {
    return this.grants.get(grantId);
  }

  /** Idempotent per attemptId: a retry of the same attempt returns the original receipt. */
  authorize(request: AuthorizationRequest, now = new Date()): AuthorizationReceipt {
    const prior = this.receiptsByAttempt.get(request.attemptId);
    if (prior) return prior;

    const receipt = this.decide(request, now);
    this.receiptsByAttempt.set(request.attemptId, receipt);
    this.receipts.push(receipt);
    return receipt;
  }

  private decide(request: AuthorizationRequest, now: Date): AuthorizationReceipt {
    const base = {
      receiptId: randomUUID(),
      attemptId: request.attemptId,
      capabilityId: request.capabilityId,
      decidedAt: now.toISOString(),
    };

    const grant = this.grants.get(request.grantId);
    if (!grant) return { ...base, allowed: false, reason: "forged", detail: `unknown grant ${request.grantId}` };

    const manifest = this.manifests.get(request.capabilityId);
    if (!manifest || grant.capabilityId !== request.capabilityId) {
      return { ...base, grantId: grant.grantId, allowed: false, reason: "unknown_capability", detail: `no manifest for ${request.capabilityId}` };
    }
    if (grant.status === "revoked") {
      return { ...base, grantId: grant.grantId, allowed: false, reason: "revoked", detail: "grant revoked" };
    }
    if (Date.parse(grant.expiresAt) <= now.getTime()) {
      return { ...base, grantId: grant.grantId, allowed: false, reason: "expired", detail: `expired ${grant.expiresAt}` };
    }
    if (grant.status === "consumed") {
      return { ...base, grantId: grant.grantId, allowed: false, reason: "replayed", detail: "grant already used by another attempt" };
    }
    if (grant.targetFingerprint !== request.targetFingerprint) {
      return { ...base, grantId: grant.grantId, allowed: false, reason: "stale_fingerprint", detail: "target changed since the grant was issued" };
    }
    const overBroad = request.requestedContextKeys.filter((key) => !manifest.requiredContextKeys.includes(key));
    if (overBroad.length > 0) {
      return {
        ...base,
        grantId: grant.grantId,
        allowed: false,
        reason: "over_broad",
        detail: `context keys outside manifest contract: ${overBroad.join(", ")}`,
      };
    }

    grant.status = "consumed";
    return { ...base, grantId: grant.grantId, allowed: true };
  }

  /** Cancellation always terminates in an inspectable receipt. */
  cancel(attemptId: string, now = new Date()): AuthorizationReceipt {
    const prior = this.receiptsByAttempt.get(attemptId);
    if (prior?.allowed) {
      const grant = prior.grantId ? this.grants.get(prior.grantId) : undefined;
      if (grant?.status === "consumed") grant.status = "revoked";
    }
    const receipt: AuthorizationReceipt = {
      receiptId: randomUUID(),
      attemptId,
      ...(prior?.grantId ? { grantId: prior.grantId } : {}),
      capabilityId: prior?.capabilityId ?? "unknown",
      allowed: false,
      reason: "revoked",
      detail: "attempt cancelled",
      decidedAt: now.toISOString(),
    };
    this.receipts.push(receipt);
    return receipt;
  }
}
