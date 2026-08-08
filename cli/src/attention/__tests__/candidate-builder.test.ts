import { describe, it, expect, beforeEach } from "vitest";
import { CandidateBuilder } from "../candidate-builder.js";
import type { Signal, CandidateEvent } from "../types.js";

function sig(overrides: Partial<Signal> = {}): Signal {
  const defaults: Signal = {
    id: `sig-${Math.random().toString(36).slice(2, 8)}`,
    kind: "delegation_changed",
    source: "delegation_runner",
    occurredAt: new Date().toISOString(),
    observedAt: new Date().toISOString(),
    subject: { id: "task-1", kind: "task", label: "Task 1" },
    payload: { status: "blocked" },
    evidence: [],
    sensitivity: "normal",
    fingerprint: `fp-${Math.random().toString(36).slice(2, 8)}`,
  };
  const result = { ...defaults, ...overrides };
  return result;
}

describe("CandidateBuilder", () => {
  let builder: CandidateBuilder;

  beforeEach(() => {
    builder = new CandidateBuilder();
    builder.clear();
  });

  it("creates a candidate from a delegation changed signal", () => {
    const signal = sig({ kind: "delegation_changed", payload: { status: "blocked" } });
    const candidate = builder.ingestSignal(signal);
    expect(candidate).not.toBeNull();
    expect(candidate!.type).toBe("delegation_blocked");
    expect(candidate!.status).toBe("pending");
  });

  it("creates a candidate with commitmentId from payload", () => {
    const signal = sig({
      kind: "delegation_changed",
      payload: { status: "completed", commitmentId: "comm-1" },
    });
    const candidate = builder.ingestSignal(signal);
    expect(candidate).not.toBeNull();
    expect(candidate!.commitmentId).toBe("comm-1");
    expect(candidate!.type).toBe("delegation_completed");
  });

  it("deduplicates by suppression key", () => {
    const signal1 = sig({ kind: "delegation_changed", fingerprint: "fp-a", subject: { id: "t1", kind: "task", label: "T1" } });
    const signal2 = sig({ kind: "delegation_changed", fingerprint: "fp-b", subject: signal1.subject, payload: signal1.payload });

    const c1 = builder.ingestSignal(signal1)!;
    const c2 = builder.ingestSignal(signal2)!;

    expect(c1.id).toBe(c2.id);
    expect(c2.signalIds.length).toBe(2);
  });

  it("returns null for unknown signal kinds", () => {
    const signal = sig({ kind: "memory_changed", payload: {} });
    const candidate = builder.ingestSignal(signal);
    expect(candidate).toBeNull();
  });

  it("tracks status transitions", () => {
    const signal = sig({ kind: "delegation_changed", fingerprint: "fp-status" });
    const candidate = builder.ingestSignal(signal)!;

    builder.updateStatus(candidate.id, "evaluating");
    expect(builder.getCandidate(candidate.id)!.status).toBe("evaluating");

    builder.updateStatus(candidate.id, "resolved");
    expect(builder.getCandidate(candidate.id)!.status).toBe("resolved");
  });

  it("getPendingCandidates returns only pending", () => {
    const s1 = sig({ kind: "delegation_changed", fingerprint: "fp-p1", subject: { id: "p1", kind: "task", label: "P1" } });
    const s2 = sig({ kind: "delegation_changed", fingerprint: "fp-p2", subject: { id: "p2", kind: "task", label: "P2" } });

    const c1 = builder.ingestSignal(s1)!;
    builder.updateStatus(c1.id, "resolved");
    builder.ingestSignal(s2);

    const pending = builder.getPendingCandidates();
    expect(pending.length).toBe(1);
  });

  it("expireSuppressed marks expired candidates", () => {
    const signal = sig({ kind: "delegation_changed", fingerprint: "fp-exp" });
    const candidate = builder.ingestSignal(signal)!;
    candidate.expiresAt = new Date(Date.now() - 1000).toISOString();

    const count = builder.expireSuppressed();
    expect(count).toBe(1);
    expect(builder.getCandidate(candidate.id)!.status).toBe("expired");
  });

  it("getStats returns correct counts", () => {
    builder.ingestSignal(sig({ kind: "delegation_changed", fingerprint: "a", subject: { id: "s1", kind: "task", label: "S1" } }));
    builder.ingestSignal(sig({ kind: "delegation_changed", fingerprint: "b", subject: { id: "s2", kind: "task", label: "S2" } }));
    builder.ingestSignal(sig({ kind: "delegation_changed", fingerprint: "c", subject: { id: "s3", kind: "task", label: "S3" } }));

    const stats = builder.getStats();
    expect(stats.total).toBe(3);
    expect(stats.pending).toBe(3);
  });

  it("processes explicit reminder signals", () => {
    const signal: Signal = {
      id: "sig-rem",
      kind: "explicit_reminder",
      source: "user_instruction",
      occurredAt: new Date().toISOString(),
      observedAt: new Date().toISOString(),
      subject: { id: "r1", kind: "task", label: "Remind" },
      payload: { text: "check email" },
      evidence: [],
      sensitivity: "normal",
      fingerprint: "fp-rem",
    };
    const candidate = builder.ingestSignal(signal);
    expect(candidate).not.toBeNull();
    expect(candidate!.type).toBe("explicit_reminder");
  });

  it("processes feedback received signals", () => {
    const signal: Signal = {
      id: "sig-fb",
      kind: "user_feedback",
      source: "scene_feedback",
      occurredAt: new Date().toISOString(),
      observedAt: new Date().toISOString(),
      subject: { id: "f1", kind: "task", label: "Feedback" },
      payload: { outcomeKind: "dismissed" },
      evidence: [],
      sensitivity: "normal",
      fingerprint: "fp-fb",
    };
    const candidate = builder.ingestSignal(signal);
    expect(candidate).not.toBeNull();
    expect(candidate!.type).toBe("feedback_received");
  });

  it("clear empties everything", () => {
    builder.ingestSignal(sig({ kind: "delegation_changed", fingerprint: "a", subject: { id: "ca1", kind: "task", label: "CA1" } }));
    builder.ingestSignal(sig({ kind: "delegation_changed", fingerprint: "b", subject: { id: "ca2", kind: "task", label: "CA2" } }));
    builder.clear();

    const stats = builder.getStats();
    expect(stats.total).toBe(0);
  });
});
