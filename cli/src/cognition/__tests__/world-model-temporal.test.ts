import { describe, expect, it } from "vitest";
import type { StoredEvent } from "../../intelligence/event-store.js";
import { deriveWorldState, worldModelProjector } from "../../intelligence/world/world-model.js";

function event(sequence: number, payload: Record<string, unknown>, capturedAt = "2026-09-22T00:00:00.000Z", kind = "observation"): StoredEvent {
  return {
    sequence,
    id: `event-${sequence}`,
    schemaVersion: 1,
    kind,
    sourceId: "test.cognition",
    capturedAt,
    consentJson: "{}",
    retentionClass: "local_default",
    provenance: "test",
    idempotencyKey: `event-${sequence}`,
    causationIds: [],
    evidenceRefs: [],
    payloadDomain: "domain:test",
    payload,
    redacted: false,
    erased: false,
  } as StoredEvent;
}

describe("temporal logical world model", () => {
  it("expires GNM3 sponsorship through a valid_for relation after GNM3 completes", () => {
    let state = worldModelProjector.initialState();
    state = worldModelProjector.apply(state, event(1, {
      entity: { id: "event:gnm3" }, attribute: "date", value: "2026-09-05",
      validFrom: "2026-09-05", timeShape: "event_bound",
    }, "2026-08-01T00:00:00.000Z"));
    state = worldModelProjector.apply(state, event(2, {
      entity: { id: "task:gnm3:sponsorship" }, attribute: "action", value: "Secure sponsors for GNM3",
      timeShape: "event_bound",
    }, "2026-08-20T00:00:00.000Z"));
    state = worldModelProjector.apply(state, event(3, {
      relation: { from: "task:gnm3:sponsorship", type: "valid_for", to: "event:gnm3", confidence: 1 },
    }, "2026-08-20T00:00:00.000Z"));
    state = worldModelProjector.apply(state, event(4, {
      entity: { id: "event:gnm3" }, attribute: "status", value: "completed", timeShape: "state",
    }, "2026-09-05T12:00:00.000Z", "user_confirmed_intention"));

    const derived = deriveWorldState(state, new Date("2026-09-22T00:00:00.000Z"));
    expect(derived.current.some((claim) => claim.value === "Secure sponsors for GNM3")).toBe(false);
    const historical = derived.historical.find((claim) => claim.value === "Secure sponsors for GNM3");
    expect(historical?.temporalStatus).toBe("expired");
    expect(historical?.derivation).toContain("parent_completed:event:gnm3");
  });

  it("keeps expired work historically retrievable", () => {
    let state = worldModelProjector.initialState();
    state = worldModelProjector.apply(state, event(1, {
      entity: { id: "task:gnm3:sponsorship" }, attribute: "action", value: "Secure sponsors for GNM3",
      validUntil: "2026-09-05", timeShape: "deadline_bound",
    }, "2026-08-20T00:00:00.000Z"));
    const derived = deriveWorldState(state, new Date("2026-09-22T00:00:00.000Z"));
    expect(derived.current).toHaveLength(0);
    expect(derived.historical[0]?.value).toBe("Secure sponsors for GNM3");
    expect(derived.historical[0]?.temporalStatus).toBe("expired");
  });

  it("uses supersedes relations without destroying old claims", () => {
    let state = worldModelProjector.initialState();
    state = worldModelProjector.apply(state, event(1, {
      entity: { id: "project:flyd" }, attribute: "architecture", value: "markdown is canonical",
    }));
    state = worldModelProjector.apply(state, event(2, {
      entity: { id: "project:flyd" }, attribute: "architecture", value: "graph is canonical",
    }, "2026-09-22T01:00:00.000Z"));
    state = worldModelProjector.apply(state, event(3, {
      relation: { from: "2", type: "supersedes", to: "1", confidence: 1 },
    }));
    const derived = deriveWorldState(state);
    expect(derived.current.find((claim) => claim.attribute === "architecture")?.value).toBe("graph is canonical");
    expect(derived.historical.some((claim) => claim.claimId === "1" && claim.temporalStatus === "superseded")).toBe(true);
  });

  it("surfaces explicit contradiction relations as uncertainty", () => {
    let state = worldModelProjector.initialState();
    state = worldModelProjector.apply(state, event(1, {
      entity: { id: "project:bloom" }, attribute: "blocked", value: "yes",
    }));
    state = worldModelProjector.apply(state, event(2, {
      entity: { id: "project:bloom" }, attribute: "blocked", value: "no",
    }, "2026-09-22T01:00:00.000Z"));
    state = worldModelProjector.apply(state, event(3, {
      relation: { from: "1", type: "contradicts", to: "2", confidence: 0.95 },
    }));
    const derived = deriveWorldState(state);
    expect(derived.conflicts.length).toBeGreaterThan(0);
    expect(derived.current.find((claim) => claim.entityId === "project:bloom")?.disputed).toBe(true);
  });
});
