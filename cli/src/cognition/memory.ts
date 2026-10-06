import { IntelligenceEventStore } from "../intelligence/event-store.js";
import { ProjectionEngine } from "../intelligence/projections.js";
import { deriveWorldState, worldModelProjector } from "../intelligence/world/world-model.js";
import { retrieveResilientLexicalBrainEvidence } from "../lib/brain-retrieval.js";
import { evaluatePredicates } from "./system-one/jev.js";
import { familyEgress, questionFor } from "./system-one/registry.js";
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
  let conversations: Array<{ id: string; content: string; source: string; relevance: number; epistemicStatus: string; freshness: number; temporalStatus: string }> = [];
  try {
    derived = deriveWorldState(new ProjectionEngine(store, worldModelProjector).rebuild(0).state);
    const terms = input.text.match(/[\p{L}\p{N}_-]+/gu)?.filter(t => !/^(?:what|where|when|why|how|the|this|that|did|was|were|with|from|have|about|working)$/i.test(t)) ?? [];
    conversations = store.searchConversations(terms, input.projectIds, input.limit ?? 8).map(event => {
      const turn = event.payload!.conversation as { user: string; assistant?: string };
      return { id: "conversation:" + event.sequence, source: "event:" + event.sequence,
        content: "User: " + turn.user.slice(0, 1000) + "\nAssistant (proposal/report, not verified): " + (turn.assistant ?? "").slice(0, 400),
        relevance: terms.filter(term => turn.user.toLowerCase().includes(term.toLowerCase())).length / Math.max(1, terms.length),
        epistemicStatus: "source_evidence", freshness: Math.max(0, 1 - (Date.now() - Date.parse(event.capturedAt)) / (14 * 86400000)), temporalStatus: "background" };
    });
  } finally {
    store.close();
  }

  const includeHistorical = input.includeHistorical ?? input.temporalFrame === "past";
  const entitySet = new Set([...(input.entities ?? []), ...(input.projectIds ?? [])].map((x) => x.toLowerCase()));
  const matchesScope = (c: { entityId: string; parentEntityId?: string }) => entitySet.size === 0 ||
    [...entitySet].some(e => [c.entityId, c.parentEntityId ?? ""].some(id => id.toLowerCase().includes(e.replace(/^project:/, ""))));
  const canonicalCurrent = derived.current.filter(matchesScope);
  const canonicalHistorical = includeHistorical
    ? derived.historical.filter((c) => {
        if (!input.includeExpired && c.temporalStatus === "expired" && input.temporalFrame !== "past") return false;
        if (!input.includeSuperseded && c.temporalStatus === "superseded" && input.temporalFrame !== "past") return false;
        return matchesScope(c);
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
    const questions: PredicateQuestion[] = relevant.map((_, i) => questionFor("candidate_relevant", { index: i }, `candidate_${i}_relevant`));
    const evaluation = await evaluatePredicates({
      request: input.text,
      temporal_frame: input.temporalFrame ?? "present",
      candidates: relevant.map((r, i) => ({ index: i, content: r.content, status: r.temporalStatus })),
    }, questions, input.jev, familyEgress("memory_rerank"));
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

  const relevantLimit = input.limit ?? 8;
  const conversationShare = Math.max(Math.floor(relevantLimit / 2), relevantLimit - relevant.length);
  const rankedConversations = conversations.filter(c => c.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || b.freshness - a.freshness).slice(0, conversationShare);

  return {
    current: canonicalCurrent.slice(0, input.limit ?? 20),
    relevant: [...rankedConversations, ...relevant].sort((a, b) => b.relevance - a.relevance).slice(0, relevantLimit),
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
