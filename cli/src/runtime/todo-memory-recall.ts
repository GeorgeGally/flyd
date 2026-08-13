import type { MemoryEvidence } from "./types.js";
import { retrieveFastBrainEvidence } from "./fast-brain-retrieval.js";

function cleanExcerpt(excerpt: string, max = 160): string {
  return excerpt.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * After recording to-dos, pull the best archive/wiki hits for each new item.
 */
export async function recallMemoryForTodoItems(
  items: string[],
  retrieve: (query: string) => Promise<MemoryEvidence> = retrieveFastBrainEvidence,
): Promise<string> {
  const unique = [...new Set(items.map((i) => i.trim()).filter(Boolean))].slice(0, 6);
  if (!unique.length) return "";

  const sections: string[] = [];
  for (const item of unique) {
    let evidence: MemoryEvidence;
    try {
      evidence = await retrieve(item);
    } catch {
      sections.push(`• ${item}: memory lookup failed.`);
      continue;
    }
    const usable = evidence.matches
      .filter((m) => m.authority !== "assistant_output" && m.outcome !== "rejected")
      .slice(0, 2);
    if (!usable.length) {
      sections.push(`• ${item}: nothing relevant in memory yet.`);
      continue;
    }
    sections.push(`• ${item}:`);
    for (const match of usable) {
      const stale = match.stale ? " (possibly stale)" : "";
      sections.push(`  — ${cleanExcerpt(match.excerpt)}${stale}`);
    }
  }

  return sections.length ? `\n\nMemory recall:\n${sections.join("\n")}` : "";
}
