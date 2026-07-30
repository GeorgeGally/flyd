import { createHash } from "node:crypto";
import type { EvidenceCluster, RankedEvidence } from "./types.js";

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "but", "by", "can", "could",
  "did", "do", "does", "for", "from", "had", "has", "have", "how", "i", "if", "in", "into",
  "is", "it", "its", "may", "more", "most", "not", "of", "on", "or", "our", "should", "so",
  "than", "that", "the", "their", "there", "these", "they", "this", "to", "was", "we", "were",
  "what", "when", "where", "which", "who", "why", "will", "with", "would", "you", "your",
]);

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function tokenSet(item: RankedEvidence): Set<string> {
  return new Set(tokens(`${item.title ?? ""} ${item.content.slice(0, 2_500)}`));
}

function similarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function firstSentence(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const match = normalized.match(/^(.{1,260}?[.!?])(?:\s|$)/);
  return (match?.[1] || normalized.slice(0, 260)).trim();
}

function clusterId(evidenceIds: string[]): string {
  return createHash("sha256").update([...evidenceIds].sort().join("\n")).digest("hex").slice(0, 16);
}

interface WorkingCluster {
  items: RankedEvidence[];
  terms: Map<string, number>;
  tokenUnion: Set<string>;
}

function addTerms(cluster: WorkingCluster, itemTokens: Set<string>): void {
  for (const token of itemTokens) {
    cluster.tokenUnion.add(token);
    cluster.terms.set(token, (cluster.terms.get(token) ?? 0) + 1);
  }
}

function labelFor(cluster: WorkingCluster): string {
  const title = cluster.items.find((item) => item.title?.trim())?.title?.trim();
  if (title) return title.length <= 90 ? title : `${title.slice(0, 89)}…`;
  const terms = [...cluster.terms.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 4)
    .map(([term]) => term);
  return terms.length > 0 ? terms.join(" · ") : "Related evidence";
}

export function clusterEvidence(evidence: RankedEvidence[], threshold = 0.16): EvidenceCluster[] {
  const working: WorkingCluster[] = [];

  for (const item of evidence) {
    const itemTokens = tokenSet(item);
    let best: WorkingCluster | null = null;
    let bestSimilarity = 0;

    for (const cluster of working) {
      const score = similarity(itemTokens, cluster.tokenUnion);
      if (score > bestSimilarity) {
        bestSimilarity = score;
        best = cluster;
      }
    }

    if (!best || bestSimilarity < threshold) {
      const cluster: WorkingCluster = { items: [item], terms: new Map(), tokenUnion: new Set() };
      addTerms(cluster, itemTokens);
      working.push(cluster);
      continue;
    }

    best.items.push(item);
    addTerms(best, itemTokens);
  }

  return working
    .map((cluster) => {
      const items = [...cluster.items].sort((left, right) => right.rrfScore - left.rrfScore);
      const capabilities = [...new Set(items.flatMap((item) => item.capabilities))].sort();
      const authors = [...new Set(items.map((item) => item.author).filter((author): author is string => Boolean(author)))].slice(0, 12);
      const supportScore = items.reduce((sum, item) => sum + item.rrfScore, 0) * (1 + Math.max(0, capabilities.length - 1) * 0.12);
      const representative = items[0];
      return {
        id: clusterId(items.map((item) => item.id)),
        label: labelFor(cluster),
        summary: firstSentence(representative.content || representative.title || "Related evidence"),
        evidenceIds: items.map((item) => item.id),
        representativeEvidenceId: representative.id,
        capabilities,
        authors,
        supportScore,
        sourceDiversity: capabilities.length,
      } satisfies EvidenceCluster;
    })
    .sort((left, right) => right.supportScore - left.supportScore || right.sourceDiversity - left.sourceDiversity)
    .slice(0, 16);
}

export function buildDrillDownQueries(query: string, clusters: EvidenceCluster[]): Array<{ label: string; query: string; weight: number }> {
  const followUps: Array<{ label: string; query: string; weight: number }> = [];
  const lowDiversity = clusters.filter((cluster) => cluster.sourceDiversity < 2).slice(0, 2);

  lowDiversity.forEach((cluster, index) => {
    followUps.push({
      label: `drill_independent_${index + 1}`,
      query: `${query} ${cluster.label} independent evidence`,
      weight: 0.78,
    });
  });

  if (followUps.length < 2) {
    followUps.push({
      label: "drill_limitations",
      query: `${query} limitations risks criticism evidence`,
      weight: 0.8,
    });
  }

  return followUps.slice(0, 2);
}
