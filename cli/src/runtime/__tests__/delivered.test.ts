import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { DELIVERED_SOURCE, deliverOnce, deliverOwed, deliveryState, holdReport, markBriefed, MAX_TRIES, seedOnce, withdrawReport, UNFINISHED_CLAIM_MS, type DeliveredRecord, type DeliveryReport } from "../delivered.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function home(): string {
  dir = mkdtempSync(join(tmpdir(), "flyd-delivered-"));
  return join(dir, "intelligence.sqlite");
}

/** What became of each report, read from the persisted flyd.delivered events. */
function deliveredRecords(store: IntelligenceEventStore): DeliveredRecord[] {
  return store.readSource(DELIVERED_SOURCE)
    .map((event) => event.payload?.delivered as DeliveredRecord | undefined)
    .filter((record): record is DeliveredRecord => Boolean(record?.outcome) && record?.outcome !== "undelivered" && record?.key !== "seed:finished.v1");
}

const report = (key: string, line = `Done: ${key}.`): DeliveryReport => ({ key, line, work: key });

describe("flyd.delivered", () => {
  it("reports what George saw apart from what the gate screened out, and where each report stands", async () => {
    const store = new IntelligenceEventStore({ path: home() });
    const outcomes: Record<string, "shown" | "kept" | "placeholder" | "undelivered"> = { "Done: work:s.": "shown", "Done: work:k.": "kept", "Done: work:p.": "placeholder", "Done: work:u.": "undelivered" };
    const delivered = await deliverOnce(["work:s", "work:k", "work:p", "work:u"].map((key) => report(key)), { store, say: async (_title, message) => outcomes[message] });
    expect(delivered.told.map((said) => said.key)).toEqual(["work:s", "work:k", "work:p", "work:u"]);
    expect(delivered.shown.map((said) => said.key)).toEqual(["work:s"]);
    expect(delivered.screened.map((said) => said.key)).toEqual(["work:k", "work:p"]);
    expect(delivered.owed.map((said) => said.key)).toEqual(["work:u"]);
    expect(delivered.states).toEqual({ "work:s": "shown", "work:k": "screened", "work:p": "screened", "work:u": "owed" });
    // Asked again: nothing is said, and each still reads where it stands.
    expect((await deliverOnce([report("work:k")], { store, say: async () => "shown" })).states).toEqual({ "work:k": "screened" });
    // Held, then briefed in the morning: he saw it. Held, then withdrawn: it never rings.
    holdReport(report("work:h"), { until: "break" }, { store });
    holdReport(report("work:w"), { until: "break" }, { store });
    expect(deliveryState("work:h", { store })).toBe("held");
    markBriefed(["work:h"], { store });
    withdrawReport("work:w", { store });
    expect([deliveryState("work:h", { store }), deliveryState("work:w", { store }), deliveryState("work:none", { store })]).toEqual(["shown", "withdrawn", undefined]);
    store.close();
  });

  it("tells each report once, and a restart on the same store tells none again", async () => {
    const path = home();
    const said: string[] = [];
    const say = async (_title: string, message: string) => { said.push(message); return "shown" as const; };
    let store = new IntelligenceEventStore({ path });
    expect((await deliverOnce([report("work:a"), report("work:b"), report("work:a")], { store, say })).told).toHaveLength(2);
    expect(await deliverOnce([report("work:a")], { store, say })).toMatchObject({ told: [], owed: [] });
    store.close();
    store = new IntelligenceEventStore({ path });
    expect(await deliverOnce([report("work:a"), report("work:b")], { store, say })).toMatchObject({ told: [], owed: [] });
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

  it("tells two pieces of work that share a PR link each under its own key", async () => {
    const store = new IntelligenceEventStore({ path: home() });
    const said: string[] = [];
    const say = async (_t: string, message: string) => { said.push(message); };
    await deliverOnce([report("work:task-1", "Done: one. https://x/pull/1")], { store, say });
    await deliverOnce([report("work:task-2", "Done: two. https://x/pull/1")], { store, say });
    expect(said).toEqual(["Done: one. https://x/pull/1", "Done: two. https://x/pull/1"]);
    store.close();
  });

  it("says a report cut off mid-send once more after the grace period, and never a third time", async () => {
    const store = new IntelligenceEventStore({ path: home() });
    const at = new Date("2026-11-10T10:00:00Z");
    const started: string[] = [];
    // A send that never comes back: the process died before any outcome was recorded.
    const cutOff = async (_t: string, message: string) => { started.push(message); return new Promise<never>(() => undefined); };
    void deliverOnce([report("work:c")], { store, say: cutOff, now: () => at });
    await Promise.resolve();
    void deliverOnce([report("work:c")], { store, say: cutOff, now: () => new Date(at.getTime() + 60_000) });
    await Promise.resolve();
    expect(started).toHaveLength(1);
    const later = new Date(at.getTime() + UNFINISHED_CLAIM_MS + 1);
    void deliverOnce([report("work:c")], { store, say: cutOff, now: () => later });
    await Promise.resolve();
    expect(started).toHaveLength(2);
    // Cut off again: whether he heard it is unknown, so it is not said a third time.
    const said: string[] = [];
    const after = await deliverOnce([report("work:c")], { store, say: async (_t, message) => { said.push(message); }, now: () => new Date(later.getTime() + UNFINISHED_CLAIM_MS + 1) });
    expect(after).toMatchObject({ told: [], owed: [] });
    expect(said).toEqual([]);
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
    expect(await deliverOwed({ store, say: async () => "shown", now: step(30) })).toMatchObject({ told: [], owed: [] });
    expect(deliveredRecords(store).map((record) => [record.key, record.outcome])).toEqual([["work:d", "shown"]]);
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
    expect(await deliverOwed({ store, say, now: () => new Date(at.getTime() + 2 * 24 * 60 * 60_000) })).toMatchObject({ told: [], owed: [] });
    expect(tries).toBe(7);
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
    expect(await deliverOwed({ store, say, now: () => new Date(Date.now() + 24 * 60 * 60_000) })).toMatchObject({ told: [], owed: [] });
    store.close();
  });
});
