import type { EpisodicEventView, EpisodeNode } from "./types.js";

export const EPISODE_SUMMARY_VERSION = 1;

export interface EpisodeSummarizer {
  summarizeLeaf(events: EpisodicEventView[]): string;
  summarizeParent(left: EpisodeNode, right: EpisodeNode): string;
}

function strings(value: unknown, out: string[], depth = 0): void {
  if (depth > 3 || out.length >= 12 || value == null) return;
  if (typeof value === "string") {
    const text = value.replace(/\s+/g, " ").trim();
    if (text.length >= 3) out.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value.slice(0, 8)) strings(child, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>).slice(0, 12)) strings(child, out, depth + 1);
  }
}

function compact(parts: string[], max = 720): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of parts) {
    const clean = part.replace(/\s+/g, " ").trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    kept.push(clean);
  }
  const joined = kept.join(" · ");
  return joined.length <= max ? joined : joined.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/**
 * Deliberately deterministic baseline. The tree/cache contract does not depend
 * on a model; a model-backed summarizer can replace this without changing node
 * identity, provenance, cover, drill, or erasure behavior.
 */
export const deterministicEpisodeSummarizer: EpisodeSummarizer = {
  summarizeLeaf(events) {
    const lines = events.flatMap((event) => {
      if (event.erased) return [];
      const found: string[] = [];
      strings(event.payload, found);
      const body = found.length ? found.slice(0, 3).join("; ") : event.sourceId;
      return [`${event.kind} [${event.sourceId}]: ${body}`];
    });
    return compact(lines.length ? lines : ["No retained evidence in this episode."]);
  },
  summarizeParent(left, right) {
    return compact([left.summary, right.summary]);
  },
};
