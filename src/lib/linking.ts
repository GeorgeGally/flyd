import { existsSync, readFileSync, readdirSync, writeFileSync, renameSync, statSync } from "fs";
import { join } from "path";
import { RAW_DIR, WIKI_DIR } from "./config.js";
import { parse, serialize } from "./frontmatter.js";
import { walkWikiFiles } from "./wiki.js";

interface LinkSuggestion {
  target: string;
  score: number;
  type: string;
}

const STOP_WORDS = new Set([
  "the", "this", "that", "these", "those", "what", "which", "who", "whom",
  "where", "when", "why", "how", "have", "has", "had", "having", "been",
  "being", "were", "was", "are", "is", "does", "did", "done", "doing",
  "would", "could", "should", "might", "must", "shall", "will", "can",
  "may", "need", "dare", "ought", "used", "about", "into", "over",
  "after", "before", "between", "under", "above", "below", "again",
  "further", "then", "once", "here", "there", "when", "where", "while",
  "because", "until", "during", "without", "through", "among", "throughout",
  "project", "projects", "file", "files", "code", "thing", "things",
  "something", "nothing", "everything", "anything", "someone", "everyone",
  "anyone", "way", "ways", "part", "parts", "stuff", "lot", "bit", "kind",
]);

function tokenize(text: string): Set<string> {
  const words = text.toLowerCase().split(/[^a-z0-9+#_-]+/);
  const tokens = new Set<string>();
  for (const w of words) {
    if (w.length >= 4 && !STOP_WORDS.has(w) && !/^\d+$/.test(w)) {
      tokens.add(w);
    }
  }
  return tokens;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function loadWikiIndex(): Map<string, { tokens: Set<string>; title: string }> {
  const index = new Map<string, { tokens: Set<string>; title: string }>();
  const files = walkWikiFiles();
  for (const fullPath of files) {
    try {
      const content = readFileSync(fullPath, "utf8");
      const { metadata, body } = parse(content);
      const relPath = fullPath.replace(WIKI_DIR + "/", "");
      const title = String(metadata.title ?? relPath.replace(/\.md$/, "").replace(/\//g, " "));
      const tags = Array.isArray(metadata.tags) ? metadata.tags.map(String).join(" ") : "";
      const text = `${title} ${tags} ${body}`.toLowerCase();
      index.set(relPath, { tokens: tokenize(text), title });
    } catch {
      // skip unreadable
    }
  }
  return index;
}

export function suggestLinksForCapture(capturePath: string): LinkSuggestion[] {
  const fullPath = join(RAW_DIR, capturePath);
  if (!existsSync(fullPath)) return [];

  const content = readFileSync(fullPath, "utf8");
  const { metadata, body } = parse(content);
  if (!body.trim()) return [];

  const captureTokens = tokenize(body);
  if (captureTokens.size < 3) return [];

  const wikiIndex = loadWikiIndex();
  if (wikiIndex.size === 0) return [];

  const suggestions: LinkSuggestion[] = [];
  for (const [relPath, wikiEntry] of wikiIndex) {
    const score = jaccardSimilarity(captureTokens, wikiEntry.tokens);
    if (score >= 0.15) {
      suggestions.push({
        target: relPath.replace(/\.md$/, ""),
        score,
        type: "related",
      });
    }
  }

  suggestions.sort((a, b) => b.score - a.score);
  return suggestions.slice(0, 5);
}

export function writeLinksToCapture(capturePath: string, suggestions: LinkSuggestion[]): boolean {
  const fullPath = join(RAW_DIR, capturePath);
  if (!existsSync(fullPath) || suggestions.length === 0) return false;

  const content = readFileSync(fullPath, "utf8");
  const { metadata, body: cleanBody } = parse(content);

  const existingLinks = new Set(
    (Array.isArray(metadata.links) ? metadata.links : [])
      .filter((l): l is Record<string, unknown> => typeof l === "object" && l !== null)
      .map((l) => String(l.target ?? "")),
  );

  const newLinks: Array<Record<string, unknown>> = [];
  for (const s of suggestions) {
    if (!existingLinks.has(s.target)) {
      newLinks.push({
        target: s.target,
        type: s.type,
        confidence: Math.round(s.score * 100) / 100,
        extraction: "auto-link",
      });
    }
  }

  if (newLinks.length === 0) return false;

  const allLinks = [
    ...(Array.isArray(metadata.links) ? metadata.links : []),
    ...newLinks,
  ];

  const updatedMetadata = { ...metadata, links: allLinks };
  const updatedContent = serialize(updatedMetadata, cleanBody);
  const tmpPath = fullPath + ".tmp.link";
  writeFileSync(tmpPath, updatedContent, "utf8");
  renameSync(tmpPath, fullPath);
  return true;
}

export function findNewCapturesSince(sinceTimestamp: number): string[] {
  if (!existsSync(RAW_DIR)) return [];
  const files = readdirSync(RAW_DIR).filter((f) => f.endsWith(".md")).sort();
  const results: string[] = [];
  for (const file of files) {
    const fullPath = join(RAW_DIR, file);
    try {
      const s = statSync(fullPath);
      if (s.mtimeMs > sinceTimestamp || s.birthtimeMs > sinceTimestamp) {
        results.push(file);
      }
    } catch {
      // skip
    }
  }
  return results;
}
