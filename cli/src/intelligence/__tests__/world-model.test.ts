import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { StoredEvent } from "../event-store.js";
import { IntelligenceEventStore } from "../event-store.js";
import { ProjectionEngine } from "../projections.js";
import {
  activeClaims,
  conflictsFor,
  epistemicConfidence,
  freshnessOf,
  resolveEntityId,
  worldModelProjector,
} from "../world/world-model.js";
import { isWorkOnlyEvent, parityCheck, projectedCurrentWork } from "../world/current-work.js";
import type { GroundingContext } from "../../work-intelligence/current-work.js";

const dir = mkdtempSync(join(tmpdir(), "flyd-world-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function claimEvent(overrides: Partial<StoredEvent> & { sequence: number; payload: Record<string, unknown> }): StoredEvent {
  return {
    id: `ev-${overrides.sequence}-${randomUUID().slice(0, 6)}`,
    schemaVersion: 1,
    kind: "observation",
    sourceId: "calendar.metadata",
    capturedAt: new Date().toISOString(),
    consentJson: "{}",
    retentionClass: "local_default",
    provenance: "test",
    idempotencyKey: `k-${overrides.sequence}`,
    causationIds: [],
    evidenceRefs: [],
    payloadDomain: "domain:test",
    redacted: false,
    erased: false,
    ...overrides,
  } as StoredEvent;
}

describe("world model", () => {
  it("resolves entity identities to stable slugs", () => {
    expect(resolveEntityId("project", "/Users/g/flyd")).toBe("project:users-g-flyd");
    expect(resolveEntityId("project", "/Users/g/flyd/")).toBe(resolveEntityId("project", "/users/g/flyd"));
  });

  it("a user correction supersedes an inference without destroying its evidence", () => {
    const store = new IntelligenceEventStore({ path: join(dir, `correct-${randomUUID()}.sqlite`) });
    const engine = new ProjectionEngine(store, worldModelProjector);

    // inference: user works on flyd
    store.append({
      pathKind: "executive",
      kind: "inferred_belief",
      sourceId: "work.foreground",
      consent: { grantedAt: "2026-08-01T00:00:00.000Z", scopes: ["work.foreground"] },
      retentionClass: "local_default",
      payloadClassification: "personal",
      provenance: "executive:inference",
      idempotencyKey: `inf-${randomUUID()}`,
      payload: { entity: { namespace: "project", key: "flyd" }, attribute: "focus", value: "building the overlay" },
    } as never);
    engine.runToHead();
    const inferredSequence = store.headSequence();

    // correction: user says they're actually on the runtime plan
    const correctionEnvelope = {
      pathKind: "interface" as const,
      kind: "user_confirmed_intention" as const,
      sourceId: "chat.correction",
      consent: { grantedAt: "2026-08-01T00:00:00.000Z", scopes: ["chat"] },
      retentionClass: "local_default" as const,
      payloadClassification: "personal" as const,
      provenance: "user-correction",
      idempotencyKey: `cor-${randomUUID()}`,
      causationIds: [String(inferredSequence)],
      payload: { entity: { namespace: "project", key: "flyd" }, attribute: "focus", value: "migrating current-work belief" },
    };
    store.append(correctionEnvelope as never);
    engine.runToHead();

    const state = engine.snapshot().state;
    const claims = state.claims.filter((c) => c.entityId === resolveEntityId("project", "flyd") && c.attribute === "focus");
    expect(claims).toHaveLength(2);

    const corrected = claims.find((c) => c.authority === "user_confirmed")!;
    const superseded = claims.find((c) => c.authority === "inferred")!;
    expect(superseded.supersededBy).toBe(corrected.claimId);
    // evidence intact: superseded claim keeps its event-sequence provenance
    expect(superseded.evidenceRefs).toContain(inferredSequence);
    // and the correction causally links back
    expect(corrected.evidenceRefs).toContain(inferredSequence);

    const active = activeClaims(state);
    expect(active.filter((c) => c.attribute === "focus")).toHaveLength(1);
    expect(active[0].value).toBe("migrating current-work belief");
    store.close();
  });

  it("conflicting current and durable claims remain visible with authority labels", () => {
    const now = new Date("2026-08-23T12:00:00Z");
    let seq = 1;
    let state = worldModelProjector.initialState();
    state = worldModelProjector.apply(state, claimEvent({
      sequence: seq++,
      capturedAt: "2026-08-20T09:00:00.000Z",
      kind: "observation",
      payload: { entity: { namespace: "goal", key: "q3" }, attribute: "priority", value: "ship coach" },
    }));
    state = worldModelProjector.apply(state, claimEvent({
      sequence: seq++,
      capturedAt: "2026-08-22T15:00:00.000Z",
      kind: "inferred_belief",
      payload: { entity: { namespace: "goal", key: "q3" }, attribute: "priority", value: "runtime migration" },
    }));

    const conflict = conflictsFor(state, resolveEntityId("goal", "q3"), "priority", now);
    expect(conflict).not.toBeNull();
    // equal-rank tie → most recent wins
    expect(conflict!.active.value).toBe("runtime migration");
    expect(conflict!.active.authority).toBe("inferred");
    expect(conflict!.conflicting).toHaveLength(1);
    expect(conflict!.conflicting[0].claim.value).toBe("ship coach");
    expect(conflict!.conflicting[0].authority).toBe("observed");

    // a confirmed claim settles the dispute: lesser claims are retired
    state = worldModelProjector.apply(state, claimEvent({
      sequence: seq++,
      capturedAt: "2026-08-23T08:00:00.000Z",
      kind: "user_confirmed_intention",
      payload: { entity: { namespace: "goal", key: "q3" }, attribute: "priority", value: "ship coach first" },
    }));
    const afterConfirm = conflictsFor(state, resolveEntityId("goal", "q3"), "priority", now);
    expect(afterConfirm).toBeNull(); // the user settled it — no live dispute
    const active = activeClaims(state, now).filter((c) => c.attribute === "priority");
    expect(active).toHaveLength(1);
    expect(active[0].value).toBe("ship coach first");
    // but the retired claims stay inspectable in history
    expect(state.claims.filter((c) => c.attribute === "priority")).toHaveLength(3);
  });

  it("old evidence changes freshness but never epistemic confidence", () => {
    const now = new Date("2026-08-23T12:00:00Z");
    let state = worldModelProjector.initialState();
    state = worldModelProjector.apply(state, claimEvent({
      sequence: 1,
      capturedAt: "2026-06-01T00:00:00.000Z", // ~83 days old
      kind: "observation",
      payload: { entity: { namespace: "person", key: "maria" }, attribute: "role", value: "design partner" },
    }));
    state = worldModelProjector.apply(state, claimEvent({
      sequence: 2,
      capturedAt: "2026-08-23T11:00:00.000Z",
      kind: "observation",
      payload: { entity: { namespace: "person", key: "maria2" }, attribute: "role", value: "design partner" },
    }));

    const oldClaim = state.claims.find((c) => c.claimId === "1")!;
    const freshClaim = state.claims.find((c) => c.claimId === "2")!;

    const cfg = { halfLifeDays: 14, now };
    expect(freshnessOf(oldClaim, cfg)).toBeLessThan(0.01);
    expect(freshnessOf(freshClaim, cfg)).toBeGreaterThan(0.9);

    // authority is independent of age — same kind, same confidence
    expect(epistemicConfidence(oldClaim)).toBe(epistemicConfidence(freshClaim));
    expect(epistemicConfidence(oldClaim)).toBe("observed");
  });
});

describe("current-work projection", () => {
  it("projects work-only events into Current Work without becoming personal intent", () => {
    const store = new IntelligenceEventStore({ path: join(dir, `work-${randomUUID()}.sqlite`) });
    const engine = new ProjectionEngine(store, worldModelProjector);

    const workObs = {
      pathKind: "sensor" as const,
      kind: "observation" as const,
      sourceId: "work.foreground",
      consent: { grantedAt: "2026-08-01T00:00:00.000Z", scopes: ["work.foreground"] },
      retentionClass: "ephemeral" as const,
      payloadClassification: "operational" as const,
      provenance: "adapter",
      idempotencyKey: `w-${randomUUID()}`,
      payload: { entity: { namespace: "work.foreground", key: "keynote" }, attribute: "stage", value: "execution" },
    };
    const personalBelief = {
      pathKind: "sensor" as const,
      kind: "inferred_belief" as const,
      sourceId: "calendar.metadata",
      consent: { grantedAt: "2026-08-01T00:00:00.000Z", scopes: ["calendar.metadata"] },
      retentionClass: "local_default" as const,
      payloadClassification: "personal" as const,
      provenance: "sensor",
      idempotencyKey: `p-${randomUUID()}`,
      payload: { entity: { namespace: "topic", key: "yacht-refit" }, attribute: "interest", value: "high" },
    };

    const workEvent = store.append(workObs as never)!;
    store.append(personalBelief as never);
    engine.runToHead();

    const workOnly = isWorkOnlyEvent(workEvent);
    expect(workOnly).toBe(true);

    const projected = projectedCurrentWork(engine.snapshot().state);
    expect(projected.stage?.value).toBe("execution");
    // personal interest never leaks into the work view
    expect(Object.values(projected).some((v) => v?.value === "high")).toBe(false);

    const allActive = activeClaims(engine.snapshot().state);
    expect(allActive.some((c) => c.entityId.includes("yacht-refit"))).toBe(true); // exists in personal model
    store.close();
  });

  it("matches the legacy reader on frozen grounding fixtures (parity)", () => {
    const repoFixture: GroundingContext = {
      environment: {
        application: { bundle_id: "com.microsoft.VSCode", name: "Visual Studio Code" },
        window: { title: "server.ts — flyd", ref: "w1" },
        focused_element: { ref: "el_01", role: "AXTextArea", description: "editor", value: "const x = 1;", placeholder: "", selected_text: "" },
        selection: "",
        sufficiency: "semantic",
        document_path: "/Users/george/work/flyd/cli/src/server.ts",
      },
      resolvedProjectRoot: "/Users/george/work/flyd",
      gitBranch: "feature/runtime-migration",
    };

    const editorFixture: GroundingContext = {
      environment: {
        application: { bundle_id: "com.apple.Notes", name: "Notes" },
        window: { title: "Ideas", ref: "w2" },
        focused_element: { ref: "el_02", role: "AXTextArea", description: "note body", value: "draft text", placeholder: "", selected_text: "draft text" },
        selection: "draft text",
        sufficiency: "semantic",
      },
    };

    for (const [name, fixture] of [["repo", repoFixture], ["editor", editorFixture]] as const) {
      const parity = parityCheck(name, fixture);
      expect(
        { fixture: parity.fixture, matches: parity.matchesLegacy, legacy: parity.legacyProject, projected: parity.projectedProject, legacyStage: parity.legacyStage, projectedStage: parity.projectedStage },
        `parity failed for ${name}: legacy=${parity.legacyProject}/${parity.legacyStage} projected=${parity.projectedProject}/${parity.projectedStage}`,
      ).toEqual({ fixture: name, matches: true, legacy: parity.legacyProject, projected: parity.legacyProject, legacyStage: parity.legacyStage, projectedStage: parity.legacyStage });
    }
  });
});
