import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { RAW_DIR, WIKI_DIR } from "./config.js";
import { parse } from "./frontmatter.js";
import { walkWikiFiles } from "./wiki.js";
import { decayedValue, getHalfLife, getWikiEntryDaysSince } from "./decay.js";

export const QMD_RAW_COLLECTION = "flyd-raw";
export const MIN_SCORE = 25;
export const MAX_ENTRIES = 12;

export interface BaseEntry {
  path: string;
  body: string;
  score: number;
  metadata: Record<string, unknown>;
  source: "raw" | "wiki";
}

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with","by","from",
  "is","are","was","were","be","been","being","have","has","had","do","does","did",
  "will","would","could","should","may","might","shall","can","need","dare","ought",
  "used","this","that","these","those","i","you","he","she","it","we","they","me",
  "him","her","us","them","my","your","his","its","our","their","not","no","nor",
  "none","if","then","else","when","where","why","how","which","who","whom","what",
  "about","into","over","after","before","between","under","above","below","up",
  "down","out","off","just","because","than","so","very","too","really","get","got",
  "gotten","make","made","doing","going","say","said","see","know","think","take",
  "come","like","want","use","work","need","feel","try","leave","call","keep","let",
  "begin","show","hear","play","run","move","live","believe","hold","bring","happen",
  "write","give","set","tell","put","ask","find","look","help","also","back","still",
  "even","well","here","there","first","last","much","many","some","any","each",
  "every","all","both","few","more","most","other","such","only","own","same","so",
  "than","too","very","just","about","over","again","further","then","once",
  "project","projects","file","files","code","thing","things","way","part","stuff",
  "lot","bit","kind","sort","type","make","made","makes","making","use","used",
  "uses","using","take","takes","took","taking","go","goes","going","went","gone",
  "come","comes","came","coming","know","knows","knew","known","think","thinks",
  "thought","thinking","see","sees","saw","seen","seeing","want","wants","wanted",
  "wanting","way","ways","something","nothing","everything","anything","someone",
  "everyone","anyone","maybe","perhaps","probably","basically","actually","really",
  "pretty","quite","rather","little","big","small","large","long","short","high",
  "low","good","bad","new","old","great","nice","cool","awesome","amazing","best",
  "worst","better","worse","different","same","other","another","many","much",
  "more","most","few","less","least","some","any","such","does","did","done",
  "doing","having","had","has","have","having","did","does","doing","am","are",
  "was","were","been","being","were","what","which","who","whom","whose","where",
  "when","why","how","all","any","both","each","few","more","most","other","some",
  "such","no","nor","not","only","own","same","so","than","too","very","just","now",
  "then","here","there","up","down","out","off","over","under","again","further",
  "once","me","you","him","his","her","she","it","its","we","us","our","ours",
  "they","them","their","theirs","my","mine","your","yours","hers","its","ours",
  "theirs","myself","yourself","himself","herself","itself","ourselves","yourselves",
  "themselves","what","which","who","whom","this","that","these","those","am",
  "is","are","was","were","be","been","being","have","has","had","do","does",
  "did","will","would","shall","should","may","might","must","can","could",
  "ought","need","dare","used","be","being","been","am","is","are","was","were",
  "being","been","be","have","has","had","do","does","did","shall","will",
  "should","would","may","might","must","can","could","ought","need","dared",
  "don","doesn","didn","wasn","weren","haven","hasn","hadn","won","wouldn",
  "shan","shouldn","mightn","mustn","isn","aren","ain","aren","couldn",
  "let","lets","let's","thats","thats","theres","heres","wheres","hows",
  "whens","whys","whos","whats","whichs","this","that","these","those",
  "mine","yours","his","hers","ours","theirs","myself","yourself","himself",
  "herself","itself","ourselves","yourselves","themselves","whoever","whomever",
  "whatever","whichever","whenever","wherever","however","whyever","whatsoever",
]);

export function extractKeywords(text: string): string[] {
  const words = text.toLowerCase().split(/[^a-z0-9]+/);
  const keywords: string[] = [];
  for (const w of words) {
    if (w.length >= 4 && !STOP_WORDS.has(w) && !/^\d+$/.test(w)) {
      keywords.push(w);
    }
  }
  return [...new Set(keywords)];
}

export function stripWikiLinks(text: string): string {
  // Remove [[link|text]] and [[link]] patterns
  return text.replace(/\[\[[^\]]+\|([^\]]+)\]\]/g, "$1").replace(/\[\[([^\]]+)\]\]/g, "$1");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isContentRelevant(body: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const cleanBody = stripWikiLinks(body).toLowerCase();
  let matches = 0;
  for (const kw of keywords) {
    const regex = new RegExp(`\\b${escapeRegExp(kw)}\\b`);
    if (regex.test(cleanBody)) matches++;
  }
  const threshold = Math.max(2, Math.ceil(keywords.length / 2));
  return matches >= threshold;
}

export function buildRawEntries(results: Array<{ path: string; score: number }>, keywords: string[]): BaseEntry[] {
  const entries: BaseEntry[] = [];

  for (const result of results) {
    if (result.score < MIN_SCORE) continue;

    const fullPath = join(RAW_DIR, result.path);
    if (!existsSync(fullPath)) continue;

    const content = readFileSync(fullPath, "utf8");
    const parsed = parse(content);

    if (!isContentRelevant(parsed.body, keywords)) continue;

    entries.push({
      path: result.path,
      body: parsed.body,
      score: result.score,
      metadata: parsed.metadata,
      source: "raw",
    });
  }

  return entries;
}

export function searchWiki(query: string, keywords: string[]): BaseEntry[] {
  const entries: BaseEntry[] = [];
  const wikiFiles = walkWikiFiles();

  for (const fullPath of wikiFiles) {
    try {
      const content = readFileSync(fullPath, "utf8");
      const parsed = parse(content);
      const body = parsed.body;

      if (!isContentRelevant(body, keywords)) {
        const tags = parsed.metadata.tags;
        const tagList = Array.isArray(tags) ? tags.map(String) : [];
        const tagMatch = keywords.some(kw => tagList.some(t => t.toLowerCase().includes(kw)));
        if (!tagMatch) continue;
      }

      const cleanBody = stripWikiLinks(body).toLowerCase();
      let uniqueMatches = 0;
      let keywordHits = 0;
      let totalWords = cleanBody.split(/\s+/).length || 1;
      for (const kw of keywords) {
        const regex = new RegExp(`\\b${escapeRegExp(kw)}\\b`, "g");
        const matches = cleanBody.match(regex);
        if (matches) {
          keywordHits += matches.length;
          uniqueMatches++;
        }
      }
      const density = keywordHits / totalWords;
      const syntheticScore = Math.min(90, Math.round(30 + uniqueMatches * 12 + density * 300));

      const relPath = fullPath.replace(WIKI_DIR + "/", "");

      // Apply decay penalty based on entry type and age
      const daysSince = getWikiEntryDaysSince(relPath);
      const halfLife = getHalfLife(parsed.metadata);
      const decayFactor = decayedValue(1.0, daysSince, halfLife);
      const decayedScore = Math.round(syntheticScore * (0.5 + 0.5 * decayFactor));

      entries.push({
        path: relPath,
        body,
        score: decayedScore,
        metadata: parsed.metadata,
        source: "wiki",
      });
    } catch {
      // skip unreadable wiki files
    }
  }

  return entries.sort((a, b) => b.score - a.score);
}

export function augmentWithGraph(
  entries: BaseEntry[],
  graphResults: Array<{ from: string; to: string; rel_type: string; confidence: number; source: string }>,
): BaseEntry[] {
  if (graphResults.length === 0) return entries;

  const pathBoost = new Map<string, number>();
  for (const gr of graphResults) {
    for (const entry of entries) {
      const entryLower = entry.path.toLowerCase();
      if (entryLower.includes(gr.from) || entryLower.includes(gr.to)) {
        const boost = gr.confidence * 0.2;
        pathBoost.set(entry.path, Math.max(pathBoost.get(entry.path) ?? 0, boost));
      }
    }
  }

  return entries.map(e => ({
    ...e,
    score: Math.min(100, e.score + Math.round((pathBoost.get(e.path) ?? 0) * 100)),
  }));
}

export function mergeEntries(rawEntries: BaseEntry[], wikiEntries: BaseEntry[]): BaseEntry[] {
  const seen = new Set<string>();
  const merged: BaseEntry[] = [];

  // Add wiki entries first (they're curated and typically more reliable)
  for (const e of wikiEntries) {
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    merged.push(e);
    if (merged.length >= MAX_ENTRIES) return merged;
  }

  // Then add raw entries
  for (const e of rawEntries) {
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    merged.push(e);
    if (merged.length >= MAX_ENTRIES) return merged;
  }

  return merged;
}
