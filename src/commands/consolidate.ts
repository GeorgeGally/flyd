import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { WIKI_DIR, RAW_DIR, CONTEXT_DIR, defaultModel } from "../lib/config.js";
import { parse } from "../lib/frontmatter.js";
import { query } from "../lib/llm.js";
import { getGraphStats, rebuildGraph } from "../lib/graph.js";
import { runDedup } from "./dedup.js";
import { walkWikiFiles } from "../lib/wiki.js";
import { updateRaw, embedRaw } from "../lib/qmd.js";
import { runSynthesis } from "../lib/synthesis.js";
import { extractInterests } from "../lib/interests.js";

interface DuplicatePair {
  a: { path: string; rel: string; body: string };
  b: { path: string; rel: string; body: string };
  score: number;
}

async function detectContradictions(maxPairs = 50): Promise<void> {
  const metaDir = join(WIKI_DIR, "meta");
  mkdirSync(metaDir, { recursive: true });

  const files = walkWikiFiles();
  const byType: Record<string, string[]> = {};

  for (const f of files) {
    const { metadata } = parse(readFileSync(f, "utf8"));
    const t = String(metadata.type ?? "unknown");
    if (!byType[t]) byType[t] = [];
    byType[t].push(f);
  }

  const pairs: Array<{ a: string; b: string; type: string }> = [];
  for (const [type, filesOfType] of Object.entries(byType)) {
    for (let i = 0; i < filesOfType.length && pairs.length < maxPairs; i++) {
      for (let j = i + 1; j < filesOfType.length && pairs.length < maxPairs; j++) {
        pairs.push({ a: filesOfType[i], b: filesOfType[j], type });
      }
    }
  }

  if (pairs.length === 0) {
    console.log("  no same-type pairs to compare");
    return;
  }

  console.log(`  checking ${pairs.length} entry pairs for contradictions...`);

  const findings: string[] = [];
  let checked = 0;

  for (const { a, b, type } of pairs) {
    const aContent = readFileSync(a, "utf8");
    const bContent = readFileSync(b, "utf8");
    const aMeta = parse(aContent);
    const bMeta = parse(bContent);

    const aBody = aMeta.body.trim().slice(0, 300);
    const bBody = bMeta.body.trim().slice(0, 300);
    const aPath = a.replace(WIKI_DIR + "/", "");
    const bPath = b.replace(WIKI_DIR + "/", "");

    const prompt = `You are a knowledge consistency checker. Two wiki entries of the same type ("${type}") are provided.

Entry A (${aPath}):
${aBody}

Entry B (${bPath}):
${bBody}

Determine if these entries CONTRADICT each other (make different factual claims), are CONSISTENT (same facts), or are UNCERTAIN (can't tell).

Respond with ONLY this JSON:
{"verdict": "contradictory|consistent|uncertain", "reason": "one sentence explanation"}`;

    try {
      const response = await query(prompt, defaultModel());
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const verdict = JSON.parse(jsonMatch[0]);
        if (verdict.verdict === "contradictory") {
          findings.push(`## ${aPath} vs ${bPath} (${type})\n**Verdict: contradictory** — ${verdict.reason}\n\nA:\n${aBody}\n\nB:\n${bBody}\n`);
        }
      }
    } catch {
      // skip on error
    }

    checked++;
    if (checked % 10 === 0) process.stdout.write(".");
  }

  const reportPath = join(metaDir, "contradictions.md");
  if (findings.length > 0) {
    const report = `# Contradiction Report\n\nGenerated: ${new Date().toISOString()}\n\n${findings.join("\n---\n")}`;
    writeFileSync(reportPath, report, "utf8");
    console.log(`\n  ${findings.length} contradiction(s) found — report written to meta/contradictions.md`);
  } else {
    console.log(`\n  no contradictions found`);
    if (existsSync(reportPath)) rmSync(reportPath);
  }
}

function checkStaleness(): { stale: number; total: number; entries: string[] } {
  const files = walkWikiFiles();
  const stale: string[] = [];
  const now = Date.now();
  const STALE_MS = 30 * 24 * 60 * 60 * 1000;

  for (const f of files) {
    const { metadata } = parse(readFileSync(f, "utf8"));
    const lastConfirmed = metadata.last_confirmed
      ? new Date(String(metadata.last_confirmed)).getTime()
      : 0;
    if (lastConfirmed === 0) {
      try {
        const { mtimeMs } = statSync(f);
        if (now - mtimeMs > STALE_MS) {
          stale.push(f.replace(WIKI_DIR + "/", ""));
        }
      } catch { /* skip */ }
    } else if (now - lastConfirmed > STALE_MS) {
      stale.push(f.replace(WIKI_DIR + "/", ""));
    }
  }

  return { stale: stale.length, total: files.length, entries: stale };
}

function checkRawStaleness(): { stale: number; total: number; entries: string[] } {
  if (!existsSync(RAW_DIR)) return { stale: 0, total: 0, entries: [] };

  const files = readdirSync(RAW_DIR).filter((f) => f.endsWith(".md")).sort();
  const stale: string[] = [];
  const now = Date.now();
  const STALE_MS = 30 * 24 * 60 * 60 * 1000;

  for (const f of files) {
    const fullPath = join(RAW_DIR, f);
    try {
      const { mtimeMs } = statSync(fullPath);
      if (now - mtimeMs > STALE_MS) {
        stale.push(f);
      }
    } catch { /* skip */ }
  }

  return { stale: stale.length, total: files.length, entries: stale };
}

export async function runConsolidate(opts: { fix?: boolean; contradictions?: boolean } = {}): Promise<void> {
  console.log("flyd consolidate\n");

  const rawCount = existsSync(RAW_DIR)
    ? readdirSync(RAW_DIR).filter((f) => f.endsWith(".md")).length
    : 0;
  const wikiCount = walkWikiFiles().length;

  if (rawCount > 100 && wikiCount < 3) {
    console.log(`★ ${rawCount} raw captures, ${wikiCount} wiki pages — run 'flyd ingest --all --write' to populate wiki\n`);
  }

  console.log("1. dedup...");
  await runDedup({ fix: opts.fix ?? false });

  console.log("\n2. staleness check...");
  const { stale, total, entries } = checkStaleness();
  const pct = total > 0 ? Math.round((stale / total) * 100) : 0;
  console.log(`  wiki: ${stale}/${total} entries stale (${pct}%)`);
  if (stale > 0) {
    console.log("  stale wiki entries:");
    for (const e of entries.slice(0, 10)) {
      console.log(`    - ${e}`);
    }
    if (entries.length > 10) console.log(`    ... and ${entries.length - 10} more`);
  }
  if (pct > 30) {
    console.log("  WARNING: >30% of wiki is stale. Run with --fix to address dedup issues.");
  }

  const rawResult = checkRawStaleness();
  const rawPct = rawResult.total > 0 ? Math.round((rawResult.stale / rawResult.total) * 100) : 0;
  console.log(`  raw:  ${rawResult.stale}/${rawResult.total} captures stale (${rawPct}%)`);
  if (rawResult.stale > 0) {
    console.log("  stale raw captures:");
    for (const e of rawResult.entries.slice(0, 10)) {
      console.log(`    - ${e}`);
    }
    if (rawResult.entries.length > 10) console.log(`    ... and ${rawResult.entries.length - 10} more`);
  }
  if (rawPct > 50 && rawResult.total > 0) {
    console.log("  NOTE: >50% of raw captures are stale. Consider asking flyd about this topic.");
  }

  console.log("\n3. synthesis...");
  const { synthesized, skipped } = await runSynthesis();
  if (synthesized.length > 0) {
    console.log(`  synthesized: ${synthesized.join(", ")}`);
  } else {
    console.log(`  skipped (no new captures): ${skipped.join(", ") || "none"}`);
  }

  console.log("\n4. interests...");
  const { extracted, updated } = extractInterests();
  console.log(`  ${extracted} new interests, ${updated} existing updated`);

  console.log("\n5. reindex...");
  try {
    await updateRaw();
    await embedRaw();
    console.log("  done");
  } catch {
    console.log("  qmd not available — skipping embed");
  }

  if (opts.contradictions) {
    console.log("\n6. contradiction detection (LLM)...");
    await detectContradictions();
  }

  console.log("\n7. graph rebuild...");
  rebuildGraph();
  const stats = getGraphStats();
  console.log(`  graph: ${stats.entities} entities, ${stats.edges} edges`);

  console.log("\ndone.");
}