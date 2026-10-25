import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { closeNote, OvertakenCalls, overtakenBy } from "../overtaken.js";
import { ArtefactFeed, callId, callItems, composeArtefact, fleetCounts, parseBacklog, type ArtefactRow } from "../artefact.js";

// George, 2026-10-17: a pending "Pick a layout for the What do you sell? step"
// stayed in Needs you after its task had finished; he had to say "this is old".
const SELL_STEP: ArtefactRow = {
  label: "Pick a layout for the What do you sell? apply step",
  task: "gnm-sell-step-pick",
  repo: "good_neighbours",
  detail: "George picks one of six lab layouts for vendor-apply 'What do you sell?' step: 1 Columns of tick rows, 2 Tiles. Or ask for changes.",
  at: "2026-10-12T09:00:00Z",
};

const hold = (text: string) => `fm-hold-v1:${Buffer.from(text).toString("base64")}`;

describe("a pending decision the staff's record has closed", () => {
  it("is overtaken once its task finished or merged", () => {
    const [entry] = parseBacklog("- [x] gnm-sell-step-pick - Pick a layout (repo: good_neighbours) (merged: 2026-10-16)").values();
    expect(overtakenBy(entry)).toBe("its task finished 2026-10-16");
  });

  it("is overtaken once its hold was answered or released", () => {
    const resolved = (mode: string) => [...parseBacklog([
      "- [ ] gnm-sell-step-pick - Pick a layout (repo: good_neighbours) (kind: captain) (since 2026-10-12)",
      "  Resolution recorded by fm-captain-hold.",
      `  Resolution mode: ${mode}`,
    ].join("\n")).values()][0];
    expect(overtakenBy(resolved("answered"))).toBe("it was answered");
    expect(overtakenBy(resolved("released"))).toBe("its hold was released");
  });

  it("stays while its hold is open, whatever an older resolution says", () => {
    const [entry] = parseBacklog([
      `- [ ] gnm-sell-step-pick - Pick a layout (repo: good_neighbours) (since 2026-10-12) (hold: ${hold("George picks a layout")}) (hold-kind: captain)`,
      "  Resolution recorded by fm-captain-hold.",
      "  Resolution mode: released",
    ].join("\n")).values();
    expect(overtakenBy(entry)).toBeUndefined();
  });

  it("stays when the record says nothing explicit about it", () => {
    expect(overtakenBy(undefined)).toBeUndefined();
    const [entry] = parseBacklog("- [ ] gnm-sell-step-pick - Pick a layout (repo: good_neighbours) (since 2026-10-12)").values();
    expect(overtakenBy(entry)).toBeUndefined();
  });

  it("tells the staff to close it, as Flyd's own note", () => {
    const note = closeNote(SELL_STEP, "its task finished 2026-10-16");
    expect(note).toContain("gnm-sell-step-pick");
    expect(note).toMatch(/Close the hold/);
    expect(note).toMatch(/not George's/);
  });
});

describe("Needs you, read against the record", () => {
  it("never shows George a call whose task finished, and tells the staff to close it once", async () => {
    const home = mkdtempSync(join(tmpdir(), "overtaken-feed-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "data"));
    const snapshot = join(home, "bearings.json");
    writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\ncat '${snapshot}'\n`, { mode: 0o755 });
    writeFileSync(snapshot, JSON.stringify({ decisions_open: [
      { id: "gnm-sell-step-pick", summary: "Pick a layout for the What do you sell? step" },
      { id: "cap5-hero", summary: "Pick the CapFive hero photo" },
    ] }));
    const backlog = (sellStep: string) => writeFileSync(join(home, "data", "backlog.md"), [
      "# Backlog",
      "",
      "## Captain",
      sellStep,
      `- [ ] cap5-hero - Pick the CapFive hero photo (repo: cap5) (kind: captain) (since 2026-10-12) (hold: ${hold("George picks the hero photo for the CapFive home page: 1 Boardroom, 2 Skyline")}) (hold-kind: captain)`,
      "",
    ].join("\n"));
    const open = `- [ ] gnm-sell-step-pick - ${SELL_STEP.label} (repo: good_neighbours) (kind: captain) (since 2026-10-12) (hold: ${hold(SELL_STEP.detail!)}) (hold-kind: captain)`;
    backlog(open);
    const sent: Array<[string, string]> = [];
    const feed = new ArtefactFeed({
      home,
      overtaken: new OvertakenCalls({ send: async (note, requestId) => { sent.push([note, requestId]); } }),
      memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none"),
    });
    await feed.refresh();
    expect(feed.current().fleet!.calls.map((row) => row.task)).toEqual(["gnm-sell-step-pick", "cap5-hero"]);
    expect(sent).toHaveLength(0);

    backlog(`${open.replace("- [ ]", "- [x]")} (merged: 2026-10-16)`);
    await feed.refresh();
    await feed.refresh();
    const fleet = feed.current().fleet!;
    expect(fleet.calls.map((row) => [row.task, row.ledgerOnly === true])).toEqual([["gnm-sell-step-pick", true], ["cap5-hero", false]]);
    expect(callItems(fleet).map((item) => item.task)).toEqual(["cap5-hero"]);
    expect(fleetCounts(fleet).call).toBe(1);
    expect(composeArtefact(feed.current()).find((item) => item.task === "gnm-sell-step-pick")).toMatchObject({ kind: "clear", detail: "Settled, nothing needed." });
    expect(sent).toHaveLength(1);
    expect(sent[0]![0]).toMatch(/its task finished 2026-10-16/);
    expect(sent[0]![1]).toMatch(/^flyd-close-[0-9a-f]{12}-gnm-sell-step-pick$/);
    expect(sent[0]![1].length).toBeLessThanOrEqual(125);

    const refused = new ArtefactFeed({
      home,
      overtaken: new OvertakenCalls({ send: async () => { throw new Error("firstmate did not take Flyd's note"); } }),
      memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none"),
    });
    await refused.refresh();
    expect(refused.current().fleet!.calls.map((row) => row.task)).toEqual(["gnm-sell-step-pick", "cap5-hero"]);
  });

  // 2026-10-24: with Core deciding fleet changes (the shipped setup), the check
  // never ran, so a call the staff had moved past kept ringing.
  it("settles overtaken calls before Core decides the rest", async () => {
    const home = mkdtempSync(join(tmpdir(), "overtaken-executive-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "data"));
    const snapshot = join(home, "bearings.json");
    writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\ncat '${snapshot}'\n`, { mode: 0o755 });
    writeFileSync(snapshot, JSON.stringify({ decisions_open: [{ id: "gnm-sell-step-pick", summary: "Pick a layout for the What do you sell? step" }] }));
    writeFileSync(join(home, "data", "backlog.md"), `- [x] gnm-sell-step-pick - ${SELL_STEP.label} (repo: good_neighbours) (merged: 2026-10-16)\n`);
    const sent: string[] = [];
    const decided: string[][] = [];
    const feed = new ArtefactFeed({
      home,
      overtaken: new OvertakenCalls({ send: async (note) => { sent.push(note); } }),
      decideChanges: async (changes) => { decided.push(changes.filter((change) => change.kind === "decision").map((change) => change.taskId ?? "")); return []; },
      memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none"),
    });
    await feed.refresh();
    expect(sent).toHaveLength(1);
    expect(decided.flat()).not.toContain("gnm-sell-step-pick");
  });

  it("names one raising of a call: a status line keeps it, the call reopened with what changed does not", () => {
    const raised = { ...SELL_STEP, raised: "2026-10-12" };
    expect(callId({ ...raised, at: "2026-10-14T08:00:00Z" })).toBe(callId(raised));
    expect(callId({ ...raised, detail: "George picks between two new layouts." })).not.toBe(callId(raised));
    expect(callId({ ...raised, raised: "2026-10-15" })).not.toBe(callId(raised));
  });
});

// George, 2026-10-25: a scene headed by a whole paragraph and a raw pull-request link, and
// another headed "An unresolved choice needs clarification." ("and this headline???!!!").
describe("a call's headline", () => {
  it("is a glance: a pull request as its number, a long ask cut to its first sentence", async () => {
    const { callHeadline } = await import("../artefact.js");
    expect(callHeadline("Merge CapFive PR https://github.com/GeorgeGally/capfive/pull/9? The Connect deals CSV export (previously uncommitted work, incl. dropdown filter facets, Year filter, spinner, cached lists) lands with the filename and first line named after the active filters."))
      .toBe("Merge CapFive PR #9?");
    expect(callHeadline("Pick a hero photo")).toBe("Pick a hero photo");
    expect(callHeadline("Which /new version(s) from lab round 2 to build (recommended: V10 Edit the thing in place, with the photo first)"))
      .toBe("Which /new versions from lab round 2 to build?");
    expect(callHeadline("Which /new version(s) from lab round 2 to build (recommended: V10 Edit the page or V2 Live page), or another lab round; and keep today's switch or adopt the No/Yes words."))
      .toBe("Which /new versions from lab round 2 to build, or another lab round?");
  });

  it("never says the stock line: the task's own title stands in", async () => {
    const { callHeadline } = await import("../artefact.js");
    expect(callHeadline("An unresolved choice needs clarification.", "CopyCopy: design lab, 6 directions for the sticky bezel"))
      .toBe("CopyCopy: design lab, 6 directions for the sticky bezel");
  });
});
