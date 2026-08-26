/**
 * World-model types (flyd-personal-intelligence-prd.md §2.2).
 *
 * Observation, inference, correction, confirmation, conflict, validity time,
 * and source evidence stay separate. Authority is epistemic and never decays;
 * freshness is temporal and computed only at read time.
 */

export type ClaimAuthority = "observed" | "inferred" | "user_confirmed";

/** Authority ranks strictly: confirmed > inferred > observed. */
export const AUTHORITY_RANK: Record<ClaimAuthority, number> = {
  observed: 0,
  inferred: 1,
  user_confirmed: 2,
};

export interface WorldClaim {
  /** Stable id: sequence-scoped, never reused. */
  claimId: string;
  /** Resolved entity key (see resolveEntityId). */
  entityId: string;
  /** Attribute under claim, e.g. "project", "stage", "goal". */
  attribute: string;
  value: string;
  authority: ClaimAuthority;
  /** Event-sequence provenance — survives supersession. */
  evidenceRefs: number[];
  capturedAt: string;
  validUntil?: string;
  /** Set when a later claim (e.g. a user correction) supersedes this one. */
  supersededBy?: string;
}

export interface WorldEntity {
  id: string;
  kind: "project" | "artifact" | "person" | "topic" | "goal" | "generic";
  label: string;
}

export interface ConflictView {
  entityId: string;
  attribute: string;
  active: WorldClaim;
  conflicting: Array<{ claim: WorldClaim; authority: ClaimAuthority }>;
}

export interface FreshnessConfig {
  /** Days until a claim's freshness halves. */
  halfLifeDays: number;
  now: Date;
}
