import type { IntelligenceEventStore } from "../event-store.js";
import { worldModelProjector, type WorldModelState } from "./world-model.js";

// The world model is a fold over the whole event log. Every chat turn asked
// for it several times (memory twice, the git digest's projection rebuild),
// and each time replayed every event from zero. The log only grows between
// those asks, so the fold is kept per database and extended with the new
// events; anything else (an erasure, a purge, a different file under the
// same name) is detected and answered with a full replay, exactly as before.

interface CachedReplay {
  file: string;
  head: number;
  count: number;
  erased: number;
  /** The id of the event at `head`, so a recreated database is never mistaken for this one. */
  headId: string | null;
  state: WorldModelState;
}

const cache = new Map<string, CachedReplay>();
const MAX_DATABASES = 4;

export interface ReplayStats { replayed: number; full: boolean }
let lastStats: ReplayStats = { replayed: 0, full: true };

/** How the most recent call was answered: events applied, and whether it replayed from zero. */
export function lastWorldModelReplay(): ReplayStats {
  return lastStats;
}

/** Forget every cached fold (tests, or after rewriting a database out of band). */
export function clearWorldModelReplayCache(): void {
  cache.clear();
}

function fold(store: IntelligenceEventStore, state: WorldModelState, after: number, upTo: number): { state: WorldModelState; applied: number; headId: string | null } {
  let cursor = after;
  let applied = 0;
  let headId: string | null = null;
  for (;;) {
    const batch = store.readFrom(cursor);
    for (const event of batch) {
      if (event.sequence > upTo) return { state, applied, headId };
      state = worldModelProjector.apply(state, event);
      cursor = event.sequence;
      headId = event.id;
      applied += 1;
    }
    if (batch.length < 1000) return { state, applied, headId };
  }
}

/**
 * The world-model state over every event in the store, identical to
 * `new ProjectionEngine(store, worldModelProjector).rebuild(0).state` but
 * extended incrementally from the last call on the same database. Treat the
 * result as read-only: later calls build on it.
 */
export function replayWorldModel(store: IntelligenceEventStore): WorldModelState {
  const now = store.replayFingerprint();
  const inMemory = now.file === "" || now.file === ":memory:";
  const prior = inMemory ? undefined : cache.get(now.file);
  if (prior && prior.erased === now.erased && now.head >= prior.head && now.count >= prior.count
    && (prior.headId === null ? prior.head === 0 : store.getBySequence(prior.head)?.id === prior.headId)) {
    const extended = fold(store, prior.state, prior.head, now.head);
    // Every new event is above the old head, so the count says whether anything below it changed.
    if (now.count === prior.count + extended.applied) {
      const next: CachedReplay = { ...now, headId: extended.applied ? extended.headId : prior.headId, state: extended.state };
      cache.set(now.file, next);
      lastStats = { replayed: extended.applied, full: false };
      return next.state;
    }
  }
  const full = fold(store, worldModelProjector.initialState(), 0, now.head);
  lastStats = { replayed: full.applied, full: true };
  if (!inMemory) {
    cache.delete(now.file);
    if (cache.size >= MAX_DATABASES) cache.delete(cache.keys().next().value!);
    cache.set(now.file, { ...now, count: full.applied, headId: full.headId, state: full.state });
  }
  return full.state;
}
