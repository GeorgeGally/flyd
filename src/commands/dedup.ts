import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { WIKI_DIR } from "../lib/config.js";
import { parse } from "../lib/frontmatter.js";
import { walkWikiFiles } from "../lib/wiki.js";

interface WikiEntry {
  path: string;
  rel: string;
  type: string;
  body: string;
}

interface DupePair {
  a: WikiEntry;
  b: WikiEntry;
  score: number;
}

export function runDedup(opts: { fix?: boolean } = {}): void {
  const files = walkWikiFiles();
  if (!files.length) {
    console.log("wiki is empty");
    return;
  }

  const entries: WikiEntry[] = files.map((f) => {
    const { metadata, body } = parse(readFileSync(f, "utf8"));
    const rel = f.replace(WIKI_DIR + "/", "");
    return { path: f, rel, type: String(metadata.type ?? ""), body };
  });

  // Group by type — only compare within same type
  const byType: Record<string, WikiEntry[]> = {};
  for (const e of entries) {
    if (!byType[e.type]) byType[e.type] = [];
    byType[e.type].push(e);
  }

  const pairs: DupePair[] = [];

  for (const [type, group] of Object.entries(byType)) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const score = similarity(group[i].body, group[j].body);
        if (score >= 0.6) {
          pairs.push({ a: group[i], b: group[j], score });
        }
      }
    }
  }

  if (!pairs.length) {
    console.log("no duplicates found");
    return;
  }

  pairs.sort((a, b) => b.score - a.score);

  console.log(`${pairs.length} potential duplicate pair(s):\n`);
  for (const { a, b, score } of pairs) {
    console.log(`  [${Math.round(score * 100)}%] ${a.rel}`);
    console.log(`       ${b.rel}`);
    if (opts.fix) {
      // Keep the longer (more complete) entry, delete the shorter
      const keep = a.body.length >= b.body.length ? a : b;
      const drop = a.body.length >= b.body.length ? b : a;
      if (existsSync(drop.path)) {
        rmSync(drop.path);
        console.log(`       → deleted ${drop.rel} (kept ${keep.rel})`);
      }
    }
    console.log();
  }

  if (!opts.fix) {
    console.log("run with --fix to auto-delete shorter duplicate in each pair");
  }
}

// Jaccard similarity on word tokens
export function similarity(a: string, b: string): number {
  const tokA = tokenize(a);
  const tokB = tokenize(b);
  if (!tokA.size || !tokB.size) return 0;
  let intersection = 0;
  for (const t of tokA) if (tokB.has(t)) intersection++;
  return intersection / (tokA.size + tokB.size - intersection);
}

export function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w.length > 2)
  );
}
