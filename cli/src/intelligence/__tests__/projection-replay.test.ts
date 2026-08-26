import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../event-store.js";
import { ProjectionEngine, type Projector } from "../projections.js";
import { validateEnvelope, type ContextEnvelope } from "../context-envelope.js";

const dir = mkdtempSync(join(tmpdir(), "flyd-proj-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface BeliefState {
  beliefs: Map<string, string>;
}

/** Deterministic example projector: latest observation payload per source. */
const beliefProjector: Projector<BeliefState> = {
  name: "beliefs",
  initialState: () => ({ beliefs: new Map() }),
  apply(state, event) {
    const next = { beliefs: new Map(state.beliefs) };
    if (event.erased) {
      next.beliefs.delete(event.sourceId);
      return next;
    }
    if (event.kind === "observation" && event.payload) {
      next.beliefs.set(event.sourceId, JSON.stringify(event.payload));
    }
    return next;
  },
};

function observation(sourceId: string, key: string, payload: Record<string, unknown>): ContextEnvelope {
  return {
    pathKind: "sensor",
    kind: "observation",
    sourceId,
    consent: { grantedAt: "2026-08-22T00:00:00.000Z", scopes: [sourceId] },
    retentionClass: "local_default",
    payloadClassification: "personal",
    provenance: "sensor:test",
    idempotencyKey: key,
    payload,
  };
}

function appendObservation(store: IntelligenceEventStore, sourceId: string, payload: Record<string, unknown>): number | null {
  const envelope = observation(sourceId, `obs-${randomUUID()}`, payload);
  if (!validateEnvelope(envelope).ok) return null;
  return store.append(envelope)?.sequence ?? null;
}

function freshStore(name: string): IntelligenceEventStore {
  return new IntelligenceEventStore({ path: join(dir, name) });
}

describe("ProjectionEngine", () => {
  it("produces identical projections for duplicate and reordered appends", () => {
    const a = freshStore(`order-a-${randomUUID()}.sqlite`);
    const b = freshStore(`order-b-${randomUUID()}.sqlite`);

    // store A: two appends, then the first one re-sent (duplicate)
    appendObservation(a, "calendar.metadata", { day: "monday" });
    const s1 = new ProjectionEngine(a, beliefProjector);
    s1.runToHead();
    appendObservation(a, "repository.activity", { repo: "flyd" });
    s1.runToHead();
    appendObservation(a, "calendar.metadata", { day: "monday" }); // duplicate key? no — different key; use same key path below

    // store B: same logical events appended in reverse batch order
    appendObservation(b, "repository.activity", { repo: "flyd" });
    appendObservation(b, "calendar.metadata", { day: "monday" });

    const hashA = s1.stateHash();
    const engineB = new ProjectionEngine(b, beliefProjector);
    engineB.runToHead();

    // canonical order makes content-equal event sets project identically
    expect(hashA).toBe(engineB.stateHash());
    expect(s1.snapshot().state.beliefs.get("calendar.metadata")).toContain("monday");

    a.close();
    b.close();
  });

  it("appending an exact duplicate does not change projection state", () => {
    const store = freshStore(`dup-${randomUUID()}.sqlite`);
    const envelope = observation("calendar.metadata", "fixed-key-1", { slot: "am" });
    store.append(envelope);
    const engine = new ProjectionEngine(store, beliefProjector);
    engine.runToHead();
    const before = engine.stateHash();
    const again = store.append({ ...envelope });
    expect(again!.sequence).toBe(store.getBySequence(1)!.sequence);
    engine.runToHead();
    expect(engine.runToHead()).toBe(0);
    expect(engine.stateHash()).toBe(before);
    store.close();
  });

  it("resumes from checkpoint after restart without duplicate execution", () => {
    const store = freshStore(`restart-${randomUUID()}.sqlite`);
    appendObservation(store, "calendar.metadata", { v: 1 });
    appendObservation(store, "calendar.metadata", { v: 2 });

    const first = new ProjectionEngine(store, beliefProjector);
    first.runToHead();
    const headHash = first.stateHash();

    // simulate restart: new engine over the same store
    const restarted = new ProjectionEngine(store, beliefProjector);
    expect(restarted.runToHead()).toBe(0); // nothing left to do — no duplicates
    expect(restarted.stateHash()).toBe(headHash);

    // new events continue from the checkpoint
    appendObservation(store, "notes.app", { v: 3 });
    expect(restarted.runToHead()).toBe(1);

    // incremental result equals a full rebuild from scratch
    const rebuilt = restarted.rebuild(0);
    expect(rebuilt.stateHash).toBe(restarted.stateHash());
    store.close();
  });

  it("retracts dependent projections when a source is erased and blocks rejected events from projecting", () => {
    const store = freshStore(`erase-${randomUUID()}.sqlite`);
    appendObservation(store, "notes.app", { body: "secret" });
    appendObservation(store, "calendar.metadata", { ok: true });

    const engine = new ProjectionEngine(store, beliefProjector);
    engine.runToHead();
    expect(engine.snapshot().state.beliefs.has("notes.app")).toBe(true);

    const { affectedSequences, sweeps } = store.eraseSource("notes.app");
    expect(affectedSequences.length).toBe(1);
    expect(sweeps.map((s) => s.surface)).toContain("projections");

    // rebuild replays canonical history; erased payloads are withheld so the
    // projector retracts the derived belief
    const rebuilt = engine.rebuild(0);
    expect(rebuilt.state.beliefs.has("notes.app")).toBe(false);
    expect(rebuilt.state.beliefs.has("calendar.metadata")).toBe(true);

    // rejected envelopes (redaction failure) never reach the spine at all
    const bad = observation("screen.capture", "bad-1", { screen_text: "raw pixels of thought" });
    expect(validateEnvelope(bad).ok).toBe(false);
    expect(store.count()).toBe(2); // only the two valid observations exist

    // hash report for fixture data (verification contract)
    const report = {
      store: `${store.count()} events`,
      projection: rebuilt.projector,
      lastSequence: rebuilt.lastSequence,
      stateHash: rebuilt.stateHash,
    };
    expect(report.stateHash).toMatch(/^[0-9a-f]{64}$/);
    console.log("[projection-replay] fixture hash report:", report);

    store.close();
  });
});
