import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../event-store.js";
import { ProjectionEngine, type Projector } from "../projections.js";
import {
  dualWriteLegacyEntry,
  reconcile,
  readerParity,
  type LegacyEntry,
} from "../migration/legacy-adapter.js";

const dir = mkdtempSync(join(tmpdir(), "flyd-migrate-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function legacyJournal(count: number): LegacyEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    legacyId: `journal-${i}-${randomUUID().slice(0, 4)}`,
    kind: "observation",
    sourceId: "work.journal",
    occurredAt: new Date(Date.parse("2026-08-10T08:00:00Z") + i * 3_600_000).toISOString(),
    payload: { note: `closeout entry ${i}`, outcome_status: i % 2 === 0 ? "succeeded" : "rejected" },
  }));
}

describe("legacy dual-write migration", () => {
  it("dual-writes legacy entries with preserved ids, provenance, and timestamps", () => {
    const store = new IntelligenceEventStore({ path: join(dir, `dw-${randomUUID()}.sqlite`) });
    const entries = legacyJournal(3);

    const results = entries.map((entry) => dualWriteLegacyEntry(store, entry)!);
    expect(results.every((r) => !r.alreadyPresent)).toBe(true);

    const first = store.getBySequence(results[0].sequence)!;
    expect(first.provenance).toBe(`legacy_import:${entries[0].legacyId}`);
    expect(first.idempotencyKey).toBe(`legacy:${entries[0].sourceId}:${entries[0].legacyId}`);
    expect((first.payload as { legacy_id?: string }).legacy_id).toBe(entries[0].legacyId);
    expect((first.payload as { occurred_at?: string }).occurred_at).toBe(entries[0].occurredAt);
    store.close();
  });

  it("backfill is idempotent — re-running never duplicates events", () => {
    const store = new IntelligenceEventStore({ path: join(dir, `idem-${randomUUID()}.sqlite`) });
    const entries = legacyJournal(4);

    for (const entry of entries) dualWriteLegacyEntry(store, entry);
    const countAfterFirstPass = store.count();
    const secondPass = entries.map((entry) => dualWriteLegacyEntry(store, entry)!);

    expect(secondPass.every((r) => r.alreadyPresent)).toBe(true);
    expect(store.count()).toBe(countAfterFirstPass);
    store.close();
  });

  it("count and hash parity gates must pass before reader cutover", () => {
    const store = new IntelligenceEventStore({ path: join(dir, `parity-${randomUUID()}.sqlite`) });
    const entries = legacyJournal(5);

    // partial backfill → reconciliation fails closed
    for (const entry of entries.slice(0, 3)) dualWriteLegacyEntry(store, entry);
    const partial = reconcile(store, "work.journal", () => entries);
    expect(partial.countParity).toBe(false);
    expect(partial.missingOnSpine).toHaveLength(2);

    // complete the backfill → gates pass
    for (const entry of entries.slice(3)) dualWriteLegacyEntry(store, entry);
    const full = reconcile(store, "work.journal", () => entries);
    expect(full.countParity).toBe(true);
    expect(full.hashParity).toBe(true);
    store.close();
  });

  it("projected state reaches parity with the legacy reader before cutover", () => {
    const store = new IntelligenceEventStore({ path: join(dir, `reader-${randomUUID()}.sqlite`) });
    const projector: Projector<{ notes: string[] }> = {
      name: "notes",
      initialState: () => ({ notes: [] }),
      apply(state, event) {
        if (event.erased || event.kind !== "observation") return state;
        const payload = event.payload as { note?: string } | undefined;
        if (!payload?.note) return state;
        return { notes: [...state.notes, payload.note] };
      },
    };
    const engine = new ProjectionEngine(store, projector);

    const entries = legacyJournal(4);
    for (const entry of entries) dualWriteLegacyEntry(store, entry);
    engine.runToHead();

    // legacy reader view vs projected view over the same logical data
    const legacyView = entries.map((e) => (e.payload as { note: string }).note);
    const projectedView = engine.snapshot().state.notes;
    expect(readerParity(projectedView, legacyView)).toBe(true);

    // a mismatching reader fails the parity probe
    expect(readerParity(projectedView, legacyView.slice(1))).toBe(false);
    store.close();
  });

  it("deletion affects legacy-derived projections without resurrection from queued legacy events", () => {
    const store = new IntelligenceEventStore({ path: join(dir, `del-${randomUUID()}.sqlite`) });
    const projector: Projector<{ notes: string[] }> = {
      name: "notes-del",
      initialState: () => ({ notes: [] }),
      apply(state, event) {
        // erased events carry no payload — the whole source's derived
        // content is retracted on any tombstoned event
        if (event.erased) return { notes: [] };
        const payload = event.payload as { note?: string } | undefined;
        if (!payload?.note) return state;
        return { notes: [...state.notes, payload.note] };
      },
    };
    const engine = new ProjectionEngine(store, projector);

    const entries = legacyJournal(3);
    for (const entry of entries) dualWriteLegacyEntry(store, entry);
    engine.runToHead();
    expect(engine.snapshot().state.notes).toHaveLength(3);

    // source deletion retracts everything derived from the legacy writer —
    // retraction is a rebuild property: tombstoned events project as retractions
    store.eraseSource("work.journal");
    const rebuilt = engine.rebuild(0);
    expect(rebuilt.state.notes).toHaveLength(0);

    // replaying queued legacy entries again cannot resurrect deleted content:
    // their idempotency keys match tombstoned spine rows, so nothing re-appends
    for (const entry of entries) {
      const result = dualWriteLegacyEntry(store, entry)!;
      expect(result.alreadyPresent).toBe(true);
    }
    expect(engine.rebuild(0).state.notes).toHaveLength(0);
    store.close();
  });
});
