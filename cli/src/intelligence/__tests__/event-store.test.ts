import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  IntelligenceEventStore,
  type StoredEvent,
} from "../event-store.js";
import { validateEnvelope, type ContextEnvelope } from "../context-envelope.js";

const dir = mkdtempSync(join(tmpdir(), "flyd-intel-"));
const dbPath = join(dir, "intelligence.sqlite");
const dbPath2 = join(dir, "restart.sqlite");

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function observation(sourceId = "calendar.metadata", key = `cal-${randomUUID()}`, payload: Record<string, unknown> = { title_hash: "h1" }): ContextEnvelope {
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

function appendValid(store: IntelligenceEventStore, envelope: ContextEnvelope): StoredEvent | null {
  const validation = validateEnvelope(envelope);
  if (!validation.ok) return null;
  return store.append(envelope);
}

describe("IntelligenceEventStore", () => {
  it("round-trips an event with full provenance metadata", () => {
    const store = new IntelligenceEventStore({ path: dbPath });
    const event = appendValid(store, observation("calendar.metadata", "meta-1", { title_hash: "abc" }));
    expect(event).not.toBeNull();
    expect(event!.schemaVersion).toBe(1);
    expect(event!.kind).toBe("observation");
    expect(event!.sourceId).toBe("calendar.metadata");
    expect(event!.consentJson).toContain("calendar.metadata");
    expect(event!.payloadDomain).toBe("domain:calendar.metadata");
    expect(event!.payload).toEqual({ title_hash: "abc" });
    expect(event!.erased).toBe(false);
    store.close();
  });

  it("coalesces duplicate idempotency keys without writing twice", () => {
    const store = new IntelligenceEventStore({ path: dbPath });
    const key = `dup-${randomUUID()}`;
    const first = appendValid(store, observation("calendar.metadata", key));
    const second = appendValid(store, observation("calendar.metadata", key));
    expect(second!.sequence).toBe(first!.sequence);
    expect(second!.id).toBe(first!.id);
    store.close();
  });

  it("rejects invalid envelopes so they never reach the spine", () => {
    const store = new IntelligenceEventStore({ path: dbPath });
    const before = store.count();
    expect(appendValid(store, observation("x", "k1", {}) as ContextEnvelope)).not.toBeNull();
    const badKind = observation("x", "bad-kind");
    badKind.kind = "chat_turn" as never;
    expect(validateEnvelope(badKind).ok).toBe(false);
    expect(appendValid(store, badKind)).toBeNull();
    const noConsent = observation("x", "no-consent");
    noConsent.consent = undefined as never;
    expect(validateEnvelope(noConsent).ok).toBe(false);
    expect(appendValid(store, noConsent)).toBeNull();
    expect(store.count()).toBe(before + 1);
    store.close();
  });

  it("survives a restart and keeps sequences monotonic", () => {
    const first = new IntelligenceEventStore({ path: dbPath2 });
    appendValid(first, observation("calendar.metadata", "r-1"));
    first.close();

    const second = new IntelligenceEventStore({ path: dbPath2 });
    expect(second.count()).toBe(1);
    const next = appendValid(second, observation("calendar.metadata", "r-2"));
    expect(next!.sequence).toBeGreaterThan(1);
    second.close();
  });

  describe("erasure", () => {
    it("destroys payloads, tombstones non-identifying audit, queues sweeps, blocks replay", () => {
      const path = join(dir, `erase-${randomUUID()}.sqlite`);
      const store = new IntelligenceEventStore({ path });
      const a = appendValid(store, observation("notes.app", "n-1", { body: "private note" }))!;
      appendValid(store, observation("calendar.metadata", "c-keep", { title_hash: "fine" }));

      const { tombstone, affectedSequences, sweeps } = store.eraseSource("notes.app");

      expect(tombstone.sourceId).toBe("notes.app");
      expect(tombstone.eventCount).toBe(1);
      expect(JSON.stringify(tombstone)).not.toContain("private note");
      expect(affectedSequences).toEqual([a.sequence]);

      const erased = store.getBySequence(a.sequence)!;
      expect(erased.erased).toBe(true);
      expect(erased.payload).toBeUndefined();

      // replay feed withholds erased content but keeps the audit record
      const replayed = store.readFrom(0).filter((e) => e.sourceId === "notes.app");
      expect(replayed).toHaveLength(1);
      expect(replayed[0].payload).toBeUndefined();

      const surfaces = sweeps.map((s) => s.surface).sort();
      expect(surfaces).toEqual(["indexes", "legacy_copies", "projections", "replay_snapshots"]);
      expect(sweeps.every((s) => s.status === "pending")).toBe(true);

      // revocation is derived from the tombstone
      expect(store.isRevoked("notes.app")).toBe(true);
      expect(store.isRevoked("calendar.metadata")).toBe(false);

      store.completeSweep(sweeps[0].sweepId);
      expect(store.pendingSweeps()).toHaveLength(3);
      store.close();
    });
  });
});

it('reads only the requested source family in canonical order and retracts erased payloads', () => {
  const store = new IntelligenceEventStore({ path: join(dir, 'prefix.sqlite') });
  try {
    appendValid(store, observation('initiative.session.a', 'prefix-a', { value: 'a' }));
    appendValid(store, observation('calendar.metadata', 'prefix-other', { value: 'private-other' }));
    appendValid(store, observation('initiative.session.b', 'prefix-b', { value: 'b' }));
    expect(store.readSourcePrefix('initiative.session.').map(event => event.payload?.value)).toEqual(['a', 'b']);
    store.eraseSource('initiative.session.a');
    expect(store.readSourcePrefix('initiative.session.').filter(event => !event.erased).map(event => event.payload?.value)).toEqual(['b']);
  } finally { store.close(); }
});


describe("initiative source-lineage erasure and retention", () => {
  it("erases a derived decision and finding atomically with a revoked CoS source", () => {
    const store = new IntelligenceEventStore({ path: join(dir, "lineage-" + randomUUID() + ".sqlite") });
    try {
      const upstream = appendValid(store, observation("cos.report", "parent", { report: { outcome: "private client details" } }))!;
      const decision = appendValid(store, observation("initiative.curated", "decision", {
        source_keys: ["cos:" + upstream.id], why_now: "private client details",
      }))!;
      const finding = appendValid(store, observation("initiative.curated", "finding", {
        sources: [{ id: "cos:" + upstream.id }], known: "private client details",
      }))!;
      const independent = appendValid(store, observation("initiative.curated", "independent", {
        sources: [{ id: "project:unrelated" }], known: "other",
      }))!;
      const result = store.eraseSource("cos.report");
      expect(result.affectedSequences).toEqual(expect.arrayContaining([
        upstream.sequence, decision.sequence, finding.sequence,
      ]));
      expect(store.getBySequence(decision.sequence)).toMatchObject({ erased: true, payload: undefined, evidenceRefs: [] });
      expect(store.getBySequence(finding.sequence)).toMatchObject({ erased: true, payload: undefined, evidenceRefs: [] });
      expect(store.getBySequence(independent.sequence)?.erased).toBe(false);
      expect(JSON.stringify(store.readSource("initiative.curated"))).not.toContain("private client details");
    } finally { store.close(); }
  });

  it("can retract one project parent without globally revoking initiative", () => {
    const store = new IntelligenceEventStore({ path: join(dir, "project-retract-" + randomUUID() + ".sqlite") });
    try {
      appendValid(store, observation("initiative.curated", "a", {
        sources: [{ id: "project:p1" }], known: "stale statement",
      }));
      appendValid(store, observation("initiative.curated", "b", {
        sources: [{ id: "project:p2" }], known: "still current",
      }));
      expect(store.retractInitiativeBySourceKeys(["project:p1"])).toBe(1);
      expect(store.retractInitiativeBySourceKeys(["project:p1"])).toBe(0);
      expect(store.isRevoked("initiative.curated")).toBe(false);
      expect(store.readSource("initiative.curated").filter(e => !e.erased).map(e => e.payload?.known)).toEqual(["still current"]);
    } finally { store.close(); }
  });

  it("retention nulls old payloads without revoking the source", () => {
    const store = new IntelligenceEventStore({ path: join(dir, "ttl-" + randomUUID() + ".sqlite") });
    try {
      const previous = appendValid(store, observation("initiative.curated", "ttl-1", { known: "private text" }))!;
      appendValid(store, observation("other", "ttl-other", { known: "keep" }));
      expect(store.purgeSourceBefore("initiative.curated", new Date(Date.now() + 5_000))).toBe(1);
      expect(store.getBySequence(previous.sequence)).toMatchObject({ erased: true, payload: undefined, evidenceRefs: [] });
      expect(store.purgeSourceBefore("initiative.curated", new Date(Date.now() + 5_000))).toBe(0);
      expect(store.readSource("other")[0]?.payload?.known).toBe("keep");
      expect(store.isRevoked("initiative.curated")).toBe(false);
    } finally { store.close(); }
  });
});
