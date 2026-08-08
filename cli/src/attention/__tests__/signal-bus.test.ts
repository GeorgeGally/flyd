import { describe, it, expect, beforeEach } from "vitest";
import { SignalBus } from "../signal-bus.js";

describe("SignalBus", () => {
  let bus: SignalBus;

  beforeEach(() => {
    bus = new SignalBus();
  });

  const subject = { id: "test-subject", kind: "task" as const, label: "Test Task" };

  it("emits a signal and returns it", () => {
    const signal = bus.emit({
      kind: "delegation_changed",
      source: "delegation_runner",
      subject,
      payload: { status: "blocked" },
    });

    expect(signal.id).toBeDefined();
    expect(signal.kind).toBe("delegation_changed");
    expect(signal.subject.id).toBe("test-subject");
    expect(signal.fingerprint).toBeDefined();
  });

  it("subscribes and receives signals", () => {
    const received: string[] = [];
    bus.subscribe((s) => received.push(s.kind));

    bus.emit({ kind: "commitment_stated", source: "commitment_ledger", subject, payload: {} });
    bus.emit({ kind: "deadline_approaching", source: "commitment_ledger", subject, payload: {} });

    expect(received).toEqual(["commitment_stated", "deadline_approaching"]);
  });

  it("unsubscribes", () => {
    const received: string[] = [];
    const unsub = bus.subscribe((s) => received.push(s.kind));

    bus.emit({ kind: "commitment_stated", source: "commitment_ledger", subject, payload: {} });
    unsub();
    bus.emit({ kind: "deadline_approaching", source: "commitment_ledger", subject, payload: {} });

    expect(received).toEqual(["commitment_stated"]);
  });

  it("finds duplicates by fingerprint", () => {
    const s1 = bus.emit({ kind: "delegation_changed", source: "delegation_runner", subject, payload: { status: "blocked" } });
    const s2 = bus.emit({ kind: "delegation_changed", source: "delegation_runner", subject, payload: { status: "blocked" } });

    const dupes = bus.findDuplicates(s2);
    expect(dupes.length).toBe(1);
    expect(dupes[0].id).toBe(s1.id);
  });

  it("different payloads produce different fingerprints", () => {
    const s1 = bus.emit({ kind: "delegation_changed", source: "delegation_runner", subject, payload: { status: "blocked" } });
    const s2 = bus.emit({ kind: "delegation_changed", source: "delegation_runner", subject, payload: { status: "completed" } });

    expect(s1.fingerprint).not.toBe(s2.fingerprint);
  });

  it("getHistory returns signals in order", () => {
    bus.emit({ kind: "commitment_stated", source: "commitment_ledger", subject, payload: {} });
    bus.emit({ kind: "deadline_approaching", source: "commitment_ledger", subject, payload: {} });

    const history = bus.getHistory();
    expect(history.length).toBe(2);
    expect(history[0].kind).toBe("commitment_stated");
    expect(history[1].kind).toBe("deadline_approaching");
  });

  it("stays within max history", () => {
    for (let i = 0; i < 1100; i++) {
      bus.emit({ kind: "commitment_stated", source: "commitment_ledger", subject, payload: { i } });
    }
    const history = bus.getHistory();
    expect(history.length).toBeLessThanOrEqual(1000);
  });

  it("listener errors do not block other listeners", () => {
    const received: string[] = [];
    bus.subscribe(() => { throw new Error("boom"); });
    bus.subscribe((s) => received.push(s.kind));

    bus.emit({ kind: "commitment_stated", source: "commitment_ledger", subject, payload: {} });
    expect(received).toEqual(["commitment_stated"]);
  });

  it("removeAllListeners clears subscriptions", () => {
    const received: string[] = [];
    bus.subscribe((s) => received.push(s.kind));
    bus.removeAllListeners();
    bus.emit({ kind: "commitment_stated", source: "commitment_ledger", subject, payload: {} });
    expect(received).toEqual([]);
  });
});
