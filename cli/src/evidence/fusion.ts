import type {
  CapabilityName,
  EvidenceItem,
  EvidenceStream,
  QueryPlan,
  RankedEvidence,
} from "./types.js";

const RRF_K = 60;
const MAX_ITEMS_PER_AUTHOR = 3;
const DIVERSITY_RELEVANCE_FLOOR = 0.25;

function normalizeLocator(locator: string): string {
  try {
    const url = new URL(locator.trim());
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^(www\.|old\.|m\.)/, "");
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return locator.trim().toLowerCase();
  }
}

function candidateKey(item: EvidenceItem): string {
  if (item.locator) return normalizeLocator(item.locator);
  return `${item.capability}:${item.sourceItemId}`;
}

function sortKey(left: RankedEvidence, right: RankedEvidence): number {
  return (
    right.rrfScore - left.rrfScore ||
    right.localRelevance - left.localRelevance ||
    right.freshness - left.freshness ||
    right.sourceQuality - left.sourceQuality ||
    left.id.localeCompare(right.id)
  );
}

function bestPrimaryScore(item: EvidenceItem): number {
  return (item.localRelevance * 100) + item.freshness + (item.sourceQuality * 10);
}

function mergeItem(candidate: RankedEvidence, incoming: EvidenceItem, score: number): void {
  const previousScore = bestPrimaryScore(candidate);
  const incomingScore = bestPrimaryScore(incoming);

  candidate.rrfScore += score;
  candidate.localRelevance = Math.max(candidate.localRelevance, incoming.localRelevance);
  candidate.freshness = Math.max(candidate.freshness, incoming.freshness);
  candidate.sourceQuality = Math.max(candidate.sourceQuality, incoming.sourceQuality);
  if (incoming.engagement !== undefined) {
    candidate.engagement = Math.max(candidate.engagement ?? 0, incoming.engagement);
  }
  if (!candidate.capabilities.includes(incoming.capability)) candidate.capabilities.push(incoming.capability);

  const provenanceKeys = new Set(
    candidate.provenance.map((entry) => `${entry.capability}:${entry.backend}:${entry.queryLabel}:${entry.sourceItemId}`),
  );
  for (const entry of incoming.provenance) {
    const key = `${entry.capability}:${entry.backend}:${entry.queryLabel}:${entry.sourceItemId}`;
    if (!provenanceKeys.has(key)) {
      provenanceKeys.add(key);
      candidate.provenance.push(entry);
    }
  }

  if (incomingScore > previousScore) {
    candidate.capability = incoming.capability;
    candidate.backend = incoming.backend;
    candidate.kind = incoming.kind;
    candidate.title = incoming.title;
    candidate.content = incoming.content;
    candidate.sourceItemId = incoming.sourceItemId;
    candidate.retrievedAt = incoming.retrievedAt;
    candidate.publishedAt = incoming.publishedAt;
    candidate.author = incoming.author;
    candidate.queryLabel = incoming.queryLabel;
    candidate.nativeRank = incoming.nativeRank;
    candidate.metadata = incoming.metadata;
  } else if (incoming.content.length > candidate.content.length) {
    candidate.content = incoming.content;
  }
}

function applyAuthorCap(candidates: RankedEvidence[], maxPerAuthor = MAX_ITEMS_PER_AUTHOR): RankedEvidence[] {
  const counts = new Map<string, number>();
  const kept: RankedEvidence[] = [];

  for (const candidate of candidates) {
    const author = candidate.author?.trim().toLowerCase();
    if (!author) {
      kept.push(candidate);
      continue;
    }
    const count = counts.get(author) ?? 0;
    if (count >= maxPerAuthor) continue;
    counts.set(author, count + 1);
    kept.push(candidate);
  }

  return kept;
}

function diversifyByCapability(candidates: RankedEvidence[], limit: number): RankedEvidence[] {
  if (candidates.length <= limit) return candidates;

  const bestRelevance = new Map<CapabilityName, number>();
  for (const candidate of candidates) {
    for (const capability of candidate.capabilities) {
      bestRelevance.set(capability, Math.max(bestRelevance.get(capability) ?? 0, candidate.localRelevance));
    }
  }

  const reserved: RankedEvidence[] = [];
  const seen = new Set<string>();
  for (const capability of [...bestRelevance.keys()].sort()) {
    if ((bestRelevance.get(capability) ?? 0) < DIVERSITY_RELEVANCE_FLOOR) continue;
    const candidate = candidates.find(
      (entry) => !seen.has(entry.id) && entry.capabilities.includes(capability),
    );
    if (!candidate) continue;
    reserved.push(candidate);
    seen.add(candidate.id);
  }

  const result = [...reserved];
  for (const candidate of candidates) {
    if (result.length >= limit) break;
    if (seen.has(candidate.id)) continue;
    result.push(candidate);
    seen.add(candidate.id);
  }

  return result.sort(sortKey).slice(0, limit);
}

export function fuseEvidence(streams: EvidenceStream[], plan: QueryPlan): RankedEvidence[] {
  const candidates = new Map<string, RankedEvidence>();

  for (const stream of streams) {
    const sourceWeight = plan.sourceWeights[stream.capability] ?? 1;
    stream.items.slice(0, plan.maxPerStream).forEach((item, index) => {
      const nativeRank = item.nativeRank > 0 ? item.nativeRank : index + 1;
      const score = (stream.weight * sourceWeight) / (RRF_K + nativeRank);
      const key = candidateKey(item);
      const existing = candidates.get(key);

      if (existing) {
        mergeItem(existing, item, score);
        return;
      }

      candidates.set(key, {
        ...item,
        nativeRank,
        provenance: [...item.provenance],
        rrfScore: score,
        capabilities: [item.capability],
      });
    });
  }

  const ranked = [...candidates.values()].sort(sortKey);
  return diversifyByCapability(applyAuthorCap(ranked), plan.maxResults);
}
