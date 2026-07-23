import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { MemoryReceipt } from "./memory-receipt.js";

const OVERLAY_RAW_DIR = join(homedir(), ".flyd", "raw", "overlay");

async function ensureDir() {
  await mkdir(OVERLAY_RAW_DIR, { recursive: true });
}

export async function persistReceipt(receipt: MemoryReceipt): Promise<string | null> {
  try {
    await ensureDir();

    const isoDate = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `receipt-${isoDate}-${receipt.receiptId.slice(0, 8)}.md`;
    const filepath = join(OVERLAY_RAW_DIR, filename);

    const frontmatter = [
      "---",
      `id: ${receipt.receiptId}`,
      `generated_at: ${receipt.generatedAt}`,
      `source: ${receipt.source}`,
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
    ].join("\n");

    await writeFile(filepath, frontmatter, "utf-8");
    return filepath;
  } catch (err) {
    console.warn("[MemoryGate] Failed to persist receipt:", err);
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
    const filename = `synthesis-${isoDate}.json`;
    const filepath = join(OVERLAY_RAW_DIR, filename);

    const content = JSON.stringify(
      { generatedAt: new Date().toISOString(), beliefs, behaviours },
      null,
      2
    );

    await writeFile(filepath, content, "utf-8");
    return filepath;
  } catch (err) {
    console.warn("[MemoryGate] Failed to persist learnings:", err);
    return null;
  }
}
