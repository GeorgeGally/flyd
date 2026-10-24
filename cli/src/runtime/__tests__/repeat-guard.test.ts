import { describe, expect, it } from "vitest";
import { createRepeatGuard, MAX_IDENTICAL_LAUNCH_FAILURES, RepeatedLoopError } from "../repeat-guard.js";

describe("repeat guard", () => {
  it("allows one retry, then stops the same call failing the same way", () => {
    const guard = createRepeatGuard();
    const call = { command: "npm run build", repo: "dir" };
    expect(guard.blocked("bash", call)).toBeNull();
    guard.record("bash", call, "Error: exit 1 after 1203ms");
    expect(guard.blocked("bash", call)).toBeNull();
    guard.record("bash", { repo: "dir", command: "npm run build" }, "Error: exit 1 after 998ms");
    expect(guard.blocked("bash", call)).toMatch(/already failed 2 times the same way/);
    expect(guard.blocked("bash", { command: "npm run build -- --verbose", repo: "dir" })).toBeNull();
  });

  it("treats a different failure as new information", () => {
    const guard = createRepeatGuard();
    guard.record("read_url", { url: "https://x" }, "Error: timeout");
    guard.record("read_url", { url: "https://x" }, "Error: 404 not found");
    expect(guard.blocked("read_url", { url: "https://x" })).toBeNull();
  });

  it("forgets failures once something changed or the call succeeded", () => {
    const guard = createRepeatGuard();
    guard.record("bash", { command: "npm test" }, "Error: 2 failing");
    guard.record("bash", { command: "npm test" }, "Error: 2 failing");
    guard.changed();
    expect(guard.blocked("bash", { command: "npm test" })).toBeNull();
    guard.record("grep", { pattern: "x" }, "Error: bad");
    guard.record("grep", { pattern: "x" }, null);
    guard.record("grep", { pattern: "x" }, "Error: bad");
    expect(guard.blocked("grep", { pattern: "x" })).toBeNull();
  });

  it("counts identical failures and stops a launch loop with a non-retryable terminal error", () => {
    const guard = createRepeatGuard(MAX_IDENTICAL_LAUNCH_FAILURES);
    const launch = { home: "/fake/firstmate", runtimes: "claude" };
    for (let attempt = 0; attempt < MAX_IDENTICAL_LAUNCH_FAILURES; attempt += 1) {
      expect(guard.blocked("firstmate-session-launch", launch)).toBeNull();
      guard.record("firstmate-session-launch", launch, "Error: usage limit reached");
    }
    expect(guard.attempts("firstmate-session-launch", launch)).toBe(3);
    expect(guard.blocked("firstmate-session-launch", launch)).toMatch(/already failed 3 times/);
    expect(guard.blocked("firstmate-session-launch", { ...launch, runtimes: "codex" })).toBeNull();

    const terminal = new RepeatedLoopError("stopped after 3 identical attempts", 3);
    expect(terminal.retryable).toBe(false);
    expect(terminal.attempts).toBe(3);
  });
});
