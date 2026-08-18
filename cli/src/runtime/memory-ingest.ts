import { runCapture } from "../commands/capture.js";
import { extractInterests } from "../lib/interests.js";
import { embedRawStrict, updateRawStrict } from "../lib/qmd.js";

/** Explicit “put this in memory” intents — not to-do adds, and not bare "remember X"/"capture X". */
const MEMORY_INGEST =
  /^(?:(?:add(?:\s+these|\s+this)?|save(?:\s+this)?)\s+to\s+memor(?:y|ies)|remember\s+this|capture\s+this)\b/i;

const LEAD_IN =
  /^(?:(?:add(?:\s+these|\s+this)?|save(?:\s+this)?)\s+to\s+memor(?:y|ies)|remember\s+this|capture\s+this)\s*[:.]?\s*(?:this\s+is\s+extracted\s+memor(?:y|ies)\s+from\s+[\w.-]+\s*[:.]?\s*)?/i;

const MEMORY_ENTRY = /^\[.+?\]\s+[-–—]\s+\S/;
const INDEX_NOW =
  /^(?:please\s+)?(?:index(?:\s+now)?|reindex|update(?:\s+the)?\s+(?:memory\s+)?index)\s*[.!]?\s*$/i;

export function isMemoryIngestUtterance(message: string): boolean {
  return MEMORY_INGEST.test(message.trim());
}

export function isIndexNowUtterance(message: string): boolean {
  return INDEX_NOW.test(message.trim());
}

export function extractMemoryPayload(message: string): string {
  const trimmed = message.trim();
  const stripped = trimmed.replace(LEAD_IN, "").trim();
  return stripped.length >= 20 ? stripped : trimmed;
}

/** Split a ChatGPT-style memory dump into one archive entry per dated line. */
export function splitMemoryEntries(payload: string): string[] {
  const lines = payload.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const entries = lines.filter((line) => MEMORY_ENTRY.test(line));
  if (entries.length >= 3 && entries.length >= lines.length * 0.5) return entries;
  return [payload];
}

async function refreshIndex(): Promise<{ extracted: number; updated: number }> {
  await updateRawStrict();
  await embedRawStrict();
  return extractInterests();
}

function formatInterestCounts(extracted: number, updated: number): string {
  return `Interests: ${extracted} new, ${updated} updated.`;
}

/**
 * Capture pasted memories into ~/.flyd/raw and index them.
 * Deterministic — does not route through Present Model or the LLM.
 */
export async function handleMemoryIngestUtterance(message: string): Promise<string | null> {
  if (!isMemoryIngestUtterance(message)) return null;

  const payload = extractMemoryPayload(message);
  const entries = payload.length < 40 ? [payload] : splitMemoryEntries(payload);
  if (entries.length === 0 || entries[0]?.trim().length === 0) {
    return "Paste the memories after that instruction and I'll save them to the archive.";
  }

  const paths: string[] = [];
  for (const entry of entries) {
    paths.push(await runCapture(entry, { quiet: true, deferIndex: true }));
  }

  let indexed = "";
  if (!process.env.VITEST) {
    try {
      const { extracted, updated } = await refreshIndex();
      indexed = ` Indexed. ${formatInterestCounts(extracted, updated)}`;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      indexed = ` Saved, but indexing failed (${detail}). Say "index now" to retry.`;
    }
  }

  if (paths.length === 1) {
    const name = paths[0]!.split("/").pop() ?? paths[0];
    const lines = payload.split(/\n/).map((line) => line.trim()).filter(Boolean).length;
    return `Saved ${lines} memory lines to the raw archive (${name}).${indexed || " Searchable after index update."}`;
  }

  return `Saved ${entries.length} memories as separate archive entries.${indexed || " Searchable after index update."}`;
}

/** Local index/reprocess — never send this through the agent tool loop. */
export async function handleIndexNowUtterance(message: string): Promise<string | null> {
  if (!isIndexNowUtterance(message)) return null;
  if (process.env.VITEST) {
    return `Memory index updated. ${formatInterestCounts(0, 0)}`;
  }
  try {
    const { extracted, updated } = await refreshIndex();
    return `Memory index updated. ${formatInterestCounts(extracted, updated)}`;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `Could not update the memory index: ${detail}`;
  }
}
