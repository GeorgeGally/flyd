import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtefactFeed, type FleetRead } from "../artefact.js";
import { SnapshotGate } from "../snapshot-gate.js";

/** A real turn of the event loop, which fake timers leave alone. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Turns the real event loop until the check holds, by a real deadline (performance.now is never faked here). */
async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const deadline = performance.now() + ms;
  while (!check() && performance.now() < deadline) await tick();
  if (!check()) throw new Error("condition never held");
}

/**
 * A fake bearings script: each run appends a line to `runs`, then holds until
 * `release` exists (when held), then prints an empty fleet.
 */
function fakeHome(held: boolean): { home: string; runs: () => number; release: () => void } {
  const home = mkdtempSync(join(tmpdir(), "snapshot-gate-"));
  mkdirSync(join(home, "bin"));
  mkdirSync(join(home, "state"));
  const runs = join(home, "runs");
  const release = join(home, "release");
  const wait = held ? `while [ ! -e '${release}' ]; do sleep 0.02; done\n` : "";
  writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\necho run >> '${runs}'\n${wait}echo '{"in_flight":[]}'\n`, { mode: 0o755 });
  return {
    home,
    runs: () => (existsSync(runs) ? readFileSync(runs, "utf8").split("\n").filter(Boolean).length : 0),
    release: () => writeFileSync(release, ""),
  };
}

function feedFor(home: string, extra: ConstructorParameters<typeof ArtefactFeed>[0] = {}): ArtefactFeed {
  const none = join(home, "none");
  return new ArtefactFeed({ home, memoryFile: none, newsFile: none, tasteFile: none, timeoutMs: 30_000, ...extra });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SnapshotGate", () => {
  it("serves a finished run for the cache window, then runs again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const gate = new SnapshotGate<number>({ cacheMs: 5_000, slowFactor: 0, maxBackoffMs: 0 });
    let runs = 0;
    const run = async () => ++runs;
    expect(await gate.read(run)).toBe(1);
    vi.advanceTimersByTime(4_000);
    expect(await gate.read(run)).toBe(1);
    expect(await gate.read(run, { fresh: true })).toBe(1);
    vi.advanceTimersByTime(1_001);
    expect(await gate.read(run)).toBe(2);
  });

  it("backs off in proportion to a slow run, capped, while a fresh read skips only the back-off", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const gate = new SnapshotGate<number>({ cacheMs: 5_000, slowFactor: 3, maxBackoffMs: 60_000 });
    let runs = 0;
    const slow = (ms: number) => async () => { vi.advanceTimersByTime(ms); return ++runs; };
    await gate.read(slow(10_000));
    // 10s run → 30s back-off.
    expect(gate.nextRunAt() - Date.now()).toBe(30_000);
    vi.advanceTimersByTime(29_000);
    expect(await gate.read(slow(0))).toBe(1);
    vi.advanceTimersByTime(1_000);
    expect(await gate.read(slow(0))).toBe(2);
    // A very slow run is capped.
    vi.advanceTimersByTime(60_000);
    await gate.read(slow(120_000));
    expect(gate.nextRunAt() - Date.now()).toBe(60_000);
    // Past the cache window an answer's fresh read runs, back-off or not; an unforced one still waits.
    vi.advanceTimersByTime(5_001);
    expect(await gate.read(slow(0))).toBe(3);
    expect(await gate.read(slow(0), { fresh: true })).toBe(4);
    expect(await gate.read(slow(0), { fresh: true })).toBe(4);
    vi.advanceTimersByTime(5_001);
    expect(await gate.read(slow(0), { fresh: true })).toBe(5);
  });

  it("shares one in-flight run with every caller and retries after a rejection", async () => {
    const gate = new SnapshotGate<string>({ cacheMs: 0, slowFactor: 0, maxBackoffMs: 0 });
    let release!: (value: string) => void;
    const run = vi.fn(() => new Promise<string>((resolve) => { release = resolve; }));
    const reads = Array.from({ length: 20 }, (_, i) => gate.read(run, { fresh: i % 2 === 0 }));
    expect(gate.running).toBe(true);
    release("one");
    expect(await Promise.all(reads)).toEqual(Array(20).fill("one"));
    expect(run).toHaveBeenCalledTimes(1);
    expect(gate.running).toBe(false);
    await expect(gate.read(() => Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(await gate.read(async () => "two")).toBe("two");
  });
});

describe("ArtefactFeed fleet reads", () => {
  it("starts one snapshot for many concurrent refreshes from several clients", async () => {
    const fake = fakeHome(true);
    // Several feeds on one home share the process's gate for that script, as every client shares the view's feed.
    const clients = [feedFor(fake.home), feedFor(fake.home), feedFor(fake.home)];
    const refreshes = clients.flatMap((feed) => Array.from({ length: 15 }, (_, i) => (i % 3 === 0 ? feed.refreshForDecision() : feed.refresh())));
    await until(() => fake.runs() >= 1);
    // Let any second run that might start show itself before the first is released.
    for (let i = 0; i < 50; i += 1) await tick();
    expect(fake.runs()).toBe(1);
    fake.release();
    const results = await Promise.all(refreshes);
    expect(results.every(Boolean)).toBe(true);
    for (const feed of clients) feed.stop();
    expect(fake.runs()).toBeLessThanOrEqual(clients.length);
  }, 30_000);

  it("serves a finished snapshot for a few seconds instead of running it again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fake = fakeHome(false);
    const gate = new SnapshotGate<FleetRead>({ cacheMs: 5_000, slowFactor: 3, maxBackoffMs: 600_000 });
    const one = feedFor(fake.home, { fleetGate: gate });
    const two = feedFor(fake.home, { fleetGate: gate });
    await one.refresh();
    await two.refresh();
    await one.refreshForDecision();
    expect(fake.runs()).toBe(1);
    vi.advanceTimersByTime(5_001);
    await two.refresh();
    expect(fake.runs()).toBe(2);
  }, 30_000);

  it("never lets the timer start a snapshot while one runs, and waits out a slow one's back-off", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const fake = fakeHome(true);
    const gate = new SnapshotGate<FleetRead>({ cacheMs: 5_000, slowFactor: 3, maxBackoffMs: 600_000 });
    const feed = feedFor(fake.home, { fleetGate: gate, intervalMs: 1_000 });
    feed.start({ force: true });
    try {
      await until(() => fake.runs() === 1);
      // The run is slow: twenty seconds and twenty timer intervals pass while it holds.
      for (let i = 0; i < 20; i += 1) {
        vi.advanceTimersByTime(1_000);
        await tick();
      }
      expect(fake.runs()).toBe(1);
      fake.release();
      await until(() => !gate.running);
      for (let i = 0; i < 20; i += 1) await tick();
      // A ~20s run backs the next one off ~60s, well past the 1s interval.
      const backoff = gate.nextRunAt() - Date.now();
      expect(backoff).toBeGreaterThan(50_000);
      vi.advanceTimersByTime(backoff - 5_000);
      for (let i = 0; i < 20; i += 1) await tick();
      expect(fake.runs()).toBe(1);
      vi.advanceTimersByTime(5_001);
      await until(() => fake.runs() === 2);
    } finally {
      feed.stop();
    }
  }, 30_000);
});
