import { existsSync, statSync } from "fs";
import { join } from "path";

const STALE_THRESHOLD_DAYS = 30;
const VERY_STALE_THRESHOLD_DAYS = 90;

export interface StalenessResult {
  stale: boolean;
  veryStale: boolean;
  daysSince: number;
  lastUpdated: string | null;
  message: string | null;
}

export function getStaleness(
  fullPath: string,
  metadata: Record<string, unknown>,
): StalenessResult {
  let lastUpdated: string | null = null;
  let daysSince = 0;

  if (metadata.last_confirmed) {
    const confirmed = new Date(String(metadata.last_confirmed));
    if (!isNaN(confirmed.getTime())) {
      lastUpdated = String(metadata.last_confirmed);
      daysSince = Math.floor(
        (Date.now() - confirmed.getTime()) / (1000 * 60 * 60 * 24),
      );
    }
  }

  if (!lastUpdated && existsSync(fullPath)) {
    try {
      const mtime = statSync(fullPath).mtime;
      lastUpdated = mtime.toISOString().split("T")[0];
      daysSince = Math.floor(
        (Date.now() - mtime.getTime()) / (1000 * 60 * 60 * 24),
      );
    } catch {
      // ignore
    }
  }

  const veryStale = daysSince > VERY_STALE_THRESHOLD_DAYS;
  const stale = daysSince > STALE_THRESHOLD_DAYS;

  let message: string | null = null;
  if (stale) {
    const since = lastUpdated ?? "unknown";
    if (veryStale) {
      message = `[stale:${daysSince}d] Last updated ${since}. Verify currency before trusting.`;
    } else {
      message = `[potentially-stale:${daysSince}d] Nothing confirmed since ${since}.`;
    }
  }

  return { stale, veryStale, daysSince, lastUpdated, message };
}

export function stalenessSummary(
  entries: Array<{ path: string; fullPath?: string; metadata: Record<string, unknown> }>,
): string[] {
  const warnings: string[] = [];
  let staleCount = 0;
  let veryStaleCount = 0;

  for (const entry of entries) {
    const path = entry.fullPath ?? entry.path;
    if (!path) continue;
    const result = getStaleness(path, entry.metadata);
    if (result.veryStale) veryStaleCount++;
    else if (result.stale) staleCount++;
  }

  if (veryStaleCount > 0) {
    warnings.push(
      `${veryStaleCount} very stale entr${veryStaleCount === 1 ? "y" : "ies"} (>${VERY_STALE_THRESHOLD_DAYS}d). Verify before trusting.`,
    );
  }
  if (staleCount > 0) {
    warnings.push(
      `${staleCount} older entr${staleCount === 1 ? "y" : "ies"} (>${STALE_THRESHOLD_DAYS}d). May need confirmation.`,
    );
  }

  return warnings;
}