import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { batchLine, deliveredRecords, deliverOnce, finishedReports, UNFINISHED_CLAIM_MS, claimDelivery, type DeliveryReport } from "../delivered.js";

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
    expect(await deliverOnce([report("work:a"), report("work:b"), report("work:a")], { store, say })).toHaveLength(2);
    expect(await deliverOnce([report("work:a")], { store, say })).toEqual([]);
    store.close();
    store = new IntelligenceEventStore({ path });
    expect(await deliverOnce([report("work:a"), report("work:b")], { store, say })).toEqual([]);
    expect(said).toEqual(["Done: work:a.", "Done: work:b."]);
    expect(deliveredRecords(store).map((record) => [record.key, record.outcome])).toEqual([["work:a", "shown"], ["work:b", "shown"]]);
    store.close();
  });

  it("tells a backlog as one line rather than ringing once per item", async () => {
    const store = new IntelligenceEventStore({ path: home() });
    const said: string[] = [];
    const told = await deliverOnce(["one", "two", "three", "four", "five"].map((name) => report(`work:${name}`)), { store, say: async (_t, message) => { said.push(message); } });
    expect(told).toHaveLength(5);
    expect(said).toEqual(["5 pieces of your work are finished: work:one, work:two, work:three and 2 more."]);
    expect(deliveredRecords(store).every((record) => record.outcome === "batched")).toBe(true);
    expect(batchLine([{ key: "x", line: "" }, { key: "y", line: "" }])).toBe("2 pieces of your work are finished.");
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
    expect(await deliverOnce([report("work:c")], { store, say: async (_t, message) => { said.push(message); return "undelivered"; }, now: () => later })).toHaveLength(1);
    expect(await deliverOnce([report("work:c")], { store, say: async (_t, message) => { said.push(message); }, now: () => new Date(later.getTime() + UNFINISHED_CLAIM_MS + 1) })).toEqual([]);
    expect(said).toEqual(["Done: work:c."]);
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
