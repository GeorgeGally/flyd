import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RssAdapter } from "../evidence/adapters/rss.js";
import { discoverLast30days, type Last30daysDiscovery, type Last30daysNomination, type Last30daysSourceState } from "./scout-last30days.js";
import { verifyScoutNomination, type ScoutResearchResult } from "./scout-evidence.js";
import type { ScoutCandidate } from "./scout.js";

/** A separate, bounded research producer. An edition reads the *last completed* cache. */
const BEATS = [
  "creative coding and generative art",
  "generative music and experimental audio",
  "creative AI tools and interactive design",
  "internet archaeology and unusual inventions",
  "", // Global exploration intentionally escapes any fixed interest vocabulary.
] as const;
const CACHE_TTL_MS = 5 * 86_400_000;
const DISCOVERY_INTERVAL_MS = 20 * 3_600_000;
const LOCK_TTL_MS = 12 * 60_000;
const MAX_RUNS = 15;
const MAX_NOMINATIONS_RESEARCHED = 3;

export type ScoutDiscoveryMode = "off" | "shadow" | "on";
export function discoveryMode(): ScoutDiscoveryMode {
  const raw = process.env.FLYD_SCOUT_DISCOVERY?.trim().toLowerCase();
  return raw === "off" ? "off" : raw === "shadow" ? "shadow" : "on";
}

export interface VerifiedNomination {
  nomination: Last30daysNomination;
  research: ScoutResearchResult;
}
export interface DiscoveryRun {
  domain: string;
  ranAt: string;
  outcome: "ok" | "nothing-solid" | "failed";
  engine: "last30days" | "native";
  nominations: Last30daysDiscovery["nominations"];
  verified: VerifiedNomination[];
  sourceStatus: Record<string, Last30daysSourceState>;
  errorKind?: "missing" | "timeout" | "schema" | "unreachable";
}
export interface DiscoveryCache { updatedAt: string; runs: DiscoveryRun[] }

export function readDiscoveryCache(dir: string): DiscoveryCache {
  try {
    const json = JSON.parse(readFileSync(join(dir, "discovery.json"), "utf8")) as Partial<DiscoveryCache>;
    return {
      updatedAt: typeof json.updatedAt === "string" ? json.updatedAt : "",
      runs: Array.isArray(json.runs) ? json.runs.filter((run): run is DiscoveryRun =>
        !!run && typeof run.domain === "string" && typeof run.ranAt === "string" &&
        ["ok", "nothing-solid", "failed"].includes(run.outcome)).map((run) => ({
          ...run,
          engine: run.engine === "native" ? "native" : "last30days",
          nominations: Array.isArray(run.nominations) ? run.nominations : [],
          verified: Array.isArray(run.verified) ? run.verified : [],
          sourceStatus: run.sourceStatus && typeof run.sourceStatus === "object" ? run.sourceStatus : {},
        })).slice(-MAX_RUNS) : [],
    };
  } catch { return { updatedAt: "", runs: [] }; }
}

function saveCache(dir: string, cache: DiscoveryCache): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "discovery.json");
  const temp = path + "." + process.pid + ".tmp";
  writeFileSync(temp, JSON.stringify(cache, null, 2) + "\n", { mode: 0o600 });
  renameSync(temp, path);
}

export function discoveryDue(dir: string, now: Date, force = false): boolean {
  if (discoveryMode() === "off" || process.env.FLYD_SCOUT === "0") return false;
  if (force) return true;
  // The previous day's completed discovery is used by the next morning edition.
  if (now.getHours() < 14) return false;
  const cache = readDiscoveryCache(dir);
  const previous = Date.parse(cache.updatedAt);
  return !Number.isFinite(previous) || now.getTime() - previous >= DISCOVERY_INTERVAL_MS;
}

function classifyError(error: unknown): DiscoveryRun["errorKind"] {
  const message = error instanceof Error ? error.message : String(error);
  if (/not installed|not found|Python 3\.12|ENOENT/i.test(message)) return "missing";
  if (/timed?out|killed|SIGTERM/i.test(message)) return "timeout";
  if (/schema|JSON|contract/i.test(message)) return "schema";
  return "unreachable";
}

function junkTopic(title: string): boolean {
  return /^(ask hn:|who is hiring|who wants to be hired|weekly thread|daily discussion|how do i\b|help me\b)/i.test(title);
}

/**
 * No Python or accounts required: public HN front page as an explicitly
 * labelled FALLBACK nomination source, not a fake trend/momentum score.
 * The Evidence Engine still investigates each surviving candidate.
 */
export async function discoverNative(now: Date, readFeed: (url: string) => Promise<Array<{
  title?: string; locator?: string; publishedAt?: string;
}>> = async (url) => new RssAdapter({ now: () => now }).read({ locator: url })): Promise<Last30daysDiscovery> {
  const items = await readFeed("https://hnrss.org/frontpage");
  const cutoff = now.getTime() - 48 * 3_600_000;
  const seen = new Set<string>();
  const nominations: Last30daysNomination[] = [];
  for (const item of items) {
    const title = String(item.title ?? "").trim();
    const url = String(item.locator ?? "").trim();
    if (!title || !/^https:\/\//.test(url) || junkTopic(title)) continue;
    if (item.publishedAt && Date.parse(item.publishedAt) < cutoff) continue;
    if (seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    nominations.push({ topic: title.slice(0, 140), whySpiking: "Appeared on the public Hacker News front page; independent confirmation pending",
      velocityScore: 0, evidenceUrls: [url], corroborationCount: 1,
      sources: ["hackernews"], previouslySurfacedCount: 0 });
    if (nominations.length === 12) break;
  }
  return { schemaVersion: "1.1", domain: "", generatedAt: now.toISOString(),
    outcome: nominations.length ? "ok" : "nothing-solid", sourceStatus: { hackernews: "ok" }, nominations };
}

export interface RefreshDiscoveryOptions {
  force?: boolean;
  fallback?: (now: Date) => Promise<Last30daysDiscovery>;
  verify?: (nomination: Last30daysNomination) => Promise<ScoutResearchResult>;
}

/**
 * Captures a source report, researches only the top nominations, and commits a
 * complete verified cache atomically. One bad search cannot block the edition.
 */
export async function refreshDiscovery(
  dir: string, now: Date,
  discover: (domain: string) => Promise<Last30daysDiscovery> = discoverLast30days,
  options: RefreshDiscoveryOptions = {},
): Promise<DiscoveryRun | null> {
  if (!discoveryDue(dir, now, options.force)) return null;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, "discovery.lock");
  try {
    closeSync(openSync(lock, "wx"));
  } catch {
    try {
      if (Date.now() - statSync(lock).mtimeMs < LOCK_TTL_MS) return null;
      unlinkSync(lock);
      closeSync(openSync(lock, "wx"));
    } catch { return null; }
  }
  try {
    const cache = readDiscoveryCache(dir);
    const domain = BEATS[cache.runs.length % BEATS.length]!;
    let engine: DiscoveryRun["engine"] = "last30days";
    let report: Last30daysDiscovery | null = null;
    let errorKind: DiscoveryRun["errorKind"];
    try { report = await discover(domain); }
    catch (error) {
      errorKind = classifyError(error);
      try {
        report = await (options.fallback ?? discoverNative)(now);
        engine = "native";
      } catch { /* Keep failure distinct from a clean nothing-solid run. */ }
    }
    const verified: VerifiedNomination[] = [];
    if (report?.outcome === "ok") {
      const verify = options.verify ?? verifyScoutNomination;
      for (const nomination of report.nominations.filter((n) => n.evidenceUrls.length > 0 && !junkTopic(n.topic)).slice(0, MAX_NOMINATIONS_RESEARCHED)) {
        try {
          const research = await verify(nomination);
          verified.push({ nomination, research });
        } catch {
          verified.push({ nomination, research: {
            evidence: [], evidenceStatus: "unverified", independentSources: 0,
            gaps: ["research_failed"], generatedAt: now.toISOString(),
          } });
        }
      }
    }
    const run: DiscoveryRun = {
      domain, ranAt: now.toISOString(), engine,
      outcome: report?.outcome ?? "failed",
      nominations: report?.nominations ?? [],
      verified,
      sourceStatus: report?.sourceStatus ?? {},
      ...(errorKind ? { errorKind } : {}),
    };
    saveCache(dir, { updatedAt: now.toISOString(), runs: [...cache.runs, run].slice(-MAX_RUNS) });
    return run;
  } finally {
    try { unlinkSync(lock); } catch { /* Already cleaned. */ }
  }
}

/** No nomination becomes "news" until a separate evidence pass completes. */
export function discoveryCandidates(dir: string, now: Date, includeShadow = false): ScoutCandidate[] {
  if (discoveryMode() !== "on" && !includeShadow) return [];
  const cutoff = now.getTime() - CACHE_TTL_MS;
  const seen = new Set<string>();
  return readDiscoveryCache(dir).runs
    .filter((run) => run.outcome === "ok" && Date.parse(run.ranAt) >= cutoff)
    .flatMap((run) => run.verified.flatMap(({ nomination, research }) => {
      if (research.evidenceStatus !== "corroborated") return [];
      const evidenceUrls = research.evidence.map((entry) => entry.url);
      const url = evidenceUrls.find((entry) => /^https?:\/\//.test(entry)) ?? nomination.evidenceUrls[0];
      const topic = nomination.topic.trim();
      if (!url || !topic || seen.has(topic.toLowerCase())) return [];
      seen.add(topic.toLowerCase());
      return [{
        id: "discovery:" + run.domain + ":" + topic,
        title: topic, url,
        source: "Discovery",
        sourceId: "discovery:" + (run.domain || "global"),
        topic: run.domain || "Unexpected discoveries",
        summary: nomination.whySpiking,
        published: run.ranAt,
        relevanceScore: Math.max(0, Math.min(1, nomination.velocityScore / 100)),
        evidenceUrls,
        corroborationCount: research.independentSources,
        evidenceStatus: research.evidenceStatus,
        evidenceSnippets: research.evidence.slice(0, 3).map((link) => link.title + ": " + link.snippet),
        evidenceCheckedAt: research.generatedAt,
      } satisfies ScoutCandidate];
    }));
}

export function discoveryStatus(dir: string): { mode: ScoutDiscoveryMode; lastRun?: DiscoveryRun; cached: number; verified: number } {
  const runs = readDiscoveryCache(dir).runs;
  return { mode: discoveryMode(), ...(runs.length ? { lastRun: runs[runs.length - 1] } : {}),
    cached: runs.reduce((sum, run) => sum + run.nominations.length, 0),
    verified: runs.reduce((sum, run) => sum + run.verified.filter((entry) => entry.research.evidenceStatus === "corroborated").length, 0) };
}
