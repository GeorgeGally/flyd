import type { InitiativeCandidate, InitiativeSource } from "./candidates.js";
import { initiativeRevision } from "./candidates.js";

/** A local first-pass only. Never a model-issued authority grant. */
export type InitiativeDisposition = "discard" | "hold" | "investigate";
export interface InitiativeDecision {
  candidateId: string;
  revision: string;
  disposition: InitiativeDisposition;
  score: number;
  reason: string;
  attention: "silent" | "ambient";
  whyNow: string;
  whyMe: string;
  policyVersion: "initiative.v1";
}
export interface InitiativeFinding {
  candidateId: string;
  revision: string;
  status: "hypothesis";
  question: string;
  whatIsKnown: string;
  whatIsNotKnown: string;
  nextCheck: string;
  evidenceRefs: string[];
  /** A well-formed hypothesis is not a verified project outcome. */
  verified: false;
}

export function initiativeScore(c: InitiativeCandidate): number {
  const bounded = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
  const relevance = bounded(c.benefit) * bounded(c.confidence);
  const surprise = bounded(c.novelty) * 0.15;
  const cost = bounded(c.effort) * 0.22;
  const urgency = bounded(c.urgency) * 0.08;
  return Number((relevance + surprise + urgency - cost).toFixed(4));
}

export interface InitiativePolicy {
  /** Existing source/consent eligibility must be checked again before output. */
  allowed: (source: InitiativeSource) => boolean;
  /** Read-only source keys already being investigated by CoS. */
  activeQuestions?: ReadonlySet<string>;
  /** Caller may only ambiently show already grounded findings in 'on' mode. */
  mode: "shadow" | "on";
  /** Silent local curiosity can use a higher daily budget than showing cards. */
  minScore?: number;
}

/**
 * One deterministic disposition shared by both active and shadow modes.
 * Notification and worker dispatch intentionally do not exist in this API.
 */
export function decideInitiative(candidate: InitiativeCandidate, policy: InitiativePolicy): InitiativeDecision {
  const revision = initiativeRevision(candidate.sources);
  const score = initiativeScore(candidate);
  const valid = candidate.sources.every(policy.allowed);
  const hasEvidence = candidate.sources.every(s => s.id && s.revision && s.evidenceRef);
  const duplicate = policy.activeQuestions?.has(candidate.id) ?? false;
  const disposition: InitiativeDisposition = !valid || !hasEvidence ? "discard"
    : duplicate ? "hold"
    : score < (policy.minScore ?? 0.3) ? "hold"
    : "investigate";
  const reason = !valid ? "source_permission_revoked"
    : !hasEvidence ? "missing_evidence"
    : duplicate ? "already_in_active_work"
    : disposition === "hold" ? "low_value_of_information" : "grounded_low_cost_question";
  return {
    candidateId: candidate.id, revision, disposition, score, reason,
    attention: disposition === "investigate" && policy.mode === "on"
      && candidate.sources.length >= 2 && score >= 0.4 ? "ambient" : "silent",
    whyNow: candidate.question,
    whyMe: candidate.subject,
    policyVersion: "initiative.v1",
  };
}

/**
 * A deliberately humble evidence-only investigation. It establishes what
 * could be tested from existing source identities without pretending to have
 * read a remote page, inspected a private repo or proven a model hypothesis.
 */
export function inspectInitiative(candidate: InitiativeCandidate): InitiativeFinding {
  const evidenceRefs = [...new Set(candidate.sources.map(s => s.evidenceRef))];
  const observations = candidate.observed.filter(Boolean).slice(0, 3).map(s => s.slice(0, 200));
  return {
    candidateId: candidate.id, revision: initiativeRevision(candidate.sources),
    status: "hypothesis", verified: false,
    question: candidate.question,
    whatIsKnown: observations.join(" | "),
    whatIsNotKnown: candidate.counterQuestion,
    nextCheck: candidate.proposedTest,
    evidenceRefs,
  };
}

/** No authority or execution fields allowed in persisted proposals. */
export function safeInitiativePayload(candidate: InitiativeCandidate, finding: InitiativeFinding): Record<string, unknown> {
  return {
    candidate_id: candidate.id,
    revision: finding.revision,
    origin: candidate.origin,
    domain: candidate.domain,
    subject: candidate.subject,
    question: finding.question,
    known: finding.whatIsKnown,
    unknown: finding.whatIsNotKnown,
    next_check: finding.nextCheck,
    verified: false,
    expires_at: candidate.expiresAt,
    sources: candidate.sources.map(s => ({ id: s.id, revision: s.revision, scope: s.scope })),
  };
}
