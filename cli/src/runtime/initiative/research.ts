import { EvidenceEngine } from "../../evidence/evidence-engine.js";
import { extractEvidenceConflicts } from "../../evidence/contradictions.js";
import { createDefaultEvidenceRegistry } from "../../evidence/default-registry.js";
import type { EvidenceBundle, EvidenceItem, ResearchDepth } from "../../evidence/types.js";
import { EgressPolicyGateway } from "../../intelligence/egress-policy-gateway.js";
import {
  INITIATIVE_PUBLIC_RESEARCH_CONTRACT,
  SourceContractRegistry,
} from "../../intelligence/sensors/source-contracts.js";
import type { ContextEnvelope } from "../../intelligence/context-envelope.js";
import { scoutItemRevision } from "./lineage.js";
import { safePublicLocator } from "./public-url.js";
export { safePublicLocator } from "./public-url.js";
import { synthesizePublicEvidence, type PublicModelInterpretation } from "./public-synthesis.js";
import { initiativeRevision, type InitiativeCandidate } from "./candidates.js";
import type { Edition, EditionItem } from "../../council/scout.js";

const PURPOSE = "initiative-background-research";
const DESTINATION = "evidence:public";
const MAX_QUERY = 160;
const MAX_PUBLIC_EVIDENCE = 5;
const RESEARCH_POLICY = "initiative.research.v1";
const PUBLIC_RESEARCH_GRANT_MS = 90 * 86_400_000;

/** A standing public-only grant is time-bounded, not indefinite. */
export function publicResearchConsentCurrent(registry: SourceContractRegistry, now = new Date()): boolean {
  const grant = registry.list().find(item => item.contract.sourceId === INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId);
  if (!grant || grant.state.status !== "enabled") return false;
  const at = Date.parse(grant.state.changedAt);
  return Number.isFinite(at) && at <= now.getTime() + 60_000
    && now.getTime() - at <= PUBLIC_RESEARCH_GRANT_MS;
}


export type InitiativeResearchStatus =
  | "source_confirmed" | "inconclusive" | "no_evidence"
  | "contradictory" | "not_permitted" | "stale" | "failed";

export interface InitiativeResearchReceipt {
  candidateId: string;
  sourceRevision: string;
  policyVersion: typeof RESEARCH_POLICY;
  status: InitiativeResearchStatus;
  /** This only describes the public reference. It is NOT proof of project improvement. */
  checkedClaim: string;
  finding: string;
  counterEvidence: string[];
  citedEvidence: Array<{ id: string; title: string; url: string; host: string }>;
  gaps: string[];
  searchedAt: string;
  researchCalls: number;
  elapsedMs: number;
  /** Never fabricate absent monetary/token metering. */
  monetaryCost?: number;
  stopReason: string;
  privateComparisonNeeded: boolean;
  /** Optional public-only model interpretation: never independent fact verification. */
  publicInterpretation?: PublicModelInterpretation;
  modelCalls?: number;
}

export interface InitiativeResearchDeps {
  now?: () => Date;
  registry?: SourceContractRegistry;
  engine?: Pick<EvidenceEngine, "research">;
  maxWallMs?: number;
  publicSynthesis?: typeof synthesizePublicEvidence;
}


function eligibleItem(candidate: InitiativeCandidate, edition: Edition | null): EditionItem | null {
  if (!edition || candidate.origin !== "scout") return null;
  const publicSource = candidate.sources.find(s => s.scope === "public" && s.id.startsWith("scout:"));
  if (!publicSource) return null;
  return edition.items.find(item =>
    "scout:" + (item.storyId ?? item.url) === publicSource.id
    && scoutItemRevision(item) === publicSource.revision
    && item.url === publicSource.evidenceRef) ?? null;
}

function evidenceHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

function tokenSet(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
    .filter(w => !["with", "from", "that", "this", "their", "about", "have", "will"].includes(w)));
}
function matchingPublicItem(item: EditionItem, evidence: EvidenceItem): boolean {
  const target = tokenSet(item.title);
  const actual = tokenSet([evidence.title ?? "", evidence.content.slice(0, 280)].join(" "));
  return [...target].filter(token => actual.has(token)).length >= Math.min(2, target.size);
}

/** A public item supplies the public query; the private candidate never does. */
export function publicResearchInput(candidate: InitiativeCandidate, edition: Edition | null):
  { query: string; locator: string } | null {
  const item = eligibleItem(candidate, edition);
  const locator = item && safePublicLocator(item.url);
  if (!item || !locator) return null;
  const query = item.title.replace(/[\n\r\t<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
  if (query.length < 8 || /(?:password|token|apikey|private repo|secret|credential)/i.test(query)) return null;
  // A public headline must not accidentally disclose the private project
  // name as a targeted search (the fetched URL itself is still public).
  const named = candidate.subject.trim();
  if (named.length >= 4 && query.toLowerCase().includes(named.toLowerCase())) return null;
  return { query, locator };
}

/**
 * Real evidence retrieval, permissioned separately from the local
 * "initiative.curated" LEARN contract. Only public Scout titles and URLs
 * cross the public evidence boundary. No model receives project details.
 */
export async function researchInitiative(
  candidate: InitiativeCandidate,
  edition: Edition | null,
  deps: InitiativeResearchDeps = {},
): Promise<InitiativeResearchReceipt> {
  const now = deps.now?.() ?? new Date();
  const started = Date.now();
  const base = {
    candidateId: candidate.id, sourceRevision: initiativeRevision(candidate.sources),
    policyVersion: RESEARCH_POLICY as typeof RESEARCH_POLICY,
    checkedClaim: "What does the cited public reference actually document?",
    citedEvidence: [] as InitiativeResearchReceipt["citedEvidence"],
    counterEvidence: [] as string[], gaps: [] as string[],
    searchedAt: now.toISOString(), researchCalls: 0,
    privateComparisonNeeded: true,
  };
  const finish = (
    status: InitiativeResearchStatus,
    finding: string,
    stopReason: string,
    more: Partial<InitiativeResearchReceipt> = {},
  ): InitiativeResearchReceipt => ({
    ...base, status, finding, stopReason, elapsedMs: Date.now() - started, ...more,
  });
  const registry = deps.registry ?? new SourceContractRegistry();
  registry.register(INITIATIVE_PUBLIC_RESEARCH_CONTRACT);
  if (!publicResearchConsentCurrent(registry, now)) {
    return finish("not_permitted", "Public research opt-in is disabled or expired.", "source_consent_required_or_expired");
  }
  const input = publicResearchInput(candidate, edition);
  if (!input) return finish("stale", "Public source is missing, unsafe, or its revision changed.", "invalid_public_source");

  const envelope: ContextEnvelope = {
    pathKind: "executive", kind: "observation", sourceId: INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId,
    consent: { grantedAt: now.toISOString(), scopes: [...INITIATIVE_PUBLIC_RESEARCH_CONTRACT.scopes] },
    retentionClass: "local_default", payloadClassification: "operational",
    provenance: "public-scout-only", idempotencyKey: "research-query:" + candidate.id,
  };
  const gateway = new EgressPolicyGateway(
    { isRevoked: source => source === INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId
      && registry.status(source) !== "enabled" },
    source => source === INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId
      ? { enabled: registry.status(source) === "enabled",
        destinations: INITIATIVE_PUBLIC_RESEARCH_CONTRACT.egressDestinations,
        purposes: [PURPOSE] } : null,
  );
  const receipt = gateway.check(envelope, {
    destination: DESTINATION, purpose: PURPOSE,
    fields: ["query", "locators"],
    payload: { query: input.query, locators: [input.locator] },
    schema: { allowedFields: ["query", "locators"], maxPayloadBytes: 4096 },
  }, now);
  if (!receipt.allowed || !receipt.outboundPayload) {
    return finish("not_permitted", "Public search blocked by egress policy.", receipt.reason ?? "egress_denied");
  }
  // Read ONLY the gateway-approved query. Candidate.subject, hypothesis and
  // local observations are deliberately unavailable to the public engine.
  const publicQuery = receipt.outboundPayload.query;
  const publicLocators = receipt.outboundPayload.locators;
  if (typeof publicQuery !== "string" || !Array.isArray(publicLocators)
    || publicLocators.some(url => typeof url !== "string" || !safePublicLocator(url))) {
    return finish("not_permitted", "Egress projection is invalid.", "invalid_projection");
  }
  const engine = deps.engine ?? new EvidenceEngine(createDefaultEvidenceRegistry());
  let evidence: EvidenceBundle;
  const maxWall = Math.max(1_000, Math.min(45_000, deps.maxWallMs ?? 20_000));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // This deadline bounds Flyd's reply; underlying evidence adapters do
    // not yet accept an AbortSignal. Do not claim the provider was cancelled.
    evidence = await Promise.race([
      engine.research(publicQuery, "quick" satisfies ResearchDepth,
        { locators: publicLocators as string[], includeSearch: true }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("evidence_timeout")), maxWall);
        timeout.unref?.();
      }),
    ]);
  } catch (error) {
    return finish("failed", "Public evidence research did not complete.",
      error instanceof Error ? error.message.slice(0, 120) : "research_error",
      { researchCalls: 1 });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  if (!publicResearchConsentCurrent(registry, new Date())) {
    return finish("not_permitted", "Public research permission was revoked or expired before completion.", "consent_revoked_after_fetch",
      { researchCalls: 1 });
  }
  const item = eligibleItem(candidate, edition);
  if (!item) return finish("stale", "The public source changed during research.", "source_changed", { researchCalls: 1 });

  // Two domains are not two independent sources if both carry the same
  // syndicated document. Check distinct public hosts AND material extracts.
  const seenHosts = new Set<string>();
  const seenDocuments = new Set<string>();
  const matches = evidence.evidence.filter(row => matchingPublicItem(item, row))
    .filter(row => {
      if (!row.locator || !safePublicLocator(row.locator)) return false;
      const host = evidenceHost(row.locator);
      const text = `${row.title ?? ""} ${row.content}`.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 1_200);
      if (!host || !text || seenHosts.has(host) || seenDocuments.has(text)) return false;
      seenHosts.add(host);
      seenDocuments.add(text);
      return true;
    })
    .slice(0, MAX_PUBLIC_EVIDENCE);
  const linked = matches.map(row => ({
    id: row.id,
    title: (row.title ?? "Public evidence").replace(/\s+/g, " ").slice(0, 130),
    url: safePublicLocator(row.locator!)!,
    host: evidenceHost(row.locator!),
  }));
  const hosts = new Set(linked.map(x => x.host).filter(Boolean));
  const gaps = evidence.gaps.map(g => g.code).slice(0, 5);
  // Quick EvidenceEngine runs do not populate conflicts. Reuse its existing
  // contradiction analyzer here instead of falsely treating [] as agreement.
  const matchedIds = new Set(matches.map(row => row.id));
  const conflicts = [...evidence.conflicts, ...extractEvidenceConflicts(matches)]
    .filter(conflict => matchedIds.has(conflict.left) && matchedIds.has(conflict.right));
  const contradicted = conflicts.length > 0;
  // Separate model opt-in. The model sees ONLY fetched PUBLIC article snippets
  // (not the project name, local observations, original candidate or mandate).
  const publicSynthesis = matches.length
    ? await (deps.publicSynthesis ?? synthesizePublicEvidence)(item.title, matches,
        { registry, now: () => now })
    : { interpretation: null, modelCalls: 0, stopReason: "no_public_evidence" };
  const status: InitiativeResearchStatus = contradicted ? "contradictory"
    : hosts.size >= 2 ? "source_confirmed"
    : linked.length ? "inconclusive" : "no_evidence";
  return finish(status,
    status === "source_confirmed"
      ? "Independent public references support the topic; its value for this project has NOT been demonstrated."
      : status === "contradictory"
        ? "Retrieved public evidence conflicts; no confident conclusion is warranted."
        : linked.length ? "A public source discusses the subject, but independent corroboration is insufficient."
          : "No topic-matching evidence was recovered; the hypothesis remains open.",
    status === "source_confirmed" ? "public_topic_correlated"
      : status === "contradictory" ? "contradictory_evidence"
        : linked.length ? "insufficient_independent_sources" : "no_matching_evidence",
    { citedEvidence: linked, gaps, researchCalls: 1,
      ...(publicSynthesis.interpretation ? { publicInterpretation: publicSynthesis.interpretation } : {}),
      modelCalls: publicSynthesis.modelCalls,
      counterEvidence: conflicts.map(c => c.reason.slice(0, 180)).slice(0, 3) });
}

/** Bounded event payload; no arbitrary raw pages, model instructions or bytes. */
export function safeResearchPayload(result: InitiativeResearchReceipt): Record<string, unknown> {
  return {
    candidate_id: result.candidateId, source_revision: result.sourceRevision,
    type: "investigation", epistemic_status: result.status,
    verified: false, // "source_confirmed" is not a verified effect or project benefit
    checked_claim: result.checkedClaim, finding: result.finding, stop_reason: result.stopReason,
    evidence: result.citedEvidence, counter_evidence: result.counterEvidence,
    gaps: result.gaps, research_calls: result.researchCalls, model_calls: result.modelCalls ?? 0,
    ...(result.publicInterpretation ? { public_interpretation: result.publicInterpretation } : {}),
    elapsed_ms: result.elapsedMs,
    at: result.searchedAt,
  };
}
