import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ScoutMetrics {
  at: string;
  mode: "legacy" | "shadow" | "on";
  fetched: number;
  grouped: number;
  shortlisted: number;
  selected: number;
  editionItems: number;
  failedSources: number;
  answeredSources?: number;
  rateLimitedSources?: number;
  duplicates?: number;
  junkPicks?: number;
}

function metricsPath(dir: string): string { return join(dir, "metrics.json"); }

/** Bounded, private diagnostics. Counters only; no private project context or source text. */
export function recordScoutMetrics(dir: string, record: ScoutMetrics): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const old = readScoutMetrics(dir);
    const path = metricsPath(dir);
    const temp = path + "." + process.pid + ".tmp";
    writeFileSync(temp, JSON.stringify([...old, record].slice(-30), null, 2), { mode: 0o600 });
    renameSync(temp, path);
  } catch { /* Diagnostics are never on the critical path. */ }
}

export function readScoutMetrics(dir: string): ScoutMetrics[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(metricsPath(dir), "utf8"));
    return Array.isArray(parsed) ? parsed.filter((record): record is ScoutMetrics =>
      record && typeof record.at === "string" && typeof record.fetched === "number" && typeof record.selected === "number") : [];
  } catch { return []; }
}

export function scoutMetricsSummary(dir: string): string {
  const runs = readScoutMetrics(dir);
  if (!runs.length) return "No Scout diagnostics recorded yet.";
  const latest = runs[runs.length - 1]!;
  return [
    "Last Scout edition: " + latest.at,
    "Editorial mode: " + latest.mode,
    "Candidates: " + latest.fetched + " fetched, " + latest.grouped + " after grouping, " + latest.shortlisted + " shortlisted",
    "Selected: " + latest.selected + " stories (" + latest.editionItems + " total edition items)",
    ...(latest.answeredSources === undefined ? [] : ["Sources: " + latest.answeredSources + " answered, " + (latest.rateLimitedSources ?? 0) + " rate-limited, " + latest.failedSources + " failed"]),
    ...(latest.duplicates ? ["Dropped as repeats: " + latest.duplicates] : []),
    ...(latest.junkPicks ? ["Dropped as junk: " + latest.junkPicks + " ranker picks"] : []),
    "Failed sources: " + latest.failedSources,
    "Runs recorded: " + runs.length,
  ].join("\n");
}

export interface ScoutSourceHealth {
  at: string;
  attempted: number;
  answered: number;
  empty: number;
  failed: number;
  rateLimited: number;
  ingested: number;
  active: number;
}

export type ScoutRunKind = "edition" | "watch";

export function sourceHealthPath(dir: string, kind: ScoutRunKind = "edition"): string {
  return join(dir, kind === "watch" ? "source-health-watch.json" : "source-health.json");
}

export function recordSourceHealth(dir: string, health: ScoutSourceHealth, kind: ScoutRunKind = "edition"): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = sourceHealthPath(dir, kind);
    const temp = path + "." + process.pid + ".tmp";
    writeFileSync(temp, JSON.stringify(health, null, 2) + "\n", { mode: 0o600 });
    renameSync(temp, path);
  } catch {}
}

export function readSourceHealth(dir: string, kind: ScoutRunKind = "edition"): ScoutSourceHealth | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(sourceHealthPath(dir, kind), "utf8"));
    return parsed && typeof (parsed as ScoutSourceHealth).at === "string" && typeof (parsed as ScoutSourceHealth).attempted === "number"
      ? parsed as ScoutSourceHealth : null;
  } catch { return null; }
}


export interface ScoutResearchHealth {
  at: string;
  topic: string;
  results: number;
  sourceStatus: Record<string, string>;
  tokens?: number;
}

/** Structured upstream source-health record; no source text, credentials or raw model errors. */
export function recordScoutResearchHealth(dir: string, record: ScoutResearchHealth): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(join(dir, "research-health.jsonl"), JSON.stringify(record) + "\n", { mode: 0o600 });
  } catch { /* Optional diagnostics only. */ }
}

export function scoutResearchHealthSummary(dir: string): string {
  try {
    const lines = readFileSync(join(dir, "research-health.jsonl"), "utf8").trim().split("\n").slice(-6);
    return lines.flatMap((line) => {
      let r: ScoutResearchHealth;
      try { r = JSON.parse(line) as ScoutResearchHealth; } catch { return []; }
      const sources = Object.entries(r.sourceStatus ?? {}).map(([key, status]) => key + ":" + status).join(", ");
      return [r.topic + ": " + r.results + " results; " + sources + (r.tokens === undefined ? "" : "; " + r.tokens + " tokens")];
    }).join("\n");
  } catch { return "No upstream source-health records yet."; }
}
