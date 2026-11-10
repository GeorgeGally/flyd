import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { batch, morningLines, QUIET_MS, readFocus, released, timing, type Held } from "../attention.js";
import { deliverOnce, heldReports, holdReport, markBriefed } from "../delivered.js";

// The timing table in docs/plans/2026-10-30-flyd-chief-of-staff-split-plan.md ("When to tell George").
const NOW = Date.parse("2026-11-11T10:00:00Z");
const MINUTE = 60_000;
const onBloom = readFocus({ now: NOW, activity: [{ project: "Bloom", at: NOW - 5 * MINUTE }, { project: "cap5", at: NOW - 15 * MINUTE }] });
const inMeeting = readFocus({ now: NOW, activity: [{ project: "Bloom", at: NOW - 5 * MINUTE }], meetingEndsAt: NOW + 30 * MINUTE });
const noFocus = readFocus({ now: NOW, activity: [{ project: "Bloom", at: NOW - QUIET_MS - MINUTE }] });

describe("when to tell George", () => {
  it("follows each row of the timing table", () => {
    expect(onBloom.project).toBe("Bloom");
    expect(noFocus.project).toBeUndefined();
    // Irreversible or credential: now, whatever he is doing, a meeting included.
    expect(timing({ project: "cap5", kind: "irreversible" }, inMeeting)).toEqual({ when: "now", depth: "lead" });
    expect(timing({ project: "cap5", kind: "credential" }, onBloom)).toEqual({ when: "now", depth: "lead" });
    // About his focus: now, fuller (the folder names the same project).
    expect(timing({ project: "/Users/g/Documents/bloom", kind: "done" }, onBloom)).toEqual({ when: "now", depth: "full" });
    // Another project while focused: held until focus breaks.
    expect(timing({ project: "cap5", kind: "done" }, onBloom)).toEqual({ when: "held", until: "break" });
    // In a meeting: held to its end, unless it blocks him now.
    expect(timing({ project: "Bloom", kind: "done" }, inMeeting)).toEqual({ when: "held", until: "meeting" });
    expect(timing({ project: "Bloom", kind: "decision", blocking: true }, inMeeting)).toEqual({ when: "now", depth: "full" });
    // No particular focus: now, as a lead line.
    expect(timing({ project: "cap5", kind: "done" }, noFocus)).toEqual({ when: "now", depth: "lead" });
  });

  it("releases an off-focus report only when focus breaks, and a meeting's at its end", () => {
    const held: Held[] = [
      { key: "work:a", line: "The cap5 export is finished.", heldAt: NOW, until: "break", focus: "Bloom", finished: true },
      { key: "work:b", line: "Cap5's footer change landed.", heldAt: NOW, until: "meeting", finished: true },
    ];
    const later = NOW + 10 * MINUTE;
    const still = readFocus({ now: later, activity: [{ project: "Bloom", at: later - MINUTE }], meetingEndsAt: later + MINUTE });
    expect(released(held, still)).toEqual([]);
    const stillOnBloom = readFocus({ now: later, activity: [{ project: "Bloom", at: later - MINUTE }] });
    expect(released(held, stillOnBloom).map((report) => report.key)).toEqual(["work:b"]);
    const switched = readFocus({ now: later, activity: [{ project: "cap5", at: later - MINUTE }] });
    const quiet = readFocus({ now: NOW + QUIET_MS + MINUTE, activity: [{ project: "Bloom", at: NOW }] });
    const chatted = readFocus({ now: later, activity: [{ project: "Bloom", at: later - MINUTE }], lastTurnAt: later - 2 * MINUTE });
    for (const focus of [switched, quiet, chatted]) expect(released(held, focus).map((report) => report.key)).toEqual(["work:a", "work:b"]);
  });

  it("batches held reports into one notification line naming each that fits", () => {
    const one: Held = { key: "work:a", line: "The cap5 export is finished.", work: "the cap5 export", heldAt: NOW, until: "break", focus: "Bloom", finished: true };
    expect(batch([one])).toBe("The cap5 export is finished.");
    expect(batch([one, { ...one, key: "work:b", work: "the cap5 footer" }])).toBe("Two things finished while you were on Bloom: the cap5 export and the cap5 footer.");
    // No work name: a short form of its line.
    expect(batch([one, { ...one, key: "work:b", work: undefined, line: "Cap5's footer change landed. Checks passed." }]))
      .toBe("Two things finished while you were on Bloom: the cap5 export and Cap5's footer change landed.");
    const long = "a very long name for a piece of work that will not fit";
    const many = batch([one, { ...one, key: "b", finished: false, work: long }, { ...one, key: "c", work: long }, { ...one, key: "d", work: long }]);
    expect(many.startsWith("Four things came in while you were on Bloom: the cap5 export, ")).toBe(true);
    expect(many.endsWith(" more.")).toBe(true);
    expect(many.includes("\n")).toBe(false);
    expect(many.length).toBeLessThanOrEqual(140);
    expect(morningLines([one])).toEqual(["Held for you (1):", "  • The cap5 export is finished."]);
  });
});

describe("held reports", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("are told once, together, and the morning brief takes the ones never told", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-attention-"));
    const store = new IntelligenceEventStore({ path: join(dir, "intelligence.sqlite") });
    const now = () => new Date(NOW);
    const said: string[] = [];
    const say = async (_title: string, message: string) => { said.push(message); return "shown" as const; };
    for (const key of ["work:a", "work:b", "work:c"]) holdReport({ key, line: `${key} is finished.`, work: key.slice(5) }, { until: "break", focus: "Bloom", finished: true }, { store, now });
    holdReport({ key: "work:a", line: "said twice" }, { until: "break" }, { store, now });
    expect(heldReports({ store, now }).map((report) => report.line)).toEqual(["work:a is finished.", "work:b is finished.", "work:c is finished."]);

    const due = heldReports({ store, now }).slice(0, 2);
    await deliverOnce(due, { store, say, now, together: (claimed) => batch(claimed.map((report) => ({ ...report, heldAt: NOW, until: "break", focus: "Bloom", finished: true }))) });
    expect(said).toEqual(["Two things finished while you were on Bloom: a and b."]);
    expect(heldReports({ store, now }).map((report) => report.key)).toEqual(["work:c"]);

    markBriefed(["work:c"], { store, now });
    expect(heldReports({ store, now })).toEqual([]);
    store.close();
  });
});
