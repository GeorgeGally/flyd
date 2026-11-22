import type { IntelligenceEventStore } from "../event-store.js";
import { validateEnvelope } from "../context-envelope.js";
import { parseExecutiveDecision } from "../executive/decision-step.js";

/**
 * The user's own rating of a source-verified result. This is NOT a verified
 * outcome, measured impact, or permission to promote an autonomous policy.
 * Only an explicit review action can write to this source.
 */
export const OUTCOME_REVIEW_SOURCE = "executive.outcome-review";
export type OutcomeReviewVerdict = "helpful" | "not_helpful";
export const OUTCOME_REVIEW_WINDOW_MS = 14 * 86_400_000;

export interface OutcomeReviewCandidate {
  decisionId: string;
  summary: string;
  at: string;
  /** An independently checked effect, not necessarily useful to the user. */
  verification: "verified";
  /** A URL only if the source already supplied a safe HTTPS page. */
  url?: string;
}

export interface OutcomeReview {
  decisionId: string;
  verdict: OutcomeReviewVerdict;
  at: string;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseReview(value: unknown): OutcomeReview | null {
  const item = object(value);
  return item && typeof item.decisionId === "string" && /^[a-f0-9]{32}$/.test(item.decisionId)
    && (item.verdict === "helpful" || item.verdict === "not_helpful")
    && typeof item.at === "string" && Number.isFinite(Date.parse(item.at))
    ? { decisionId: item.decisionId, verdict: item.verdict, at: item.at }
    : null;
}

/** Latest explicit user rating wins; an erased review stops influencing the view. */
export function outcomeReviews(store: IntelligenceEventStore, limit = 300): Map<string, OutcomeReview> {
  const reviews = new Map<string, OutcomeReview>();
  for (const event of store.readSourcePage(OUTCOME_REVIEW_SOURCE, { limit })) {
    const review = parseReview(event.payload?.review);
    if (review && !reviews.has(review.decisionId)) reviews.set(review.decisionId, review);
  }
  return reviews;
}

/**
 * Only an existing, user-facing, independently verified executive result can
 * request a rating. This source is never scored by a model or inferred from
 * a worker's "done" text.
 */
export function outcomeReviewCandidates(store: IntelligenceEventStore, now = new Date(), limit = 2): OutcomeReviewCandidate[] {
  const seen = new Set<string>();
  const reviewed = outcomeReviews(store);
  const candidates: OutcomeReviewCandidate[] = [];
  for (const event of store.readSourcePage("executive.cycle", { limit: 300 })) {
    const decision = parseExecutiveDecision(event.payload?.decision);
    if (!decision || seen.has(decision.decisionId)) continue;
    seen.add(decision.decisionId);
    if (!decision.show || decision.disposition !== "handle_internally"
      || decision.verification.status !== "verified"
      || !decision.verification.evidenceRefs.length
      || reviewed.has(decision.decisionId)) continue;
    const at = Date.parse(decision.createdAt);
    if (!Number.isFinite(at) || now.getTime() - at < 0 || now.getTime() - at > OUTCOME_REVIEW_WINDOW_MS) continue;
    const summary = decision.summary.replace(/\s+/g, " ").trim();
    if (!summary || summary.length > 240) continue;
    const url = decision.delivery?.url;
    candidates.push({
      decisionId: decision.decisionId,
      summary, at: decision.createdAt, verification: "verified",
      ...(typeof url === "string" && /^https:\/\/[^@\s]+$/i.test(url) ? { url } : {}),
    });
    if (candidates.length >= Math.max(1, Math.min(2, limit))) break;
  }
  return candidates;
}

export type ReviewRecordResult = "recorded" | "already_recorded" | "not_eligible";

/** Idempotent per decision and verdict. A correction appends another event; neither is a measured effect. */
export function recordExplicitOutcomeReview(
  store: IntelligenceEventStore,
  input: { decisionId: string; verdict: OutcomeReviewVerdict; at?: Date },
): ReviewRecordResult {
  if (!/^[a-f0-9]{32}$/.test(input.decisionId) || !["helpful", "not_helpful"].includes(input.verdict)) {
    return "not_eligible";
  }
  const at = input.at ?? new Date();
  // Recheck the actual source on every write, including corrections. An
  // erased or downgraded decision can never be rated just because an old
  // review still exists.
  const live = store.readSourcePage("executive.cycle", { limit: 300 })
    .map((event) => parseExecutiveDecision(event.payload?.decision))
    .find((decision) => decision?.decisionId === input.decisionId);
  const createdAt = Date.parse(live?.createdAt ?? "");
  if (!live || !live.show || live.disposition !== "handle_internally"
    || live.verification.status !== "verified"
    || !live.verification.evidenceRefs.length
    || !Number.isFinite(createdAt) || at.getTime() < createdAt
    || at.getTime() - createdAt > OUTCOME_REVIEW_WINDOW_MS) return "not_eligible";

  const prior = store.readByIdempotencyPrefix(OUTCOME_REVIEW_SOURCE, "review:" + input.decisionId + ":");
  const last = prior.at(-1);
  if (parseReview(last?.payload?.review)?.verdict === input.verdict) return "already_recorded";
  // A user can correct either way. Stable revision numbers make same-verdict
  // retries idempotent while leaving the prior opinion inspectable.
  // Erasure keeps non-readable idempotency tombstones. If the source was
  // explicitly renewed, do not collide with an earlier erased revision and
  // silently report success without creating a readable review.
  let revision = prior.length + 1;
  while (store.findByIdempotencyKey(OUTCOME_REVIEW_SOURCE, "review:" + input.decisionId + ":" + revision)) {
    revision += 1;
  }
  const key = "review:" + input.decisionId + ":" + revision;
  const envelope = {
    pathKind: "interface" as const,
    kind: "observation" as const,
    sourceId: OUTCOME_REVIEW_SOURCE,
    consent: { grantedAt: at.toISOString(), scopes: ["explicit.user.review"] },
    retentionClass: "local_default" as const,
    payloadClassification: "operational" as const,
    provenance: "user:outcome-review.v1",
    idempotencyKey: key,
    correlationId: input.decisionId,
    evidenceRefs: ["executive:" + input.decisionId],
    policyVersion: "outcome-review.v1",
    payload: { review: { decisionId: input.decisionId, verdict: input.verdict, at: at.toISOString() } },
  };
  const verified = validateEnvelope(envelope, { consentLookup: store });
  if (!verified.ok) return "not_eligible";
  store.append(envelope);
  return "recorded";
}
