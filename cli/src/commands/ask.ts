import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { hasApiKey, defaultModel, RAW_DIR, WIKI_DIR } from "../lib/config.js";
import { parse } from "../lib/frontmatter.js";
import { query } from "../lib/llm.js";
import { getStaleness, stalenessSummary, type StalenessResult } from "../lib/staleness.js";
import { getActiveInterests } from "../lib/interests.js";
import {
  retrieveRankedBrainEvidence,
  retrieveRankedLexicalBrainEvidence,
} from "../lib/brain-retrieval.js";
import type { RecallIntent } from "../lib/recall-intent.js";
import type { PresentModel } from "../lib/present-model.js";
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
  /** Populated when this entry came from retrieveRankedBrainEvidence — see currentness-gate.ts. */
  isCurrent?: boolean;
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

export function buildPrompt(
  question: string,
  entries: RetrievedEntry[],
  scored?: ScoredEvidence[],
  intent?: RecallIntent,
  presentModel?: PresentModel | null,
): string {
  const currentEntries = entries.filter((e) => e.isCurrent === true);
  const backgroundEntries = entries.filter((e) => e.isCurrent !== true);

  const renderEntry = (e: RetrievedEntry, i: number): string => {
    const timestamp = e.metadata.timestamp ? ` (${e.metadata.timestamp})` : "";
    const staleNote = e.staleness?.message ? ` ⚠ ${e.staleness.message}` : "";
    const sourceTag = e.source === "wiki" ? "wiki" : "raw";
    const scoreNote = scored?.[i] ? ` 📊${(scored[i].librarianScore * 100).toFixed(0)}%` : "";
    return `[${sourceTag}:${e.path}]${timestamp}${staleNote}${scoreNote}\n${e.body.trim()}`;
  };

  const OBSERVATION_BACKGROUND_EXCERPT_CHARS = 160;
  // Matches memoryEpistemicStatus() in brain-retrieval.ts: any non-wiki raw
  // capture, or an explicitly unpromoted/conversation-index entry, maps to
  // "observation" — flyd's own lowest-authority tier ("source evidence, not
  // promoted long-term truth", never curated knowledge). Left full-length,
  // a detailed old raw capture reliably wins over terser current evidence
  // regardless of instructions (verified live, for both a conversation
  // transcript and an unrelated long-form raw report). Trimming keeps it
  // visible and citable — never removed — just less narratively compelling
  // than the actual current evidence above. Curated wiki memory (promoted
  // knowledge, corrections) is untouched.
  const isLowAuthorityObservation = (e: RetrievedEntry): boolean =>
    e.source !== "wiki" || e.metadata.type === "conversation-index" || e.metadata.promoted === false;

  const renderBackgroundEntry = (e: RetrievedEntry, i: number): string => {
    if (!isLowAuthorityObservation(e)) return renderEntry(e, i);
    const timestamp = e.metadata.timestamp ? ` (${e.metadata.timestamp})` : "";
    const sourceTag = e.source === "wiki" ? "wiki" : "raw";
    const trimmed = e.body.trim().slice(0, OBSERVATION_BACKGROUND_EXCERPT_CHARS);
    const truncatedNote = e.body.trim().length > OBSERVATION_BACKGROUND_EXCERPT_CHARS ? "…" : "";
    return `[${sourceTag}:${e.path}]${timestamp} (unpromoted observation — lowest authority)\n${trimmed}${truncatedNote}`;
  };

  let currentSection = "";
  const isResume = intent?.kind === "task_resume";
  if (intent?.kind === "current_state" || isResume) {
    const heading = isResume ? "Continuing From" : "Currently Active";
    if (currentEntries.length > 0) {
      const note = isResume
        ? "live, corroborated — this is where the work left off, in rough chronological order"
        : "live, corroborated — this is what's actually happening right now, not background history";
      const priorityInstruction = (isResume
        ? "ANSWER PRIMARILY FROM THIS SECTION. It reflects the actual current state of the work. The Evidence section below is unrelated background history — do not let it override, dilute, or take precedence over what's here, even if it is more detailed or reads as a more complete story."
        : "ANSWER PRIMARILY FROM THIS SECTION — it is what's actually happening right now. The Evidence section below is background history and must not override or dilute this answer, even if it is more detailed or reads as a more complete story.")
        + " Items are ordered most-recent-first — lead with the first item(s); a shorter, terser entry near the top is more current than a longer, more narrative one further down.";
      currentSection = `\n\n## ${heading} (${note})\n${priorityInstruction}\n\n${currentEntries
        .map((e) => renderEntry(e, entries.indexOf(e)))
        .join("\n\n---\n\n")}`;
    } else {
      const gapNote = presentModel?.gaps.length
        ? ` (unavailable signals: ${presentModel.gaps.join(", ")})`
        : "";
      const fallbackVerb = isResume ? "resuming from" : "currently active";
      currentSection = `\n\n## ${heading}\nNo evidence was corroborated as ${fallbackVerb}${gapNote}. Do not present background evidence below as current work — say so explicitly if the question asks what's active now.`;
    }
  }

  // flyd's own memory must never be suppressed — git is a corroborating
  // signal that augments it, not a replacement (a user won't always be using
  // git). Weak/uncorroborated background evidence still shouldn't win over
  // strong current evidence in the answer, but that's handled by keeping it
  // clearly labeled background (and trimming raw transcripts, see above)
  // rather than by hiding it.
  const evidence = backgroundEntries.map((e) => renderBackgroundEntry(e, entries.indexOf(e))).join("\n\n---\n\n");

  let librarianSection = "";
  if (scored) {
    const sufficiency = estimateSufficiency(scored, question);
    librarianSection = `\n\n## Librarian Assessment\nSufficiency: ${sufficiency.verdict} — ${sufficiency.reason}\n`;
  }

  return `${currentSection}

## Evidence (background — do not present as current unless corroborated above)
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
    const currentFlag = e.isCurrent ? " ✓current" : "";
    const timestamp = e.metadata.timestamp ? ` (${e.metadata.timestamp})` : "";
    const sourceTag = e.source === "wiki" ? "wiki" : "raw";
    const scoreEntry = scored?.find((s) => s.path === e.path);
    const libScore = scoreEntry ? ` 📊${(scoreEntry.librarianScore * 100).toFixed(0)}%` : "";
    lines.push(`[${sourceTag}]${staleFlag}${currentFlag}${libScore} ${e.path}${timestamp} (score=${e.score}%)`);
  }
  return lines.join("\n");
}

export async function runAsk(
  question: string,
  model?: string,
  opts?: { deep?: boolean; librarian?: boolean },
): Promise<void> {
  const m = model ?? defaultModel();
  const keywords = extractKeywords(question);
  const retrieval = opts?.deep
    ? await retrieveRankedBrainEvidence(question)
    : await retrieveRankedLexicalBrainEvidence(question);
  const entries = retrieval.entries.map((entry) => ({
    ...entry,
    fullPath: join(entry.source === "wiki" ? WIKI_DIR : RAW_DIR, entry.path),
  })) as RetrievedEntry[];

  // If nothing found, use LLM to find relevant wiki pages by title/summary
  if (!entries.length && opts?.deep && hasApiKey(m)) {
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
  const answer = await query(
    buildPrompt(question, entries, scored, retrieval.intent, retrieval.presentModel),
    m,
    buildSystemPrompt(question),
  );

  console.log(answer);
  console.log(`\n---\nevidence:\n${evidenceSummary}`);
  if (librarianSummary) {
    console.log(`\n${librarianSummary}`);
  }
}

// Re-export shared functions for backward compatibility (index.ts librarian command)
export { extractKeywords, searchWiki, mergeEntries, QMD_RAW_COLLECTION, MAX_ENTRIES };
