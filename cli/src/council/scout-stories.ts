import { createHash } from "node:crypto";
import type { ScoutCandidate, EditionItem } from "./scout.js";

/** Scout groups *events* before editorial selection. Conservative: false splits are safer than false merges. */
const STOP = new Set([
  "a", "an", "the", "and", "or", "to", "from", "by", "with", "for",
  "in", "on", "of", "is", "are", "at", "as", "how", "why", "what",
  "now", "new", "latest", "about", "this", "that", "it", "its", "vs",
  "after", "before", "into", "more", "gets", "have", "has", "their",
]);

export interface StoryCandidate extends ScoutCandidate {
  storyId?: string;
  evidenceUrls?: string[];
  independentSources?: number;
  corroborationCount?: number;
  relevanceScore?: number;
  verification?: "confirmed" | "unverified" | "contradicted";
}

function titleTokens(title: string): string[] {
  return [...new Set(title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP.has(word)))].sort();
}

function urlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    for (const key of [...parsed.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) parsed.searchParams.delete(key);
    return parsed.toString();
  } catch { return url.trim().toLowerCase(); }
}

function sourceHost(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function specificNumbers(title: string): string[] {
  return title.match(/\b(?:v\d+(?:\.\d+){0,3}|\d+(?:\.\d+){1,3}|\d{4})\b/gi)?.map((token) => token.toLowerCase()).sort() ?? [];
}

/** Titles referring to the same event, not just the same broad topic. */
export function sameStory(left: Pick<ScoutCandidate, "title" | "url">, right: Pick<ScoutCandidate, "title" | "url">): boolean {
  if (urlKey(left.url) === urlKey(right.url)) return true;
  const a = titleTokens(left.title);
  const b = titleTokens(right.title);
  if (a.length < 3 || b.length < 3) return false;
  const numsA = specificNumbers(left.title);
  const numsB = specificNumbers(right.title);
  if ((numsA.length || numsB.length) && numsA.join(",") !== numsB.join(",")) return false;
  const aSet = new Set(a);
  const common = b.filter((word) => aSet.has(word)).length;
  const union = new Set([...a, ...b]).size;
  return common >= 3 && common / union >= 0.67 && common / Math.min(a.length, b.length) >= 0.8;
}

function stableId(item: ScoutCandidate): string {
  const tokens = titleTokens(item.title);
  const key = tokens.length >= 3 ? tokens.join(" ") : urlKey(item.url);
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function bestCandidate(items: StoryCandidate[]): StoryCandidate {
  return [...items].sort((a, b) =>
    (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0)
      || (b.published ?? "").localeCompare(a.published ?? "")
      || b.summary.length - a.summary.length)[0]!;
}

/** Within one edition, combine independent links to the same development. */
export function groupScoutStories(input: ScoutCandidate[]): StoryCandidate[] {
  const groups: StoryCandidate[][] = [];
  for (const candidate of input) {
    if (!candidate.url || !candidate.title) continue;
    const match = groups.find((group) => group.some((item) => sameStory(item, candidate)));
    if (match) match.push(candidate);
    else groups.push([candidate]);
  }
  return groups.map((group) => {
    const main = bestCandidate(group);
    const urlSet = new Set(group.flatMap((item) => [item.url, ...(item.evidenceUrls ?? [])]).map(urlKey));
    const hosts = new Set([...urlSet].map(sourceHost).filter(Boolean));
    // Verification comes only from a completed Evidence Engine pass, not from
    // counting syndication, discussion URLs or distinct hosting domains.
    const verified = group.find((entry) => entry.evidenceStatus === "corroborated");
    return {
      ...main,
      storyId: verified?.storyId ?? stableId(main),
      evidenceUrls: [...urlSet],
      ...(verified?.evidenceSnippets ? { evidenceSnippets: verified.evidenceSnippets } : {}),
      ...(verified?.evidenceCheckedAt ? { evidenceCheckedAt: verified.evidenceCheckedAt } : {}),
      ...(verified ? { evidenceStatus: "corroborated" as const } : {}),
      // Source diversity is descriptive; it is never a confidence verdict.
      independentSources: hosts.size,
      corroborationCount: verified?.corroborationCount ?? main.corroborationCount ?? 0,
    };
  });
}

/** Existing editions carry old article shapes; title comparison protects them without migration. */
export function previouslyCovered(candidate: ScoutCandidate, previous: Array<Pick<EditionItem, "title" | "url">>): boolean {
  return previous.some((prior) => sameStory(candidate, prior));
}

/** A new version/number of the *same named project* is an update, not a duplicate. */
export function noteworthyUpdate(candidate: ScoutCandidate, previous: Pick<EditionItem, "title" | "url">): boolean {
  if (candidate.evidenceStatus !== "corroborated") return false;
  const left = specificNumbers(candidate.title);
  const right = specificNumbers(previous.title);
  if (!left.length || !right.length || left.join(",") === right.join(",")) return false;
  const removeNumbers = (title: string): string => title.replace(/\b(?:v\d+(?:\.\d+){0,3}|\d+(?:\.\d+){1,3}|\d{4})\b/gi, "");
  const a = new Set(titleTokens(removeNumbers(candidate.title)));
  const b = new Set(titleTokens(removeNumbers(previous.title)));
  const common = [...a].filter((word) => b.has(word)).length;
  return common >= 3 && common / Math.max(1, Math.min(a.size, b.size)) >= 0.7;
}
