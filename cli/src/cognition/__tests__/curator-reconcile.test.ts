import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { ProjectionEngine } from "../../intelligence/projections.js";
import { deriveWorldState, worldModelProjector } from "../../intelligence/world/world-model.js";
import { CognitiveCurator } from "../curator/curator.js";
import { runCuratorSweep } from "../curator/reconcile.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fakeJev(): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: "jev-test",
      answers: {
        is_correction: { noul: 0.99, confidence: 0.95 },
        changes_current_state: { noul: 0.99, confidence: 0.95 },
        marks_completed: { noul: 0.99, confidence: 0.95 },
        marks_cancelled: { noul: 0.01, confidence: 0.95 },
        evidence_supported: { noul: 0.99, confidence: 0.95 },
      },
    }),
  })) as unknown as typeof fetch;
}

describe("background graph curator", () => {
  it("uses Jev as evidence but deterministic lifecycle logic expires event-bound work", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flyd-curator-"));
    dirs.push(dir);
    const previous = process.env.FLYD_DIR;
    process.env.FLYD_DIR = dir;
    const store = new IntelligenceEventStore({ path: join(dir, `intelligence-${randomUUID()}.sqlite`) });
    const curator = new CognitiveCurator(store);
    try {
      curator.addClaim({ entityId: "event:gnm3", attribute: "status", value: "active", authority: "observed" });
      curator.addClaim({ entityId: "task:gnm3:sponsorship", attribute: "action", value: "Secure sponsors for GNM3", authority: "observed", timeShape: "event_bound" });
      curator.addRelation({ fromId: "task:gnm3:sponsorship", type: "valid_for", toId: "event:gnm3" });
      curator.recordConversationTurn({
        sessionId: "s1",
        user: "GNM3 is done. We don't need sponsors anymore.",
        assistant: "Understood.",
        projectIds: ["event:gnm3"],
        intentKind: "correction",
        temporalFrame: "present",
      });
      await runCuratorSweep({ store, jev: { apiKey: "test", fetchFn: fakeJev() } });
      const state = deriveWorldState(new ProjectionEngine(store, worldModelProjector).rebuild(0).state, new Date("2026-09-22T00:00:00Z"));
      expect(state.current.some((claim) => claim.value === "Secure sponsors for GNM3")).toBe(false);
      expect(state.historical.find((claim) => claim.value === "Secure sponsors for GNM3")?.temporalStatus).toBe("expired");
      expect(state.historical.some((claim) => claim.entityId === "event:gnm3" && claim.value === "active")).toBe(true);
    } finally {
      curator.close();
      if (previous === undefined) delete process.env.FLYD_DIR; else process.env.FLYD_DIR = previous;
    }
  });
});
