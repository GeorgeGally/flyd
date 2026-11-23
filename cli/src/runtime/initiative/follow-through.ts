import { IntelligenceEventStore, type StoredEvent } from "../../intelligence/event-store.js";
import {
  INITIATIVE_CURATED_CONTRACT, INITIATIVE_MANDATE_CONTRACT,
  INITIATIVE_PUBLIC_RESEARCH_CONTRACT, SourceContractRegistry,
} from "../../intelligence/sensors/source-contracts.js";
import { readProjects, type Project } from "../../council/projects.js";
import { localDay } from "../../council/memory-store.js";
import { listObjectives, openVerifiedInitiativeResearch, mutateObjective } from "../../command/cos/objectives.js";
import { recordCosReport } from "../../command/cos/tick.js";
import type { CosReport } from "../../command/cos/types.js";
import { currentReadOnlyMandate } from "./mandate.js";
import { initiativeSourcesCurrent, currentInitiativeEvidence, type CurrentInitiativeEvidence } from "./source-validity.js";
import { initiativeRevision, type InitiativeSource } from "./candidates.js";
import { safePublicLocator } from "./research.js";
import { commandDir } from "../../command/store.js";

/**
 * Conservative first CoS vertical: a user-approved, project-bound read-only
 * follow-up turns independently checked PUBLIC research into an accepted CoS
 * report. It does not launch unrestricted agent workers or edit a repository.
 * A later approved writer/sandbox capability must guard any such effects.
 */
export interface FollowThroughDeps {
  store?: IntelligenceEventStore;
  registry?: SourceContractRegistry;
  now?: () => Date;
  projects?: () => Project[];
  current?: () => CurrentInitiativeEvidence;
  objectiveDir?: string;
}
export interface FollowThroughResult {
  reviewed: number;
  accepted: number;
  reported: number;
  held: string[];
}

function usableResearchEvent(event: StoredEvent): {
  candidateId: string;
  revision: string;
  projectId: string;
  evidenceRefs: string[];
  sources: InitiativeSource[];
} | null {
  if (event.erased || event.kind !== "inferred_belief" || event.sourceId !== INITIATIVE_CURATED_CONTRACT.sourceId) return null;
  const p = event.payload;
  if (!p || p.type !== "investigation" || p.epistemic_status !== "source_confirmed"
    || !Array.isArray(p.sources) || !Array.isArray(p.evidence)) return null;
  const sources = p.sources as InitiativeSource[];
  const project = sources.find(s => s.id.startsWith("project:") && s.scope === "local_operational");
  const candidateId = p.candidate_id;
  const revision = p.source_revision;
  if (!project || typeof candidateId !== "string" || typeof revision !== "string"
    || initiativeRevision(sources) !== revision) return null;
  const evidenceRefs = (p.evidence as Array<{ url?: unknown; host?: unknown }>).flatMap(item =>
    typeof item.url === "string" && safePublicLocator(item.url) ? [item.url] : []);
  if (new Set(evidenceRefs.map(url => new URL(url).hostname)).size < 2) return null;
  return { candidateId, revision, projectId: project.id.slice("project:".length), evidenceRefs, sources };
}

export async function runInitiativeFollowThrough(deps: FollowThroughDeps = {}): Promise<FollowThroughResult> {
  const summary: FollowThroughResult = { reviewed: 0, accepted: 0, reported: 0, held: [] };
  const registry = deps.registry ?? new SourceContractRegistry();
  for (const contract of [
    INITIATIVE_CURATED_CONTRACT, INITIATIVE_PUBLIC_RESEARCH_CONTRACT, INITIATIVE_MANDATE_CONTRACT,
  ]) registry.register(contract);
  if ([INITIATIVE_CURATED_CONTRACT, INITIATIVE_PUBLIC_RESEARCH_CONTRACT, INITIATIVE_MANDATE_CONTRACT]
    .some(contract => registry.status(contract.sourceId) !== "enabled")) {
    summary.held.push("separate_research_and_user_mandate_consents_required");
    return summary;
  }
  const now = deps.now?.() ?? new Date();
  const owns = !deps.store;
  const store = deps.store ?? new IntelligenceEventStore();
  try {
    const projects = (deps.projects ?? readProjects)();
    const current = deps.current ?? (() => currentInitiativeEvidence());
    const objectiveDir = deps.objectiveDir ?? commandDir();
    const events = store.readSourcePage(INITIATIVE_CURATED_CONTRACT.sourceId, { limit: 300 });
    for (const event of events) {
      const research = usableResearchEvent(event);
      if (!research) continue;
      summary.reviewed++;
      const project = projects.find(p => p.id === research.projectId);
      if (!project || !initiativeSourcesCurrent(research.sources, current())) continue;
      if (registry.status(INITIATIVE_MANDATE_CONTRACT.sourceId) !== "enabled") break;
      const mandate = currentReadOnlyMandate(store, project, now);
      if (!mandate) continue;
      const today = localDay(now);
      const existingToday = listObjectives(objectiveDir)
        .filter(o => o.origin.surface === "initiative" && localDay(new Date(o.createdAt)) === today);
      const matching = existingToday.find(o => o.initiative?.candidateId === research.candidateId
        && o.initiative.sourceRevision === research.revision && o.initiative.mandateEventId === mandate.sourceEventId);
      if (existingToday.length >= mandate.maxReportsPerDay && !matching) {
        summary.held.push("accepted_readonly_followup_budget");
        break;
      }
      const { objective, created } = openVerifiedInitiativeResearch({
        candidateId: research.candidateId,
        sourceRevision: research.revision,
        acceptedMandateEventId: mandate.sourceEventId,
        researchEventId: event.id,
        projectName: project.name,
        publicEvidenceRefs: research.evidenceRefs,
      }, objectiveDir, now);
      if (created) summary.accepted++;
      const report: CosReport = {
        id: objective.id + ":research",
        objectiveId: objective.id,
        kind: "done",
        outcome: "Found independently corroborated public material relevant to " + project.name.slice(0, 65) + ".",
        detail: "The public reference was checked against independent sources. This is a read-only research result, not proof of improvement to the project and not a completed implementation.",
        recommendation: "Compare the cited technique against the current project constraints before building anything.",
        evidenceRefs: [...research.evidenceRefs, "event:" + event.id, "event:" + mandate.sourceEventId],
        shape: "words", artefacts: [], urgency: "whenever",
      };
      if (registry.status(INITIATIVE_MANDATE_CONTRACT.sourceId) !== "enabled"
        || !initiativeSourcesCurrent(research.sources, current())) {
        mutateObjective(objective.id, old => old && ({ ...old, status: "cancelled" }), objectiveDir);
        summary.held.push("mandate_or_source_changed");
        continue;
      }
      if (recordCosReport(report, store, now)) summary.reported++;
      // Ownership and delivery remain with existing CoS reports; no second
      // notification or in-conversation workers are created here.
      if (summary.reported >= 1) break;
    }
  } finally {
    if (owns) store.close();
  }
  return summary;
}
