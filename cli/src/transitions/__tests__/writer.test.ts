import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import {
  configureTransitionStore,
  isTransitionCaptureDisabled,
  recordAction,
  recordJudgment,
  recordNextState,
  transitionSourceRegistry,
} from "../writer.js";

const rootDir = mkdtempSync(join(tmpdir(), "flyd-transitions-"));

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

let dbPath = "";
let registryPath = "";

beforeEach(() => {
  const id = randomUUID();
  dbPath = join(rootDir, `${id}.sqlite`);
  registryPath = join(rootDir, `consents-${id}.json`);
  configureTransitionStore({ dbPath, registryPath });
});

afterEach(() => {
  delete process.env.FLYD_TRANSITIONS_DISABLED;
});

describe("transition spine writer", () => {
  it("records an action then its next-state as two valid events sharing correlation", async () => {
    const action = recordAction({
      sessionId: "sess-1",
      invocationId: "inv-1",
      surface: "overlay",
      intent: "fix the failing test",
      routeKind: "native",
      resolutionMode: "fast",
      model: "gpt-5.2-mini",
    });
    expect(action.ok).toBe(true);

    const outcome = recordNextState({
      invocationId: "inv-1",
      origin: "user",
      signal: "succeeded",
    });
    expect(outcome.ok).toBe(true);

    const store = new IntelligenceEventStore({ path: dbPath });
    const events = store.readFrom(0);
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe("proposed_action");
    expect(events[0].sourceId).toBe("transition.overlay");
    expect(events[0].sequence).toBeLessThan(events[1].sequence);
    expect(events[1].kind).toBe("verified_outcome");
    expect(events[1].correlationId).toBe("inv-1");
    expect(events.every((e) => e.correlationId === "inv-1")).toBe(true);
    store.close();
  });

  it("kill switch set → success no-op and nothing persists", () => {
    process.env.FLYD_TRANSITIONS_DISABLED = "1";
    expect(isTransitionCaptureDisabled()).toBe(true);

    expect(recordAction({
      sessionId: "s", invocationId: "i", surface: "overlay", intent: "x",
    })).toEqual({ ok: true, skipped: true });
    expect(recordNextState({ invocationId: "i", origin: "user", signal: "failed" })).toEqual({ ok: true, skipped: true });
    expect(recordJudgment({ transitionSeq: 999, verdict: 0, confidence: 0.5, rationale: "r" })).toEqual({ ok: true, skipped: true });

    const store = new IntelligenceEventStore({ path: dbPath });
    expect(store.count()).toBe(0);
    store.close();
  });

  it("revoked source → rejection surfaced, not swallowed; prior rows remain", () => {
    recordAction({
      sessionId: "sess-r", invocationId: "inv-live", surface: "overlay", intent: "before revoke",
    });

    const registry = transitionSourceRegistry();
    registry.setStatus("transition.overlay", "revoked");

    const rejected = recordAction({
      sessionId: "sess-r", invocationId: "inv-after-revoke", surface: "overlay", intent: "after revoke",
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.rejection).toBe("consent_revoked");
    }

    const again = recordNextState({ invocationId: "inv-after-revoke-2", origin: "user", signal: "ambiguous" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.rejection).toBe("consent_revoked");

    // previously written rows are untouched (deletion sweep is U9's job)
    const store = new IntelligenceEventStore({ path: dbPath });
    expect(store.count()).toBe(1);
    store.close();
  });

  it("judgment referencing a nonexistent sequence is rejected", () => {
    const result = recordJudgment({ transitionSeq: 4242, verdict: 1, confidence: 0.8, rationale: "good" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection).toBe("invalid");
      expect(result.detail).toContain("4242");
    }
  });

  it("happy-path judgment appends an observation from transition.judge tied to its target", () => {
    const action = recordAction({
      sessionId: "sess-j", invocationId: "inv-j", surface: "cli_chat", intent: "summarize the diff",
    });
    expect(action.ok).toBe(true);
    const targetSeq = action.ok && action.event ? action.event.sequence : -1;

    const judgment = recordJudgment({
      transitionSeq: targetSeq,
      verdict: -1,
      confidence: 0.7,
      rationale: "answer ignored the user's stated constraint",
    });
    expect(judgment.ok).toBe(true);

    const store = new IntelligenceEventStore({ path: dbPath });
    const stored = store.getBySequence(targetSeq)!;
    const judgeEvent = judgment.ok ? judgment.event : null;
    expect(judgeEvent!.kind).toBe("observation");
    expect(judgeEvent!.sourceId).toBe("transition.judge");
    expect(judgeEvent!.payload).toMatchObject({ transitionSeq: targetSeq, verdict: -1, confidence: 0.7 });
    expect(judgeEvent!.correlationId).toBe(stored.correlationId);
    expect(judgeEvent!.causationIds).toEqual([stored.id]);

    // judgments are idempotent per transition
    const replay = recordJudgment({ transitionSeq: targetSeq, verdict: 1, confidence: 0.9, rationale: "changed my mind" });
    expect(replay.ok).toBe(true);
    expect(replay.ok && !replay.skipped ? replay.event.sequence : null).toBe(judgeEvent!.sequence);
    store.close();
  });

  it("transition contracts register enabled by default and stay low sensitivity", () => {
    const registry = transitionSourceRegistry();
    for (const sourceId of ["transition.overlay", "transition.cli-chat", "transition.harness", "transition.judge"]) {
      expect(registry.status(sourceId)).toBe("enabled");
      const contract = registry.contract(sourceId)!;
      expect(contract.sensitivity).toBe("low");
      expect(contract.retentionClass).toBe("local_default");
    }
  });
});
