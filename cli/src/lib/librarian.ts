import { getActiveInterests } from "./interests.js";
import { getStaleness, type StalenessResult } from "./staleness.js";
import { decayedValue, getHalfLife } from "./decay.js";

export interface EvidenceEntry {
  path: string;
  body: string;
  source: "raw" | "wiki";
  score: number;
  metadata: Record<string, unknown>;
  staleness: StalenessResult | null;
}

export interface ScoredEvidence extends EvidenceEntry {
  librarianScore: number;
  recencyWeight: number;
  reliabilityWeight: number;
  interestBoost: number;
  corroborationCount: number;
  contradictionCount: number;
}

export interface SufficiencyAssessment {
  verdict: "sufficient" | "partial" | "conflicting" | "insufficient";
  reason: string;
  coverage: number;
}

export function decayedConfidence(
  originalConfidence: number,
  daysSince: number,
): number {
  if (daysSince <= 0) return originalConfidence;
  const halfLife = 180;
  const decayed = originalConfidence * Math.pow(0.5, daysSince / halfLife);
  return Math.max(0.1, Math.round(decayed * 100) / 100);
}

export function scoreEvidence(
  entry: EvidenceEntry,
  keywords: string[],
  question: string,
): ScoredEvidence {
  const unpromoted = entry.metadata.promoted === false || entry.metadata.type === "conversation-index";
  const defaultConfidence = entry.source === "wiki" && !unpromoted ? 0.9 : 0.5;
  const parsedConfidence = Number(entry.metadata.confidence ?? defaultConfidence);
  const rawConfidence = Number.isFinite(parsedConfidence)
    ? Math.max(0, Math.min(1, parsedConfidence))
    : defaultConfidence;
  const daysSince = entry.staleness?.daysSince ?? 0;
  const recencyWeight = Math.max(0, 1 - daysSince / 730);
  const halfLife = getHalfLife(entry.metadata);
  const reliabilityWeight = decayedValue(rawConfidence, daysSince, halfLife);
  const activeInterests = getActiveInterests();
  const interestBoost = activeInterests.some(
    (i) =>
      entry.body.toLowerCase().includes(i.topic.toLowerCase()) ||
      i.keywords.some((k) => entry.body.toLowerCase().includes(k.toLowerCase())),
  )
    ? 0.15
    : 0;

  const cleanBody = entry.body.toLowerCase();
  const questionWords = question.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const keywordHits = questionWords.filter((w) => cleanBody.includes(w)).length;
  const keywordDensity = questionWords.length > 0 ? keywordHits / questionWords.length : 0;

  const librarianScore = Math.min(
    1,
    recencyWeight * 0.25 +
      reliabilityWeight * 0.35 +
      keywordDensity * 0.25 +
      interestBoost,
  );

  return {
    ...entry,
    librarianScore: Math.round(librarianScore * 100) / 100,
    recencyWeight: Math.round(recencyWeight * 100) / 100,
    reliabilityWeight,
    interestBoost: Math.round(interestBoost * 100) / 100,
    corroborationCount: 0,
    contradictionCount: 0,
  };
}

export function corroborate(
  scored: ScoredEvidence[],
): ScoredEvidence[] {
  const byTopic = new Map<string, ScoredEvidence[]>();
  for (const entry of scored) {
    const words = entry.body.toLowerCase().split(/\s+/).filter((w) => w.length > 5);
    const topWords = [...new Set(words)].slice(0, 20);
    for (const w of topWords) {
      if (!byTopic.has(w)) byTopic.set(w, []);
      byTopic.get(w)!.push(entry);
    }
  }

  for (const [, group] of byTopic) {
    if (group.length < 2) continue;
    const unique = new Set(group.map((e) => e.path));
    for (const entry of group) {
      entry.corroborationCount = Math.max(entry.corroborationCount, unique.size - 1);
    }
  }

  return scored;
}

export function estimateSufficiency(
  entries: ScoredEvidence[],
  question: string,
): SufficiencyAssessment {
  if (entries.length === 0) {
    return { verdict: "insufficient", reason: "No evidence retrieved.", coverage: 0 };
  }

  const highQuality = entries.filter((e) => e.librarianScore >= 0.6);
  const mediumQuality = entries.filter(
    (e) => e.librarianScore >= 0.4 && e.librarianScore < 0.6,
  );

  const hasContradictions = entries.some((e) => e.contradictionCount > 0);
  const questionWords = question.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const coveredWords = questionWords.filter((w) =>
    entries.some((e) => e.body.toLowerCase().includes(w)),
  );
  const coverage = questionWords.length > 0 ? coveredWords.length / questionWords.length : 0;

  if (hasContradictions && highQuality.length >= 2) {
    return {
      verdict: "conflicting",
      reason: `${highQuality.length} high-quality entries found but they contain conflicting claims.`,
      coverage,
    };
  }

  if (highQuality.length >= 2 && coverage >= 0.5) {
    return {
      verdict: "sufficient",
      reason: `${highQuality.length} strong sources covering ${Math.round(coverage * 100)}% of query terms.`,
      coverage,
    };
  }

  if (highQuality.length >= 1 || mediumQuality.length >= 2) {
    return {
      verdict: "partial",
      reason: `${highQuality.length} strong + ${mediumQuality.length} moderate sources, coverage ${Math.round(coverage * 100)}%. May be incomplete.`,
      coverage,
    };
  }

  return {
    verdict: "insufficient",
    reason: `Only ${entries.length} low-quality or unmatched entries found. Coverage ${Math.round(coverage * 100)}%.`,
    coverage,
  };
}

export function formatLibrarianSummary(
  scored: ScoredEvidence[],
  sufficiency: SufficiencyAssessment,
): string {
  const lines: string[] = ["## Librarian Assessment", ""];
  lines.push(`**Sufficiency:** ${sufficiency.verdict}`);
  lines.push(`**Reason:** ${sufficiency.reason}`);
  lines.push("");

  const sorted = [...scored].sort((a, b) => b.librarianScore - a.librarianScore);
  lines.push("| # | Source | Entry | Score | Recency | Reliability | Corroborations |");
  lines.push("|---|--------|-------|-------|---------|-------------|----------------|");
  for (const e of sorted) {
    const src = e.source === "wiki" ? "W" : "R";
    const contra = e.contradictionCount > 0 ? ` ⚠${e.contradictionCount}` : "";
    lines.push(
      `| ${e.corroborationCount > 0 ? "✓" : " "} | ${src} | ${e.path} | ${(e.librarianScore * 100).toFixed(0)}% | ${(e.recencyWeight * 100).toFixed(0)}% | ${(e.reliabilityWeight * 100).toFixed(0)}% | ${e.corroborationCount}${contra} |`,
    );
  }

  return lines.join("\n");
}
