import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtefactFeed, type FleetRead } from "../artefact.js";
import { SnapshotGate } from "../snapshot-gate.js";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

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
  it("starts one snapshot for many concurrent refreshes from several clients of one feed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fake = fakeHome(true);
    // As in production: one feed (commands/view.ts) serves every connection, behind the process's 5s cache.
    const feed = feedFor(fake.home, { fleetGate: new SnapshotGate<FleetRead>({ cacheMs: 5_000, slowFactor: 3, maxBackoffMs: 600_000 }) });
    const clients = 5;
    // Each client polls, answers a call, and acts on the page, all at once.
    const refreshes = Array.from({ length: clients }, () => [
      feed.refresh(), feed.refresh(), feed.refreshForDecision(), feed.refresh({ fresh: true }), feed.refresh(),
    ]).flat();
    await until(() => fake.runs() >= 1);
    // Let any second run that might start show itself before the first is released.
    for (let i = 0; i < 50; i += 1) await tick();
    expect(fake.runs()).toBe(1);
    fake.release();
    const results = await Promise.all(refreshes);
    expect(results.every(Boolean)).toBe(true);
    // The answers that waited for the first refresh were served its result from the cache: still one run.
    expect(fake.runs()).toBe(1);
    feed.stop();
  }, 30_000);

  it("keeps a timed-out snapshot in flight until its whole tree has exited, then runs again", async () => {
    const home = mkdtempSync(join(tmpdir(), "snapshot-gate-orphan-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "state"));
    const runs = join(home, "runs");
    const childPid = join(home, "child.pid");
    const script = join(home, "bin", "fm-bearings-snapshot.sh");
    // Ignores SIGTERM, and leaves a child that escapes into a process group of its own, ignores SIGTERM
    // too and lets go of the output pipe - the shape of a firstmate check outliving a killed snapshot.
    writeFileSync(script, `#!/bin/sh\necho run >> '${runs}'\ntrap '' TERM\nperl -e '$SIG{TERM}="IGNORE"; setpgrp(0,0); open(my $f, ">", $ARGV[0]); print $f $$; close $f; exec "sleep", 60' '${childPid}' </dev/null >/dev/null 2>&1 &\nsleep 60\n`, { mode: 0o755 });
    const count = () => (existsSync(runs) ? readFileSync(runs, "utf8").split("\n").filter(Boolean).length : 0);
    const feed = feedFor(home, { timeoutMs: 300 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      let settled = false;
      const first = feed.refresh().finally(() => { settled = true; });
      await until(() => existsSync(childPid) && readFileSync(childPid, "utf8").trim().length > 0);
      const child = Number(readFileSync(childPid, "utf8"));
      // Past the timeout and the SIGTERM it ignores, the run is still in flight: every refresh shares it.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(settled).toBe(false);
      expect(alive(child)).toBe(true);
      // The next run records whether the old tree's child was still alive when it started.
      // Swapped by rename, so the shell still running the old script keeps reading its own file.
      const next = `${script}.next`;
      writeFileSync(next, `#!/bin/sh\nif kill -0 ${child} 2>/dev/null; then echo overlap >> '${runs}'; else echo run >> '${runs}'; fi\necho '{"in_flight":[]}'\n`, { mode: 0o755 });
      renameSync(next, script);
      const second = feed.refresh();
      const third = feed.refreshForDecision();
      expect(count()).toBe(1);
      expect(await first).toBe(false);
      // It settled only once the escaped child was gone.
      expect(alive(child)).toBe(false);
      await second;
      expect(await third).toBe(true);
      const lines = readFileSync(runs, "utf8").split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines).not.toContain("overlap");
    } finally {
      warn.mockRestore();
      feed.stop();
    }
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
