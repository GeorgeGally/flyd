import { createHash } from "crypto";
import { join } from "path";
import { RAW_DIR, WIKI_DIR } from "./config.js";
import { getInterestKeywords } from "./interests.js";
import { searchGraph as defaultSearchGraph } from "./graph.js";
import { scoreEvidence, corroborate, countContradictions, estimateSufficiency, type ScoredEvidence, type SufficiencyAssessment, type ConfidenceProfile } from "./librarian.js";
import { search, searchLexical } from "./qmd.js";
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
import { classifyRecallIntent, type RecallIntent } from "./recall-intent.js";
import { buildPresentModel, type PresentModel } from "./present-model.js";
import { gateCurrentness } from "./currentness-gate.js";
import type { RecentCommit } from "./recent-commits.js";

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
  epistemicStatus: string;
  confidence: number;
  confidenceProfile: ConfidenceProfile;
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
    isCurrent: boolean;
  };
}

export interface BrainRetrievalResult {
  version: "1.0";
  source: "flyd-cli";
  query: string;
  generatedAt: string;
  sufficiency: SufficiencyAssessment;
  matches: MemoryMatch[];
  intent?: RecallIntent;
  presentModel?: PresentModel | null;
}

export interface RankedBrainRetrieval {
  query: string;
  generatedAt: string;
  sufficiency: SufficiencyAssessment;
  entries: ScoredEvidence[];
  intent: RecallIntent;
  presentModel: PresentModel | null;
}

const defaults: BrainRetrievalDependencies = {
  searchRaw: async (query, keywords) => buildRawEntries(await search(query, QMD_RAW_COLLECTION), keywords),
  searchWiki: defaultSearchWiki,
  searchGraph: (query) => defaultSearchGraph(query, 1),
  now: () => new Date(),
};

const lexicalDefaults: BrainRetrievalDependencies = {
  ...defaults,
  searchRaw: async (query, keywords) => buildRawEntries(await searchLexical(query, QMD_RAW_COLLECTION), keywords),
};

const FANOUT_KEYWORD_CAP = 4;

export function mergeSearchResults(
  batches: Array<Array<{ path: string; score: number }>>,
): Array<{ path: string; score: number }> {
  const byPath = new Map<string, number>();
  for (const batch of batches) {
    for (const result of batch) {
      const existing = byPath.get(result.path);
      if (existing === undefined || result.score > existing) byPath.set(result.path, result.score);
    }
  }
  return [...byPath.entries()]
    .map(([path, score]) => ({ path, score }))
    .sort((a, b) => b.score - a.score);
}

// QMD's lexical search joins every token with AND, so one non-matching token
// (a stop word, an app name) zeroes the whole query. When the full query
// misses, retry each extracted keyword separately and merge.
export function createResilientLexicalSearchRaw(
  searchFn: (query: string, collection: string, limit?: number) => Promise<Array<{ path: string; score: number }>> = searchLexical,
  buildEntries: typeof buildRawEntries = buildRawEntries,
): BrainRetrievalDependencies["searchRaw"] {
  return async (query, keywords) => {
    const primary = buildEntries(await searchFn(query, QMD_RAW_COLLECTION), keywords);
    if (primary.length > 0) return primary;
    if (keywords.length === 0) return primary;

    const batches = await Promise.all(
      keywords.slice(0, FANOUT_KEYWORD_CAP).map((kw) => searchFn(kw, QMD_RAW_COLLECTION)),
    );
    return buildEntries(mergeSearchResults(batches), keywords, 1);
  };
}

const resilientLexicalDefaults: BrainRetrievalDependencies = {
  ...defaults,
  searchRaw: createResilientLexicalSearchRaw(),
};

function stableId(path: string, body: string): string {
  const digest = createHash("sha256").update(`${path}\0${body}`).digest("hex").slice(0, 16);
  return `memory_match:${digest}`;
}

const WIKI_STATUS_MAP: Record<string, string> = {
  canon: "verified",
  working: "working_assumption",
  speculative: "speculative",
  questioned: "questioned",
  unresolved: "unresolved",
  contradictory: "contradictory",
  dormant: "dormant",
  episodic: "episodic",
};

function memoryEpistemicStatus(entry: ScoredEvidence): string {
  if (entry.metadata.type === "conversation-index" || entry.metadata.promoted === false) return "observation";
  if (entry.metadata.type === "flyd-runtime-task-corrected") return "user_confirmed";
  if (entry.source === "wiki") {
    const status = entry.metadata.status as string | undefined;
    return status && WIKI_STATUS_MAP[status] ? WIKI_STATUS_MAP[status] : "working_assumption";
  }
  return "observation";
}

const COMMIT_FRESHNESS_DECAY_HOURS = 14 * 24;

function freshnessFromCommitAge(committedAt: string, now: Date): number {
  const hoursSince = (now.getTime() - new Date(committedAt).getTime()) / (1000 * 60 * 60);
  return Math.max(0, Math.min(1, 1 - hoursSince / COMMIT_FRESHNESS_DECAY_HOURS));
}

// Recent commits are direct, authoritative live observations, not inferred
// claims — they bypass gateCurrentness() entirely rather than needing to
// corroborate against themselves. epistemicConfidence stays 1.0 regardless
// of age (per the no-recency-in-epistemicConfidence invariant); recency
// lives only in freshness.
function buildCommitEvidence(commit: RecentCommit, now: Date): ScoredEvidence {
  const freshness = freshnessFromCommitAge(commit.committedAt, now);
  return {
    path: `git:commit:${commit.shortHash}`,
    body: commit.subject,
    source: "raw",
    score: 95,
    metadata: { type: "live-commit", commitHash: commit.hash, committedAt: commit.committedAt },
    staleness: null,
    librarianScore: 0.95,
    recencyWeight: freshness,
    reliabilityWeight: 1,
    interestBoost: 0,
    corroborationCount: 0,
    contradictionCount: 0,
    confidenceProfile: {
      epistemicConfidence: 1,
      freshness,
      interestAffinity: 0,
      retrievalUtility: 0.5,
      associationStrength: 0,
    },
    isCurrent: true,
  };
}

export async function retrieveBrainEvidence(
  query: string,
  dependencies: BrainRetrievalDependencies = defaults,
  projectRoot?: string,
): Promise<BrainRetrievalResult> {
  const ranked = await retrieveRankedBrainEvidence(query, dependencies, projectRoot);

  return {
    version: "1.0",
    source: "flyd-cli",
    query,
    generatedAt: ranked.generatedAt,
    sufficiency: ranked.sufficiency,
    intent: ranked.intent,
    presentModel: ranked.presentModel,
    matches: ranked.entries.map((entry) => ({
      id: stableId(entry.path, entry.body),
      type: "memory_match",
      source: "cli.retrieval",
      epistemicStatus: memoryEpistemicStatus(entry),
      confidence: entry.librarianScore,
      confidenceProfile: entry.confidenceProfile,
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
        isCurrent: entry.isCurrent ?? false,
      },
    })),
  };
}

export async function retrieveLexicalBrainEvidence(query: string, projectRoot?: string): Promise<BrainRetrievalResult> {
  return retrieveBrainEvidence(query, lexicalDefaults, projectRoot);
}

export async function retrieveResilientLexicalBrainEvidence(query: string, projectRoot?: string): Promise<BrainRetrievalResult> {
  return retrieveBrainEvidence(query, resilientLexicalDefaults, projectRoot);
}

export async function retrieveRankedLexicalBrainEvidence(query: string, projectRoot?: string): Promise<RankedBrainRetrieval> {
  return retrieveRankedBrainEvidence(query, lexicalDefaults, projectRoot);
}

export async function retrieveRankedBrainEvidence(
  query: string,
  dependencies: BrainRetrievalDependencies = defaults,
  projectRoot?: string,
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
  const graphResults = dependencies.searchGraph(searchQuery);
  entries = augmentWithGraph(entries, graphResults);

  const scored = countContradictions(corroborate(entries.map((entry) => scoreEvidence({
    ...entry,
    staleness: getStaleness(join(entry.source === "wiki" ? WIKI_DIR : RAW_DIR, entry.path), entry.metadata),
  }, keywords, query))), graphResults).sort((a, b) => b.librarianScore - a.librarianScore).slice(0, MAX_ENTRIES);
  const generatedAt = dependencies.now().toISOString();

  const intent = classifyRecallIntent(query);
  const commitLimit = intent.kind === "task_resume" ? 15 : 5;
  const presentModel = intent.kind === "current_state" || intent.kind === "task_resume"
    ? await buildPresentModel(process.cwd(), undefined, commitLimit, projectRoot).catch(() => null)
    : null;
  const currentPaths = gateCurrentness(scored, presentModel, intent);
  for (const entry of scored) {
    entry.isCurrent = currentPaths.has(entry.path);
  }

  if (projectRoot) {
    const projectName = projectRoot.split("/").pop()?.toLowerCase() ?? "";
    const projectBoost = 0.05;
    for (const entry of scored) {
      const pathLower = entry.path.toLowerCase();
      if (pathLower.startsWith(projectRoot.toLowerCase()) || pathLower.includes(projectName)) {
        entry.librarianScore = Math.min(1, entry.librarianScore + projectBoost);
        entry.confidenceProfile.retrievalUtility = Math.min(1, entry.confidenceProfile.retrievalUtility + projectBoost);
      }
    }
    scored.sort((a, b) => b.librarianScore - a.librarianScore);
  }

  // Sufficiency reflects real archive evidence only — synthetic commit
  // entries are added after, so they can't inflate an otherwise-empty
  // archive into a false "sufficient" verdict.
  const sufficiency = estimateSufficiency(scored, query);
  const commitEntries = (presentModel?.recentCommits ?? []).map((commit) =>
    buildCommitEvidence(commit, dependencies.now()),
  );

  return {
    query,
    generatedAt,
    sufficiency,
    entries: [...commitEntries, ...scored],
    intent,
    presentModel,
  };
}
