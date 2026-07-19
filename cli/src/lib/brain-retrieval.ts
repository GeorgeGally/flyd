import { createHash } from "crypto";
import { join } from "path";
import { RAW_DIR, WIKI_DIR } from "./config.js";
import { getInterestKeywords } from "./interests.js";
import { searchGraph as defaultSearchGraph } from "./graph.js";
import { scoreEvidence, corroborate, estimateSufficiency, type ScoredEvidence, type SufficiencyAssessment } from "./librarian.js";
import { search } from "./qmd.js";
import {
  augmentWithGraph,
  buildRawEntries,
  extractKeywords,
  mergeEntries,
  searchWiki as defaultSearchWiki,
  QMD_RAW_COLLECTION,
  MAX_ENTRIES,
  type BaseEntry,
} from "./retrieval.js";
import { getStaleness } from "./staleness.js";
import { isPollutedCapture } from "./brain-state.js";

export interface BrainRetrievalDependencies {
  searchRaw: (query: string, keywords: string[]) => Promise<BaseEntry[]>;
  searchWiki: (query: string, keywords: string[]) => BaseEntry[];
  searchGraph: (query: string) => Array<{ from: string; to: string; rel_type: string; confidence: number; source: string }>;
  now: () => Date;
}

export interface MemoryMatch {
  id: string;
  type: "memory_match";
  source: "cli.retrieval";
  epistemicStatus: "observation" | "user_confirmed";
  confidence: number;
  generatedAt: string;
  evidenceRefs: string[];
  content: {
    path: string;
    archive: "raw" | "wiki";
    excerpt: string;
    retrievalScore: number;
    recencyWeight: number;
    reliabilityWeight: number;
    corroborationCount: number;
    stale: boolean;
    lastUpdated: string | null;
  };
}

export interface BrainRetrievalResult {
  version: "1.0";
  source: "flyd-cli";
  query: string;
  generatedAt: string;
  sufficiency: SufficiencyAssessment;
  matches: MemoryMatch[];
}

export interface RankedBrainRetrieval {
  query: string;
  generatedAt: string;
  sufficiency: SufficiencyAssessment;
  entries: ScoredEvidence[];
}

const defaults: BrainRetrievalDependencies = {
  searchRaw: async (query, keywords) => buildRawEntries(await search(query, QMD_RAW_COLLECTION), keywords),
  searchWiki: defaultSearchWiki,
  searchGraph: (query) => defaultSearchGraph(query, 1),
  now: () => new Date(),
};

function stableId(path: string, body: string): string {
  const digest = createHash("sha256").update(`${path}\0${body}`).digest("hex").slice(0, 16);
  return `memory_match:${digest}`;
}

function memoryEpistemicStatus(entry: ScoredEvidence): "observation" | "user_confirmed" {
  if (entry.source === "wiki") return "user_confirmed";
  if (entry.metadata.type === "flyd-runtime-task-corrected") return "user_confirmed";
  return "observation";
}

export async function retrieveBrainEvidence(
  query: string,
  dependencies: BrainRetrievalDependencies = defaults,
): Promise<BrainRetrievalResult> {
  const ranked = await retrieveRankedBrainEvidence(query, dependencies);

  return {
    version: "1.0",
    source: "flyd-cli",
    query,
    generatedAt: ranked.generatedAt,
    sufficiency: ranked.sufficiency,
    matches: ranked.entries.map((entry) => ({
      id: stableId(entry.path, entry.body),
      type: "memory_match",
      source: "cli.retrieval",
      epistemicStatus: memoryEpistemicStatus(entry),
      confidence: entry.librarianScore,
      generatedAt: ranked.generatedAt,
      evidenceRefs: [],
      content: {
        path: entry.path,
        archive: entry.source,
        excerpt: entry.body.trim().slice(0, 1_200),
        retrievalScore: entry.score,
        recencyWeight: entry.recencyWeight,
        reliabilityWeight: entry.reliabilityWeight,
        corroborationCount: entry.corroborationCount,
        stale: entry.staleness?.stale ?? false,
        lastUpdated: entry.staleness?.lastUpdated ?? null,
      },
    })),
  };
}

export async function retrieveRankedBrainEvidence(
  query: string,
  dependencies: BrainRetrievalDependencies = defaults,
): Promise<RankedBrainRetrieval> {
  const keywords = extractKeywords(query);
  const interestBoost = getInterestKeywords(query);
  const searchQuery = interestBoost ? `${query} ${interestBoost}` : query;
  const [rawEntries, wikiEntries] = await Promise.all([
    dependencies.searchRaw(searchQuery, keywords),
    Promise.resolve(dependencies.searchWiki(searchQuery, keywords)),
  ]);
  const cleanRaw = rawEntries.filter((entry) => !isPollutedCapture({ body: entry.body, metadata: entry.metadata }));
  let entries = mergeEntries(cleanRaw, wikiEntries);
  entries = augmentWithGraph(entries, dependencies.searchGraph(searchQuery));

  const scored = corroborate(entries.map((entry) => scoreEvidence({
    ...entry,
    staleness: getStaleness(join(entry.source === "wiki" ? WIKI_DIR : RAW_DIR, entry.path), entry.metadata),
  }, keywords, query))).sort((a, b) => b.librarianScore - a.librarianScore).slice(0, MAX_ENTRIES);
  const generatedAt = dependencies.now().toISOString();

  return {
    query,
    generatedAt,
    sufficiency: estimateSufficiency(scored, query),
    entries: scored,
  };
}
