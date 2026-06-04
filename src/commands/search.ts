import { search } from "../lib/qmd.js";
import {
  extractKeywords,
  searchWiki,
  buildRawEntries,
  mergeEntries,
  QMD_RAW_COLLECTION,
  MAX_ENTRIES,
  type BaseEntry,
} from "../lib/retrieval.js";

export async function runSearch(query: string): Promise<void> {
  const keywords = extractKeywords(query);

  const rawResults = await search(query, QMD_RAW_COLLECTION);
  const rawEntries = buildRawEntries(rawResults, keywords);
  const wikiEntries = searchWiki(query, keywords);

  const entries = mergeEntries(rawEntries, wikiEntries);

  if (!entries.length) {
    console.log("no captures found");
    return;
  }

  console.log(`## Evidence (${entries.length} entries)\n`);
  for (const e of entries) {
    const timestamp = e.metadata.timestamp ? ` (${e.metadata.timestamp})` : "";
    console.log(`[${e.source}] ${e.path}${timestamp} (score=${e.score}%)`);
    console.log(e.body.trim().slice(0, 500));
    if (e.body.trim().length > 500) console.log("...");
    console.log("");
  }
}
