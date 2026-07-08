import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { WIKI_DIR } from "../lib/config.js";
import { computeAttention, formatAttentionReport, generateNudges, writeNudges, loadCaptureDocs } from "../lib/attention.js";

export async function runAttention(): Promise<void> {
  console.log("Scanning captures...");
  const docs = loadCaptureDocs();
  console.log(`  ${docs.length} documents loaded`);

  const signals = computeAttention(docs);
  console.log(`  ${signals.length} topics scored`);

  // Display top results
  console.log("");
  const top = signals.slice(0, 5);
  for (const s of top) {
    const bar = "█".repeat(Math.round(s.composite * 10)) + "░".repeat(10 - Math.round(s.composite * 10));
    const flag = s.composite >= 0.5 ? " ⚠" : "";
    console.log(`  ${bar} ${s.topic} (${(s.composite * 100).toFixed(0)}%)${flag}`);
    if (s.unresolved > 0) console.log(`    unresolved: ${s.details.unresolvedCount} events`);
    if (s.details.contradictions.length > 0) console.log(`    contradictions: ${s.details.contradictions.join(", ")}`);
  }
  console.log("");

  // Generate nudges
  const nudges = generateNudges(signals);
  if (nudges.length > 0) {
    console.log("Nudges:");
    for (const n of nudges) console.log(`  ${n}`);
    writeNudges(nudges);
    console.log(`  → written to wiki/nudges.md`);
  } else {
    console.log("No nudges generated (all topics below threshold)");
  }
  console.log("");

  // Write attention report to wiki
  if (existsSync(WIKI_DIR)) {
    const report = formatAttentionReport(signals);
    const reportPath = join(WIKI_DIR, "attention-report.md");
    mkdirSync(WIKI_DIR, { recursive: true });
    writeFileSync(reportPath, report, "utf8");
    console.log(`Full report written to wiki/attention-report.md`);
  } else {
    console.log("Wiki not initialized — run 'flyd wiki init' for persistent attention reports");
  }
}
