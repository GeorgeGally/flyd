import type { EvidenceBundle, EvidenceItem, RankedEvidence } from "../evidence/types.js";
import { EvidenceEngine, createDefaultEvidenceRegistry } from "../evidence/index.js";
import type { Last30daysNomination } from "./scout-last30days.js";

const FILLER = new Set(["and","the","with","from","into","for","that","this","what","how","why","new","now","about","best","its","are","has","was","out","first","over","opens","video","post"]);
const SAFE_URL = /^https?:\/\//i;

export type ScoutEvidenceStatus = "corroborated" | "single-source" | "unverified" | "contradicted";
export interface ScoutEvidenceLink {
  url: string;
  title: string;
  snippet: string;
  source: string;
  kind: string;
  publishedAt?: string;
  isPrimary: boolean;
}
export interface ScoutResearchResult {
  evidence: ScoutEvidenceLink[];
  evidenceStatus: ScoutEvidenceStatus;
  independentSources: number;
  gaps: string[];
  generatedAt: string;
}
export interface ScoutResearcher {
  (topic: string, urls: string[]): Promise<EvidenceBundle>;
}

/** Existing Evidence Engine owns read/search, fallbacks and provenance. */
export async function researchScoutTopic(topic: string, urls: string[]): Promise<EvidenceBundle> {
  const engine = new EvidenceEngine(createDefaultEvidenceRegistry());
  return engine.research(topic, "quick", { locators: urls.filter((url) => SAFE_URL.test(url)).slice(0, 2), includeSearch: true });
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().replace(/[^a-z0-9]+/g," ").split(/\s+/)
    .filter((w) => w.length > 2 && !FILLER.has(w)));
}

/** Topic matching prevents an unrelated provider result being counted as corroboration. */
export function evidenceMatches(topic: string, item: Pick<EvidenceItem, "title" | "content">): boolean {
  const target = tokens(topic);
  if (target.size < 2) return false;
  const headline = tokens(item.title ?? "");
  const body = tokens(item.content.slice(0, 400));
  const commonTitle = [...target].filter((t) => headline.has(t)).length;
  const commonBody = [...target].filter((t) => body.has(t)).length;
  return commonTitle >= Math.min(3, target.size) || (commonTitle >= 2 && commonBody >= Math.min(3, target.size));
}

export function sourceFamily(link: string): string {
  try {
    const url = new URL(link);
    const host = url.hostname.replace(/^(?:www|m)\./, "").toLowerCase();
    if (host === "github.com") return "github:" + (url.pathname.split("/")[1] ?? "").toLowerCase();
    if (host === "reddit.com" || host.endsWith(".reddit.com")) return "reddit";
    if (host === "news.ycombinator.com") return "hackernews";
    if (host === "x.com" || host === "twitter.com") return "x";
    if (host === "youtube.com" || host === "youtu.be") return "youtube";
    if (!host || host === "localhost") return "";
    return host;
  } catch { return ""; }
}

function primary(item: RankedEvidence): boolean {
  return item.kind === "first_party_statement" || item.kind === "release" || item.kind === "code" || item.kind === "research";
}

function httpUrl(value: string | undefined): string | undefined {
  if (!value || !SAFE_URL.test(value)) return;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return;
    const host = url.hostname.toLowerCase();
    if (/^(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0$)/.test(host) || /\.(local|internal)$/.test(host)) return;
    return url.toString();
  } catch { return; }
}

function linkOf(item: RankedEvidence): ScoutEvidenceLink | null {
  const url = httpUrl(item.locator);
  if (!url) return null;
  return {
    url, title: (item.title || "Source").slice(0, 160),
    snippet: item.content.replace(/\s+/g, " ").slice(0, 320),
    source: item.capability, kind: item.kind,
    ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
    isPrimary: primary(item),
  };
}

export function adjudicateScoutEvidence(topic: string, bundle: EvidenceBundle): ScoutResearchResult {
  const generated = Date.parse(bundle.generatedAt);
  const support = bundle.evidence.filter((item) => {
    if (!evidenceMatches(topic, item)) return false;
    const published = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
    // Discovery claims of "just launched" cannot be corroborated by ancient or future-dated evidence.
    if (Number.isFinite(published) && Number.isFinite(generated)
      && (published < generated - 45 * 86_400_000 || published > generated + 86_400_000)) return false;
    return true;
  });
  const links = support.flatMap((item) => {
    const link = linkOf(item);
    return link ? [link] : [];
  });
  const byUrl = new Map<string, ScoutEvidenceLink>();
  for (const link of links) if (!byUrl.has(link.url)) byUrl.set(link.url, link);
  const unique = [...byUrl.values()].slice(0, 8);
  const independent = new Set(unique.map((link) => sourceFamily(link.url)).filter(Boolean));
  // Multiple mirrors of one release cannot establish two confirmations.
  const independentReports = new Map<string, string>();
  const syndicated = new Set<string>();
  for (const link of unique.filter((entry) => !["reddit","hackernews","x","youtube"].includes(entry.source))) {
    const family = sourceFamily(link.url);
    if (!family) continue;
    // Exact copied prose across hosts is syndication, not independent confirmation.
    const fingerprint = (link.title + " " + link.snippet).toLowerCase().replace(/[^a-z0-9]+/g, " ").slice(0, 160);
    if (syndicated.has(fingerprint)) continue;
    syndicated.add(fingerprint);
    independentReports.set(family, fingerprint);
  }
  const hasPrimary = unique.some((link) => link.isPrimary);
  const evidenceStatus: ScoutEvidenceStatus =
    bundle.conflicts.length > 0 ? "contradicted" :
    (hasPrimary && independentReports.size >= 2) || independentReports.size >= 2
      ? "corroborated" : unique.length ? "single-source" : "unverified";
  return {
    evidence: unique, evidenceStatus,
    independentSources: independent.size,
    gaps: bundle.gaps.map((gap) => gap.code).slice(0, 6),
    generatedAt: bundle.generatedAt,
  };
}

/** A bounded research unit per nominated discovery; no model-generated facts are silently accepted. */
export async function verifyScoutNomination(
  nomination: Last30daysNomination,
  research: ScoutResearcher = researchScoutTopic,
): Promise<ScoutResearchResult> {
  const urls = nomination.evidenceUrls.filter((url) => httpUrl(url)).slice(0, 3);
  if (!urls.length) return { evidence: [], evidenceStatus: "unverified", independentSources: 0, gaps: ["no_evidence_url"], generatedAt: new Date().toISOString() };
  const bundle = await research(nomination.topic, urls);
  return adjudicateScoutEvidence(nomination.topic, bundle);
}


export interface MustKnowCandidate {
  title: string;
  url: string;
  evidenceStatus?: ScoutEvidenceStatus;
  evidenceUrls?: string[];
}

/** Fail closed for proactive interruptions: an LLM rating alone never notifies. */
export async function verifiedMustKnow<T extends MustKnowCandidate>(
  picks: T[],
  research: ScoutResearcher = researchScoutTopic,
): Promise<T[]> {
  const verified: T[] = [];
  for (const pick of picks.slice(0, 2)) {
    if (pick.evidenceStatus === "corroborated") {
      verified.push(pick);
      continue;
    }
    try {
      const bundle = await research(pick.title, [pick.url]);
      const evidence = adjudicateScoutEvidence(pick.title, bundle);
      if (evidence.evidenceStatus !== "corroborated") continue;
      verified.push({
        ...pick, evidenceStatus: "corroborated",
        evidenceUrls: [...new Set([pick.url, ...evidence.evidence.map((entry) => entry.url)])],
      });
    } catch { /* Notification accuracy outranks immediacy. */ }
  }
  return verified;
}
