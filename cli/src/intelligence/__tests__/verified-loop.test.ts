import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IntelligenceEventStore, type StoredEvent } from "../event-store.js";
import { recordCosReport } from "../../command/cos/tick.js";
import { deliverOnce } from "../../runtime/delivered.js";
import { projectVerifiedLoop, summarizeVerifiedLoop, verifiedLoopFromStore } from "../outcomes/verified-loop.js";

function event(sourceId: string, payload: Record<string, unknown>, sequence: number): StoredEvent {
  return {
    sequence, id: "event-" + sequence, schemaVersion: 1, kind: "observation",
    sourceId, capturedAt: new Date(Date.parse("2026-11-22T10:00:00Z") + sequence * 1000).toISOString(),
    consentJson: "{}", retentionClass: "local_default", provenance: "test",
    idempotencyKey: "key-" + sequence, causationIds: [], evidenceRefs: [],
    payloadDomain: sourceId, payload, redacted: false, erased: false,
  };
}

describe("verified intelligence loop projection", () => {
  it("separates delivered notice, reported completion and independently verified effect", () => {
    const events = [
      event("cos.report", { report: {
        id: "objective-1:final", objectiveId: "objective-1", kind: "done",
      } }, 1),
      event("flyd.delivered", { delivered: { key: "cos:objective-1:final" } }, 2),
      event("flyd.delivered", { delivered: { key: "cos:objective-1:final", outcome: "shown" } }, 3),
      event("executive.cycle", { decision: {
        decisionId: "decision-1", verification: {
          status: "verified", evidenceRefs: ["github-merge:123456"],
        },
      } }, 4),
    ];
    const projected = projectVerifiedLoop(events);
    expect(projected).toHaveLength(2);
    expect(projected.find((item) => item.source === "cos.report")).toMatchObject({
      effect: "unknown", delivery: "shown", impact: "unknown",
    });
    expect(projected.find((item) => item.source === "executive.cycle")).toMatchObject({
      effect: "verified", delivery: "not_correlated", impact: "unknown",
    });
    expect(summarizeVerifiedLoop(projected)).toMatchObject({
      interventions: 2, verifiedEffects: 1, unknownEffects: 1, delivered: 1,
      unknownImpact: 2, verificationCoverage: { known: 1, eligible: 2 },
    });
  });

  it("keeps crash-uncertain deliveries pending and never treats a worker's done claim as verified", () => {
    const items = projectVerifiedLoop([
      event("cos.report", { report: { id: "a", objectiveId: "one", kind: "done" } }, 1),
      event("flyd.delivered", { delivered: { key: "cos:a" } }, 2),
      event("executive.cycle", { decision: {
        decisionId: "b", verification: { status: "verified", evidenceRefs: [] },
      } }, 3),
    ]);
    expect(items.map((item) => item.effect)).toEqual(["unknown", "unknown"]);
    expect(items[0]?.delivery).toBe("pending");
    expect(summarizeVerifiedLoop(items).pendingDelivery).toBe(1);
  });

  it("replays after restart and retracts erased source events", async () => {
    const folder = mkdtempSync(join(tmpdir(), "flyd-loop-"));
    const path = join(folder, "intelligence.sqlite");
    try {
      let store = new IntelligenceEventStore({ path });
      const report = {
        id: "objective-9:done", objectiveId: "objective-9", kind: "done" as const,
        outcome: "The work is finished", detail: "", evidenceRefs: ["objective:objective-9"],
        shape: "words" as const, artefacts: [], urgency: "whenever" as const,
      };
      expect(recordCosReport(report, store)).toBe(true);
      await deliverOnce([{
        key: "cos:" + report.id, line: report.outcome, kind: "deliverable",
      }], { store, say: async () => "shown" });
      store.close();
      store = new IntelligenceEventStore({ path });
      expect(verifiedLoopFromStore(store)).toMatchObject([{
        id: "cos:objective-9:done", effect: "unknown", delivery: "shown", impact: "unknown",
      }]);
      store.eraseSource("cos.report");
      expect(verifiedLoopFromStore(store)).toEqual([]);
      store.close();
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
