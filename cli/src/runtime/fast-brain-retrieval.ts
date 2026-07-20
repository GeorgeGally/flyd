import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { isPollutedCapture } from "../lib/brain-state.js";
import { RAW_DIR } from "../lib/config.js";
import { parse } from "../lib/frontmatter.js";
import { extractKeywords, searchWiki, type BaseEntry } from "../lib/retrieval.js";
import type { MemoryEvidence, MemoryMatchSummary } from "./types.js";

interface FastRetrievalDependencies {
  searchEntries(query: string, keywords: string[]): BaseEntry[];
  now(): Date;
}

const LOW_INFORMATION_TERMS = new Set([
  "chat", "current", "currently", "hello", "latest", "recent", "thanks", "thank", "today",
]);

function countMatches(body: string, keywords: string[]): { hits: number; unique: number } {
  const normalized = body.toLowerCase();
  let hits = 0;
  let unique = 0;
  for (const keyword of keywords) {
    const matches = normalized.match(new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"));
    if (!matches) continue;
    hits += matches.length;
    unique += 1;
  }
  return { hits, unique };
}

function rawEntries(_query: string, keywords: string[]): BaseEntry[] {
  if (!existsSync(RAW_DIR)) return [];

  return readdirSync(RAW_DIR)
    .filter((name) => name.endsWith(".md"))
    .flatMap((name) => {
      try {
        const parsed = parse(readFileSync(join(RAW_DIR, name), "utf8"));
        if (isPollutedCapture({ body: parsed.body, metadata: parsed.metadata })) return [];
        const matches = countMatches(parsed.body, keywords);
        if (matches.unique === 0) return [];
        return [{
          path: name,
          body: parsed.body,
          metadata: parsed.metadata,
          source: "raw" as const,
          score: Math.min(95, 25 + matches.unique * 14 + Math.min(matches.hits, 12) * 2),
        }];
      } catch {
        return [];
      }
    });
}

const defaults: FastRetrievalDependencies = {
  searchEntries: (query, keywords) => [
    ...searchWiki(query, keywords),
    ...rawEntries(query, keywords),
  ],
  now: () => new Date(),
};

function lastUpdated(metadata: Record<string, unknown>): Date | null {
  for (const field of [ "updated_at", "timestamp", "created_at" ]) {
    const value = metadata[field];
    if (typeof value !== "string") continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function match(entry: BaseEntry, now: Date): MemoryMatchSummary {
  const updated = lastUpdated(entry.metadata);
  const stale = updated ? now.getTime() - updated.getTime() > 90 * 24 * 60 * 60 * 1_000 : false;
  const id = createHash("sha256").update(`${entry.source}:${entry.path}:${entry.body}`).digest("hex").slice(0, 16);
  return {
    id: `fast-memory:${id}`,
    path: entry.path,
    excerpt: entry.body.trim().slice(0, 1_000),
    stale,
    kind: "archive",
  };
}

export async function retrieveFastBrainEvidence(
  query: string,
  dependencies: FastRetrievalDependencies = defaults,
): Promise<MemoryEvidence> {
  const keywords = extractKeywords(query).filter((keyword) => !LOW_INFORMATION_TERMS.has(keyword));
  if (keywords.length === 0) return { verdict: "insufficient", matches: [] };

  const entries = dependencies.searchEntries(query, keywords)
    .map((entry) => ({ entry, matches: countMatches(entry.body, keywords) }))
    .filter(({ matches }) => matches.unique > 0)
    .sort((left, right) =>
      right.matches.unique - left.matches.unique ||
      right.matches.hits - left.matches.hits ||
      right.entry.score - left.entry.score
    )
    .slice(0, 6)
    .map(({ entry }) => match(entry, dependencies.now()));

  return {
    verdict: entries.length >= 3 ? "sufficient" : entries.length > 0 ? "partial" : "insufficient",
    matches: entries,
  };
}
