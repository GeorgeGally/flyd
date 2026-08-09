import { writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { MemoryReceipt, LearningReceipt } from "./memory-receipt.js";
import { FLYD_DIR } from "./lib/config.js";

let overlayRawDir = join(FLYD_DIR, "raw", "overlay");
const receiptFiles: string[] = [];

export function configureMemoryPersistenceDirectory(directory: string): void {
  overlayRawDir = directory;
  receiptFiles.length = 0;
}

export function trackReceiptWritten(filename: string) {
  receiptFiles.push(filename);
}

function receiptShort(): string {
  return randomUUID().slice(0, 8);
}

async function ensureDir() {
  await mkdir(overlayRawDir, { recursive: true });
}

export async function persistReceipt(receipt: MemoryReceipt): Promise<string | null> {
  try {
    await ensureDir();

    const isoDate = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `receipt-${isoDate}-${receipt.receiptId.slice(0, 8)}.md`;
    const filepath = join(overlayRawDir, filename);

    const timestamp = receipt.generatedAt.replace(/Z$/, "");
    const topicLines = receipt.topics.length > 0
      ? ["topics:"].concat(receipt.topics.map((t) => `  - ${t}`)).join("\n")
      : "";

    const frontmatter = [
      "---",
      `id: ${receipt.receiptId}`,
      `timestamp: ${timestamp}`,
      `generated_at: ${receipt.generatedAt}`,
      `source: ${receipt.source}`,
      `event_type: ${receipt.eventType}`,
      `outcome: ${receipt.evidence.outcome}`,
      `signal: ${receipt.derivedSignal}`,
      topicLines,
      `category: ${receipt.belief.what}`,
      `confidence: ${receipt.belief.why}`,
      `self_contained: ${receipt.selfContained}`,
      "---",
      "",
      `## Belief`,
      `- **What:** ${receipt.belief.what}`,
      `- **Why:** ${receipt.belief.why}`,
      `- **When:** ${receipt.belief.when}`,
      "",
      `## Evidence`,
      `- **Intent:** ${receipt.evidence.intent}`,
      `- **Resolution:** ${receipt.evidence.resolution}`,
      `- **Outcome:** ${receipt.evidence.outcome}`,
      `- **Environment:** ${receipt.evidence.environmentSummary}`,
      receipt.evidence.correction ? `- **Correction:** ${receipt.evidence.correction}` : "",
    ].filter(Boolean).join("\n");

    await writeFile(filepath, frontmatter, "utf-8");
    trackReceiptWritten(filename);
    return filepath;
  } catch (err) {
    console.warn("[MemoryGate] Failed to persist receipt:", err);
    return null;
  }
}

export async function persistLearningReceipt(receipt: LearningReceipt): Promise<string | null> {
  try {
    await ensureDir();

    const isoDate = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `learning-${isoDate}-${receipt.receiptId.slice(0, 8)}.md`;
    const filepath = join(overlayRawDir, filename);

    const timestamp = receipt.generatedAt.replace(/Z$/, "");
    const topicLines = receipt.topics.length > 0
      ? ["topics:"].concat(receipt.topics.map((t) => `  - ${t}`)).join("\n")
      : "";

    const frontmatter = [
      "---",
      `id: ${receipt.receiptId}`,
      `timestamp: ${timestamp}`,
      `generated_at: ${receipt.generatedAt}`,
      `source: ${receipt.source}`,
      `event_type: ${receipt.eventType}`,
      `signal: ${receipt.derivedSignal}`,
      `epistemic_confidence: ${receipt.provenance.epistemicConfidence}`,
      `source_type: ${receipt.provenance.sourceType}`,
      `domain: ${receipt.provenance.domain}`,
      `outcome_ref: ${receipt.provenance.outcomeRef}`,
      topicLines,
      `category: ${receipt.belief.what}`,
      `self_contained: ${receipt.selfContained}`,
      "---",
      "",
      `## Belief`,
      `- **What:** ${receipt.belief.what}`,
      `- **Why:** ${receipt.belief.why}`,
      `- **When:** ${receipt.belief.when}`,
      "",
      `## Evidence`,
      `- **Content:** ${receipt.evidence.content}`,
      `- **Domain:** ${receipt.evidence.domain}`,
      `- **Outcome Ref:** ${receipt.evidence.outcomeRef}`,
      "",
      `## Provenance`,
      `- **Epistemic Confidence:** ${receipt.provenance.epistemicConfidence}`,
      `- **Source Type:** ${receipt.provenance.sourceType}`,
      `- **Domain:** ${receipt.provenance.domain}`,
      `- **Outcome Ref:** ${receipt.provenance.outcomeRef}`,
      `- **Timestamp:** ${receipt.provenance.timestamp}`,
    ].filter(Boolean).join("\n");

    await writeFile(filepath, frontmatter, "utf-8");
    trackReceiptWritten(filename);
    return filepath;
  } catch (err) {
    console.warn("[MemoryGate] Failed to persist learning receipt:", err);
    return null;
  }
}

export async function persistLearnings(
  beliefs: Array<Record<string, unknown>>,
  behaviours: Array<Record<string, unknown>>
): Promise<string | null> {
  try {
    await ensureDir();

    const isoDate = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `synthesis-${isoDate}-${receiptShort()}.md`;
    const filepath = join(overlayRawDir, filename);

    const timestamp = new Date().toISOString().replace(/Z$/, "");
    const derivedFromLines = receiptFiles.length > 0
      ? ["derived_from:"].concat(receiptFiles.map((f) => `  - ${f}`)).join("\n")
      : "";

    const beliefLines = beliefs.map(
      (b) => `- **Subject:** ${b.subject}, **Predicate:** ${b.predicate ?? "has_value"}, **Object:** ${b.object}, **Confidence:** ${b.confidence}`
    );
    const behaviourLines = behaviours.map(
      (b) => `- **Pattern:** ${b.pattern}, **Response:** ${b.response}, **Context:** ${b.context ?? "overlay_invocation"}, **Confidence:** ${b.confidence}`
    );

    const frontmatter = [
      "---",
      `timestamp: ${timestamp}`,
      `source: flyd-overlay-synthesis`,
      `event_type: belief_synthesis`,
      `outcome: confirmed`,
      `promoted: false`,
      `epistemic_status: inferred`,
      derivedFromLines,
      "---",
      "",
      "## Synthesized Beliefs",
      ...beliefLines,
      "",
      "## Synthesized Behaviours",
      ...behaviourLines,
      "",
    ].filter(Boolean).join("\n");

    await writeFile(filepath, frontmatter, "utf-8");
    receiptFiles.length = 0;
    return filepath;
  } catch (err) {
    console.warn("[MemoryGate] Failed to persist learnings:", err);
    return null;
  }
}
