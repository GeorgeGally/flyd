import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { deliveredRecords, deliverOnce, deliverOwed, MAX_TRIES, seedOnce, finishedReports, UNFINISHED_CLAIM_MS, claimDelivery, type DeliveryReport } from "../delivered.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function home(): string {
  dir = mkdtempSync(join(tmpdir(), "flyd-delivered-"));
  return join(dir, "intelligence.sqlite");
}

const report = (key: string, line = `Done: ${key}.`): DeliveryReport => ({ key, line, work: key });

describe("flyd.delivered", () => {
  it("tells each report once, and a restart on the same store tells none again", async () => {
    const path = home();
    const said: string[] = [];
    const say = async (_title: string, message: string) => { said.push(message); return "shown" as const; };
    let store = new IntelligenceEventStore({ path });
    expect((await deliverOnce([report("work:a"), report("work:b"), report("work:a")], { store, say })).told).toHaveLength(2);
    expect(await deliverOnce([report("work:a")], { store, say })).toEqual({ told: [], owed: [] });
    store.close();
    store = new IntelligenceEventStore({ path });
    expect(await deliverOnce([report("work:a"), report("work:b")], { store, say })).toEqual({ told: [], owed: [] });
    expect(said).toEqual(["Done: work:a.", "Done: work:b."]);
    expect(deliveredRecords(store).map((record) => [record.key, record.outcome])).toEqual([["work:a", "shown"], ["work:b", "shown"]]);
    store.close();
  });

  it("tells a backlog one report at a time, each in its own line with its link", async () => {
    const store = new IntelligenceEventStore({ path: home() });
    const said: string[] = [];
    const lines = ["one", "two", "three", "four", "five"].map((name) => `Done: ${name}. https://github.com/GeorgeGally/flyd/pull/${name.length}`);
    const { told } = await deliverOnce(lines.map((line, index) => report(`work:${index}`, line)), { store, say: async (_t, message) => { said.push(message); } });
    expect(told).toHaveLength(5);
    expect(said).toEqual(lines);
    expect(deliveredRecords(store).map((record) => record.outcome)).toEqual(["shown", "shown", "shown", "shown", "shown"]);
    store.close();
  });

  it("does not tell the same news twice under another name (its link)", async () => {
    const store = new IntelligenceEventStore({ path: home() });
    const said: string[] = [];
    const say = async (_t: string, message: string) => { said.push(message); };
    await deliverOnce([{ ...report("work:run-1"), aliases: ["link:https://x/pull/1"] }], { store, say });
    await deliverOnce([{ ...report("work:task-1"), aliases: ["link:https://x/pull/1"] }], { store, say });
    expect(said).toEqual(["Done: work:run-1."]);
    store.close();
  });

  it("says a report cut off mid-send once more after the grace period, and never a third time", async () => {
    const store = new IntelligenceEventStore({ path: home() });
    const at = new Date("2026-11-10T10:00:00Z");
    // Claimed, then the process died before any outcome was recorded.
    expect(claimDelivery(store, report("work:c"), at)).toBe(0);
    expect(claimDelivery(store, report("work:c"), new Date(at.getTime() + 60_000))).toBeUndefined();
    const later = new Date(at.getTime() + UNFINISHED_CLAIM_MS + 1);
    expect(claimDelivery(store, report("work:c"), later)).toBe(1);
    // Cut off again: whether he heard it is unknown, so it is not said a third time.
    const said: string[] = [];
    const after = await deliverOnce([report("work:c")], { store, say: async (_t, message) => { said.push(message); }, now: () => new Date(later.getTime() + UNFINISHED_CLAIM_MS + 1) });
    expect([after, said]).toEqual([{ told: [], owed: [] }, []]);
    store.close();
  });

  it("keeps a report that was not delivered owed, and says it again on each sweep until it is", async () => {
    const path = home();
    let store = new IntelligenceEventStore({ path });
    const at = new Date("2026-11-10T10:00:00Z");
    const step = (minutes: number) => () => new Date(at.getTime() + minutes * 60_000);
    const first = await deliverOnce([{ ...report("work:d"), kind: "deliverable", work: "the footer" }], { store, say: async () => "undelivered", now: step(0) });
    expect(first.owed.map((item) => item.key)).toEqual(["work:d"]);
    // Inside the grace period nothing is said, and it is still owed.
    expect(await deliverOwed({ store, say: async () => "shown", now: step(1) })).toMatchObject({ told: [], owed: [{ key: "work:d" }] });
    // No adapter listening twice more, across a restart: still owed, never dropped.
    expect((await deliverOwed({ store, say: async () => "undelivered", now: step(6) })).told).toHaveLength(1);
    store.close();
    store = new IntelligenceEventStore({ path });
    expect((await deliverOwed({ store, say: async () => "undelivered", now: step(12) })).owed).toHaveLength(1);
    const said: Array<[string, string | undefined, string | undefined]> = [];
    const told = await deliverOwed({ store, say: async (_t, message, kind, work) => { said.push([message, kind, work]); return "shown"; }, now: step(18) });
    expect([said, told.owed]).toEqual([[["Done: work:d.", "deliverable", "the footer"]], []]);
    expect(await deliverOwed({ store, say: async () => "shown", now: step(30) })).toEqual({ told: [], owed: [] });
    expect(deliveredRecords(store).map((record) => [record.key, record.outcome])).toEqual([["work:d", "shown"]]);
    store.close();
  });

  it("does not sweep the other name (link) a report was claimed under", async () => {
    const store = new IntelligenceEventStore({ path: home() });
    const at = new Date("2026-11-10T10:00:00Z");
    await deliverOnce([{ ...report("work:e"), aliases: ["link:https://x/pull/5"] }], { store, say: async () => "undelivered", now: () => at });
    const said: string[] = [];
    await deliverOwed({ store, say: async (_t, message) => { said.push(message); return "shown"; }, now: () => new Date(at.getTime() + UNFINISHED_CLAIM_MS + 1) });
    expect(said).toEqual(["Done: work:e."]);
    store.close();
  });

  it("waits twice as long before each try, and gives up after the cap", async () => {
    const store = new IntelligenceEventStore({ path: home() });
    const at = new Date("2026-11-10T10:00:00Z");
    let tries = 0;
    const say = async () => { tries++; return "undelivered" as const; };
    await deliverOnce([report("work:f")], { store, say, now: () => at });
    // Waits of 5, 10, 20, 40, 80 and 160 minutes: 315 minutes for MAX_TRIES (6) more tries.
    let minutes = 0;
    for (const wait of [5, 10, 20, 40, 80, 160]) {
      await deliverOwed({ store, say, now: () => new Date(at.getTime() + (minutes + wait - 1) * 60_000) });
      minutes += wait;
      await deliverOwed({ store, say, now: () => new Date(at.getTime() + minutes * 60_000) });
    }
    expect([tries, MAX_TRIES]).toEqual([7, 6]);
    // Given up: no longer owed, never tried again.
    expect(await deliverOwed({ store, say, now: () => new Date(at.getTime() + 2 * 24 * 60 * 60_000) })).toEqual({ told: [], owed: [] });
    expect(tries).toBe(7);
    store.close();
  });

  it("never tells under a key that was claimed as another report's other name", async () => {
    const store = new IntelligenceEventStore({ path: home() });
    const at = new Date("2026-11-10T10:00:00Z");
    const said: string[] = [];
    const say = async (_t: string, message: string) => { said.push(message); return "shown" as const; };
    await deliverOnce([{ ...report("work:desk-1"), aliases: ["work:flyd-task"] }], { store, say, now: () => at });
    await deliverOnce([report("work:flyd-task", "Done: flyd task.")], { store, say, now: () => new Date(at.getTime() + 24 * 60 * 60_000) });
    expect(said).toEqual(["Done: work:desk-1."]);
    store.close();
  });

  it("seeds finished work on record at upgrade as told, once, and tells only what finishes after", async () => {
    const path = home();
    let store = new IntelligenceEventStore({ path });
    const said: string[] = [];
    const say = async (_t: string, message: string) => { said.push(message); return "shown" as const; };
    expect(seedOnce(["work:old-1", "work:old-2"], { store })).toBe(true);
    await deliverOnce([report("work:old-1"), report("work:old-2")], { store, say });
    store.close();
    store = new IntelligenceEventStore({ path });
    // A restart never seeds again: work finishing now is told.
    expect(seedOnce(["work:new-1"], { store })).toBe(false);
    await deliverOnce([report("work:old-1"), report("work:new-1")], { store, say });
    expect(said).toEqual(["Done: work:new-1."]);
    expect(await deliverOwed({ store, say, now: () => new Date(Date.now() + 24 * 60 * 60_000) })).toEqual({ told: [], owed: [] });
    store.close();
  });

  it("makes one report per finished decision Flyd shows and notifies", () => {
    expect(finishedReports([
      { taskId: "flyd-a", show: true, notify: true, evidenceRefs: ["r"], delivery: { line: "Done: a. https://x/pull/2", url: "https://x/pull/2" } },
      { taskId: "flyd-b", show: false, notify: false, evidenceRefs: [] },
      { show: true, notify: true, evidenceRefs: [], delivery: { line: "no task" } },
    ], (task) => `named ${task}`)).toEqual([
      { key: "work:flyd-a", line: "Done: a. https://x/pull/2", kind: "deliverable", work: "named flyd-a", evidenceRefs: ["r"], aliases: ["link:https://x/pull/2"] },
    ]);
    // Keyed by the run the task is his work for; a task its owner keeps quiet makes no report.
    const done = (taskId: string) => ({ taskId, show: true, notify: true, evidenceRefs: [], delivery: { line: `Done: ${taskId}.` } });
    expect(finishedReports([done("flyd-c"), done("flyd-d")], (task) => task, (task) => (task === "flyd-c" ? "desk-1" : undefined)).map((item) => item.key))
      .toEqual(["work:desk-1"]);
  });
});
