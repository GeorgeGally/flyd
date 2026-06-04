import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { hasApiKey, defaultModel, RAW_DIR } from "../lib/config.js";
import { parse } from "../lib/frontmatter.js";
import { query } from "../lib/llm.js";
import { getStaleness, stalenessSummary, type StalenessResult } from "../lib/staleness.js";
import { search } from "../lib/qmd.js";
import { getActiveInterests, getInterestKeywords } from "../lib/interests.js";

interface RetrievedEntry {
  path: string;
  fullPath: string;
  body: string;
  score: number;
  metadata: Record<string, unknown>;
  staleness: StalenessResult | null;
}

const QMD_RAW_COLLECTION = "flyd-raw";

function buildEntries(results: Array<{ path: string; score: number }>): RetrievedEntry[] {
  const entries: RetrievedEntry[] = [];

  for (const result of results) {
    const fullPath = join(RAW_DIR, result.path);

    if (!existsSync(fullPath)) continue;

    const content = readFileSync(fullPath, "utf8");
    const parsed = parse(content);
    const metadata = parsed.metadata;
    const body = parsed.body;
    const staleness = getStaleness(fullPath, metadata);

    entries.push({
      path: result.path,
      fullPath,
      body,
      score: result.score,
      metadata,
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

  return `You are a personal memory system. Answer using only the raw captures below.
Rules:
- Synthesize from multiple captures when possible. If the evidence contains relevant information spread across multiple files, combine it into a coherent answer.
- If the question asks for a list, list every item that matches the question — omit anything that does not match.
- The word or name in the question appears in the evidence — use it. Do not refuse to answer if you can see the topic in the captures. For example, if asked "tell me about X" and a capture mentions X, describe what the capture says about X.
- Only say you don't have information if NO capture mentions the topic at all.
- Cite source path for each claim using [raw:filename] notation.
- If evidence is incomplete or uncertain, say so explicitly.
- If all returned evidence is stale (>30 days old), note this explicitly.${interestContext}`;
}

function buildPrompt(question: string, entries: RetrievedEntry[]): string {
  const evidence = entries
    .map((e) => {
      const timestamp = e.metadata.timestamp ? ` (${e.metadata.timestamp})` : "";
      const staleNote = e.staleness?.message ? ` ⚠ ${e.staleness.message}` : "";
      return `[raw:${e.path}]${timestamp}${staleNote}\n${e.body.trim()}`;
    })
    .join("\n\n---\n\n");

  return `## Evidence
${evidence}

## Question
${question}`;
}

function formatEvidence(entries: RetrievedEntry[]): string {
  const warnings = stalenessSummary(entries);
  const lines: string[] = [];

  if (warnings.length) {
    for (const w of warnings) lines.push(`⚠ ${w}`);
    lines.push("");
  }

  for (const e of entries) {
    const staleFlag = e.staleness?.veryStale ? " ⚠️" : e.staleness?.stale ? " ⚡" : "";
    const timestamp = e.metadata.timestamp ? ` (${e.metadata.timestamp})` : "";
    lines.push(`[raw]${staleFlag} ${e.path}${timestamp} (score=${e.score}%)`);
  }
  return lines.join("\n");
}

export async function runAsk(question: string, model?: string): Promise<void> {
  const m = model ?? defaultModel();

  const interestBoost = getInterestKeywords(question);
  const searchQuery = interestBoost ? `${question} ${interestBoost}` : question;
  const results = await search(searchQuery, QMD_RAW_COLLECTION);
  const entries = buildEntries(results);

  if (!entries.length) {
    console.log("no captures found");
    return;
  }

  const evidenceSummary = formatEvidence(entries);

  if (!hasApiKey(m)) {
    console.log(`evidence:\n${evidenceSummary}`);
    return;
  }

  const answer = await query(buildPrompt(question, entries), m, buildSystemPrompt(question));

  console.log(answer);
  console.log(`\n---\nevidence:\n${evidenceSummary}`);
}
