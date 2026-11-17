import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverLast30days, type Last30daysDiscovery, type Last30daysSourceState } from "./scout-last30days.js";
import type { ScoutCandidate } from "./scout.js";

/** A separate, cached discovery lane. Never a blocker for the morning edition. */
const BEATS = [
  "creative coding and generative art",
  "generative music and experimental audio",
  "creative AI tools and interactive design",
  "internet archaeology and unusual inventions",
] as const;
const CACHE_TTL_MS = 48 * 3_600_000;
const DISCOVERY_INTERVAL_MS = 20 * 3_600_000;
const LOCK_TTL_MS = 10 * 60_000;
const MAX_RUNS = 8;

export type ScoutDiscoveryMode = "off" | "shadow" | "on";
export function discoveryMode(): ScoutDiscoveryMode {
  const raw = process.env.FLYD_SCOUT_DISCOVERY?.trim().toLowerCase();
  return raw === "on" ? "on" : raw === "off" ? "off" : "shadow";
}

export interface DiscoveryRun {
  domain: string;
  ranAt: string;
  outcome: "ok" | "nothing-solid" | "failed";
  nominations: Last30daysDiscovery["nominations"];
  sourceStatus: Record<string, Last30daysSourceState>;
  errorKind?: "missing" | "timeout" | "schema" | "unreachable";
}

export interface DiscoveryCache {
  updatedAt: string;
  runs: DiscoveryRun[];
}

export function readDiscoveryCache(dir: string): DiscoveryCache {
  try {
    const json = JSON.parse(readFileSync(join(dir, "discovery.json"), "utf8")) as Partial<DiscoveryCache>;
    return {
      updatedAt: typeof json.updatedAt === "string" ? json.updatedAt : "",
      runs: Array.isArray(json.runs) ? json.runs.filter((run): run is DiscoveryRun =>
        run && typeof run.domain === "string" && typeof run.ranAt === "string"
          && ["ok", "nothing-solid", "failed"].includes(run.outcome)).slice(-MAX_RUNS) : [],
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

export function discoveryDue(dir: string, now: Date): boolean {
  if (discoveryMode() === "off" || now.getHours() < 14) return false;
  const cache = readDiscoveryCache(dir);
  const previous = Date.parse(cache.updatedAt);
  return !Number.isFinite(previous) || now.getTime() - previous >= DISCOVERY_INTERVAL_MS;
}

function classifyError(error: unknown): DiscoveryRun["errorKind"] {
  const message = error instanceof Error ? error.message : String(error);
  if (/not installed|not found|Python 3\.12/i.test(message)) return "missing";
  if (/timed?out|killed|SIGTERM/i.test(message)) return "timeout";
  if (/schema|JSON|contract/i.test(message)) return "schema";
  return "unreachable";
}

/** One domain at a time, rotating beats. The upstream headless discovery may be thin or fail. */
export async function refreshDiscovery(
  dir: string,
  now: Date,
  discover: (domain: string) => Promise<Last30daysDiscovery> = (domain) => discoverLast30days(domain),
): Promise<DiscoveryRun | null> {
  if (!discoveryDue(dir, now)) return null;
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
    let run: DiscoveryRun;
    try {
      const result = await discover(domain);
      run = {
        domain,
        ranAt: now.toISOString(),
        outcome: result.outcome,
        nominations: result.nominations,
        sourceStatus: result.sourceStatus,
      };
    } catch (error) {
      run = { domain, ranAt: now.toISOString(), outcome: "failed", nominations: [], sourceStatus: {},
        errorKind: classifyError(error) };
    }
    saveCache(dir, { updatedAt: now.toISOString(), runs: [...cache.runs, run].slice(-MAX_RUNS) });
    return run;
  } finally {
    try { unlinkSync(lock); } catch { /* Already cleaned. */ }
  }
}

/** Candidate mapping is intentionally lossy only at the existing Scout interface, with metadata preserved. */
export function discoveryCandidates(dir: string, now: Date, includeShadow = false): ScoutCandidate[] {
  if (discoveryMode() !== "on" && !includeShadow) return [];
  const cache = readDiscoveryCache(dir);
  const cutoff = now.getTime() - CACHE_TTL_MS;
  const seen = new Set<string>();
  return cache.runs.filter((run) => run.outcome === "ok" && Date.parse(run.ranAt) >= cutoff)
    .flatMap((run) => run.nominations.flatMap((nomination) => {
      const url = nomination.evidenceUrls[0];
      if (!url || !nomination.topic || seen.has(nomination.topic.toLowerCase())) return [];
      // Discovery's confidence floor is the nomination gate; weak, uncorroborated results do not fill a slow news day.
      if (nomination.corroborationCount < 2 && nomination.velocityScore < 85) return [];
      seen.add(nomination.topic.toLowerCase());
      return [{
        id: "discovery:" + run.domain + ":" + nomination.topic,
        title: nomination.topic,
        url,
        source: "Discovery",
        sourceId: "discovery:" + run.domain,
        topic: run.domain,
        summary: nomination.whySpiking,
        published: run.ranAt,
        engagement: "Momentum " + nomination.velocityScore,
        relevanceScore: Math.min(1, Math.max(0, nomination.velocityScore / 100)),
        evidenceUrls: nomination.evidenceUrls,
        corroborationCount: nomination.corroborationCount,
      }];
    }));
}

export function discoveryStatus(dir: string): { mode: ScoutDiscoveryMode; lastRun?: DiscoveryRun; cached: number } {
  const runs = readDiscoveryCache(dir).runs;
  return { mode: discoveryMode(), ...(runs.length ? { lastRun: runs[runs.length - 1] } : {}),
    cached: runs.reduce((sum, run) => sum + run.nominations.length, 0) };
}
