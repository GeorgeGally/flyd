import type { Projector } from "../projections.js";
import type { StoredEvent } from "../event-store.js";
import {
  AUTHORITY_RANK,
  type ClaimAuthority,
  type ClaimAuthority as Authority,
  type ConflictView,
  type FreshnessConfig,
  type WorldClaim,
} from "./types.js";

/**
 * Claim/belief lifecycle projection over the canonical event spine
 * (flyd-personal-intelligence-prd.md §2.2, plan U3).
 *
 * Lifecycle rules:
 * - event kind → claim authority: observation→observed, inferred_belief→inferred,
 *   user_confirmed_intention→user_confirmed.
 * - a user-confirmed claim supersedes any lesser-authority claim on the same
 *   (entityId, attribute) — the superseded claim is retained with its evidence
 *   (supersededBy pointer); nothing is destroyed.
 * - conflicting claims of equal-or-unranked authority remain visible with
 *   authority labels; the active claim wins by rank, then recency.
 */

export interface WorldModelState {
  claims: WorldClaim[];
}

export function resolveEntityId(namespace: string, key: string): string {
  const slug = key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${namespace}:${slug || "unknown"}`;
}

function authorityForKind(kind: string): ClaimAuthority | null {
  switch (kind) {
    case "observation":
      return "observed";
    case "inferred_belief":
      return "inferred";
    case "user_confirmed_intention":
      return "user_confirmed";
    default:
      return null;
  }
}

interface ClaimPayload {
  entity?: { namespace?: string; key?: string; id?: string };
  attribute?: string;
  value?: string;
  validUntil?: string;
}

function claimsFromEvent(event: StoredEvent): WorldClaim[] {
  if (event.erased || !event.payload) return [];
  const authority = authorityForKind(event.kind);
  if (!authority) return [];
  const payload = event.payload as ClaimPayload;
  const entityId = payload.entity?.id ?? resolveEntityId(payload.entity?.namespace ?? event.sourceId, payload.entity?.key ?? event.sourceId);
  if (!payload.attribute || payload.value === undefined) return [];
  return [
    {
      claimId: `${event.sequence}`,
      entityId,
      attribute: payload.attribute,
      value: String(payload.value),
      authority,
      evidenceRefs: [event.sequence, ...event.causationIds.map(Number).filter(Number.isFinite)],
      capturedAt: event.capturedAt,
      ...(payload.validUntil ? { validUntil: payload.validUntil } : {}),
    },
  ];
}

export const worldModelProjector: Projector<WorldModelState> = {
  name: "world-model",
  initialState: () => ({ claims: [] }),
  apply(state, event) {
    const incoming = claimsFromEvent(event);
    if (incoming.length === 0) return state;
    const claims = state.claims.slice();
    for (const claim of incoming) {
      // Supersession is reserved for user corrections/confirmations: a
      // confirmed claim retires lesser claims on the same key. Inferred vs
      // observed claims coexist as a visible conflict instead.
      if (claim.authority === "user_confirmed") {
        for (const existing of claims) {
          if (
            !existing.supersededBy &&
            existing.entityId === claim.entityId &&
            existing.attribute === claim.attribute &&
            AUTHORITY_RANK[existing.authority] < AUTHORITY_RANK[claim.authority]
          ) {
            existing.supersededBy = claim.claimId;
          }
        }
      }
      claims.push(claim);
    }
    return { claims };
  },
};

// ---------------------------------------------------------------------------
// Read model: active claims, conflict visibility, freshness
// ---------------------------------------------------------------------------

export interface ActiveClaim extends WorldClaim {
  /** Temporal, read-time only. Never mixed into authority. */
  freshness: number;
  /** True when another visible claim disputes this one. */
  disputed: boolean;
}

function isExpired(claim: WorldClaim, now: Date): boolean {
  if (!claim.validUntil) return false;
  const t = Date.parse(claim.validUntil);
  return Number.isFinite(t) && t <= now.getTime();
}

export function freshnessOf(claim: WorldClaim, config: FreshnessConfig): number {
  const captured = Date.parse(claim.capturedAt);
  if (!Number.isFinite(captured)) return 0;
  const ageDays = Math.max(0, (config.now.getTime() - captured) / 86_400_000);
  return Math.max(0, 1 - ageDays / config.halfLifeDays);
}

/** Active (non-superseded, non-expired) claims with freshness and dispute labels. */
export function activeClaims(state: WorldModelState, now = new Date(), halfLifeDays = 14): ActiveClaim[] {
  const visible = state.claims.filter((c) => !c.supersededBy && !isExpired(c, now));
  const byKey = new Map<string, WorldClaim[]>();
  for (const claim of visible) {
    const key = `${claim.entityId}::${claim.attribute}`;
    const group = byKey.get(key) ?? [];
    group.push(claim);
    byKey.set(key, group);
  }

  const active: ActiveClaim[] = [];
  for (const group of byKey.values()) {
    const sorted = group.slice().sort((a, b) => {
      const rank = AUTHORITY_RANK[b.authority] - AUTHORITY_RANK[a.authority];
      if (rank !== 0) return rank;
      return Date.parse(b.capturedAt) - Date.parse(a.capturedAt);
    });
    const winner = sorted[0];
    active.push({
      ...winner,
      freshness: freshnessOf(winner, { halfLifeDays, now }),
      disputed: sorted.length > 1,
    });
  }
  return active.sort((a, b) => a.entityId.localeCompare(b.entityId) || a.attribute.localeCompare(b.attribute));
}

/**
 * Conflict view (plan U3 test 2): conflicting current and durable claims stay
 * visible with authority labels — the active claim never silently erases the
 * challenger.
 */
export function conflictsFor(
  state: WorldModelState,
  entityId: string,
  attribute: string,
  now = new Date(),
): ConflictView | null {
  const visible = state.claims.filter(
    (c) => !c.supersededBy && !isExpired(c, now) && c.entityId === entityId && c.attribute === attribute,
  );
  if (visible.length < 2) return null;
  const sorted = visible.slice().sort((a, b) => {
    const rank = AUTHORITY_RANK[b.authority] - AUTHORITY_RANK[a.authority];
    if (rank !== 0) return rank;
    return Date.parse(b.capturedAt) - Date.parse(a.capturedAt);
  });
  return {
    entityId,
    attribute,
    active: sorted[0],
    conflicting: sorted.slice(1).map((claim) => ({ claim, authority: claim.authority })),
  };
}

/**
 * Epistemic lookup: authority of a claim is a function of its evidence only.
 * Freshness never alters it — old evidence stays as credible as it ever was.
 */
export function epistemicConfidence(claim: WorldClaim): Authority {
  return claim.authority;
}
