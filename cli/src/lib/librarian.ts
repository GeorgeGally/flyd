import { getActiveInterests } from "./interests.js";
import { getStaleness, type StalenessResult } from "./staleness.js";
import { getHalfLife } from "./decay.js";

export interface EvidenceEntry {
  path: string;
  body: string;
  source: "raw" | "wiki";
  score: number;
  metadata: Record<string, unknown>;
  staleness: StalenessResult | null;
}

export interface ConfidenceProfile {
  epistemicConfidence: number;
  freshness: number;
  interestAffinity: number;
  retrievalUtility: number;
  associationStrength: number;
}

export interface ScoredEvidence extends EvidenceEntry {
  librarianScore: number;
  /** @deprecated — use confidenceProfile.epistemicConfidence instead */
  recencyWeight: number;
  /** @deprecated — use confidenceProfile.freshness instead */
  reliabilityWeight: number;
  /** @deprecated — use confidenceProfile.interestAffinity instead */
  interestBoost: number;
  corroborationCount: number;
  contradictionCount: number;
  confidenceProfile: ConfidenceProfile;
  /** Set by currentness-gate.ts — true only when corroborated by a live Present Model signal. */
  isCurrent?: boolean;
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
  const halfLife = getHalfLife(entry.metadata);

  const epistemicConfidence = rawConfidence;
  const freshness = Math.max(0, 1 - daysSince / Math.max(1, halfLife));

  const activeInterests = getActiveInterests();
  const interestAffinity = activeInterests.some(
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

  const retrievalUtility = 0.5;
  const associationStrength = 0.0;

  const librarianScore = Math.min(
    1,
    epistemicConfidence * 0.25 +
      freshness * 0.25 +
      keywordDensity * 0.25 +
      interestAffinity * 0.15 +
      associationStrength * 0.10,
  );

  return {
    ...entry,
    librarianScore: Math.round(librarianScore * 100) / 100,
    recencyWeight: Math.round(freshness * 100) / 100,
    reliabilityWeight: epistemicConfidence,
    interestBoost: Math.round(interestAffinity * 100) / 100,
    corroborationCount: 0,
    contradictionCount: 0,
    confidenceProfile: {
      epistemicConfidence,
      freshness: Math.round(freshness * 100) / 100,
      interestAffinity: Math.round(interestAffinity * 100) / 100,
      retrievalUtility,
      associationStrength,
    },
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

export function countContradictions(
  scored: ScoredEvidence[],
  graphResults: Array<{ from: string; to: string; rel_type: string; confidence: number; source: string }>,
): ScoredEvidence[] {
  for (const entry of scored) {
    const entryLower = entry.path.toLowerCase();
    for (const gr of graphResults) {
      if (gr.rel_type !== "contradicts") continue;
      if (entryLower.includes(gr.from) || entryLower.includes(gr.to)) {
        entry.contradictionCount++;
      }
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

  const highQuality = entries.filter((e) => e.confidenceProfile.epistemicConfidence >= 0.6);
  const mediumQuality = entries.filter(
    (e) => e.confidenceProfile.epistemicConfidence >= 0.4 && e.confidenceProfile.epistemicConfidence < 0.6,
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
  lines.push("| # | Source | Entry | Score | Epistemic | Freshness | Affinity | Corroborations |");
  lines.push("|---|--------|-------|-------|-----------|-----------|----------|----------------|");
  for (const e of sorted) {
    const src = e.source === "wiki" ? "W" : "R";
    const contra = e.contradictionCount > 0 ? ` ⚠${e.contradictionCount}` : "";
    const p = e.confidenceProfile;
    lines.push(
      `| ${e.corroborationCount > 0 ? "✓" : " "} | ${src} | ${e.path} | ${(e.librarianScore * 100).toFixed(0)}% | ${(p.epistemicConfidence * 100).toFixed(0)}% | ${(p.freshness * 100).toFixed(0)}% | ${(p.interestAffinity * 100).toFixed(0)}% | ${e.corroborationCount}${contra} |`,
    );
  }

  return lines.join("\n");
}
