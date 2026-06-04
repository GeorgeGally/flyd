import { createStore, type HybridQueryResult } from "@tobilu/qmd";
import { homedir } from "os";
import { join } from "path";

function getDbPath(): string {
  const cacheDir = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(cacheDir, "qmd", "index.sqlite");
}

let storePromise: ReturnType<typeof createStore> | null = null;

async function getStore() {
  if (!storePromise) {
    storePromise = createStore({ dbPath: getDbPath() });
  }
  return storePromise;
}

export async function search(
  query: string,
  collection: string,
  limit = 20,
): Promise<Array<{ path: string; score: number }>> {
  const prefix = collection + "/";
  try {
    const store = await getStore();
    const results = await store.search({
      query,
      collection,
      limit,
      rerank: true,
    });
    return results.map((r: HybridQueryResult) => ({
      path: r.displayPath.startsWith(prefix) ? r.displayPath.slice(prefix.length) : r.displayPath,
      score: Math.round(r.score * 100),
    }));
  } catch {
    try {
      const store = await getStore();
      const results = await store.searchLex(query, { collection, limit });
      return results.map((r) => ({
        path: r.displayPath.startsWith(prefix) ? r.displayPath.slice(prefix.length) : r.displayPath,
        score: Math.round(r.score * 100),
      }));
    } catch {
      return [];
    }
  }
}

export async function updateRaw(): Promise<void> {
  try {
    const store = await getStore();
    await store.update({ collections: ["flyd-raw"] });
  } catch {
    // non-fatal
  }
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
