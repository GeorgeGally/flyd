import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { RAW_DIR } from "../lib/config.js";
import { parse } from "../lib/frontmatter.js";
import { getInterestStaleness } from "../lib/interests.js";

const STALE_MS = 30 * 24 * 60 * 60 * 1000;
const VERY_STALE_MS = 90 * 24 * 60 * 60 * 1000;

const SEED_TOPICS: string[] = [
  "cartier", "ogilvy", "dentsu", "tbwa", "quirk",
  "gigham", "function gallery", "crypto art week",
  "tokyo", "berlin", "singapore", "hong kong", "cape town", "new york",
  "looking glass", "nft", "blockchain", "generative", "data",
  "lucky strike", "jetstar", "coca cola", "disney",
  "creative technologist", "installation",
];

function rawFiles(): string[] {
  if (!existsSync(RAW_DIR)) return [];
  return readdirSync(RAW_DIR).filter((f) => f.endsWith(".md")).sort();
}

function fileAge(filepath: string): number {
  try {
    return Date.now() - statSync(filepath).mtimeMs;
  } catch {
    return 0;
  }
}

function discoverTopics(files: string[]): string[] {
  const topics = new Set(SEED_TOPICS);
  for (const file of files) {
    const fullPath = join(RAW_DIR, file);
    try {
      const content = readFileSync(fullPath, "utf8");
      const { metadata } = parse(content);
      const project = String(metadata.project ?? "");
      if (project) topics.add(project.toLowerCase());
    } catch { /* skip */ }
  }
  return [...topics];
}

export async function runCheck(): Promise<void> {
  const files = rawFiles();

  if (!files.length) {
    console.log("no raw captures yet — run 'flyd <text>' to start");
    return;
  }

  const topics = discoverTopics(files);
  const totalSize = files.reduce((sum, f) => sum + (statSync(join(RAW_DIR, f)).size || 0), 0);
  const kb = Math.round(totalSize / 1024);

  let staleCount = 0;
  let veryStaleCount = 0;
  let lastCapture = "";

  const topicSeen: Record<string, { file: string; timestamp: string }> = {};

  for (const file of files) {
    const fullPath = join(RAW_DIR, file);
    const age = fileAge(fullPath);

    if (age > VERY_STALE_MS) veryStaleCount++;
    else if (age > STALE_MS) staleCount++;

    const mtime = statSync(fullPath).mtimeMs;
    lastCapture = new Date(mtime).toISOString().replace("T", " ").slice(0, 19);

    try {
      const content = readFileSync(fullPath, "utf8");
      const { metadata } = parse(content);
      const body = content.toLowerCase();

      for (const topic of topics) {
        if (body.includes(topic)) {
          const ts = String(metadata.timestamp ?? file.replace(/\.md$/, "").replace(/-/g, " "));
          const prev = topicSeen[topic];
          if (!prev) {
            topicSeen[topic] = { file, timestamp: ts };
          } else {
            const prevMtime = statSync(join(RAW_DIR, prev.file)).mtimeMs;
            if (mtime > prevMtime) {
              topicSeen[topic] = { file, timestamp: ts };
            }
          }
        }
      }
    } catch {
      // skip unreadable
    }
  }

  console.log("flyd memory health\n");
  console.log(`  raw captures: ${files.length} (${kb}KB)`);
  console.log(`  stale (>30d): ${staleCount}`);
  console.log(`  very stale (>90d): ${veryStaleCount}`);
  console.log(`  last capture: ${lastCapture}\n`);

  // Topic gaps
  const gaps: string[] = [];
  const onlyOne: string[] = [];

  for (const topic of topics) {
    if (!topicSeen[topic]) continue;
    const seen = topicSeen[topic];
    const fullPath = join(RAW_DIR, seen.file);
    if (fileAge(fullPath) > STALE_MS) {
      const days = Math.round(fileAge(fullPath) / (24 * 60 * 60 * 1000));
      gaps.push(`"${topic}" — last mentioned ${days}d ago (${seen.file})`);
    }
  }

  // Count topics that only appear in 1 file
  const topicCounts: Record<string, number> = {};
  for (const file of files) {
    try {
      const content = readFileSync(join(RAW_DIR, file), "utf8").toLowerCase();
      for (const topic of topics) {
        if (content.includes(topic)) topicCounts[topic] = (topicCounts[topic] ?? 0) + 1;
      }
    } catch { /* skip */ }
  }
  for (const [topic, count] of Object.entries(topicCounts)) {
    if (count === 1) onlyOne.push(`"${topic}" — only in 1 capture (${topicSeen[topic]?.file ?? "?"})`);
  }

  if (gaps.length > 0) {
    console.log("  stale topics:");
    for (const g of gaps.slice(0, 8)) console.log(`    - ${g}`);
    if (gaps.length > 8) console.log(`    ... and ${gaps.length - 8} more`);
    console.log();
  }

  if (onlyOne.length > 0) {
    console.log("  thin coverage (only 1 mention):");
    for (const t of onlyOne.slice(0, 5)) console.log(`    - ${t}`);
    if (onlyOne.length > 5) console.log(`    ... and ${onlyOne.length - 5} more`);
    console.log();
  }

  if (!gaps.length && !onlyOne.length) {
    console.log("  all clear — no stale or thin topics");
  }

  const { stale: staleInterests, dormant } = getInterestStaleness();
  if (staleInterests.length > 0) {
    console.log("  stale interests:");
    for (const i of staleInterests) {
      const days = Math.round((Date.now() - new Date(i.last_active.replace(" ", "T") + "Z").getTime()) / (1000 * 60 * 60 * 24));
      console.log(`    - "${i.topic}" — ${days}d since last capture (last: ${i.last_active})`);
    }
    console.log();
  }
  if (dormant.length > 0) {
    console.log("  dormant interests (auto-extracted, never confirmed):");
    for (const i of dormant) {
      console.log(`    - "${i.topic}" — only 1 capture`);
    }
    console.log();
  }
}
