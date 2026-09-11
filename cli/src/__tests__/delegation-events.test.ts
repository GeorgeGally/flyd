import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingDelegation,
  delegationEvents,
  LEGACY_PENDING_TIMEOUT_MS,
  listPendingDelegations,
  registerPendingDelegation,
  resetDelegationEventsForTests,
  startPendingSweep,
  stopPendingSweep,
} from "../delegation-events.js";
import { buildDelegationEnvelope } from "../delegation.js";

function makeEnvelope() {
  return buildDelegationEnvelope("research something", {}, [], null);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetDelegationEventsForTests();
});

afterEach(() => {
  resetDelegationEventsForTests();
  vi.useRealTimers();
});

describe("pending delegation registry", () => {
  it("registers and lists a pending delegation", () => {
    const envelope = makeEnvelope();
    registerPendingDelegation(envelope);
    expect(listPendingDelegations().map((e) => e.delegationId)).toContain(envelope.delegationId);
  });

  it("clears a pending delegation", () => {
    const envelope = makeEnvelope();
    registerPendingDelegation(envelope);
    clearPendingDelegation(envelope.delegationId);
    expect(listPendingDelegations().map((e) => e.delegationId)).not.toContain(envelope.delegationId);
  });

  it("emits a pending event on registration", () => {
    const listener = vi.fn();
    delegationEvents.onPending(listener);
    const envelope = makeEnvelope();
    registerPendingDelegation(envelope);
    expect(listener).toHaveBeenCalledWith(envelope);
    delegationEvents.offPending(listener);
  });
});

describe("legacy pending sweep", () => {
  it("does not time out before the fixed compatibility timeout", () => {
    const listener = vi.fn();
    delegationEvents.onTimeout(listener);
    registerPendingDelegation(makeEnvelope());

    startPendingSweep(1000);
    vi.advanceTimersByTime(LEGACY_PENDING_TIMEOUT_MS - 1000);

    expect(listener).not.toHaveBeenCalled();
    delegationEvents.offTimeout(listener);
  });

  it("emits a synthetic blocked completion after the compatibility timeout", () => {
    const listener = vi.fn();
    delegationEvents.onTimeout(listener);
    const envelope = makeEnvelope();
    registerPendingDelegation(envelope);

    startPendingSweep(1000);
    vi.advanceTimersByTime(LEGACY_PENDING_TIMEOUT_MS + 1000);

    expect(listener).toHaveBeenCalledTimes(1);
    const completion = listener.mock.calls[0][0];
    expect(completion.delegationId).toBe(envelope.delegationId);
    expect(completion.status).toBe("blocked");
    expect(completion.blocker).toContain("legacy_runner_timeout");
    expect(completion.handoff).toBeNull();
    expect(completion.verification).toBeNull();
    delegationEvents.offTimeout(listener);
  });

  it("clears the pending entry once it times out", () => {
    const envelope = makeEnvelope();
    registerPendingDelegation(envelope);
    startPendingSweep(1000);
    vi.advanceTimersByTime(LEGACY_PENDING_TIMEOUT_MS + 1000);
    expect(listPendingDelegations()).toEqual([]);
  });

  it("does not double-register the sweep interval", () => {
    startPendingSweep(1000);
    startPendingSweep(1000);
    const envelope = makeEnvelope();
    registerPendingDelegation(envelope);
    const listener = vi.fn();
    delegationEvents.onTimeout(listener);
    vi.advanceTimersByTime(LEGACY_PENDING_TIMEOUT_MS + 1000);
    expect(listener).toHaveBeenCalledTimes(1);
    delegationEvents.offTimeout(listener);
  });

  it("stopPendingSweep halts further timeouts", () => {
    const envelope = makeEnvelope();
    registerPendingDelegation(envelope);
    startPendingSweep(1000);
    stopPendingSweep();
    const listener = vi.fn();
    delegationEvents.onTimeout(listener);
    vi.advanceTimersByTime(60 * 60_000);
    expect(listener).not.toHaveBeenCalled();
    delegationEvents.offTimeout(listener);
  });
});

describe("completion event bus", () => {
  it("delivers completion events only to completion listeners", () => {
    const completionListener = vi.fn();
    const timeoutListener = vi.fn();
    delegationEvents.onCompletion(completionListener);
    delegationEvents.onTimeout(timeoutListener);

    delegationEvents.emitCompletion({
      delegationId: "d1",
      invocationId: "i1",
      status: "completed",
      handoff: null,
      activity: [],
      verification: null,
      claimedAt: new Date().toISOString(),
    });

    expect(completionListener).toHaveBeenCalledTimes(1);
    expect(timeoutListener).not.toHaveBeenCalled();
    delegationEvents.offCompletion(completionListener);
    delegationEvents.offTimeout(timeoutListener);
  });
});
