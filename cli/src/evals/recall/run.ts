import { createStore } from "@tobilu/qmd";
import { RAW_DIR } from "../../lib/config.js";
import { qmdDbPath, closeStore } from "../../lib/qmd.js";
import { retrieveBrainEvidence, retrieveLiveLexicalBrainEvidence, searchLiveWiki } from "../../lib/brain-retrieval.js";
import { searchGraph } from "../../lib/graph.js";
import { buildRawEntries, QMD_RAW_COLLECTION } from "../../lib/retrieval.js";
import { loadRecallCases } from "./schema.js";
import { shouldEscalateRecall, combineRecallMatches, rerankTemporalRecall } from "../../lib/recall-escalation.js";
import { scoreRecall, type RecallScoreRow } from "./score.js";

async function main() {
  const file = process.argv[2];
  if (!file || process.argv.length !== 3) throw new Error("Usage: tsx src/evals/recall/run.ts <private-labels.json>");
  const cases = loadRecallCases(file, RAW_DIR);
  const store = await createStore({ dbPath: qmdDbPath() });
  const rows: Record<string, Array<RecallScoreRow & { id: string; split: string; ms: number }>> = { lexical: [], hybrid: [], targeted: [] };
  try {
    for (const item of cases) {
      const start = performance.now();
      const lexical = await retrieveLiveLexicalBrainEvidence(item.query);
      const lexMs = Math.round(performance.now() - start);
      const hybridStart = performance.now();
      const hybrid = await retrieveBrainEvidence(item.query, {
        searchRaw: async (query, keywords) => {
          const found = await store.search({ query, collection: QMD_RAW_COLLECTION, limit: 20, rerank: true });
          return buildRawEntries(found.map((entry) => ({ path: entry.displayPath.replace(/^flyd-raw\//, ""), score: Math.round(entry.score * 100) })), keywords);
        },
        searchWiki: searchLiveWiki,
        searchGraph: (query) => searchGraph(query, 1),
        now: () => new Date(),
      });
      const hybridMs = Math.round(performance.now() - hybridStart);
      const base = { id: item.id, split: item.split, answers: item.answers.map((a) => a.path), stale: item.stale, noAnswer: item.category === "no-answer" };
      rows.lexical!.push({ ...base, paths: lexical.matches.map((match) => match.content.path), currentPaths: lexical.matches.filter((match) => match.content.isCurrent).map((match) => match.content.path), ms: lexMs });
      rows.hybrid!.push({ ...base, paths: hybrid.matches.map((match) => match.content.path), currentPaths: hybrid.matches.filter((match) => match.content.isCurrent).map((match) => match.content.path), ms: hybridMs });
      const escalate = shouldEscalateRecall(item.query, lexical.matches[0]?.content.excerpt ?? "");
      const matches = escalate && hybrid.matches.length ? combineRecallMatches(hybrid.matches, lexical.matches) : lexical.matches;
      rows.targeted!.push({ ...base, paths: rerankTemporalRecall(item.query, matches).map((match) => match.content.path), currentPaths: matches.filter((match) => match.content.isCurrent).map((match) => match.content.path), ms: lexMs + (escalate ? hybridMs : 0) });
      process.stderr.write(`completed ${item.id}\n`);
    }
  } finally { await store.close(); await closeStore(); }
  const results = Object.fromEntries(Object.entries(rows).map(([mode, results]) => [mode, Object.fromEntries(["development", "held-out"].map((split) => {
    const group = results.filter((row) => row.split === split);
    const times = group.map((row) => row.ms).sort((a, b) => a - b);
    return [split, { ...scoreRecall(group), medianMs: times[Math.floor(times.length / 2)] ?? 0 }];
  }))]));
  process.stdout.write(JSON.stringify({ results, cases: rows }, null, 2) + "\n");
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
