import type { EvidenceConflict, RankedEvidence } from "./types.js";

const STOPWORDS = new Set([
  "about", "after", "also", "and", "are", "because", "been", "before", "being", "between",
  "but", "can", "could", "does", "from", "have", "into", "just", "more", "most", "only", "other",
  "over", "should", "some", "such", "than", "that", "their", "there", "these", "they", "this", "through",
  "under", "very", "what", "when", "where", "which", "while", "with", "would", "your",
]);

const NEGATIVE = /\b(no|not|never|cannot|can't|doesn't|isn't|won't|without|fails?|failed|broken|unavailable|unsupported|unsafe|false|incorrect|worse|declined|decreased)\b/i;
const POSITIVE = /\b(can|does|is|will|works?|working|available|supports?|supported|safe|true|correct|better|released|includes?|increased|improved)\b/i;

function terms(item: RankedEvidence): Set<string> {
  return new Set(`${item.title ?? ""} ${item.content.slice(0, 1_800)}`
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((term) => term.length >= 4 && !STOPWORDS.has(term)));
}

function sharedTerms(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((term) => right.has(term));
}

function polarity(item: RankedEvidence): -1 | 0 | 1 {
  const text = `${item.title ?? ""} ${item.content.slice(0, 1_200)}`;
  // Negated assertions necessarily contain positive verbs ("does not support").
  // Explicit negation therefore wins over a positive-word match.
  if (NEGATIVE.test(text)) return -1;
  if (POSITIVE.test(text)) return 1;
  return 0;
}

function independent(left: RankedEvidence, right: RankedEvidence): boolean {
  if (left.id === right.id) return false;
  if (left.author && right.author && left.author.toLowerCase() === right.author.toLowerCase()) return false;
  const leftSources = new Set(left.provenance.map((entry) => `${entry.capability}:${entry.sourceItemId}`));
  return right.provenance.some((entry) => !leftSources.has(`${entry.capability}:${entry.sourceItemId}`));
}

export function extractEvidenceConflicts(evidence: RankedEvidence[]): EvidenceConflict[] {
  const conflicts: EvidenceConflict[] = [];
  const termSets = new Map(evidence.map((item) => [item.id, terms(item)]));

  for (let leftIndex = 0; leftIndex < evidence.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < evidence.length; rightIndex += 1) {
      const left = evidence[leftIndex];
      const right = evidence[rightIndex];
      if (!independent(left, right)) continue;
      const leftPolarity = polarity(left);
      const rightPolarity = polarity(right);
      if (leftPolarity === 0 || rightPolarity === 0 || leftPolarity === rightPolarity) continue;

      const shared = sharedTerms(termSets.get(left.id) ?? new Set(), termSets.get(right.id) ?? new Set());
      if (shared.length < 2) continue;
      const topic = shared.slice(0, 4).join(" · ");
      const overlap = shared.length / Math.max(1, Math.min(termSets.get(left.id)?.size ?? 1, termSets.get(right.id)?.size ?? 1));
      const confidence = Math.min(0.95, 0.55 + overlap + (left.capability !== right.capability ? 0.08 : 0));
      conflicts.push({
        left: left.id,
        right: right.id,
        topic,
        reason: `Independent evidence makes opposing assertions about ${topic}`,
        confidence,
      });
      if (conflicts.length >= 8) return conflicts;
    }
  }

  return conflicts;
}
