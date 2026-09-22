import { IntelligenceEventStore } from "../intelligence/event-store.js";
import { ProjectionEngine } from "../intelligence/projections.js";
import { deriveWorldState, worldModelProjector } from "../intelligence/world/world-model.js";
import { retrieveResilientLexicalBrainEvidence } from "../lib/brain-retrieval.js";
import { evaluatePredicates } from "./system-one/jev.js";
import type { JevOptions, PredicateQuestion } from "./system-one/types.js";
import type { UnifiedMemoryResult } from "./types.js";

export interface MemoryQuery {
  text: string;
  entities?: string[];
  projectIds?: string[];
  temporalFrame?: "past" | "present" | "future" | "mixed";
  includeHistorical?: boolean;
  includeExpired?: boolean;
  includeSuperseded?: boolean;
  limit?: number;
  projectRoot?: string;
  useJev?: boolean;
  jev?: JevOptions;
}

export async function queryMemory(input: MemoryQuery): Promise<UnifiedMemoryResult> {
  const store = new IntelligenceEventStore();
  let derived;
  try {
    derived = deriveWorldState(new ProjectionEngine(store, worldModelProjector).rebuild(0).state);
  } finally {
    store.close();
  }

  const includeHistorical = input.includeHistorical ?? input.temporalFrame === "past";
  const entitySet = new Set([...(input.entities ?? []), ...(input.projectIds ?? [])].map((x) => x.toLowerCase()));
  const canonicalCurrent = derived.current.filter((c) => entitySet.size === 0 || [...entitySet].some((e) => c.entityId.toLowerCase().includes(e.replace(/^project:/,""))));
  const canonicalHistorical = includeHistorical
    ? derived.historical.filter((c) => {
        if (!input.includeExpired && c.temporalStatus === "expired" && input.temporalFrame !== "past") return false;
        if (!input.includeSuperseded && c.temporalStatus === "superseded" && input.temporalFrame !== "past") return false;
        return entitySet.size === 0 || [...entitySet].some((e) => c.entityId.toLowerCase().includes(e.replace(/^project:/,"")));
      })
    : [];

  let legacy: Awaited<ReturnType<typeof retrieveResilientLexicalBrainEvidence>> | null = null;
  try { legacy = await retrieveResilientLexicalBrainEvidence(input.text, input.projectRoot); } catch {}
  let memorySystemOne: UnifiedMemoryResult["systemOne"] | undefined;
  let relevant = (legacy?.matches ?? []).slice(0, Math.max(input.limit ?? 8, 1)).map((m) => ({
    id: m.id,
    content: m.content.excerpt,
    source: m.content.path,
    relevance: m.confidence,
    epistemicStatus: m.epistemicStatus,
    freshness: m.confidenceProfile.freshness,
    // Legacy archive retrieval is background evidence only. Canonical derived world state owns present-tense authority.
    temporalStatus: "background",
  }));

  if (input.useJev !== false && relevant.length > 1) {
    const questions: PredicateQuestion[] = relevant.map((_, i) => ({
      id: `candidate_${i}_relevant`,
      instructions: `Is candidate ${i} materially useful for answering the user's request now?`,
    }));
    const evaluation = await evaluatePredicates({
      request: input.text,
      temporal_frame: input.temporalFrame ?? "present",
      candidates: relevant.map((r, i) => ({ index: i, content: r.content, status: r.temporalStatus })),
    }, questions, input.jev);
    memorySystemOne = {
      model: evaluation.model,
      predicates: Object.fromEntries(Object.entries(evaluation.answers).map(([id, answer]) => [id, answer.probability])),
      latencyMs: evaluation.latencyMs,
      ...(evaluation.error ? { error: evaluation.error } : {}),
    };
    if (evaluation.ok) {
      relevant = relevant.map((r,i) => ({ ...r, relevance: evaluation.answers[`candidate_${i}_relevant`]?.probability ?? r.relevance }))
        .sort((a,b) => b.relevance-a.relevance);
    }
  }

  return {
    current: canonicalCurrent.slice(0, input.limit ?? 20),
    relevant: relevant.slice(0, input.limit ?? 8),
    historical: canonicalHistorical.slice(0, input.limit ?? 20),
    conflicts: derived.conflicts.map((c) => ({
      entityId: c.entityId, attribute: c.attribute,
      claims: [c.active.value, ...c.conflicting.map((x) => x.claim.value)],
    })),
    gaps: derived.unresolvedEntityIds.map((id) => `unresolved_dependency:${id}`),
    relations: derived.relations,
    ...(memorySystemOne ? { systemOne: memorySystemOne } : {}),
  };
}
