import { extractKeywords } from "./retrieval.js";

const EXPLICIT_RECALL = /\b(?:recall|(?:do|can) you remember|remember (?:when|what|where|why|how|whether|if)|what (?:did|have|had) (?:i|we)|when did (?:i|we)|what (?:was|were) (?:i|we))\b/i;

export function isExplicitRecall(query: string): boolean { return EXPLICIT_RECALL.test(query); }

/** This rule was evaluated on labelled cases where lexical top results had weak term overlap. */
export function shouldEscalateRecall(query: string, topExcerpt: string): boolean {
  if (!isExplicitRecall(query)) return false;
  const keywords = extractKeywords(query);
  if (keywords.length < 3) return false;
  const text = topExcerpt.toLowerCase();
  return keywords.filter((word) => text.includes(word)).length <= 1;
}

export function combineRecallMatches<T extends { content: { path: string; archive?: string } }>(hybrid: T[], lexical: T[]): T[] {
  const seen = new Set<string>();
  return [...hybrid, ...lexical].filter((match) => {
    const key = `${match.content.archive ?? ""}\0${match.content.path}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

/** Rank by topical overlap first, then observation date for explicit current-time questions.
 * Dates are only a ranking signal; they never promote a source to current authority. */
export function rerankTemporalRecall<T extends { content: { excerpt: string; lastUpdated: string | null } }>(query: string, matches: T[]): T[] {
  if (!/\b(?:now|current|currently|latest)\b/i.test(query) || !/\b(?:i|my|we|george|flyd)\b/i.test(query)) return matches;
  const keywords = extractKeywords(query);
  if (keywords.length < 3) return matches;
  const overlap = (item: T) => keywords.filter((word) => item.content.excerpt.toLowerCase().includes(word)).length;
  return matches.map((item, index) => ({ item, index, overlap: overlap(item) }))
    .sort((a, b) => b.overlap - a.overlap || (b.item.content.lastUpdated ?? "").localeCompare(a.item.content.lastUpdated ?? "") || a.index - b.index)
    .map(({ item }) => item);
}
