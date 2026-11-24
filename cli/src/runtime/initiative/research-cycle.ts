import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import type { ContextEnvelope } from "../../intelligence/context-envelope.js";
import { validateEnvelope } from "../../intelligence/context-envelope.js";
import {
  INITIATIVE_CURATED_CONTRACT, INITIATIVE_PUBLIC_RESEARCH_CONTRACT,
  INITIATIVE_PUBLIC_SYNTHESIS_CONTRACT, SourceContractRegistry,
} from "../../intelligence/sensors/source-contracts.js";
import { readProjects, type Project } from "../../council/projects.js";
import { latestEdition, type Edition } from "../../council/scout.js";
import { openAdvisories, type Advisory } from "../../council/advisors.js";
import { localDay } from "../../council/memory-store.js";
import { recordActivity, type ActivityRecord } from "../../conversation-view/activity.js";
import { deriveInitiatives, initiativeRevision, type InitiativeCandidate } from "./candidates.js";
import { initiativeSourcesCurrent, type CurrentInitiativeEvidence } from "./source-validity.js";
import {
  researchInitiative, safeResearchPayload, publicResearchConsentCurrent, type InitiativeResearchReceipt,
} from "./research.js";
import { countInitiativeCards, initiativeCardRecorded } from "./cycle.js";
import { projectInitiativeQuietUntil } from "./outcomes.js";

const SOURCE = INITIATIVE_CURATED_CONTRACT.sourceId;
const LEASE_MS = 15 * 60_000;

export interface ResearchCycleDeps {
  store?: IntelligenceEventStore;
  now?: () => Date;
  projects?: () => Project[];
  edition?: () => Edition | null;
  advisories?: (now: Date) => Advisory[];
  /** Real registry must be checked BEFORE local source reads. */
  registry?: SourceContractRegistry;
  current?: () => CurrentInitiativeEvidence;
  perform?: typeof researchInitiative;
  maxDaily?: number;
  record?: (item: ActivityRecord) => void;
  seen?: (key: string) => boolean;
  countPublished?: (day: string) => number;
  on?: boolean;
}
export interface ResearchCycleSummary {
  eligible: number;
  attempted: number;
  confirmed: number;
  inconclusive: number;
  published: number;
  held: string[];
}

function event(now: Date, kind: ContextEnvelope["kind"], idempotencyKey: string,
  candidate: InitiativeCandidate, payload: Record<string, unknown>): ContextEnvelope {
  return {
    pathKind: "executive", kind, sourceId: SOURCE,
    consent: { grantedAt: now.toISOString(), scopes: [...INITIATIVE_CURATED_CONTRACT.scopes] },
    retentionClass: "local_default", payloadClassification: "personal",
    provenance: "initiative.research.v1", idempotencyKey,
    correlationId: candidate.id, policyVersion: "initiative.research.v1",
    evidenceRefs: candidate.sources.map(s => s.evidenceRef),
    payload,
  };
}
function sourceLineage(candidate: InitiativeCandidate): Record<string, unknown> {
  return {
    source_keys: candidate.sources.map(s => s.id),
    sources: candidate.sources.map(s => ({ ...s })),
  };
}

export function researchedActivity(candidate: InitiativeCandidate, finding: InitiativeResearchReceipt): ActivityRecord {
  return {
    key: "initiative:research:" + candidate.id + ":" + initiativeRevision(candidate.sources),
    kind: "noted", state: "done", at: finding.searchedAt, expiresAt: candidate.expiresAt,
    title: finding.status === "source_confirmed" ? "A sourced creative connection" : "A researched possibility",
    line: finding.status === "source_confirmed"
      ? "I found independent public references related to " + candidate.subject.slice(0, 65) + "; a real project benefit remains untested."
      : "The public evidence for " + candidate.subject.slice(0, 65) + " is still uncertain.",
    detail: [
      "Question: " + candidate.question,
      "Finding: " + finding.finding,
      ...(finding.publicInterpretation ? [
        "Model hypothesis (unverified): " + finding.publicInterpretation.hypothesis,
        "Counterargument: " + finding.publicInterpretation.counterargument,
        "Uncertainty: " + finding.publicInterpretation.caveat,
      ] : []),
      "Limit: This does not prove a technique will improve the project.",
      "Next: " + candidate.proposedTest,
      "Public sources: " + finding.citedEvidence.map(s => s.url).join(", "),
    ].join("\n"),
    sourceRefs: candidate.sources.map(s => ({ ...s })),
    stories: finding.citedEvidence.map(x => ({
      title: x.title, url: x.url, gist: "Source checked; project value not independently verified",
      source: x.host, kind: "relevant",
    })),
  };
}

export async function runInitiativeResearchCycle(deps: ResearchCycleDeps = {}): Promise<ResearchCycleSummary> {
  const summary: ResearchCycleSummary = {
    eligible: 0, attempted: 0, confirmed: 0, inconclusive: 0, published: 0, held: [],
  };
  const registry = deps.registry ?? new SourceContractRegistry();
  registry.register(INITIATIVE_CURATED_CONTRACT);
  registry.register(INITIATIVE_PUBLIC_RESEARCH_CONTRACT);
  registry.register(INITIATIVE_PUBLIC_SYNTHESIS_CONTRACT);
  const now = deps.now?.() ?? new Date();
  if (registry.status(SOURCE) !== "enabled" || !publicResearchConsentCurrent(registry, now)) {
    summary.held.push("source_or_public_research_consent_required");
    return summary;
  }
  const owns = !deps.store;
  const store = deps.store ?? new IntelligenceEventStore();
  try {
    // Existing 30-day derived LEARN retention is now enforced at read/tick.
    store.purgeSourceBefore(SOURCE, new Date(now.getTime() - 30 * 86_400_000));
    const projects = (deps.projects ?? readProjects)();
    const edition = (deps.edition ?? latestEdition)();
    const advisories = (deps.advisories ?? openAdvisories)(now);
    const reports = store.readSourcePage("cos.report", { limit: 100 });
    const candidates = deriveInitiatives({ now, projects, edition, advisories, reports });
    const current = deps.current ?? (() =>
      ({ projects: (deps.projects ?? readProjects)(), edition: (deps.edition ?? latestEdition)(),
        advisories: (deps.advisories ?? openAdvisories)(now),
        reports: store.readSourcePage("cos.report", { limit: 100 }) }));
    const selected = candidates.filter(c => c.origin === "scout" && initiativeSourcesCurrent(c.sources, current()))
      .slice(0, 4);
    summary.eligible = selected.length;
    const maxDaily = Math.max(0, Math.min(4, deps.maxDaily ?? 2));
    for (const candidate of selected) {
      const generation = store.latestTombstone(SOURCE)?.erasedAt ?? "initial";
      const publicGeneration = registry.list().find(item => item.contract.sourceId === INITIATIVE_PUBLIC_RESEARCH_CONTRACT.sourceId)?.state.changedAt ?? "missing";
      const synthGeneration = registry.list().find(item => item.contract.sourceId === INITIATIVE_PUBLIC_SYNTHESIS_CONTRACT.sourceId)?.state.changedAt ?? "missing";
      const caseKey = generation + ":" + publicGeneration + ":" + synthGeneration + ":" + candidate.id + ":" + initiativeRevision(candidate.sources);
      const resultKey = "research-result:" + caseKey;
      if (registry.status(SOURCE) !== "enabled" || !publicResearchConsentCurrent(registry, new Date())) {
        summary.held.push("consent_revoked");
        break;
      }
      if (!initiativeSourcesCurrent(candidate.sources, current())) continue;
      const claim = store.transaction(() => {
        if (store.findByIdempotencyKey(SOURCE, resultKey)) return false;
        const today = localDay(now);
        const attempts = store.readSourcePage(SOURCE, { limit: 1000 })
          .filter(e => e.payload?.type === "research_claim" && typeof e.payload.at === "string"
            && localDay(new Date(e.payload.at)) === today);
        if (attempts.length >= maxDaily) return false;
        const prior = store.readByIdempotencyPrefix(SOURCE, "research-claim:" + caseKey + ":");
        const last = prior.at(-1)?.payload;
        if (last && typeof last.at === "string" && now.getTime() - Date.parse(last.at) < LEASE_MS) return false;
        if (prior.length >= 2) return false; // never spin on a bad public service
        const id = "research-claim:" + caseKey + ":" + (prior.length + 1);
        const e = event(now, "observation", id, candidate, {
          type: "research_claim", candidate_id: candidate.id, source_revision: initiativeRevision(candidate.sources),
          at: now.toISOString(), expires_at: new Date(now.getTime() + LEASE_MS).toISOString(),
          ...sourceLineage(candidate),
        });
        return validateEnvelope(e, { consentLookup: store }).ok && !!store.append(e);
      });
      if (!claim) continue;
      summary.attempted++;
      let research: InitiativeResearchReceipt;
      try {
        research = await (deps.perform ?? researchInitiative)(candidate, edition, {
          now: () => now, registry,
        });
      } catch {
        summary.held.push("research_error");
        continue;
      }
      // A callback can return while the source/mandate has changed.
      if (!initiativeSourcesCurrent(candidate.sources, current())
        || registry.status(SOURCE) !== "enabled"
        || !publicResearchConsentCurrent(registry, new Date())) {
        summary.held.push("source_changed_or_revoked");
        continue;
      }
      const created = store.transaction(() => {
        if (store.findByIdempotencyKey(SOURCE, resultKey)) return false;
        const e = event(now, "inferred_belief", resultKey, candidate, {
          ...safeResearchPayload(research), ...sourceLineage(candidate),
        });
        return validateEnvelope(e, { consentLookup: store }).ok && !!store.append(e);
      });
      if (!created) continue;
      if (research.status === "source_confirmed") summary.confirmed++;
      else summary.inconclusive++;
      const modeOn = deps.on ?? (process.env.FLYD_INITIATIVE === "on" || process.env.FLYD_INITIATIVE === undefined);
      const projectId = candidate.sources.find(s => s.id.startsWith("project:"))?.id.slice("project:".length);
      const quietUntil = projectId && projectInitiativeQuietUntil(
        store.readSourcePage(SOURCE, { limit: 1000 }), projectId, now);
      if (modeOn && !quietUntil && research.citedEvidence.length >= 2
        && (deps.countPublished ?? countInitiativeCards)(localDay(now)) < 1
        && registry.status(SOURCE) === "enabled"
        && initiativeSourcesCurrent(candidate.sources, current())) {
        const card = researchedActivity(candidate, research);
        if (!(deps.seen ?? initiativeCardRecorded)(card.key!)) {
          (deps.record ?? recordActivity)(card);
          summary.published++;
        }
      }
    }
  } finally {
    if (owns) store.close();
  }
  return summary;
}
