import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../event-store.js";
import { ProjectionEngine, type Projector } from "../projections.js";
import {
  CALENDAR_METADATA_CONTRACT,
  SourceContractRegistry,
} from "../sensors/source-contracts.js";
import { SensorGate } from "../sensors/sensor-gate.js";
import { deleteSource, exportSourceData, governanceSummary } from "../sensors/governance.js";

const dir = mkdtempSync(join(tmpdir(), "flyd-sensors-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function registryWithCalendar(): SourceContractRegistry {
  const registry = new SourceContractRegistry({ path: join(dir, `consents-${randomUUID()}.json`) });
  registry.register(CALENDAR_METADATA_CONTRACT);
  return registry;
}

function calendarEnvelope(key = `cal-${randomUUID()}`): Parameters<IntelligenceEventStore["append"]>[0] {
  return {
    pathKind: "sensor",
    kind: "observation",
    sourceId: "calendar.metadata",
    consent: { grantedAt: "2026-08-22T00:00:00.000Z", scopes: ["calendar.metadata"] },
    retentionClass: "local_default",
    payloadClassification: "personal",
    provenance: "sensor:test",
    idempotencyKey: key,
    payload: { event_title_hash: "abc", starts_at: "2026-08-23T09:00:00Z" },
  } as never;
}

describe("LEARN source governance", () => {
  it("calendar metadata cannot emit an event before its contract is enabled", () => {
    const registry = registryWithCalendar();
    const gate = new SensorGate(registry);
    expect(registry.status("calendar.metadata")).toBe("disabled");

    const denied = gate.admit(calendarEnvelope());
    expect(denied).toEqual({ admitted: false, reason: "contract_disabled" });

    // unregistered sources are not LEARN sources at all
    const unknown = gate.admit({ ...calendarEnvelope(), sourceId: "browser.history" } as never);
    expect(unknown).toMatchObject({ admitted: false, reason: "not_a_learn_source" });

    registry.setStatus("calendar.metadata", "enabled");
    expect(gate.admit(calendarEnvelope())).toEqual({ admitted: true });
  });

  it("PRESENT foreground feedback stays outside the personal event spine", () => {
    const registry = registryWithCalendar();
    const gate = new SensorGate(registry);

    // the bounded complaint transport is not a LEARN source and can never be admitted
    const complaint = { ...calendarEnvelope(), sourceId: "present.foreground_feedback" } as never;
    expect(gate.admit(complaint)).toMatchObject({ admitted: false, reason: "not_a_learn_source" });

    // and registering it is refused — PRESENT keeps its separate contract
    expect(() =>
      registry.register({
        ...CALENDAR_METADATA_CONTRACT,
        sourceId: "present.foreground_feedback",
        displayName: "Foreground feedback",
      }),
    ).toThrow(/refusing/i);
  });

  it("revocation immediately stops capture and queued analysis", () => {
    const registry = registryWithCalendar();
    registry.setStatus("calendar.metadata", "enabled");
    const gate = new SensorGate(registry);

    expect(gate.admit(calendarEnvelope())).toEqual({ admitted: true });

    registry.setStatus("calendar.metadata", "paused");
    expect(gate.admit(calendarEnvelope())).toMatchObject({ admitted: false, reason: "contract_paused" });

    registry.setStatus("calendar.metadata", "revoked");
    expect(gate.admit(calendarEnvelope())).toMatchObject({ admitted: false, reason: "source_revoked" });
    // queued analysis re-checks through the same lookup before processing
    expect(registry.status("calendar.metadata")).toBe("revoked");
    expect(() => registry.setStatus("calendar.metadata", "enabled")).toThrow(/revoked/);
  });

  it("incognito sessions and excluded apps create no event", () => {
    const registry = registryWithCalendar();
    registry.setStatus("calendar.metadata", "enabled");
    const gate = new SensorGate(registry);

    expect(gate.admit(calendarEnvelope(), { incognito: true })).toMatchObject({ admitted: false, reason: "incognito" });
    expect(gate.admit(calendarEnvelope(), { bundleId: "com.flyd.overlay" })).toMatchObject({ admitted: false, reason: "app_excluded" });
    expect(gate.admit(calendarEnvelope(), { bundleId: "com.apple.Calendar" })).toEqual({ admitted: true });
  });

  it("raw screen, clipboard, audio, and communication content remain unavailable by default", () => {
    const registry = new SourceContractRegistry({ path: join(dir, `sensitive-${randomUUID()}.json`) });

    for (const sensitive of ["screen.raw_text", "clipboard", "microphone.content", "communications"]) {
      expect(() =>
        registry.register({
          ...CALENDAR_METADATA_CONTRACT,
          sourceId: sensitive,
          sensitivity: "high",
          scopes: [sensitive],
        }),
      ).toThrow(/high-sensitivity/i);
      expect(registry.contract(sensitive)).toBeUndefined();
    }

    // even a registered low-sensitivity source cannot carry sensitive fields
    registry.register(CALENDAR_METADATA_CONTRACT);
    registry.setStatus("calendar.metadata", "enabled");
    const gate = new SensorGate(registry);
    const smuggling = {
      ...calendarEnvelope(),
      payload: { screen_text: "everything on screen right now" },
    };
    expect(gate.admit(smuggling)).toMatchObject({ admitted: false, reason: "redaction_failed" });
  });

  it("source deletion makes raw payloads unrecoverable from every store surface", async () => {
    const registry = registryWithCalendar();
    registry.setStatus("calendar.metadata", "enabled");

    const store = new IntelligenceEventStore({ path: join(dir, `gov-${randomUUID()}.sqlite`) });
    const countingProjector: Projector<{ seen: number }> = {
      name: "counting",
      initialState: () => ({ seen: 0 }),
      apply(state) {
        return { seen: state.seen + 1 };
      },
    };
    const engine = new ProjectionEngine(store, countingProjector);

    for (let i = 0; i < 3; i += 1) store.append(calendarEnvelope(`del-${i}`));
    engine.runToHead();
    expect(engine.snapshot().state.seen).toBe(3);

    // export shows everything while the source lives
    const before = exportSourceData(store, "calendar.metadata");
    expect(before.events).toHaveLength(3);
    expect(before.events.every((e) => e.payloadReadable)).toBe(true);

    const deletion = deleteSource(store, registry, "calendar.metadata");
    expect(deletion.tombstone?.eventCount).toBe(3);
    expect(deletion.pendingSweeps).toBe(4); // projections, indexes, replay_snapshots, legacy_copies

    // canonical: payload gone
    const anyEvent = store.readFrom(0).find((e) => e.sourceId === "calendar.metadata")!;
    expect(anyEvent.erased).toBe(true);
    expect(anyEvent.payload).toBeUndefined();

    // replay surface withholds content
    expect(store.readFrom(0).every((e) => e.sourceId !== "calendar.metadata" || e.payload === undefined)).toBe(true);

    // projection rebuild retracts derived state
    expect(engine.rebuild(0).state.seen).toBeLessThan(3 + 1); // tombstoned events project as retractions only

    // export after deletion carries no readable material
    const after = exportSourceData(store, "calendar.metadata");
    expect(after.events.every((e) => !e.payloadReadable && e.payload === undefined)).toBe(true);
    expect(JSON.stringify(after)).not.toContain("2026-08-23T09:00:00Z");

    // inspect reflects the revoked state
    const summary = governanceSummary(store, registry).find((s) => s.sourceId === "calendar.metadata");
    expect(summary?.status).toBe("revoked");

    store.close();
  });
});
