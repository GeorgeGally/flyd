import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTurnDeadline } from "../agent-session.js";
import { describeToolActivity, localClock } from "../conversation-responder.js";

describe("createTurnDeadline", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps a busy turn alive while it makes progress", async () => {
    const deadline = createTurnDeadline(1_000, 60_000);
    let settle!: (value: string) => void;
    const turn = deadline.run(new Promise<string>((resolve) => { settle = resolve; }));
    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(900);
      deadline.touch();
    }
    settle("done");
    await expect(turn).resolves.toBe("done");
    expect(deadline.signal.aborted).toBe(false);
    deadline.dispose();
  });

  it("aborts the turn after silence so it cannot keep acting", async () => {
    const deadline = createTurnDeadline(1_000, 60_000);
    const turn = deadline.run(new Promise<string>(() => {}));
    vi.advanceTimersByTime(1_001);
    await expect(turn).rejects.toThrow("timed out after 1 seconds without progress");
    expect(deadline.signal.aborted).toBe(true);
  });

  it("does not count time spent waiting for George's confirmation", async () => {
    const deadline = createTurnDeadline(1_000, 60_000);
    let settle!: (value: string) => void;
    const turn = deadline.run(new Promise<string>((resolve) => { settle = resolve; }));
    deadline.pause();
    vi.advanceTimersByTime(30_000);
    deadline.resume();
    settle("approved");
    await expect(turn).resolves.toBe("approved");
    deadline.dispose();
  });

  it("enforces the absolute ceiling even with constant progress", async () => {
    const deadline = createTurnDeadline(1_000, 5_000);
    const turn = deadline.run(new Promise<string>(() => {}));
    const caught = turn.catch((error: Error) => error.message);
    for (let i = 0; i < 6; i += 1) {
      vi.advanceTimersByTime(900);
      deadline.touch();
    }
    expect(await caught).toContain("stopped this turn");
  });
});

describe("chat presentation helpers", () => {
  it("describes tool activity in plain language", () => {
    expect(describeToolActivity("web_search", { query: "F1 results" })).toBe("Searching the web: F1 results");
    expect(describeToolActivity("read_url", { url: "https://www.formula1.com/en/results" })).toBe("Reading www.formula1.com");
    expect(describeToolActivity("read_file", { path: "README.md", repo: "/Users/g/Documents/cleanx" })).toBe("Reading README.md in cleanx");
    expect(describeToolActivity("reminders", { action: "create", title: "Call mom" })).toBe("Creating reminder: Call mom");
  });

  it("states local wall-clock time with its UTC offset", () => {
    const line = localClock(new Date(2026, 8, 26, 23, 45));
    expect(line).toMatch(/^Local time: Saturday, 26 September 2026 at 23:45 \(.+, UTC[+-]\d{2}:\d{2}\)$/);
  });
});
