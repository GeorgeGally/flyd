import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { callArea, closeNote, OvertakenCalls, overtakenBy, type AreaCommit } from "../overtaken.js";
import { ArtefactFeed, callId, type ArtefactRow } from "../artefact.js";

// George, 2026-10-17: a pending "Pick a layout for the What do you sell? step"
// stayed in Needs you after the apply flow was rebuilt and shipped on Oct 16;
// he had to say "this is old, we've already put the site live".
const SELL_STEP: ArtefactRow = {
  label: "Pick a layout for the What do you sell? apply step",
  task: "gnm-sell-step-pick",
  repo: "good_neighbours",
  detail: "George picks one of six lab layouts for vendor-apply 'What do you sell?' step (see data/gnm-sell-step-lab/report.md + shots): 1 Columns of tick rows, 2 Tiles, 3 Label column + outline chips (smallest change), 4 Cream card, 5 Big type list + summary strip, 6 Search + picks tray. Or ask for changes.",
  at: "2026-10-12T09:00:00Z",
  choices: ["Columns of tick rows", "Tiles", "Label column + outline chips", "Cream card", "Big type list + summary strip", "Search + picks tray"],
};

const SHIPPED: AreaCommit[] = [
  { at: "2026-10-16T13:02:00+08:00", subject: "Polish Christmas site and vendor application across devices", files: ["css/apply-flow.css", "vendor-apply/christmas-apply.js", "vendor-apply/lab/what-do-you-sell.html", "index.html"] },
  { at: "2026-10-16T11:40:00+08:00", subject: "Apply flow: one consolidated category list on the form and the backend, two-way swipe, equal-height space tiles", files: ["vendor-apply/index.php", "vendor-apply/christmas.php", "css/apply-flow.css"] },
  { at: "2026-10-11T10:00:00+08:00", subject: "Apply flow: tighter space tiles", files: ["vendor-apply/index.php"] },
];

const NOW = Date.parse("2026-10-17T06:00:00Z");

describe("a pending decision the work has moved past", () => {
  it("reads the area a call names", () => {
    expect(callArea(SELL_STEP)).toEqual(expect.arrayContaining(["vendor-apply", "what-do-you-sell"]));
  });

  it("drops the What do you sell? layout pick once the apply flow was rebuilt and shipped", () => {
    expect(overtakenBy(SELL_STEP, { commits: SHIPPED }, NOW)).toMatch(/shipped 2026-10-16/);
  });

  it("keeps a call younger than a day, whatever shipped", () => {
    expect(overtakenBy({ ...SELL_STEP, at: "2026-10-16T20:00:00Z" }, { commits: SHIPPED }, NOW)).toBeUndefined();
  });

  it("reads a call's age from when it was raised, not its latest status line", () => {
    expect(overtakenBy({ ...SELL_STEP, raised: "2026-10-12", at: "2026-10-17T05:00:00Z" }, { commits: SHIPPED }, NOW)).toMatch(/shipped 2026-10-16/);
  });

  it("keeps a call when only commits from before it touched the area", () => {
    expect(overtakenBy(SELL_STEP, { commits: SHIPPED.slice(2) }, NOW)).toBeUndefined();
  });

  it("keeps a call when later commits touched other parts of the project", () => {
    const elsewhere: AreaCommit[] = [{ at: "2026-10-16T10:00:00Z", subject: "Contact: lighten the gradient over the background photo", files: ["contact.html", "css/christmas-2026.css"] }];
    expect(overtakenBy(SELL_STEP, { commits: elsewhere }, NOW)).toBeUndefined();
  });

  it("keeps a call when a commit in its area is about something else", () => {
    const unrelated: AreaCommit[] = [{ at: "2026-10-16T10:00:00Z", subject: "Upload images within server limits without browser recompression", files: ["vendor-apply/tests/image_prepare_test.cjs"] }];
    expect(overtakenBy(SELL_STEP, { commits: unrelated }, NOW)).toBeUndefined();
  });

  it("counts work the staff finished in the same project on the same thing", () => {
    const finished = [{ title: "GNM: new layout for the vendor apply categories step", repo: "good_neighbours", finished: "2026-10-16" }];
    expect(overtakenBy({ ...SELL_STEP, detail: undefined }, { finished }, NOW)).toMatch(/finished 2026-10-16/);
    expect(overtakenBy({ ...SELL_STEP, detail: undefined }, { finished: [{ ...finished[0]!, repo: "cap5" }] }, NOW)).toBeUndefined();
  });

  it("tells the staff to close it, as Flyd's own note", () => {
    const note = closeNote(SELL_STEP, '"Apply flow: one consolidated category list" shipped 2026-10-16');
    expect(note).toContain("gnm-sell-step-pick");
    expect(note).toMatch(/close the hold/);
    expect(note).toMatch(/not George's/);
  });
});

describe("Needs you, read against the record", () => {
  it("never shows George the overtaken layout pick, and tells the staff to close it once", async () => {
    const home = mkdtempSync(join(tmpdir(), "overtaken-feed-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "data"));
    const snapshot = join(home, "bearings.json");
    writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\ncat '${snapshot}'\n`, { mode: 0o755 });
    writeFileSync(snapshot, JSON.stringify({ decisions_open: [
      { id: "gnm-sell-step-pick", summary: "Pick a layout for the What do you sell? step" },
      { id: "cap5-hero", summary: "Pick the CapFive hero photo" },
    ] }));
    const hold = (text: string) => `fm-hold-v1:${Buffer.from(text).toString("base64")}`;
    writeFileSync(join(home, "data", "backlog.md"), [
      "# Backlog",
      "",
      "## Captain",
      `- [ ] gnm-sell-step-pick - ${SELL_STEP.label} (repo: good_neighbours) (kind: captain) (since 2026-10-12) (hold: ${hold(SELL_STEP.detail!)}) (hold-kind: captain)`,
      `- [ ] cap5-hero - Pick the CapFive hero photo (repo: cap5) (kind: captain) (since 2026-10-12) (hold: ${hold("George picks the hero photo for the CapFive home page: 1 Boardroom, 2 Skyline")}) (hold-kind: captain)`,
      "",
    ].join("\n"));
    const sent: Array<[string, string]> = [];
    const overtaken = new OvertakenCalls({
      repoPath: (repo) => `/repos/${repo}`,
      readCommits: async (path) => (path === "/repos/good_neighbours" ? SHIPPED : []),
      send: async (note, requestId) => { sent.push([note, requestId]); },
    });
    const feed = new ArtefactFeed({ home, overtaken, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none") });
    await feed.refresh();
    await feed.refresh();
    expect(feed.current().fleet!.calls.map((row) => row.task)).toEqual(["cap5-hero"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]![1]).toMatch(/^flyd-close-[0-9a-f]{12}-gnm-sell-step-pick$/);
    expect(sent[0]![1].length).toBeLessThanOrEqual(125);

    // Firstmate acknowledges with a status line while the hold is still listed: no second close note.
    mkdirSync(join(home, "state"));
    writeFileSync(join(home, "state", "gnm-sell-step-pick.status"), "2026-10-13 noted Flyd's close note\n");
    utimesSync(join(home, "state", "gnm-sell-step-pick.status"), new Date("2026-10-13T12:00:00Z"), new Date("2026-10-13T12:00:00Z"));
    await feed.refresh();
    expect(feed.current().fleet!.calls.map((row) => row.task)).toEqual(["cap5-hero"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]![0]).toMatch(/Polish Christmas site and vendor application across devices/);

    // Core restarts after the status file was touched within the day: the call's age is still read from when it was raised.
    utimesSync(join(home, "state", "gnm-sell-step-pick.status"), new Date("2026-10-17T05:00:00Z"), new Date("2026-10-17T05:00:00Z"));
    const restarted = new ArtefactFeed({
      home,
      overtaken: new OvertakenCalls({ repoPath: (repo) => `/repos/${repo}`, readCommits: async () => SHIPPED, send: async (note, requestId) => { sent.push([note, requestId]); } }),
      memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none"),
    });
    await restarted.refresh();
    expect(restarted.current().fleet!.calls.map((row) => row.task)).toEqual(["cap5-hero"]);
    expect(sent).toHaveLength(2);
    expect(sent[1]![1]).toBe(sent[0]![1]);

    const refused = new ArtefactFeed({
      home,
      overtaken: new OvertakenCalls({ repoPath: (repo) => `/repos/${repo}`, readCommits: async () => SHIPPED, send: async () => { throw new Error("firstmate did not take Flyd's note"); } }),
      memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none"),
    });
    await refused.refresh();
    expect(refused.current().fleet!.calls.map((row) => row.task)).toEqual(["gnm-sell-step-pick", "cap5-hero"]);
  });

  it("names one raising of a call: a status line keeps it, the call reopened with what changed does not", () => {
    const raised = { ...SELL_STEP, raised: "2026-10-12" };
    expect(callId({ ...raised, at: "2026-10-14T08:00:00Z" })).toBe(callId(raised));
    expect(callId({ ...raised, detail: "George picks between two new layouts." })).not.toBe(callId(raised));
    expect(callId({ ...raised, raised: "2026-10-15" })).not.toBe(callId(raised));
  });
});
