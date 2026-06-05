import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { WIKI_DIR } from "./config.js";
import { parse } from "./frontmatter.js";

export const DEFAULT_HALF_LIVES: Record<string, number> = {
  canon: 180,
  working: 90,
  raw: 60,
  episodic: 30,
  event: 30,
  observation: 60,
  decision: 90,
  belief: 180,
  goal: 90,
};

export function decayedValue(
  originalConfidence: number,
  daysSince: number,
  halfLifeDays: number,
): number {
  if (daysSince <= 0) return originalConfidence;
  if (halfLifeDays <= 0) return originalConfidence;
  const decayed = originalConfidence * Math.pow(0.5, daysSince / halfLifeDays);
  return Math.max(0.1, Math.round(decayed * 100) / 100);
}

export function getHalfLife(metadata: Record<string, unknown>): number {
  const rawType = String(metadata.type ?? "");
  if (rawType in DEFAULT_HALF_LIVES) return DEFAULT_HALF_LIVES[rawType];

  const eventType = String(metadata.event_type ?? "");
  if (eventType in DEFAULT_HALF_LIVES) return DEFAULT_HALF_LIVES[eventType];

  return DEFAULT_HALF_LIVES["raw"];
}

export function estimateDaysSince(path: string): number {
  const timestampMatch = path.match(/(\d{4}-\d{2}-\d{2})/);
  if (timestampMatch) {
    const then = new Date(timestampMatch[1]).getTime();
    const now = Date.now();
    return Math.round((now - then) / (1000 * 60 * 60 * 24));
  }

  return 0;
}

export function getWikiEntryDaysSince(relativePath: string): number {
  const fullPath = join(WIKI_DIR, relativePath);
  if (!existsSync(fullPath)) return 0;

  try {
    const content = readFileSync(fullPath, "utf8");
    const { metadata } = parse(content);
    const lastConfirmed = metadata.last_confirmed
      ? String(metadata.last_confirmed)
      : null;

    if (lastConfirmed) {
      const then = new Date(lastConfirmed).getTime();
      const now = Date.now();
      return Math.round((now - then) / (1000 * 60 * 60 * 24));
    }
  } catch { /* ignore */ }

  return 0;
}
