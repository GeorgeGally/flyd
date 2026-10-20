import type { StoredEvent } from "../event-store.js";

export interface EpisodicEventView {
  sequence: number;
  capturedAt: string;
  eventTime: string;
  kind: string;
  sourceId: string;
  erased: boolean;
  payload?: Record<string, unknown>;
}

export interface EpisodeNode {
  id: string;
  level: number;
  leafStart: number;
  leafEnd: number;
  startSequence: number;
  endSequence: number;
  startTime: string;
  endTime: string;
  eventCount: number;
  summary: string;
  sourceHash: string;
  summaryVersion: number;
  generatedAt: string;
  leftChildId?: string;
  rightChildId?: string;
}

export interface EpisodeCoverOptions {
  budget?: number;
}

export interface EpisodeDrillResult {
  node: EpisodeNode;
  children: EpisodeNode[];
  events: StoredEvent[];
}

export interface EpisodeBuildResult {
  nodes: EpisodeNode[];
  leafCount: number;
  eventCount: number;
}
