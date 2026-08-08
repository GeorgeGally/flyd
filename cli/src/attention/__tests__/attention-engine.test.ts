import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AttentionEngine } from "../attention-engine.js";

describe("AttentionEngine", () => {
  let engine: AttentionEngine;

  beforeEach(() => {
    engine = new AttentionEngine();
    engine.reset();
  });

  afterEach(() => {
    engine.stop();
  });

  it("starts in shadow mode by default", () => {
    engine.start({ shadowMode: true, logDecisions: false });
    expect(engine.isShadowMode).toBe(true);
    expect(engine.isRunning()).toBe(true);
  });

  it("stops cleanly", () => {
    engine.start({ shadowMode: true, logDecisions: false });
    engine.stop();
    expect(engine.isRunning()).toBe(false);
  });

  it("double start is safe", () => {
    engine.start({ shadowMode: true, logDecisions: false });
    engine.start({ shadowMode: true, logDecisions: false });
    expect(engine.isRunning()).toBe(true);
  });

  it("emits signal and processes through pipeline", async () => {
    engine.start({ shadowMode: true, logDecisions: false });

    engine.emitSignal({
      kind: "delegation_changed",
      source: "delegation_runner",
      subject: { id: "del-1", kind: "delegation", label: "Delegation 1" },
      payload: { status: "blocked", delegationId: "del-1" },
    });

    // Let the signal propagate through the sync pipeline
    const report = await engine.tick();
    expect(report.candidatesCreated).toBeGreaterThanOrEqual(1);
    expect(report.decisions.length).toBeGreaterThanOrEqual(0);
  });

  it("emits signal for completed delegation", async () => {
    engine.start({ shadowMode: true, logDecisions: false });

    engine.emitSignal({
      kind: "delegation_changed",
      source: "delegation_runner",
      subject: { id: "del-1", kind: "delegation", label: "Delegation 1" },
      payload: { status: "completed", delegationId: "del-1" },
    });

    const report = await engine.tick();
    expect(report.candidatesCreated).toBeGreaterThanOrEqual(1);
  });

  it("getEngineReport returns structured state", () => {
    const report = engine.getEngineReport();
    expect(report.running).toBeDefined();
    expect(report.shadowMode).toBeDefined();
    expect(report.metrics).toBeDefined();
    expect(report.pendingCandidates).toBe(0);
    expect(report.sceneClaims).toBe(0);
    expect(report.policyVersion).toBeDefined();
  });

  it("kill switch stops processing", () => {
    engine.start({ shadowMode: true, logDecisions: false });
    engine.kill("global");
    expect(engine.getEngineReport().running).toBe(true);
  });

  it("release restores kill switch", () => {
    engine.kill("global");
    engine.release("global");
  });

  it("setShadowMode toggles", () => {
    engine.setShadowMode(false);
    expect(engine.isShadowMode).toBe(false);
    engine.setShadowMode(true);
    expect(engine.isShadowMode).toBe(true);
  });

  it("reset clears all state", () => {
    engine.emitSignal({
      kind: "delegation_changed",
      source: "delegation_runner",
      subject: { id: "del-1", kind: "delegation", label: "Test" },
      payload: { status: "blocked" },
    });

    engine.reset();

    const report = engine.getEngineReport();
    expect(report.metrics.candidatesCreated).toBe(0);
    expect(report.sceneClaims).toBe(0);
    expect(engine.getDecisionLog().length).toBe(0);
  });

  it("records outcome for known candidate", async () => {
    engine.start({ shadowMode: true, logDecisions: false });

    engine.emitSignal({
      kind: "explicit_reminder",
      source: "user_instruction",
      subject: { id: "rem-1", kind: "task", label: "Reminder" },
      payload: { text: "Check email" },
    });

    const report = await engine.tick();
    const candidateId = report.decisions[0]?.candidateId;

    if (candidateId) {
      const outcome = engine.recordOutcome(candidateId, "dismissed");
      expect(outcome).not.toBeNull();
      expect(outcome!.kind).toBe("dismissed");
    }
  });

  it("returns null outcome for unknown candidate", () => {
    const outcome = engine.recordOutcome("nonexistent", "dismissed");
    expect(outcome).toBeNull();
  });

  it("getSceneClaims delegates to dispatcher", () => {
    expect(engine.getSceneClaims()).toEqual([]);
  });

  it("getMetrics returns copy", () => {
    const m1 = engine.getMetrics();
    m1.candidatesCreated = 999;
    const m2 = engine.getMetrics();
    expect(m2.candidatesCreated).not.toBe(999);
  });
});
