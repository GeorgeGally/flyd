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

export type TemporalStatus =
  | "future"
  | "current"
  | "expired"
  | "completed"
  | "cancelled"
  | "superseded"
  | "historical"
  | "unknown";

export type TimeShape =
  | "durable"
  | "temporary"
  | "deadline_bound"
  | "event_bound"
  | "state"
  | "historical";

export type WorldRelationType =
  | "supports"
  | "contradicts"
  | "supersedes"
  | "requires"
  | "depends_on"
  | "caused_by"
  | "part_of"
  | "instance_of"
  | "resolved_by"
  | "valid_for"
  | "implemented_by"
  | "verified_by"
  | "motivates"
  | "has_problem";

export interface WorldRelation {
  relationId: string;
  fromId: string;
  type: WorldRelationType;
  toId: string;
  confidence: number;
  evidenceRefs: number[];
  createdAt: string;
  validFrom?: string;
  validUntil?: string;
  supersededBy?: string;
}

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
  observedAt?: string;
  validFrom?: string;
  validUntil?: string;
  effectiveAt?: string;
  timeShape?: TimeShape;
  temporalStatus?: TemporalStatus;
  parentEntityId?: string;
  /** Set when a later claim supersedes this one. */
  supersededBy?: string;
}

export interface WorldEntity {
  id: string;
  kind:
    | "project"
    | "artifact"
    | "person"
    | "organization"
    | "topic"
    | "goal"
    | "task"
    | "event"
    | "feature"
    | "requirement"
    | "file"
    | "product"
    | "generic";
  label: string;
  aliases?: string[];
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

/** Shared confidence vocabulary for derived planning state. */
export type PlanningConfidence = "high" | "medium" | "low" | "unknown";

/**
 * A planning snapshot field is a projection of canonical/observed state, not a
 * new source of truth. Provenance records where the value came from.
 */
export interface StateFact<T = unknown> {
  value: T;
  confidence: PlanningConfidence;
  freshness?: string;
  provenance: string[];
}

/**
 * Point-in-time world projection used for consequence prediction. It may only
 * be persisted at an explicit INVOKED/agent-action boundary; ambient PRESENT
 * observation remains zero-persistence.
 */
export interface WorldStateSnapshot {
  id: string;
  capturedAt: string;
  projectId?: string;
  activeProjects: StateFact<string[]>;
  activeTasks: StateFact<Array<{ id?: string; description: string; status: string }>>;
  repoStates: StateFact<Array<{ root: string; branch?: string; dirty: boolean; head?: string }>>;
  blockers: StateFact<string[]>;
  decisions: StateFact<string[]>;
  commitments: StateFact<string[]>;
  entities: StateFact<string[]>;
  deadlines: StateFact<string[]>;
  agentWork: StateFact<string[]>;
}
