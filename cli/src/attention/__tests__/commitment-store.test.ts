import { describe, it, expect, beforeEach } from "vitest";
import { CommitmentStore } from "../commitment-store.js";

describe("CommitmentStore", () => {
  let store: CommitmentStore;

  beforeEach(() => {
    store = new CommitmentStore();
    store.clear();
  });

  it("creates and retrieves a commitment", () => {
    const c = store.create({
      kind: "promise",
      title: "Ship attention engine",
    });

    const retrieved = store.get(c.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.kind).toBe("promise");
    expect(retrieved!.title).toBe("Ship attention engine");
    expect(retrieved!.status).toBe("open");
    expect(retrieved!.confidence).toBe(0.5);
  });

  it("respects custom confidence and status", () => {
    const c = store.create({
      kind: "promise",
      title: "Ship",
      status: "proposed",
      confidence: 0.3,
    });

    expect(c.status).toBe("proposed");
    expect(c.confidence).toBe(0.3);
  });

  it("updates a commitment", () => {
    const c = store.create({ kind: "promise", title: "Ship attention engine" });
    const updated = store.update(c.id, { status: "done", confidence: 1.0 });

    expect(updated).toBeDefined();
    expect(updated!.status).toBe("done");
    expect(updated!.confidence).toBe(1.0);
    expect(updated!.nextCheckAt).toBeUndefined();
  });

  it("returns undefined for nonexistent update", () => {
    const updated = store.update("nonexistent", { status: "done" });
    expect(updated).toBeUndefined();
  });

  it("deletes a commitment", () => {
    const c = store.create({ kind: "promise", title: "Ship" });
    expect(store.get(c.id)).toBeDefined();
    store.delete(c.id);
    expect(store.get(c.id)).toBeUndefined();
    expect(store.delete("nonexistent")).toBe(false);
  });

  it("lists commitments with filters", () => {
    store.create({ kind: "promise", title: "Ship engine", status: "open" });
    store.create({ kind: "deadline", title: "Tax deadline", status: "open", dueAt: new Date(Date.now() + 86400000).toISOString() });
    store.create({ kind: "follow_up", title: "Check on Bob", status: "done" });

    const open = store.list({ status: ["open"] });
    expect(open.length).toBe(2);

    const promises = store.list({ kind: ["promise"] });
    expect(promises.length).toBe(1);

    const done = store.list({ status: ["done", "cancelled"] });
    expect(done.length).toBe(1);
  });

  it("finds overdue commitments", () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    store.create({ kind: "deadline", title: "Past deadline", status: "open", dueAt: past });
    store.create({ kind: "promise", title: "Future promise", status: "open", dueAt: new Date(Date.now() + 86400000).toISOString() });

    const overdue = store.findOverdue();
    expect(overdue.length).toBe(1);
    expect(overdue[0].title).toBe("Past deadline");
  });

  it("ignores done/cancelled/expired in overdue", () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    store.create({ kind: "deadline", title: "Done but past", status: "done", dueAt: past });
    store.create({ kind: "deadline", title: "Cancelled past", status: "cancelled", dueAt: past });
    store.create({ kind: "deadline", title: "Expired", status: "expired", dueAt: past });

    const overdue = store.findOverdue();
    expect(overdue.length).toBe(0);
  });

  it("finds blocked commitments", () => {
    store.create({ kind: "delegation", title: "Blocked task", status: "blocked" });
    store.create({ kind: "promise", title: "Active", status: "open" });

    const blocked = store.findBlocked();
    expect(blocked.length).toBe(1);
    expect(blocked[0].title).toBe("Blocked task");
  });

  it("finds low confidence commitments", () => {
    store.create({ kind: "promise", title: "Sure thing", status: "proposed", confidence: 0.8 });
    store.create({ kind: "promise", title: "Maybe", status: "proposed", confidence: 0.2 });

    const lowConf = store.findLowConfidence(0.5);
    expect(lowConf.length).toBe(1);
    expect(lowConf[0].title).toBe("Maybe");
  });

  it("finds due soon", () => {
    const soon = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const later = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    store.create({ kind: "deadline", title: "Due soon", status: "open", dueAt: soon });
    store.create({ kind: "deadline", title: "Due later", status: "open", dueAt: later });

    const dueSoon = store.findDueSoon(24);
    expect(dueSoon.length).toBe(1);
    expect(dueSoon[0].title).toBe("Due soon");
  });

  it("finds by ids", () => {
    const a = store.create({ kind: "promise", title: "A" });
    const b = store.create({ kind: "promise", title: "B" });
    store.create({ kind: "promise", title: "C" });

    const found = store.findByIds([a.id, b.id, "nonexistent"]);
    expect(found.length).toBe(2);
  });

  it("adds evidence", () => {
    const c = store.create({ kind: "promise", title: "Test" });
    store.addEvidence(c.id, {
      sourceId: "src-1",
      sourceKind: "conversation",
      description: "Extracted from chat",
      observedAt: new Date().toISOString(),
    });

    const updated = store.get(c.id);
    expect(updated!.sourceEvidence.length).toBe(1);
    expect(updated!.sourceEvidence[0].sourceId).toBe("src-1");
  });

  it("adds completion evidence", () => {
    const c = store.create({ kind: "promise", title: "Test" });
    store.addCompletionEvidence(c.id, {
      sourceId: "done-1",
      sourceKind: "verification",
      description: "Artifact verified",
      observedAt: new Date().toISOString(),
    });

    const updated = store.get(c.id);
    expect(updated!.completionEvidence!.length).toBe(1);
  });

  it("merges commitments", () => {
    const a = store.create({
      kind: "promise",
      title: "Ship engine",
      confidence: 0.6,
      sourceEvidence: [{
        sourceId: "s1", sourceKind: "chat", description: "From chat",
        observedAt: new Date().toISOString(),
      }],
    });
    const b = store.create({
      kind: "promise",
      title: "Ship attention engine",
      confidence: 0.8,
      sourceEvidence: [{
        sourceId: "s2", sourceKind: "email", description: "From email",
        observedAt: new Date().toISOString(),
      }],
    });

    const merged = store.merge(a.id, b.id);
    expect(merged).toBeDefined();
    expect(merged!.sourceEvidence.length).toBe(2);
    expect(merged!.confidence).toBeGreaterThan(0.6);
    expect(store.get(b.id)).toBeUndefined();
  });

  it("clear empties the store", () => {
    store.create({ kind: "promise", title: "Test" });
    store.clear();
    expect(store.list().length).toBe(0);
  });
});
