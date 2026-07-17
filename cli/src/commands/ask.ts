import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { hasApiKey, defaultModel, RAW_DIR, WIKI_DIR } from "../lib/config.js";
import { parse } from "../lib/frontmatter.js";
import { query } from "../lib/llm.js";
import { getStaleness, stalenessSummary, type StalenessResult } from "../lib/staleness.js";
import { getActiveInterests } from "../lib/interests.js";
import { retrieveRankedBrainEvidence } from "../lib/brain-retrieval.js";
import {
  extractKeywords,
  searchWiki,
  buildRawEntries,
  mergeEntries,
  QMD_RAW_COLLECTION,
  MAX_ENTRIES,
  type BaseEntry,
} from "../lib/retrieval.js";
import { walkWikiFiles } from "../lib/wiki.js";
import {
  scoreEvidence,
  corroborate,
  estimateSufficiency,
  formatLibrarianSummary,
  type EvidenceEntry,
  type ScoredEvidence,
} from "../lib/librarian.js";

export interface RetrievedEntry extends BaseEntry {
  fullPath: string;
  staleness: StalenessResult | null;
}

export function buildEntries(results: Array<{ path: string; score: number }>, keywords: string[]): RetrievedEntry[] {
  const baseEntries = buildRawEntries(results, keywords);
  const entries: RetrievedEntry[] = [];

  for (const e of baseEntries) {
    const fullPath = join(RAW_DIR, e.path);
    const staleness = getStaleness(fullPath, e.metadata);

    entries.push({
      ...e,
      fullPath,
      staleness,
    });
  }

  return entries;
}

function buildSystemPrompt(question: string): string {
  const activeInterests = getActiveInterests();
  const interestContext = activeInterests.length > 0
    ? `\nYour user has active interests in: ${activeInterests.map(i => i.topic).join(", ")}. If the question relates to these, prioritize relevant evidence.\n`
    : "";

  return `You are a personal memory system. Answer using only the evidence below.
Rules:
- Synthesize from multiple sources when possible. If the evidence contains relevant information spread across multiple files, combine it into a coherent answer.
- If the question asks for a list, list every item that matches the question — omit anything that does not match.
- The word or name in the question appears in the evidence — use it. Do not refuse to answer if you can see the topic in the evidence. For example, if asked "tell me about X" and evidence mentions X, describe what it says about X.
- Only say you don't have information if NO evidence mentions the topic at all.
- Cite source path for each claim using [raw:filename] or [wiki:path] notation.
- If evidence is incomplete or uncertain, say so explicitly.
- If all returned evidence is stale (>30 days old), note this explicitly.${interestContext}`;
}

function buildPrompt(question: string, entries: RetrievedEntry[], scored?: ScoredEvidence[]): string {
  const evidence = entries
    .map((e, i) => {
      const timestamp = e.metadata.timestamp ? ` (${e.metadata.timestamp})` : "";
      const staleNote = e.staleness?.message ? ` ⚠ ${e.staleness.message}` : "";
      const sourceTag = e.source === "wiki" ? "wiki" : "raw";
      const scoreNote = scored?.[i] ? ` 📊${(scored[i].librarianScore * 100).toFixed(0)}%` : "";
      return `[${sourceTag}:${e.path}]${timestamp}${staleNote}${scoreNote}\n${e.body.trim()}`;
    })
    .join("\n\n---\n\n");

  let librarianSection = "";
  if (scored) {
    const sufficiency = estimateSufficiency(scored, question);
    librarianSection = `\n\n## Librarian Assessment\nSufficiency: ${sufficiency.verdict} — ${sufficiency.reason}\n`;
  }

  return `## Evidence
${evidence}${librarianSection}

## Question
${question}`;
}

function formatEvidence(entries: RetrievedEntry[], scored?: ScoredEvidence[]): string {
  const warnings = stalenessSummary(entries);
  const lines: string[] = [];

  if (warnings.length) {
    for (const w of warnings) lines.push(`⚠ ${w}`);
    lines.push("");
  }

  for (const e of entries) {
    const staleFlag = e.staleness?.veryStale ? " ⚠️" : e.staleness?.stale ? " ⚡" : "";
    const timestamp = e.metadata.timestamp ? ` (${e.metadata.timestamp})` : "";
    const sourceTag = e.source === "wiki" ? "wiki" : "raw";
    const scoreEntry = scored?.find((s) => s.path === e.path);
    const libScore = scoreEntry ? ` 📊${(scoreEntry.librarianScore * 100).toFixed(0)}%` : "";
    lines.push(`[${sourceTag}]${staleFlag}${libScore} ${e.path}${timestamp} (score=${e.score}%)`);
  }
  return lines.join("\n");
}

export async function runAsk(question: string, model?: string, opts?: { librarian?: boolean }): Promise<void> {
  const m = model ?? defaultModel();
  const keywords = extractKeywords(question);
  const retrieval = await retrieveRankedBrainEvidence(question);
  const entries = retrieval.entries.map((entry) => ({
    ...entry,
    fullPath: join(entry.source === "wiki" ? WIKI_DIR : RAW_DIR, entry.path),
  })) as RetrievedEntry[];

  // If nothing found, use LLM to find relevant wiki pages by title/summary
  if (!entries.length && hasApiKey(m)) {
    const wikiFiles = walkWikiFiles();
    if (wikiFiles.length > 0) {
      const pageList = wikiFiles
        .map((f) => f.replace(WIKI_DIR + "/", ""))
        .map((p) => {
          const name = p.replace(/\.md$/, "").split("/").join(" → ");
          return `- ${name}`;
        })
        .join("\n");

      const fallbackPrompt = `You have this wiki. Which pages are relevant to: "${question}"?

${pageList}

Return ONLY a JSON array of wiki page paths. Example: ["projects/radarboy/graffiti-machine.md"]
If no page is relevant, return [].`;
      try {
        const response = await query(fallbackPrompt, m);
        const match = response.match(/\[[\s\S]*\]/);
        if (match) {
          const paths: string[] = JSON.parse(match[0]);
          for (const p of paths) {
            const wikiPath = p.endsWith(".md") ? p : p + ".md";
            const fullPath = join(WIKI_DIR, wikiPath);
            if (existsSync(fullPath)) {
              const content = readFileSync(fullPath, "utf8");
              const parsed = parse(content);
              entries.push({
                path: wikiPath,
                body: parsed.body,
                score: 85,
                metadata: parsed.metadata,
                source: "wiki",
                fullPath,
                staleness: getStaleness(fullPath, parsed.metadata),
              } as RetrievedEntry);
            }
          }
        }
      } catch {}
    }
  }

  if (!entries.length) {
    console.log("no captures found");
    return;
  }

  // Run librarian evaluation if requested
  let scored: ScoredEvidence[] | undefined;
  if (opts?.librarian) {
    const evidenceEntries: EvidenceEntry[] = entries.map((e) => ({
      path: e.path,
      body: e.body,
      source: e.source,
      score: e.score,
      metadata: e.metadata,
      staleness: e.staleness,
    }));
    scored = evidenceEntries.map((e) => scoreEvidence(e, keywords, question));
    scored = corroborate(scored);
  }

  const evidenceSummary = formatEvidence(entries, scored);

  if (!hasApiKey(m)) {
    console.log(`evidence:\n${evidenceSummary}`);
    return;
  }

  const librarianSummary = scored ? formatLibrarianSummary(scored, estimateSufficiency(scored, question)) : "";
  const answer = await query(buildPrompt(question, entries, scored), m, buildSystemPrompt(question));

  console.log(answer);
  console.log(`\n---\nevidence:\n${evidenceSummary}`);
  if (librarianSummary) {
    console.log(`\n${librarianSummary}`);
  }
}

// Re-export shared functions for backward compatibility (index.ts librarian command)
export { extractKeywords, searchWiki, mergeEntries, QMD_RAW_COLLECTION, MAX_ENTRIES };
