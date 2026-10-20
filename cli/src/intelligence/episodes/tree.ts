import { createHash } from "node:crypto";
import type { StoredEvent } from "../event-store.js";
import { episodicEventView } from "./normalize.js";
import { deterministicEpisodeSummarizer, EPISODE_SUMMARY_VERSION, type EpisodeSummarizer } from "./summarize.js";
import type { EpisodeBuildResult, EpisodeNode } from "./types.js";

export const DEFAULT_EPISODE_LEAF_SIZE = 8;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function nodeId(level: number, leafStart: number, leafEnd: number): string {
  return `episode:${level}:${leafStart}-${leafEnd}`;
}

/**
 * Build an aligned binary forest over canonical event order.
 * Incomplete tail ranges stay at their finest available level instead of
 * inventing non-power-of-two parents. This keeps node identity deterministic
 * as new events arrive.
 */
export function buildEpisodeTree(
  events: StoredEvent[],
  options: { leafSize?: number; summarizer?: EpisodeSummarizer; now?: Date } = {},
): EpisodeBuildResult {
  const leafSize = Math.max(1, Math.floor(options.leafSize ?? DEFAULT_EPISODE_LEAF_SIZE));
  const summarizer = options.summarizer ?? deterministicEpisodeSummarizer;
  const generatedAt = (options.now ?? new Date()).toISOString();
  const ordered = events.slice().sort((a, b) => a.sequence - b.sequence);
  const nodes: EpisodeNode[] = [];
  const byRange = new Map<string, EpisodeNode>();

  const leaves: EpisodeNode[] = [];
  for (let i = 0; i < ordered.length; i += leafSize) {
    const batch = ordered.slice(i, i + leafSize);
    if (!batch.length) continue;
    const views = batch.map(episodicEventView);
    const leafStart = leaves.length;
    const leafEnd = leafStart + 1;
    const leaf: EpisodeNode = {
      id: nodeId(0, leafStart, leafEnd),
      level: 0,
      leafStart,
      leafEnd,
      startSequence: batch[0]!.sequence,
      endSequence: batch[batch.length - 1]!.sequence,
      startTime: views[0]!.eventTime,
      endTime: views[views.length - 1]!.eventTime,
      eventCount: batch.length,
      summary: summarizer.summarizeLeaf(views),
      sourceHash: hash(batch.map((e) => [e.sequence, e.erased, e.payload ?? null])),
      summaryVersion: EPISODE_SUMMARY_VERSION,
      generatedAt,
    };
    leaves.push(leaf);
    nodes.push(leaf);
    byRange.set(`${leafStart}:${leafEnd}`, leaf);
  }

  for (let size = 2, level = 1; size <= leaves.length; size *= 2, level += 1) {
    const half = size / 2;
    for (let start = 0; start + size <= leaves.length; start += size) {
      const mid = start + half;
      const end = start + size;
      const left = byRange.get(`${start}:${mid}`);
      const right = byRange.get(`${mid}:${end}`);
      if (!left || !right) throw new Error(`episode tree missing child range ${start}:${end}`);
      const node: EpisodeNode = {
        id: nodeId(level, start, end),
        level,
        leafStart: start,
        leafEnd: end,
        startSequence: left.startSequence,
        endSequence: right.endSequence,
        startTime: left.startTime,
        endTime: right.endTime,
        eventCount: left.eventCount + right.eventCount,
        summary: "",
        sourceHash: hash([left.sourceHash, right.sourceHash]),
        summaryVersion: EPISODE_SUMMARY_VERSION,
        generatedAt,
        leftChildId: left.id,
        rightChildId: right.id,
      };
      node.summary = summarizer.summarizeParent(left, right);
      nodes.push(node);
      byRange.set(`${start}:${end}`, node);
    }
  }

  return { nodes, leafCount: leaves.length, eventCount: ordered.length };
}
