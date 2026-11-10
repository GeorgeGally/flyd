import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { deliveredRecords, deliverOnce, finishedReports, UNFINISHED_CLAIM_MS, claimDelivery, type DeliveryReport } from "../delivered.js";

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

  it("says a report cut off mid-send once more after the grace period, and one Core never took once more only", async () => {
    const store = new IntelligenceEventStore({ path: home() });
    const at = new Date("2026-11-10T10:00:00Z");
    expect(claimDelivery(store, report("work:c"), at)).toBe(true);
    expect(claimDelivery(store, report("work:c"), new Date(at.getTime() + 60_000))).toBe(false);
    const later = new Date(at.getTime() + UNFINISHED_CLAIM_MS + 1);
    const said: string[] = [];
    const cut = await deliverOnce([report("work:c")], { store, say: async (_t, message) => { said.push(message); return "undelivered"; }, now: () => later });
    // Said once more and still not delivered: the second try was its last, so it is no longer owed.
    expect([cut.told.length, cut.owed.length]).toEqual([1, 0]);
    expect(await deliverOnce([report("work:c")], { store, say: async (_t, message) => { said.push(message); }, now: () => new Date(later.getTime() + UNFINISHED_CLAIM_MS + 1) })).toEqual({ told: [], owed: [] });
    expect(said).toEqual(["Done: work:c."]);
    store.close();
  });

  it("keeps a first send that was not delivered owed until it is told", async () => {
    const store = new IntelligenceEventStore({ path: home() });
    const at = new Date("2026-11-10T10:00:00Z");
    const first = await deliverOnce([report("work:d")], { store, say: async () => "undelivered", now: () => at });
    expect(first.owed.map((item) => item.key)).toEqual(["work:d"]);
    // Inside the grace period nothing is said, and it is still owed.
    expect((await deliverOnce([report("work:d")], { store, say: async () => "shown", now: () => new Date(at.getTime() + 60_000) })).owed).toHaveLength(1);
    const said: string[] = [];
    const later = await deliverOnce([report("work:d")], { store, say: async (_t, message) => { said.push(message); return "shown"; }, now: () => new Date(at.getTime() + UNFINISHED_CLAIM_MS + 1) });
    expect([said, later.owed]).toEqual([["Done: work:d."], []]);
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
  });
});
