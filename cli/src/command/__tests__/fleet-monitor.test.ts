import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LiveStaffSession,
  NUDGE_GRACE_MS,
  STALE_HANDOFF_MS,
  StaffMonitor,
  UNREACHABLE_MS,
  WORKER_WAIT_MS,
  describeStaff,
  readStaffView,
  staffFile,
  type StaffView,
} from "../fleet-monitor.js";
import type { FirstmateExec } from "../firstmate.js";
import type { sendRunMessage } from "../messages.js";
import { saveDomainRun } from "../store.js";
import type { DomainRun } from "../types.js";

const T0 = Date.parse("2026-10-17T00:00:00.000Z");
const MIN = 60_000;

describe("Flyd's watch on its coding staff", () => {
  let root: string;
  let home: string;
  let dir: string;
  let sessions: string;
  let ready: Record<string, unknown>;
  let notes: Array<{ args: string[]; input?: string }>;
  let noteSaved: boolean;

  const exec: FirstmateExec = async (_script, args, options) => {
    if (args[0] === "ready") return { stdout: JSON.stringify(ready), stderr: "" };
    if (args[0] === "note") {
      notes.push({ args, input: options.input });
      if (!noteSaved) throw new Error("inbox refused");
      return { stdout: JSON.stringify({ id: "note-x", saved: true }), stderr: "" };
    }
    throw new Error(`unexpected ${args.join(" ")}`);
  };

  const summary = (value: Record<string, unknown>) => {
    writeFileSync(join(home, "state", "home-summary.json"), JSON.stringify(value));
  };

  const run = (overrides: Partial<DomainRun> = {}): DomainRun => ({
    id: "domain-quiet",
    request: {
      id: "domain-quiet", domain: "coding", originalMessage: "fix the footer link",
      intendedOutcome: "The footer link opens the partners page", doneWhen: ["the link works"], createdAt: new Date(T0).toISOString(),
    },
    owner: "FirstMate",
    status: "accepted",
    createdAt: new Date(T0).toISOString(),
    updatedAt: new Date(T0).toISOString(),
    transport: { kind: "firstmate", requestId: "domain-quiet", externalId: "note-1" },
    ...overrides,
  });

  const monitor = (now: () => number, extra: { notify?: (title: string, message: string) => Promise<void>; sendRun?: typeof sendRunMessage } = {}) =>
    new StaffMonitor({ home, script: "/fake/fm-inbox.sh", exec, sessionsDir: sessions, dir, now, ...extra });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "flyd-staff-"));
    home = join(root, "firstmate");
    dir = join(root, "command");
    sessions = join(root, "sessions");
    mkdirSync(join(home, "state"), { recursive: true });
    mkdirSync(sessions, { recursive: true });
    ready = { lock: { state: "held", pid: 4242, live_harness: true }, wake_consumer: { state: "healthy", beacon_age_seconds: 12 }, can_receive: true };
    notes = [];
    noteSaved = true;
    summary({ active_children: [], decisions_open: [], counts: { queued: 0 } });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reads what is under way, waiting and held from the staff's own records", async () => {
    writeFileSync(join(sessions, "4242.json"), JSON.stringify({ pid: 4242, sessionId: "live-session-1" }));
    summary({
      active_children: [
        { id: "footer-link", state: "working", name: "Fix the footer link", doing: "running tests" },
        { id: "island-text", state: "needs-decision", name: "Restore readable island text", doing: "harness busy (claude-hook)" },
        { id: "notice-scrub", state: "working", name: "Scrub notifications", doing: "validating (running) · run: 01M53SGNH2E80SBE94FG8NNY1Q" },
      ],
      decisions_open: [{ id: "fm-handover", summary: "Seamless handover between sessions", hold_age_days: 2 }],
      counts: { queued: 7 },
    });
    writeFileSync(join(home, "state", "island-text.status"), `working [at=${T0 / 1000 - 600}]: started\nneeds-decision [at=${T0 / 1000 - 300}]: which size?\n`);
    saveDomainRun(run(), dir);
    saveDomainRun(run({ id: "domain-done", status: "completed" }), dir);

    const snapshot = await monitor(() => T0).read();
    expect(snapshot.readiness).toEqual({ lock: "held", pid: 4242, liveHarness: true, heartbeat: "healthy", beaconAgeSeconds: 12, canReceive: true });
    expect(snapshot.session).toBe("live-session-1");
    expect(snapshot.workers).toEqual([
      { id: "footer-link", name: "Fix the footer link", state: "working", doing: "running tests" },
      { id: "island-text", name: "Restore readable island text", state: "needs-decision", since: new Date(T0 - 5 * MIN).toISOString() },
      { id: "notice-scrub", name: "Scrub notifications", state: "working", doing: "validating (running)" },
    ]);
    expect(snapshot.waitingOnHim).toEqual([{ id: "fm-handover", summary: "Seamless handover between sessions", ageDays: 2 }]);
    expect(snapshot.queued).toBe(7);
    expect(snapshot.handoffs.map((handoff) => handoff.id)).toEqual(["domain-quiet"]);
  });

  it("asks the staff about a quiet handoff first, and tells George only when that did not help", async () => {
    saveDomainRun(run(), dir);
    let now = T0 + STALE_HANDOFF_MS + MIN;
    const told: string[] = [];
    const nudged: Array<{ kind: string; from?: string; body: string }> = [];
    const sendRun: typeof sendRunMessage = async (input) => {
      nudged.push({ kind: input.kind, ...(input.from ? { from: input.from } : {}), body: input.body });
      // Delivery touches the run, as the real one does; that is not word back.
      saveDomainRun({ ...input.run, updatedAt: new Date(now).toISOString() }, dir);
      return { delivered: true };
    };
    const watch = monitor(() => now, { notify: async (_title, message) => { told.push(message); }, sendRun });

    const first = await watch.tick();
    expect(nudged).toHaveLength(1);
    expect(nudged[0]).toMatchObject({ kind: "question", from: "flyd" });
    expect(nudged[0]!.body).toContain("Plain prose is fine");
    expect(told).toEqual([]);
    expect(first!.concerns[0]!.nudgedAt).toBeDefined();
    expect(first!.concerns[0]!.toldAt).toBeUndefined();

    now += NUDGE_GRACE_MS / 2;
    await watch.tick();
    expect(nudged).toHaveLength(1);
    expect(told).toEqual([]);

    now += NUDGE_GRACE_MS;
    const later = await watch.tick();
    expect(told).toHaveLength(1);
    expect(told[0]).toContain("The footer link opens the partners page");
    expect(told[0]).toMatch(/heard nothing back/);
    expect(later!.concerns[0]!.toldAt).toBeDefined();
    expect(readStaffView({ file: staffFile(dir), now })?.concerns[0]?.toldAt).toBeDefined();

    // Told once only.
    now += NUDGE_GRACE_MS;
    await watch.tick();
    expect(told).toHaveLength(1);
  });

  it("forgets a stall once the staff answers", async () => {
    saveDomainRun(run(), dir);
    let now = T0 + STALE_HANDOFF_MS + MIN;
    const watch = monitor(() => now, { notify: async () => undefined, sendRun: async () => ({ delivered: true }) });
    expect((await watch.tick())!.concerns).toHaveLength(1);
    saveDomainRun(run({ status: "working", transport: { kind: "firstmate", requestId: "domain-quiet", externalId: "note-1", replyCursor: "2" }, updatedAt: new Date(now).toISOString() }), dir);
    now += MIN;
    const view = await watch.tick();
    expect(view!.concerns).toEqual([]);
    const state = JSON.parse(readFileSync(join(dir, "staff-monitor.json"), "utf8")) as { nudged: object };
    expect(state.nudged).toEqual({});
  });

  it("nudges the staff about a worker left waiting on a decision, and tells George if the note cannot be left", async () => {
    summary({ active_children: [{ id: "island-text", state: "needs-decision", name: "Restore readable island text" }], decisions_open: [], counts: {} });
    writeFileSync(join(home, "state", "island-text.status"), `needs-decision [at=${T0 / 1000}]: which size?\n`);
    const told: string[] = [];
    const now = T0 + WORKER_WAIT_MS + MIN;
    await monitor(() => now, { notify: async (_title, message) => { told.push(message); } }).tick();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.args.slice(0, 2)).toEqual(["note", "--request-id"]);
    expect(notes[0]!.input).toContain("island-text");
    expect(told).toEqual([]);

    rmSync(join(dir, "staff-monitor.json"));
    noteSaved = false;
    await monitor(() => now, { notify: async (_title, message) => { told.push(message); } }).tick();
    expect(told).toEqual([expect.stringContaining("Restore readable island text")]);
  });

  it("tells George straight away when nobody is there to nudge, after a while", async () => {
    ready = { lock: { state: "free" }, wake_consumer: { state: "unknown" }, can_receive: false };
    saveDomainRun(run({ updatedAt: new Date(T0).toISOString() }), dir);
    let now = T0;
    const told: string[] = [];
    const nudges: unknown[] = [];
    const watch = monitor(() => now, { notify: async (_title, message) => { told.push(message); }, sendRun: async (input) => { nudges.push(input); return { delivered: true }; } });
    await watch.tick();
    expect(told).toEqual([]);
    now += UNREACHABLE_MS + MIN;
    await watch.tick();
    expect(nudges).toEqual([]);
    expect(told).toEqual([expect.stringMatching(/Nobody has been looking after your coding work/)]);
    ready = { lock: { state: "held", pid: 1, live_harness: true }, wake_consumer: { state: "healthy" }, can_receive: true };
    now += MIN;
    expect((await watch.tick())!.concerns).toEqual([]);
  });

  it("treats a live lock holder who is not taking work as busy: nudges the staff, does not alarm George", async () => {
    ready = { lock: { state: "held", pid: 4242, live_harness: true }, wake_consumer: { state: "healthy" }, can_receive: false };
    summary({ active_children: [{ id: "island-text", state: "needs-decision", name: "Restore readable island text" }], decisions_open: [], counts: {} });
    writeFileSync(join(home, "state", "island-text.status"), `needs-decision [at=${T0 / 1000}]: which size?\n`);
    let now = T0;
    const told: string[] = [];
    const watch = monitor(() => now, { notify: async (_title, message) => { told.push(message); } });
    await watch.tick();
    expect(told).toEqual([]);
    now += UNREACHABLE_MS + MIN;
    const view = await watch.tick();
    expect(view!.concerns.some((concern) => concern.kind === "unreachable")).toBe(false);
    expect(notes).toHaveLength(1);
    expect(told).toEqual([]);
  });

  it("describes the staff for chat in plain words, without machinery names", async () => {
    summary({
      active_children: [{ id: "footer-link", state: "working", name: "Fix the footer link" }],
      decisions_open: [{ id: "fm-handover", summary: "Seamless handover between sessions" }],
      counts: { queued: 3 },
    });
    saveDomainRun(run(), dir);
    const now = T0 + 10 * MIN;
    const snapshot = await monitor(() => now).read();
    const view: StaffView = { snapshot, concerns: [] };
    const text = describeStaff(view, now);
    expect(text).toContain("Under way (1):\n- Fix the footer link");
    expect(text).toContain("The footer link opens the partners page — accepted, last word 10 min ago");
    expect(text).toContain("Held for George (1)");
    expect(text).toContain("Queued next: 3.");
    expect(text).not.toMatch(/firstmate|fm-inbox|crewmate/i);
  });

  const headerFor = async (readiness: Record<string, unknown>): Promise<string> => {
    ready = readiness;
    const snapshot = await monitor(() => T0).read();
    return describeStaff({ snapshot, concerns: [] }, T0).split("\n")[0]!;
  };

  it("reads nobody at home when no lock is held or no harness is live, not busy", async () => {
    expect(await headerFor({ lock: { state: "free" }, wake_consumer: { state: "unknown" }, can_receive: false })).toContain("nobody is looking after the coding work right now");
    expect(await headerFor({ lock: { state: "stale" }, can_receive: false })).toContain("nobody is looking after the coding work right now");
    expect(await headerFor({ lock: { state: "held", pid: 4242, live_harness: false }, wake_consumer: { state: "healthy" }, can_receive: true })).toContain("nobody is looking after the coding work right now");
  });

  it("reads a live lock holder by whether it takes work, and an unknown lock as unclear", async () => {
    expect(await headerFor({ lock: { state: "held", pid: 4242, live_harness: true }, wake_consumer: { state: "healthy" }, can_receive: false })).toContain("not taking new work right now");
    expect(await headerFor({ lock: { state: "held", pid: 4242, live_harness: true }, wake_consumer: { state: "healthy" }, can_receive: true })).toContain("on duty");
    expect(await headerFor({ lock: { state: "weird" }, wake_consumer: { state: "unknown" } })).toContain("status unclear");
  });

  it("finds the session that holds the staff's lock, reusing one read for 30 s", async () => {
    writeFileSync(join(sessions, "4242.json"), JSON.stringify({ sessionId: "live-session-1" }));
    let now = T0;
    let reads = 0;
    const counting: FirstmateExec = async (script, args, options) => { reads++; return exec(script, args, options); };
    const live = new LiveStaffSession({ home, script: "/fake/fm-inbox.sh", exec: counting, sessionsDir: sessions, now: () => now });
    expect(await live.current()).toBe("live-session-1");
    now += 28_000;
    expect(await live.current()).toBe("live-session-1");
    expect(reads).toBe(1);
    ready = { lock: { state: "free" }, can_receive: false };
    now += 3_000;
    expect(await live.current()).toBeUndefined();
  });
});
