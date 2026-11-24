import { readFileSync } from "node:fs";
import { activityRecordPath, type ActivityRecord } from "../../conversation-view/activity.js";
import type { IntelligenceEventStore, StoredEvent } from "../../intelligence/event-store.js";
import { validateEnvelope, type ContextEnvelope } from "../../intelligence/context-envelope.js";
import { INITIATIVE_CURATED_CONTRACT, SourceContractRegistry } from "../../intelligence/sensors/source-contracts.js";
import { currentInitiativeEvidence, initiativeSourcesCurrent } from "./source-validity.js";
import type { InitiativeSource } from "./candidates.js";

export type InitiativeReviewVerdict = "helpful" | "not_helpful";
export interface InitiativeReview {
  candidateId: string;
  verdict: InitiativeReviewVerdict;
  at: string;
  /** An explicit human reaction is NOT a verified external effect. */
  effect: "unknown";
}
export interface InitiativeOutcomeItem {
  candidateId: string;
  researched: boolean;
  evidenceStatus?: string;
  verifiedExternalImpact: false;
  researchCalls: number;
  modelCalls: number;
  reviewed?: InitiativeReviewVerdict;
  /** The activity writer is not a verified display/acknowledgment receipt. */
  delivery: "unknown";
}

const SOURCE = INITIATIVE_CURATED_CONTRACT.sourceId;
function validCandidateId(id: string): boolean { return /^[a-f0-9]{24}$/.test(id); }
function lastResearchByCandidate(events: StoredEvent[]): Map<string, StoredEvent> {
  const seen = new Map<string, StoredEvent>();
  for (const event of [...events].reverse()) {
    if (event.erased || event.kind !== "inferred_belief" || event.payload?.type !== "investigation") continue;
    const id = event.payload.candidate_id;
    if (typeof id === "string" && validCandidateId(id)) seen.set(id, event);
  }
  return seen;
}
export function initiativeReviews(events: StoredEvent[]): Map<string, InitiativeReview> {
  const result = new Map<string, InitiativeReview>();
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    const p = event.payload;
    if (event.erased || p?.type !== "initiative_review") continue;
    if (!validCandidateId(p.candidate_id as string)
      || (p.verdict !== "helpful" && p.verdict !== "not_helpful")) continue;
    result.set(p.candidate_id as string, {
      candidateId: p.candidate_id as string, verdict: p.verdict,
      at: event.capturedAt, effect: "unknown",
    });
  }
  return result;
}
export function initiativeOutcomeProjection(events: StoredEvent[]): InitiativeOutcomeItem[] {
  const found = lastResearchByCandidate(events);
  const reviews = initiativeReviews(events);
  const cases = new Set([...found.keys(), ...reviews.keys()]);
  return [...cases].map(candidateId => {
    const e = found.get(candidateId);
    const p = e?.payload;
    return {
      candidateId,
      researched: Boolean(e),
      ...(typeof p?.epistemic_status === "string" ? { evidenceStatus: p.epistemic_status } : {}),
      verifiedExternalImpact: false as const,
      researchCalls: typeof p?.research_calls === "number" && Number.isFinite(p.research_calls) ? p.research_calls : 0,
      modelCalls: typeof p?.model_calls === "number" && Number.isFinite(p.model_calls) ? p.model_calls : 0,
      ...(reviews.has(candidateId) ? { reviewed: reviews.get(candidateId)!.verdict } : {}),
      delivery: "unknown" as const,
    };
  });
}
export function summarizeInitiativeOutcomes(events: StoredEvent[]) {
  const items = initiativeOutcomeProjection(events);
  return {
    candidatesWithResearch: items.filter(x => x.researched).length,
    independentlyCorroboratedPublicTopics: items.filter(x => x.evidenceStatus === "source_confirmed").length,
    inconclusiveOrContradicted: items.filter(x => x.researched && x.evidenceStatus !== "source_confirmed").length,
    explicitHelpfulReviews: items.filter(x => x.reviewed === "helpful").length,
    explicitNotHelpfulReviews: items.filter(x => x.reviewed === "not_helpful").length,
    unknownExternalImpact: items.length,
    verifiedExternalImpact: 0,
    reportedPublicResearchCalls: items.reduce((sum, x) => sum + x.researchCalls, 0),
    reportedPublicSynthesisModelCalls: items.reduce((sum, x) => sum + x.modelCalls, 0),
    modelMonetarySpend: "unknown_without_provider_metering" as const,
  };
}

/**
 * Three different explicit negative reviews of findings about the SAME
 * project quiet only that project's optional future insight cards for seven
 * days. This is a subject-specific attention preference, NOT a new source
 * fact, a changed authorization, or proof of low external impact.
 *
 * A later explicitly helpful review resets the sequence. Ignoring a card
 * creates no review event and can never mute a project.
 */
export function projectInitiativeQuietUntil(
  events: StoredEvent[], projectId: string, now = new Date(),
): string | null {
  if (!projectId || !/^[a-zA-Z0-9-]{1,90}$/.test(projectId)) return null;
  const key = "project:" + projectId;
  const last = new Map<string, { verdict: InitiativeReviewVerdict; at: number }>();
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    const p = event.payload;
    if (event.erased || p?.type !== "initiative_review"
      || typeof p.candidate_id !== "string"
      || !Array.isArray(p.source_keys) || !p.source_keys.includes(key)
      || (p.verdict !== "helpful" && p.verdict !== "not_helpful")) continue;
    const at = Date.parse(event.capturedAt);
    if (Number.isFinite(at) && at <= now.getTime() && at >= now.getTime() - 30 * 86_400_000) {
      last.set(p.candidate_id, { verdict: p.verdict, at });
    }
  }
  const reviews = [...last.values()].sort((a, b) => a.at - b.at);
  const lastHelpful = reviews.filter(r => r.verdict === "helpful").at(-1)?.at ?? -Infinity;
  const negatives = reviews.filter(r => r.verdict === "not_helpful" && r.at > lastHelpful);
  if (negatives.length < 3) return null;
  const until = new Date(negatives[2]!.at + 7 * 86_400_000);
  return until.getTime() > now.getTime() ? until.toISOString() : null;
}

/**
 * Explicit user-triggered CLI review; only a recent, actually prepared
 * research card can be reviewed. Prepared ≠ read ≠ independently useful.
 */
export function recordInitiativeReview(input: {
  store: IntelligenceEventStore;
  registry: SourceContractRegistry;
  candidateId: string;
  verdict: InitiativeReviewVerdict;
  now?: Date;
  activityPath?: string;
  currentSources?: (refs: InitiativeSource[]) => boolean;
}): "recorded" | "already_recorded" | "not_eligible" {
  const { store, registry, candidateId, verdict } = input;
  if (!validCandidateId(candidateId) || (verdict !== "helpful" && verdict !== "not_helpful")
    || registry.status(SOURCE) !== "enabled" || store.isRevoked(SOURCE)) return "not_eligible";
  const now = input.now ?? new Date();
  const events = store.readSourcePage(SOURCE, { limit: 1000 });
  const research = events.find(e => e.kind === "inferred_belief" && e.payload?.type === "investigation"
    && e.payload.candidate_id === candidateId && Date.parse(e.capturedAt) >= now.getTime() - 14 * 86_400_000);
  if (!research || !Array.isArray(research.payload?.sources)) return "not_eligible";
  const live = input.currentSources ?? ((refs: InitiativeSource[]) => initiativeSourcesCurrent(refs, currentInitiativeEvidence()));
  if (!live(research.payload.sources as InitiativeSource[])) return "not_eligible";
  let prepared = false;
  try {
    prepared = readFileSync(input.activityPath ?? activityRecordPath(), "utf8")
      .split("\n").some(line => {
        try {
          const rec = JSON.parse(line) as ActivityRecord;
          return rec.key?.startsWith("initiative:research:" + candidateId + ":")
            && typeof rec.at === "string" && Date.parse(rec.at) <= now.getTime();
        } catch { return false; }
      });
  } catch { /* no prepared card */ }
  if (!prepared) return "not_eligible";
  const previous = initiativeReviews(events).get(candidateId);
  if (previous?.verdict === verdict) return "already_recorded";
  let version = events.filter(e => e.payload?.type === "initiative_review"
    && e.payload.candidate_id === candidateId).length + 1;
  while (store.findByIdempotencyKey(SOURCE, "review:" + candidateId + ":" + version)) version++;
  const envelope: ContextEnvelope = {
    pathKind: "interface", kind: "observation", sourceId: SOURCE,
    consent: { grantedAt: now.toISOString(), scopes: [...INITIATIVE_CURATED_CONTRACT.scopes] },
    retentionClass: "local_default", payloadClassification: "operational",
    provenance: "explicit-user:initiative-review", idempotencyKey: "review:" + candidateId + ":" + version,
    correlationId: candidateId, evidenceRefs: ["event:" + research.id],
    payload: {
      type: "initiative_review", candidate_id: candidateId, verdict, effect: "unknown",
      revision: research.payload?.source_revision,
      sources: research.payload?.sources,
      source_keys: (research.payload?.sources as InitiativeSource[]).map(s => s.id),
    },
  };
  if (!validateEnvelope(envelope, { consentLookup: store }).ok) return "not_eligible";
  return store.append(envelope) ? "recorded" : "not_eligible";
}
