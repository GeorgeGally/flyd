import { IntelligenceEventStore, defaultIntelligenceDbPath, type StoredEvent } from "../event-store.js";
import { selectEpisodeCover } from "./cover.js";
import { EpisodeStore } from "./store.js";
import { buildEpisodeTree, DEFAULT_EPISODE_LEAF_SIZE } from "./tree.js";
import type { EpisodeDrillResult, EpisodeNode } from "./types.js";

export class EpisodicMemory {
  readonly path: string;
  readonly leafSize: number;

  constructor(options: { path?: string; leafSize?: number } = {}) {
    this.path = options.path ?? defaultIntelligenceDbPath();
    this.leafSize = Math.max(1, Math.floor(options.leafSize ?? DEFAULT_EPISODE_LEAF_SIZE));
  }

  rebuild(): { eventCount: number; leafCount: number; nodeCount: number } {
    const events = new IntelligenceEventStore({ path: this.path });
    const episodes = new EpisodeStore({ path: this.path });
    try {
      const built = buildEpisodeTree(events.readFrom(0, Number.MAX_SAFE_INTEGER), { leafSize: this.leafSize });
      episodes.replaceAll(built.nodes);
      return { eventCount: built.eventCount, leafCount: built.leafCount, nodeCount: built.nodes.length };
    } finally {
      episodes.close();
      events.close();
    }
  }

  timeline(budget = 12): EpisodeNode[] {
    const store = new EpisodeStore({ path: this.path });
    try { return selectEpisodeCover(store.all(), budget); }
    finally { store.close(); }
  }

  drill(nodeId: string): EpisodeDrillResult | null {
    const episodes = new EpisodeStore({ path: this.path });
    const events = new IntelligenceEventStore({ path: this.path });
    try {
      const node = episodes.get(nodeId);
      if (!node) return null;
      const children = episodes.children(node);
      const source: StoredEvent[] = [];
      if (children.length === 0) {
        for (const event of events.readFrom(Math.max(0, node.startSequence - 1), Math.max(1, node.eventCount + 16))) {
          if (event.sequence > node.endSequence) break;
          if (event.sequence >= node.startSequence) source.push(event);
        }
      }
      return { node, children, events: source };
    } finally {
      episodes.close();
      events.close();
    }
  }

  verify(): { ok: boolean; issues: string[]; nodes: number } {
    const store = new EpisodeStore({ path: this.path });
    try {
      const nodes = store.all();
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const issues: string[] = [];
      for (const node of nodes) {
        if (node.leafEnd <= node.leafStart) issues.push(`${node.id}: invalid leaf range`);
        if (node.endSequence < node.startSequence) issues.push(`${node.id}: invalid sequence range`);
        for (const id of [node.leftChildId, node.rightChildId]) {
          if (id && !byId.has(id)) issues.push(`${node.id}: missing child ${id}`);
        }
        if (node.leftChildId && node.rightChildId) {
          const left = byId.get(node.leftChildId)!;
          const right = byId.get(node.rightChildId)!;
          if (left.leafEnd !== right.leafStart || left.leafStart !== node.leafStart || right.leafEnd !== node.leafEnd) {
            issues.push(`${node.id}: child ranges do not tile parent`);
          }
        }
      }
      return { ok: issues.length === 0, issues, nodes: nodes.length };
    } finally { store.close(); }
  }
}
