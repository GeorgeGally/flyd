import { createStore, type HybridQueryResult } from "@tobilu/qmd";
import { mkdir } from "fs/promises";
import { homedir } from "os";
import { join, resolve } from "path";
import { RAW_DIR, WIKI_DIR } from "./config.js";
import { expandQuery as expandQueryOpenAI, type ExpandedQuery } from "./query-expansion.js";

function getDbPath(): string {
  const cacheDir = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(cacheDir, "qmd", "index.sqlite");
}

async function initializeStore() {
  await Promise.all([
    mkdir(RAW_DIR, { recursive: true, mode: 0o700 }),
    mkdir(WIKI_DIR, { recursive: true, mode: 0o700 }),
  ]);
  const store = await createStore({ dbPath: getDbPath() });
  const collections = await store.listCollections();
  for (const [name, path] of [ [ "flyd-raw", RAW_DIR ], [ "flyd-wiki", WIKI_DIR ] ] as const) {
    const current = collections.find((collection) => collection.name === name);
    if (!current || resolve(current.pwd) !== resolve(path)) {
      await store.addCollection(name, { path, pattern: "**/*.md" });
    }
  }
  return store;
}

let storePromise: ReturnType<typeof initializeStore> | null = null;

async function getStore() {
  if (!storePromise) {
    storePromise = initializeStore();
  }
  return storePromise;
}

function normalizeResults(
  results: Array<{ displayPath: string; score: number }>,
  prefix: string,
): Array<{ path: string; score: number }> {
  return results.map((r) => ({
    path: r.displayPath.startsWith(prefix) ? r.displayPath.slice(prefix.length) : r.displayPath,
    score: Math.round(r.score * 100),
  }));
}

function mergeResults(
  ftsResults: Array<{ path: string; score: number }>,
  vecResults: Array<{ path: string; score: number }>,
): Array<{ path: string; score: number }> {
  // Simple RRF: reciprocal rank fusion
  const k = 60;
  const scores = new Map<string, number>();

  for (let i = 0; i < ftsResults.length; i++) {
    const r = ftsResults[i];
    scores.set(r.path, (scores.get(r.path) ?? 0) + 1 / (k + i + 1));
  }

  for (let i = 0; i < vecResults.length; i++) {
    const r = vecResults[i];
    scores.set(r.path, (scores.get(r.path) ?? 0) + 1 / (k + i + 1));
  }

  const merged = [...scores.entries()]
    .map(([path, score]) => ({ path, score: Math.round(score * 1000) }))
    .sort((a, b) => b.score - a.score);

  return merged;
}

async function searchWithExpansion(
  expanded: ExpandedQuery[],
  collection: string,
  limit: number,
): Promise<Array<{ path: string; score: number }>> {
  const prefix = collection + "/";
  const store = await getStore();

  // Get the default embed model from the store (runtime property, not in TS types)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const embedModel = String((store as any).llm?.embedModelName ?? "");

  // Run BM25 with the lex query (or first expanded query)
  const lexQuery = expanded.find((e) => e.type === "lex")?.query ?? expanded[0]?.query ?? "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ftsResults = lexQuery
    ? normalizeResults(await (store as any).searchFTS(lexQuery, limit * 2, collection), prefix)
    : [];

  // Run vector search with the vec/hyde query
  const vecQuery = expanded.find((e) => e.type === "vec" || e.type === "hyde")?.query ?? lexQuery;
  let vecResults: Array<{ path: string; score: number }> = [];
  if (vecQuery && embedModel) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vecResults = normalizeResults(
        await (store as any).searchVec(vecQuery, embedModel, limit * 2, collection),
        prefix,
      );
    } catch (err) {
      // Vector search may fail if embeddings aren't ready
      console.error("qmd vector search failed:", err instanceof Error ? err.message : String(err));
    }
  }

  // Merge with RRF
  const merged = mergeResults(ftsResults, vecResults);
  return merged.slice(0, limit);
}

export async function search(
  query: string,
  collection: string,
  limit = 20,
): Promise<Array<{ path: string; score: number }>> {
  const prefix = collection + "/";

  // Attempt 1: Native QMD hybrid search (with local Llama expansion + reranking)
  try {
    const store = await getStore();
    const results = await store.search({
      query,
      collection,
      limit,
      rerank: true,
    });
    return normalizeResults(results, prefix);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("qmd native search failed:", msg);

    // If it's the LlamaGrammar error, use OpenAI expansion
    if (msg.includes("LlamaGrammar") || msg.includes("different Llama instance")) {
      console.error("using OpenAI-based query expansion fallback...");
      const expanded = await expandQueryOpenAI(query);
      return searchWithExpansion(expanded, collection, limit);
    }

    // For other errors, fall back to bare BM25
    console.error("falling back to BM25");
    try {
      const store = await getStore();
      const results = await store.searchLex(query, { collection, limit });
      return normalizeResults(results, prefix);
    } catch (fallbackErr) {
      console.error("qmd BM25 fallback also failed:", fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr));
      return [];
    }
  }
}

export async function updateRaw(): Promise<void> {
  try {
    await updateRawStrict();
  } catch {
    // non-fatal
  }
}

export async function updateRawStrict(): Promise<void> {
  const store = await getStore();
  await store.update({ collections: ["flyd-raw"] });
}

export async function embedRaw(): Promise<void> {
  try {
    const store = await getStore();
    await store.embed({ collection: "flyd-raw" });
  } catch {
    // non-fatal
  }
}

export async function closeStore(): Promise<void> {
  if (storePromise) {
    try {
      const store = await storePromise;
      await store.close();
    } catch {
      // non-fatal
    }
    storePromise = null;
  }
}
