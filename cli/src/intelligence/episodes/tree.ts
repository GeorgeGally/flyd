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

export function buildEpisodeTree(
  events: StoredEvent[],
  options: { leafSize?: number; summarizer?: EpisodeSummarizer; now?: Date } = {},
): EpisodeBuildResult {
  const leafSize = Math.max(1, Math.floor(options.leafSize ?? DEFAULT_EPISODE_LEAF_SIZE));
  const summarizer = options.summarizer ?? deterministicEpisodeSummarizer;
  const generatedAt = (options.now ?? new Date()).toISOString();
  const ordered = events.slice().sort((a, b) => a.sequence - b.sequence);
  const levels: EpisodeNode[][] = [];

  const leaves: EpisodeNode[] = [];
  for (let i = 0; i < ordered.length; i += leafSize) {
    const batch = ordered.slice(i, i + leafSize);
    if (!batch.length) continue;
    const views = batch.map(episodicEventView);
    const leafStart = leaves.length;
    const leafEnd = leafStart + 1;
    leaves.push({
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
    });
  }
  levels.push(leaves);

  let current = leaves;
  let level = 1;
  while (current.length > 1) {
    const next: EpisodeNode[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      const right = current[i + 1];
      if (!right) {
        next.push({ ...left });
        continue;
      }
      const node: EpisodeNode = {
        id: nodeId(level, left.leafStart, right.leafEnd),
        level,
        leafStart: left.leafStart,
        leafEnd: right.leafEnd,
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
      next.push(node);
    }
    levels.push(next);
    current = next;
    level += 1;
  }

  return { nodes: levels.flat(), leafCount: leaves.length, eventCount: ordered.length };
}
