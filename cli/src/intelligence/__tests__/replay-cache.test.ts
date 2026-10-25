import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CognitiveCurator } from "../../cognition/curator/curator.js";
import { IntelligenceEventStore } from "../event-store.js";
import { ProjectionEngine } from "../projections.js";
import { clearWorldModelReplayCache, lastWorldModelReplay, replayWorldModel } from "../world/replay-cache.js";
import { deriveWorldState, worldModelProjector } from "../world/world-model.js";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flyd-replay-"));
  path = join(dir, "intelligence.sqlite");
  clearWorldModelReplayCache();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function withStore<T>(use: (store: IntelligenceEventStore) => T): T {
  const store = new IntelligenceEventStore({ path });
  try { return use(store); } finally { store.close(); }
}

function claim(store: IntelligenceEventStore, entityId: string, attribute: string, value: string, sourceId = "cognition.curator"): void {
  new CognitiveCurator(store).addClaim({ entityId, attribute, value, authority: "observed", evidenceRefs: [] }, sourceId);
}

/** What replaying from zero gives, the authority the cache must always match. */
function fromZero(store: IntelligenceEventStore) {
  return deriveWorldState(new ProjectionEngine(store, worldModelProjector).rebuild(0).state, new Date("2026-10-25T00:00:00Z"));
}

function cached(store: IntelligenceEventStore) {
  return deriveWorldState(replayWorldModel(store), new Date("2026-10-25T00:00:00Z"));
}

describe("world-model replay cache", () => {
  it("replays the log once, then only the events appended since", () => {
    withStore((store) => {
      claim(store, "project:flyd", "branch", "main");
      claim(store, "project:flyd", "dirty", "false");
      expect(cached(store)).toEqual(fromZero(store));
      expect(lastWorldModelReplay()).toEqual({ replayed: 2, full: true });
    });
    // A fresh connection to the same database, as each memory query opens one.
    withStore((store) => {
      replayWorldModel(store);
      expect(lastWorldModelReplay()).toEqual({ replayed: 0, full: false });
      claim(store, "project:flyd", "branch", "prune");
      expect(cached(store)).toEqual(fromZero(store));
      expect(lastWorldModelReplay()).toEqual({ replayed: 1, full: false });
      expect(cached(store).current.find((c) => c.attribute === "branch")?.value).toBe("prune");
    });
  });

  it("replays from zero after an erasure, so erased claims are never served from the cache", () => {
    withStore((store) => {
      claim(store, "project:flyd", "branch", "main", "work.git");
      claim(store, "person:george", "city", "Cape Town", "personal.notes");
      expect(cached(store).current.some((c) => c.value === "Cape Town")).toBe(true);
      store.eraseSource("personal.notes");
      const after = cached(store);
      expect(lastWorldModelReplay().full).toBe(true);
      expect(after.current.some((c) => c.value === "Cape Town")).toBe(false);
      expect(after).toEqual(fromZero(store));
    });
  });

  it("never mistakes a recreated database at the same path for the cached one", () => {
    withStore((store) => {
      claim(store, "project:flyd", "branch", "main");
      replayWorldModel(store);
    });
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
    withStore((store) => {
      claim(store, "project:bloom", "branch", "develop");
      const state = cached(store);
      expect(lastWorldModelReplay().full).toBe(true);
      expect(state.current.map((c) => c.value)).toEqual(["develop"]);
    });
  });
});
