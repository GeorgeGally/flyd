import { queryMemory } from "../../cognition/memory.js";
import { IntelligenceEventStore, type StoredEvent } from "../../intelligence/event-store.js";
import { EpisodicMemory } from "../../intelligence/episodes/service.js";
import type { EpisodeNode } from "../../intelligence/episodes/types.js";
import type { EpisodeEvalMode } from "./types.js";

export interface EpisodeEvalContext {
  text: string;
  evidenceSequences: number[];
  episodeNodeIds: string[];
}

function terms(question: string): string[] {
  return [...new Set((question.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])
    .filter((term) => term.length >= 3 && !/^(what|when|where|which|with|from|that|this|were|was|did|why|how|our|the|and|then|about|into|over|before|after)$/i.test(term)))];
}

function nodeScore(node: EpisodeNode, words: string[]): number {
  const lower = node.summary.toLowerCase();
  return words.reduce((score, word) => score + (lower.includes(word) ? 1 : 0), 0);
}

function eventText(event: StoredEvent): string {
  return `[event:${event.sequence}; ${event.capturedAt}; ${event.kind}; ${event.sourceId}] ${JSON.stringify(event.payload ?? null)}`;
}

export async function buildEvalContext(mode: EpisodeEvalMode, question: string, budget = 10): Promise<EpisodeEvalContext> {
  const current = await queryMemory({ text: question, temporalFrame: "past", includeHistorical: true, limit: 12, useJev: false });
  const currentText = [
    ...current.current.map((item) => `[current] ${item.entityId} ${item.attribute}: ${String(item.value)}`),
    ...current.historical.map((item) => `[historical] ${item.entityId} ${item.attribute}: ${String(item.value)}`),
    ...current.relevant.map((item) => `[relevant; ${item.source}] ${item.content}`),
  ].join("\n");
  const currentEvidenceSequences = current.relevant.flatMap((item) => {
    const match = item.source.match(/^event:(\d+)$/);
    return match ? [Number(match[1])] : [];
  });
  if (mode === "current") return { text: currentText, evidenceSequences: currentEvidenceSequences, episodeNodeIds: [] };

  const episodic = new EpisodicMemory();
  const nodes = episodic.timeline(budget);
  const episodeText = nodes.map((node) =>
    `[${node.id}; events ${node.startSequence}-${node.endSequence}; ${node.startTime}..${node.endTime}] ${node.summary}`
  ).join("\n");
  if (mode === "cover") return { text: [currentText, episodeText].filter(Boolean).join("\n\n"), evidenceSequences: currentEvidenceSequences, episodeNodeIds: nodes.map((n) => n.id) };

  const words = terms(question);
  const ranked = nodes.slice().sort((a, b) => nodeScore(b, words) - nodeScore(a, words) || b.endSequence - a.endSequence);
  const chosen = ranked.slice(0, Math.min(3, ranked.length));
  const evidence: StoredEvent[] = [];
  const visited = new Set<string>();

  for (const root of chosen) {
    let frontier = [root.id];
    for (let depth = 0; depth < 8 && frontier.length; depth += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        if (visited.has(id)) continue;
        visited.add(id);
        const drilled = episodic.drill(id);
        if (!drilled) continue;
        if (drilled.children.length) {
          const childRanked = drilled.children
            .slice()
            .sort((a, b) => nodeScore(b, words) - nodeScore(a, words) || b.endSequence - a.endSequence);
          next.push(...childRanked.slice(0, Math.min(2, childRanked.length)).map((node) => node.id));
        } else {
          evidence.push(...drilled.events);
        }
      }
      frontier = next;
    }
  }

  const unique = [...new Map(evidence.map((event) => [event.sequence, event])).values()]
    .sort((a, b) => a.sequence - b.sequence)
    .slice(-48);
  return {
    text: [currentText, episodeText, unique.map(eventText).join("\n")].filter(Boolean).join("\n\n"),
    evidenceSequences: [...new Set([...currentEvidenceSequences, ...unique.map((event) => event.sequence)])],
    episodeNodeIds: [...visited],
  };
}
