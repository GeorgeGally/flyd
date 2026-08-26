import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { governanceSummary, exportSourceData } from "../../intelligence/sensors/governance.js";
import { configureDirectivesStore, listDirectives } from "../directives-store.js";
import {
  configureTransitionStore,
  recordAction,
  recordJudgment,
  recordNextState,
  transitionSourceRegistry,
} from "../writer.js";
import { buildSnapshot, forgetSource } from "../../commands/transitions.js";

const rootDir = mkdtempSync(join(tmpdir(), "flyd-transitions-governance-"));

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

let dbPath = "";
let registryPath = "";

function seedOverlayTransition(correlationId: string): number {
  const action = recordAction({
    sessionId: "sess-1",
    invocationId: correlationId,
    surface: "overlay",
    intent: "fix the failing test",
  });
  expect(action.ok).toBe(true);
  const outcome = recordNextState({
    invocationId: correlationId,
    origin: "user",
    signal: "rejected",
    correction: "always inspect the repo before proposing a fix",
  });
  expect(outcome.ok).toBe(true);
  expect(outcome.ok && !outcome.skipped).toBe(true);
  const seq = (outcome as { event: { sequence: number } }).event.sequence;
  const judgment = recordJudgment({
    transitionSeq: seq,
    verdict: -1,
    confidence: 0.9,
    rationale: "user rejected the result",
  });
  expect(judgment.ok).toBe(true);
  return seq;
}

beforeEach(() => {
  const id = randomUUID();
  dbPath = join(rootDir, `${id}.sqlite`);
  registryPath = join(rootDir, `consents-${id}.json`);
  configureTransitionStore({ dbPath, registryPath });
  configureDirectivesStore(rootDir);
});

describe("transition governance", () => {
  it("forget transition.overlay erases transitions, judgments, and derived directives with tombstones", () => {
    seedOverlayTransition("inv-1");
    expect(listDirectives()).toHaveLength(1);

    const store = new IntelligenceEventStore({ path: dbPath });
    const registry = transitionSourceRegistry();
    const result = forgetSource(store, registry, "transition.overlay");

    expect(result.sourceId).toBe("transition.overlay");
    expect(result.tombstone.eventCount).toBe(2);
    expect(result.judgeTombstone?.eventCount).toBe(1);
    expect(result.removedDirectives).toBe(1);

    expect(registry.status("transition.overlay")).toBe("revoked");
    expect(store.latestTombstone("transition.overlay")).toMatchObject({ sourceId: "transition.overlay", eventCount: 2 });
    expect(store.latestTombstone("transition.judge")).toMatchObject({ sourceId: "transition.judge", eventCount: 1 });

    const remaining = store.readFrom(0).filter((e) =>
      e.sourceId === "transition.overlay" || e.sourceId === "transition.judge",
    );
    expect(remaining.length).toBeGreaterThan(0);
    for (const event of remaining) {
      expect(event.erased).toBe(true);
      expect(event.payload).toBeUndefined();
    }

    expect(listDirectives()).toHaveLength(0);

    const rewrite = recordAction({
      sessionId: "s", invocationId: "inv-2", surface: "overlay", intent: "again",
    });
    expect(rewrite).toMatchObject({ ok: false, rejection: "consent_revoked" });

    const exportAfter = exportSourceData(store, "transition.overlay");
    expect(exportAfter.events.every((e) => !e.payloadReadable)).toBe(true);
    store.close();
  });

  it("export on an empty source returns a valid empty export", () => {
    const store = new IntelligenceEventStore({ path: dbPath });
    const exported = exportSourceData(store, "transition.cli-chat");
    expect(exported.sourceId).toBe("transition.cli-chat");
    expect(typeof exported.exportedAt).toBe("string");
    expect(exported.events).toEqual([]);
    store.close();
  });

  it("governance summary lists the four transition sources with counts", () => {
    recordAction({
      sessionId: "sess-1", invocationId: "inv-1", surface: "overlay", intent: "do the thing",
    });
    recordAction({
      sessionId: "sess-2", invocationId: "inv-2", surface: "cli_chat", intent: "other thing",
    });
    recordNextState({ invocationId: "inv-1", origin: "verifier", surface: "overlay", signal: "verified" });
    const probe = new IntelligenceEventStore({ path: dbPath });
    const judgmentTarget = probe.readFrom(0)[0];
    probe.close();
    recordJudgment({
      transitionSeq: judgmentTarget.sequence, verdict: 1, confidence: 0.8, rationale: "fine",
    });

    const store = new IntelligenceEventStore({ path: dbPath });
    const summary = governanceSummary(store, transitionSourceRegistry());
    const transitions = summary.filter((s) => s.sourceId.startsWith("transition."));
    expect(transitions.map((s) => s.sourceId)).toEqual([
      "transition.cli-chat",
      "transition.harness",
      "transition.judge",
      "transition.overlay",
    ]);
    const counts = Object.fromEntries(transitions.map((s) => [s.sourceId, s.eventCount]));
    expect(counts).toEqual({
      "transition.overlay": 1,
      "transition.cli-chat": 1,
      "transition.harness": 1,
      "transition.judge": 1,
    });
    store.close();
  });

  it("snapshot lists events newest-first capped at 50 with directives attached", () => {
    for (let i = 0; i < 55; i++) {
      recordAction({
        sessionId: `s-${i}`, invocationId: `inv-${i}`, surface: "cli_chat", intent: `task ${i}`,
      });
    }
    const store = new IntelligenceEventStore({ path: dbPath });
    const snapshot = buildSnapshot(store, transitionSourceRegistry());
    expect(snapshot.events).toHaveLength(50);
    expect(snapshot.events[0].sequence).toBeGreaterThan(snapshot.events[1].sequence);
    expect(snapshot.sources.map((s) => s.sourceId)).toContain("transition.cli-chat");
    store.close();
  });
});
