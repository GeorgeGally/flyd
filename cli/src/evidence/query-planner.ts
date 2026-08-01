import type {
  CapabilityName,
  EvidenceSubquery,
  QueryPlan,
  ResearchDepth,
  ResearchIntent,
} from "./types.js";

const SOURCE_PRIORITY: Record<ResearchIntent, CapabilityName[]> = {
  factual: ["web", "github", "hackernews", "reddit", "youtube", "rss", "arxiv"],
  opinion: ["reddit", "x", "youtube", "hackernews", "web"],
  how_to: ["youtube", "reddit", "github", "web", "hackernews"],
  comparison: ["reddit", "github", "hackernews", "x", "youtube", "web"],
  breaking_news: ["x", "web", "reddit", "hackernews", "youtube", "rss"],
  prediction: ["polymarket", "x", "web", "hackernews", "reddit", "youtube"],
  product: ["reddit", "youtube", "x", "web", "github"],
};

const DEPTH_BUDGETS: Record<ResearchDepth, { sources: number; maxResults: number; maxPerStream: number }> = {
  quick: { sources: 3, maxResults: 12, maxPerStream: 6 },
  default: { sources: Number.POSITIVE_INFINITY, maxResults: 30, maxPerStream: 10 },
  deep: { sources: Number.POSITIVE_INFINITY, maxResults: 60, maxPerStream: 14 },
};

const LENS_CAPABILITIES: Record<string, CapabilityName[]> = {
  official: ["web", "github", "rss", "arxiv"],
  community: ["reddit", "x", "hackernews", "youtube"],
  limitations: ["reddit", "hackernews", "github", "web", "youtube"],
  alternatives: ["reddit", "github", "web", "youtube", "hackernews"],
  recent: ["x", "web", "hackernews", "rss", "reddit"],
};

const BREAKING = /\b(today|tonight|this week|breaking|just happened|latest|right now|currently|current news|reaction)\b/i;
const PREDICTION = /\b(predict|prediction|odds|chance|probability|will .* happen|likely to happen|forecast)\b/i;
const COMPARISON = /\b(vs\.?|versus|compare|comparison|better than|difference between)\b/i;
const HOW_TO = /\b(how do i|how to|best way to|workflow|setup|configure|tutorial|guide)\b/i;
const OPINION = /\b(what do people|what are people|everyone saying|community|sentiment|reviews?|complaints?|opinions?|reaction to)\b/i;
const PRODUCT = /\b(buy|purchase|product|tool|app|service|worth it|pricing|price|alternative|recommend)\b/i;

export function classifyResearchIntent(query: string): ResearchIntent {
  if (PREDICTION.test(query)) return "prediction";
  if (BREAKING.test(query)) return "breaking_news";
  if (COMPARISON.test(query)) return "comparison";
  if (HOW_TO.test(query)) return "how_to";
  if (OPINION.test(query)) return "opinion";
  if (PRODUCT.test(query)) return "product";
  return "factual";
}

function rankedAvailableCapabilities(intent: ResearchIntent, available: readonly CapabilityName[]): CapabilityName[] {
  const availableSet = new Set(available);
  const ordered = SOURCE_PRIORITY[intent].filter((capability) => availableSet.has(capability));
  const known = new Set(ordered);
  const remaining = available.filter((capability) => !known.has(capability)).sort();
  return [...ordered, ...remaining];
}

function sourceWeights(capabilities: CapabilityName[]): Record<string, number> {
  const weights: Record<string, number> = {};
  capabilities.forEach((capability, index) => {
    weights[capability] = Math.max(0.55, 1 - (index * 0.08));
  });
  return weights;
}

function lensCapabilities(
  label: string,
  available: readonly CapabilityName[],
  fallback: readonly CapabilityName[],
): CapabilityName[] {
  const availableSet = new Set(available);
  const preferred = (LENS_CAPABILITIES[label] ?? fallback).filter((capability) => availableSet.has(capability));
  const result = preferred.length > 0 ? preferred : fallback.filter((capability) => availableSet.has(capability));
  return result.slice(0, 4);
}

function multiLensSubqueries(
  query: string,
  depth: ResearchDepth,
  selected: CapabilityName[],
): EvidenceSubquery[] {
  const subqueries: EvidenceSubquery[] = [{
    label: "primary",
    query: query.trim(),
    weight: 1,
    capabilities: selected.slice(0, depth === "quick" ? 3 : 5),
  }];
  if (depth === "quick") return subqueries;

  subqueries.push(
    {
      label: "official",
      query: `${query.trim()} official documentation announcement primary source`,
      weight: 0.96,
      capabilities: lensCapabilities("official", selected, selected),
    },
    {
      label: "community",
      query: `${query.trim()} user experience community discussion reviews`,
      weight: 0.88,
      capabilities: lensCapabilities("community", selected, selected),
    },
    {
      label: "limitations",
      query: `${query.trim()} limitations risks problems criticism`,
      weight: 0.84,
      capabilities: lensCapabilities("limitations", selected, selected),
    },
  );

  if (depth === "deep") {
    subqueries.push(
      {
        label: "alternatives",
        query: `${query.trim()} alternatives comparison tradeoffs`,
        weight: 0.82,
        capabilities: lensCapabilities("alternatives", selected, selected),
      },
      {
        label: "recent",
        query: `${query.trim()} latest recent update`,
        weight: 0.9,
        capabilities: lensCapabilities("recent", selected, selected),
      },
    );
  }

  return subqueries.filter((subquery) => subquery.capabilities.length > 0);
}

export function planEvidence(
  query: string,
  availableCapabilities: readonly CapabilityName[],
  depth: ResearchDepth = "quick",
  forcedIntent?: ResearchIntent,
): QueryPlan {
  const intent = forcedIntent ?? classifyResearchIntent(query);
  const budget = DEPTH_BUDGETS[depth];
  const selected = rankedAvailableCapabilities(intent, availableCapabilities).slice(0, budget.sources);

  return {
    query: query.trim(),
    intent,
    depth,
    sourceWeights: sourceWeights(selected),
    subqueries: multiLensSubqueries(query, depth, selected),
    maxResults: budget.maxResults,
    maxPerStream: budget.maxPerStream,
  };
}

export function sourcePriorityFor(intent: ResearchIntent): readonly CapabilityName[] {
  return SOURCE_PRIORITY[intent];
}
