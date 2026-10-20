import Database from "better-sqlite3";
import { dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { defaultIntelligenceDbPath } from "../event-store.js";
import type { EpisodeNode } from "./types.js";

export class EpisodeStore {
  private readonly db: Database.Database;

  constructor(options: { path?: string } = {}) {
    const path = options.path ?? defaultIntelligenceDbPath();
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episode_nodes (
        id TEXT PRIMARY KEY,
        level INTEGER NOT NULL,
        leaf_start INTEGER NOT NULL,
        leaf_end INTEGER NOT NULL,
        start_sequence INTEGER NOT NULL,
        end_sequence INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        event_count INTEGER NOT NULL,
        summary TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        summary_version INTEGER NOT NULL,
        generated_at TEXT NOT NULL,
        left_child_id TEXT,
        right_child_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_episode_nodes_range ON episode_nodes(leaf_start, leaf_end);
      CREATE INDEX IF NOT EXISTS idx_episode_nodes_sequence ON episode_nodes(start_sequence, end_sequence);
    `);
  }

  replaceAll(nodes: EpisodeNode[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM episode_nodes").run();
      const insert = this.db.prepare(`
        INSERT INTO episode_nodes (
          id, level, leaf_start, leaf_end, start_sequence, end_sequence,
          start_time, end_time, event_count, summary, source_hash,
          summary_version, generated_at, left_child_id, right_child_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const n of nodes) insert.run(
        n.id, n.level, n.leafStart, n.leafEnd, n.startSequence, n.endSequence,
        n.startTime, n.endTime, n.eventCount, n.summary, n.sourceHash,
        n.summaryVersion, n.generatedAt, n.leftChildId ?? null, n.rightChildId ?? null,
      );
    });
    tx();
  }

  all(): EpisodeNode[] {
    return (this.db.prepare("SELECT * FROM episode_nodes ORDER BY level, leaf_start").all() as Array<Record<string, unknown>>).map(this.map);
  }

  get(id: string): EpisodeNode | null {
    const row = this.db.prepare("SELECT * FROM episode_nodes WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.map(row) : null;
  }

  children(node: EpisodeNode): EpisodeNode[] {
    return [node.leftChildId, node.rightChildId].flatMap((id) => {
      if (!id) return [];
      const child = this.get(id);
      return child ? [child] : [];
    });
  }

  close(): void { this.db.close(); }

  private map = (r: Record<string, unknown>): EpisodeNode => ({
    id: String(r.id), level: Number(r.level), leafStart: Number(r.leaf_start), leafEnd: Number(r.leaf_end),
    startSequence: Number(r.start_sequence), endSequence: Number(r.end_sequence), startTime: String(r.start_time),
    endTime: String(r.end_time), eventCount: Number(r.event_count), summary: String(r.summary),
    sourceHash: String(r.source_hash), summaryVersion: Number(r.summary_version), generatedAt: String(r.generated_at),
    leftChildId: (r.left_child_id as string) ?? undefined, rightChildId: (r.right_child_id as string) ?? undefined,
  });
}
