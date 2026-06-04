import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { RAW_DIR } from "../lib/config.js";
import { parse } from "../lib/frontmatter.js";
import { search } from "../lib/qmd.js";

interface RetrievedEntry {
  path: string;
  body: string;
  score: number;
  metadata: Record<string, unknown>;
}

const QMD_RAW_COLLECTION = "flyd-raw";

function buildEntries(results: Array<{ path: string; score: number }>): RetrievedEntry[] {
  const entries: RetrievedEntry[] = [];

  for (const result of results) {
    const fullPath = join(RAW_DIR, result.path);

    if (!existsSync(fullPath)) continue;

    const content = readFileSync(fullPath, "utf8");
    const parsed = parse(content);

    entries.push({
      path: result.path,
      body: parsed.body,
      score: result.score,
      metadata: parsed.metadata,
    });
  }

  return entries;
}

export async function runSearch(query: string): Promise<void> {
  const results = await search(query, QMD_RAW_COLLECTION);
  const entries = buildEntries(results);

  if (!entries.length) {
    console.log("no raw captures found");
    return;
  }

  console.log(`## Evidence (${entries.length} entries)\n`);
  for (const e of entries) {
    const timestamp = e.metadata.timestamp ? ` (${e.metadata.timestamp})` : "";
    console.log(`[raw] ${e.path}${timestamp} (score=${e.score}%)`);
    console.log(e.body.trim().slice(0, 500));
    if (e.body.trim().length > 500) console.log("...");
    console.log("");
  }
}
