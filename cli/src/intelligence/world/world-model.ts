import type { Projector } from "../projections.js";
import type { StoredEvent } from "../event-store.js";
import { groundedProperty, projectFactEntity, knowledgeScopeHash } from "../../cognition/knowledge-facts.js";
import {
  AUTHORITY_RANK,
  type ClaimAuthority,
  type ClaimAuthority as Authority,
  type ConflictView,
  type FreshnessConfig,
  type TemporalStatus,
  type TimeShape,
  type WorldClaim,
  type WorldRelation,
  type WorldRelationType,
} from "./types.js";

export interface WorldModelState {
  claims: WorldClaim[];
  relations: WorldRelation[];
  retractedRepairs?: string[];
  erasedSequences?: number[];
  governedScopeHashes?: string[];
}

export function factKey(claim: { entityId: string; attribute: string; scopeId?: string }): string {
  return JSON.stringify([claim.entityId, claim.attribute, claim.scopeId ?? "legacy"]);
}

const factTime = (claim: WorldClaim): number => Date.parse(claim.effectiveAt ?? claim.observedAt ?? claim.capturedAt);

export interface DerivedClaim extends WorldClaim {
  freshness: number;
  disputed: boolean;
  temporalStatus: TemporalStatus;
  derivation: string[];
}

export interface DerivedWorldState {
  now: string;
  current: DerivedClaim[];
  historical: DerivedClaim[];
  conflicts: ConflictView[];
  relations: WorldRelation[];
  staleEntityIds: string[];
  unresolvedEntityIds: string[];
  governedScopeHashes?: string[];
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
    case "observation": return "observed";
    case "inferred_belief": return "inferred";
    case "user_confirmed_intention": return "user_confirmed";
    default: return null;
  }
}

interface ClaimPayload {
  scopeId?: string;
  repairId?: string;
  legacyRefs?: string[];
  displaySection?: string;
  entity?: { namespace?: string; key?: string; id?: string };
  attribute?: string;
  value?: string;
  validFrom?: string;
  validUntil?: string;
  effectiveAt?: string;
  timeShape?: TimeShape;
  parentEntityId?: string;
}

interface RelationPayload {
  relation?: {
    repairId?: string;
    id?: string;
    from?: string;
    fromEntity?: { namespace?: string; key?: string; id?: string };
    type?: WorldRelationType;
    to?: string;
    toEntity?: { namespace?: string; key?: string; id?: string };
    confidence?: number;
    validFrom?: string;
    validUntil?: string;
  };
}

function entityFromRef(
  explicit: string | undefined,
  entity: { namespace?: string; key?: string; id?: string } | undefined,
  fallbackNamespace: string,
): string | null {
  if (explicit?.trim()) return explicit.trim();
  if (entity?.id?.trim()) return entity.id.trim();
  if (entity?.key?.trim()) return resolveEntityId(entity.namespace ?? fallbackNamespace, entity.key);
  return null;
}

function claimFromEvent(event: StoredEvent): WorldClaim | null {
  if (event.erased || !event.payload) return null;
  const authority = authorityForKind(event.kind);
  if (!authority) return null;
  const payload = event.payload as ClaimPayload;
  const entityId = payload.entity?.id
    ?? resolveEntityId(payload.entity?.namespace ?? event.sourceId, payload.entity?.key ?? event.sourceId);
  if (!payload.attribute || payload.value === undefined) return null;
  return {
    claimId: `${event.sequence}`,
    entityId,
    attribute: payload.attribute,
    value: String(payload.value),
    ...(payload.scopeId ? { scopeId: payload.scopeId } : {}),
    ...(payload.repairId ? { repairId: payload.repairId } : {}),
    ...(payload.legacyRefs ? { legacyRefs: payload.legacyRefs } : {}),
    ...(payload.displaySection ? { displaySection: payload.displaySection } : {}),
    authority,
    evidenceRefs: [...new Set([event.sequence, ...event.causationIds.map(Number).filter(Number.isFinite),
      ...event.evidenceRefs.filter(ref => /^event:\d+$/.test(ref)).map(ref => Number(ref.slice(6)))])],
    capturedAt: event.capturedAt,
    observedAt: event.capturedAt,
    ...(payload.validFrom ? { validFrom: payload.validFrom } : {}),
    ...(payload.validUntil ? { validUntil: payload.validUntil } : {}),
    ...(payload.effectiveAt ? { effectiveAt: payload.effectiveAt } : {}),
    ...(payload.timeShape ? { timeShape: payload.timeShape } : {}),
    ...(payload.parentEntityId ? { parentEntityId: payload.parentEntityId } : {}),
  };
}

function relationFromEvent(event: StoredEvent): WorldRelation | null {
  if (event.erased || !event.payload) return null;
  const payload = event.payload as RelationPayload;
  const rel = payload.relation;
  if (!rel?.type) return null;
  const fromId = entityFromRef(rel.from, rel.fromEntity, event.sourceId);
  const toId = entityFromRef(rel.to, rel.toEntity, event.sourceId);
  if (!fromId || !toId) return null;
  return {
    relationId: rel.id?.trim() || `relation:${event.sequence}`,
    fromId,
    type: rel.type,
    ...(rel.repairId ? { repairId: rel.repairId } : {}),
    toId,
    confidence: Math.max(0, Math.min(1, Number(rel.confidence ?? 1))),
    evidenceRefs: [...new Set([event.sequence, ...event.causationIds.map(Number).filter(Number.isFinite),
      ...event.evidenceRefs.filter(ref => /^event:\d+$/.test(ref)).map(ref => Number(ref.slice(6)))])],
    createdAt: event.capturedAt,
    ...(rel.validFrom ? { validFrom: rel.validFrom } : {}),
    ...(rel.validUntil ? { validUntil: rel.validUntil } : {}),
  };
}

function relationActive(relation: WorldRelation, now: Date): boolean {
  if (relation.supersededBy) return false;
  const from = relation.validFrom ? Date.parse(relation.validFrom) : Number.NaN;
  if (Number.isFinite(from) && from > now.getTime()) return false;
  const until = relation.validUntil ? Date.parse(relation.validUntil) : Number.NaN;
  if (Number.isFinite(until) && until <= now.getTime()) return false;
  return true;
}

function relationSupersedesClaim(state: WorldModelState, claim: WorldClaim, now: Date): string | undefined {
  const rel = state.relations.find((r) =>
    r.type === "supersedes" && r.toId === claim.claimId && relationActive(r, now)
  );
  return rel?.fromId;
}

function claimStatusValue(state: WorldModelState, entityId: string, now: Date): string | undefined {
  const claims = state.claims.filter((c) =>
    c.entityId === entityId && c.attribute === "status" && !c.supersededBy && !relationSupersedesClaim(state, c, now)
  );
  const visible = claims.filter((c) => {
    const status = temporalStatusOf(c, state, now, false).status;
    return status === "current" || status === "completed" || status === "cancelled";
  });
  return visible.sort((a,b) => AUTHORITY_RANK[b.authority] - AUTHORITY_RANK[a.authority] || Date.parse(b.capturedAt)-Date.parse(a.capturedAt))[0]?.value.toLowerCase();
}

function parentEntitiesForClaim(state: WorldModelState, claim: WorldClaim, now: Date): string[] {
  const out = new Set<string>();
  if (claim.parentEntityId) out.add(claim.parentEntityId);
  for (const rel of state.relations) {
    if (!relationActive(rel, now)) continue;
    if (rel.fromId !== claim.entityId) continue;
    if (rel.type === "valid_for" || rel.type === "part_of") out.add(rel.toId);
  }
  return [...out];
}

function temporalStatusOf(
  claim: WorldClaim,
  state: WorldModelState,
  now: Date,
  checkParent = true,
): { status: TemporalStatus; derivation: string[] } {
  const derivation: string[] = [];
  const supersededBy = claim.supersededBy ?? relationSupersedesClaim(state, claim, now);
  if (supersededBy) return { status: "superseded", derivation: [`superseded_by:${supersededBy}`] };

  const validFrom = claim.validFrom ? Date.parse(claim.validFrom) : Number.NaN;
  if (Number.isFinite(validFrom) && validFrom > now.getTime()) {
    return { status: "future", derivation: [`valid_from:${claim.validFrom}`] };
  }
  const validUntil = claim.validUntil ? Date.parse(claim.validUntil) : Number.NaN;
  if (Number.isFinite(validUntil) && validUntil <= now.getTime()) {
    return { status: "expired", derivation: [`valid_until:${claim.validUntil}`] };
  }

  if (claim.attribute === "status") {
    const value = claim.value.toLowerCase();
    if (value === "completed" || value === "done") return { status: "completed", derivation: ["status_claim:completed"] };
    if (value === "cancelled" || value === "canceled") return { status: "cancelled", derivation: ["status_claim:cancelled"] };
  }

  if (checkParent) {
    for (const parent of parentEntitiesForClaim(state, claim, now)) {
      const parentStatus = claimStatusValue(state, parent, now);
      if (parentStatus === "completed" || parentStatus === "done") {
        return { status: "expired", derivation: [`parent_completed:${parent}`] };
      }
      if (parentStatus === "cancelled" || parentStatus === "canceled") {
        return { status: "cancelled", derivation: [`parent_cancelled:${parent}`] };
      }
    }
  }

  if (claim.timeShape === "historical") return { status: "historical", derivation: ["time_shape:historical"] };
  return { status: "current", derivation };
}

function supersedeLesserClaims(claims: WorldClaim[], incoming: WorldClaim): void {
  if (incoming.repairId) return;
  if (incoming.authority !== "user_confirmed") return;
  for (let index = 0; index < claims.length; index++) {
    const existing = claims[index];
    if (
      !existing.supersededBy &&
      existing.entityId === incoming.entityId &&
      existing.attribute === incoming.attribute &&
      existing.scopeId === incoming.scopeId &&
      factTime(existing) <= factTime(incoming) &&
      AUTHORITY_RANK[existing.authority] < AUTHORITY_RANK[incoming.authority]
    ) {
      claims[index] = { ...existing, supersededBy: incoming.claimId };
    }
  }
}

export const worldModelProjector: Projector<WorldModelState> = {
  name: "world-model-v3",
  initialState: () => ({ claims: [], relations: [] }),
  apply(state, event) {
    const claims = state.claims.slice();
    const relations = state.relations.slice();
    const claim = claimFromEvent(event);
    if (claim) {
      supersedeLesserClaims(claims, claim);
      claims.push(claim);
    }
    const relation = relationFromEvent(event);
    if (relation) relations.push(relation);
    const retraction = event.payload?.knowledgeRetraction as { repairId?: string } | undefined;
    return {
      claims, relations,
      retractedRepairs: retraction?.repairId && !event.erased ? [...new Set([...(state.retractedRepairs ?? []), retraction.repairId])] : state.retractedRepairs,
      erasedSequences: event.erased ? [...(state.erasedSequences ?? []), event.sequence] : state.erasedSequences,
      governedScopeHashes: event.knowledgeScopeHash ? [...new Set([...(state.governedScopeHashes ?? []), event.knowledgeScopeHash])] : state.governedScopeHashes,
    };
  },
};

export function freshnessOf(claim: WorldClaim, config: FreshnessConfig): number {
  const captured = Date.parse(claim.observedAt ?? claim.capturedAt);
  if (!Number.isFinite(captured)) return 0;
  const ageDays = Math.max(0, (config.now.getTime() - captured) / 86_400_000);
  return Math.max(0, 1 - ageDays / config.halfLifeDays);
}

function visibleClaimsForKey(state: WorldModelState, entityId: string, attribute: string, now: Date): WorldClaim[] {
  return state.claims.filter((c) => {
    if (c.entityId !== entityId || c.attribute !== attribute) return false;
    return temporalStatusOf(c, state, now).status === "current";
  });
}

export function activeClaims(state: WorldModelState, now = new Date(), halfLifeDays = 14): DerivedClaim[] {
  return deriveWorldState(state, now, halfLifeDays).current;
}

export function conflictsFor(
  state: WorldModelState,
  entityId: string,
  attribute: string,
  now = new Date(),
): ConflictView | null {
  const visible = visibleClaimsForKey(state, entityId, attribute, now);
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

export function deriveWorldState(state: WorldModelState, now = new Date(), halfLifeDays = 14): DerivedWorldState {
  const retracted = new Set(state.retractedRepairs ?? []);
  const erased = new Set(state.erasedSequences ?? []);
  const excluded = (claim: WorldClaim) => !!claim.repairId && (retracted.has(claim.repairId) || claim.evidenceRefs.some((ref) => erased.has(ref)));
  const withdrawn = state.claims.filter(excluded);
  state = { ...state, claims: state.claims.filter((claim) => !excluded(claim)), relations: state.relations.filter((relation) => !relation.repairId || !retracted.has(relation.repairId) && !relation.evidenceRefs.some((ref) => erased.has(ref))) };
  const current: DerivedClaim[] = [];
  const historical: DerivedClaim[] = withdrawn.filter((claim) => !claim.evidenceRefs.some((ref) => erased.has(ref))).map((claim) => ({ ...claim, freshness: 0, disputed: false, temporalStatus: "historical", derivation: ["repair_retracted"] }));
  const byKey = new Map<string, DerivedClaim[]>();

  for (const claim of state.claims) {
    const temporal = temporalStatusOf(claim, state, now);
    const derived: DerivedClaim = {
      ...claim,
      temporalStatus: temporal.status,
      derivation: temporal.derivation,
      freshness: freshnessOf(claim, { now, halfLifeDays }),
      disputed: false,
    };
    if (temporal.status === "current") {
      const key = factKey(claim);
      const group = byKey.get(key) ?? [];
      group.push(derived);
      byKey.set(key, group);
    } else {
      historical.push(derived);
    }
  }

  const conflicts: ConflictView[] = [];
  for (const group of byKey.values()) {
    const sorted = group.slice().sort((a,b) => {
      const rank = AUTHORITY_RANK[b.authority]-AUTHORITY_RANK[a.authority];
      if (rank !== 0) return rank;
      return factTime(b)-factTime(a);
    });
    const seenValues = new Set<string>();
    const distinct = sorted.filter((c) => { const value=c.value.trim(); if (seenValues.has(value)) return false; seenValues.add(value); return true; });
    const timeSeries = ["branch","dirty","latest_commit","head","changed_files","ahead","behind"].includes(sorted[0].attribute);
    const winner = { ...sorted[0], disputed: distinct.length > 1 && !timeSeries };
    winner.evidenceRefs = [...new Set(sorted.filter((c) => c.value.trim() === winner.value.trim()).flatMap((c) => c.evidenceRefs))];
    current.push(winner);
    if (distinct.length > 1) {
      if (!timeSeries) conflicts.push({
        entityId: winner.entityId,
        attribute: winner.attribute,
        scopeId: winner.scopeId,
        status: "unresolved",
        active: winner,
        conflicting: distinct.filter((claim) => claim.value.trim() !== winner.value.trim()).map((claim) => ({ claim, authority: claim.authority })),
      });
      historical.push(...sorted.slice(1).map((c) => ({ ...c, disputed: true, temporalStatus: "historical" as const, derivation: [...c.derivation, "conflicting_non_winner"] })));
    }
  }

  const explicitConflictKeys = new Set(conflicts.map((conflict) => `${conflict.entityId}::${conflict.attribute}::${conflict.active.claimId}`));
  for (const rel of state.relations) {
    if (!relationActive(rel, now) || rel.type !== "contradicts") continue;
    const a = state.claims.find((claim) => claim.claimId === rel.fromId);
    const b = state.claims.find((claim) => claim.claimId === rel.toId);
    if (!a || !b) continue;
    const sorted = [a, b].sort((left, right) => {
      const rank = AUTHORITY_RANK[right.authority] - AUTHORITY_RANK[left.authority];
      if (rank !== 0) return rank;
      return Date.parse(right.capturedAt) - Date.parse(left.capturedAt);
    });
    const active = sorted[0];
    const other = sorted[1];
    const key = `${active.entityId}::${active.attribute}::${active.claimId}`;
    if (!explicitConflictKeys.has(key)) {
      conflicts.push({
        entityId: active.entityId,
        attribute: active.attribute,
        active,
        conflicting: [{ claim: other, authority: other.authority }],
      });
      explicitConflictKeys.add(key);
    }
    const currentClaim = current.find((claim) => claim.claimId === active.claimId);
    if (currentClaim) currentClaim.disputed = true;
  }

  const stale = new Set<string>();
  const unresolved = new Set<string>();
  const latestForEntity = (entityId: string): WorldClaim | undefined =>
    state.claims
      .filter((claim) => claim.entityId === entityId)
      .sort((a, b) => Date.parse(b.effectiveAt ?? b.observedAt ?? b.capturedAt) - Date.parse(a.effectiveAt ?? a.observedAt ?? a.capturedAt))[0];

  for (const rel of state.relations) {
    if (!relationActive(rel, now)) continue;
    if (rel.type === "depends_on") {
      const upstream = latestForEntity(rel.toId);
      const downstream = latestForEntity(rel.fromId);
      const upstreamAt = upstream ? Date.parse(upstream.effectiveAt ?? upstream.observedAt ?? upstream.capturedAt) : Number.NaN;
      const downstreamAt = downstream ? Date.parse(downstream.effectiveAt ?? downstream.observedAt ?? downstream.capturedAt) : Number.NaN;
      if (
        (Number.isFinite(upstreamAt) && (!Number.isFinite(downstreamAt) || upstreamAt > downstreamAt)) ||
        current.some((claim) => claim.entityId === rel.toId && claim.freshness < 0.25)
      ) {
        stale.add(rel.fromId);
      }
    }
    if (rel.type === "requires") {
      const status = claimStatusValue(state, rel.toId, now);
      if (!status || !["completed", "done", "resolved", "verified"].includes(status)) unresolved.add(rel.fromId);
    }
  }

  const governed = new Map(current.filter((c) => c.repairId).map((c) => [factKey(c), c]));
  const guardedScopes = new Set(state.governedScopeHashes ?? []);
  const effectiveCurrent = current.filter((claim) => {
      if (claim.repairId || claim.scopeId) return true;
      const legacy = groundedProperty(claim.value);
      if (!legacy) return true;
      const entityId = projectFactEntity(legacy.subject);
      const replacement = governed.get(factKey({ entityId, attribute: legacy.property, scopeId: entityId }));
      if (!replacement && !guardedScopes.has(knowledgeScopeHash(entityId, legacy.property)) || claim.parentEntityId !== entityId && claim.entityId !== entityId) return true;
      if (!replacement) return false; // Erasure cannot resurrect an old compatibility claim.
      historical.push({ ...claim, temporalStatus: "superseded", derivation: [...claim.derivation, `governed_by:${replacement.claimId}`] });
      return false;
    });
  const effectiveIds = new Set(effectiveCurrent.map((claim) => claim.claimId));
  return {
    now: now.toISOString(),
    current: effectiveCurrent.sort((a,b) => a.entityId.localeCompare(b.entityId) || a.attribute.localeCompare(b.attribute)),
    historical: historical.sort((a,b) => Date.parse(b.capturedAt)-Date.parse(a.capturedAt)),
    conflicts: conflicts.filter((conflict) => effectiveIds.has(conflict.active.claimId)),
    relations: state.relations.filter((r) => relationActive(r, now)),
    staleEntityIds: [...stale],
    unresolvedEntityIds: [...unresolved],
    governedScopeHashes: state.governedScopeHashes,
  };
}

export function epistemicConfidence(claim: WorldClaim): Authority {
  return claim.authority;
}
