import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ArtefactFeed, composeArtefact, enrichFleet, fleetCounts, landedByDay, memoryHighlights, newsHighlights, parseBacklog, parseBearings,
  pickShots, plainStep, readyStatus, statusNote, tasteHighlights,
} from "../artefact.js";

const BEARINGS = {
  schema: "fm-bearings.v1",
  generated: "2026-10-09T10:56:01Z",
  decisions_open: [{ id: "jev", summary: "Review the Jev decision log: keep or remove it?" }],
  in_flight: [
    { id: "a", state: "working", repo: "flyd", name: "Artefact mode must always show something real", doing: "harness busy (claude-hook)" },
    { id: "b", state: "done", repo: "flyd", name: "Flyd: island filter", doing: "run passed: PR open (publication/CI verification skipped) · run: 01M4G6ETGYAW3BBCHE08D3CKM…" },
    { id: "c", state: "done", repo: "flyd", name: "Refresh the PR branches", doing: "76 MERGED green https://github.com/GeorgeGally/flyd/pull/76" },
    { id: "d", state: "failed", repo: "gnm", name: "Admin redesign", doing: "run failed · run: 01M4FXNW61Q43HXE710WXSB279" },
  ],
  landed: [{ id: "flyd-show-mode", what: "Flyd: visual show mode", artifact: "https://github.com/GeorgeGally/flyd/pull/79" }],
  gates: [{ id: "flyd-icon-led", title: "Add a subtle flat green light to the Flyd icon", blocked_by: "-" }],
  recorded_prs: [{ id: "b", url: "https://github.com/GeorgeGally/flyd/pull/70" }],
};

describe("parseBearings", () => {
  it("maps firstmate's snapshot to calls, live, ready, landed, held and next, said plainly", () => {
    const fleet = parseBearings(BEARINGS);
    expect(fleet.generated).toBe("2026-10-09T10:56:01Z");
    expect(fleet.unavailable).toBeUndefined();
    expect(fleet.calls).toEqual([{ label: "Review the Jev decision log: keep or remove it?", task: "jev" }]);
    expect(fleet.live).toEqual([{ label: "Artefact mode must always show something real", task: "a", detail: "Working on it now", repo: "flyd" }]);
    expect(fleet.ready).toEqual([{
      label: "Flyd: island filter", task: "b", detail: "PR open; its checks passed", repo: "flyd", url: "https://github.com/GeorgeGally/flyd/pull/70", status: "PR open",
    }]);
    expect(fleet.landed).toEqual([
      { label: "Refresh the PR branches", task: "c", detail: "#76 merged green", repo: "flyd", url: "https://github.com/GeorgeGally/flyd/pull/76", status: "merged" },
      { label: "Flyd: visual show mode", task: "flyd-show-mode", repo: "flyd", url: "https://github.com/GeorgeGally/flyd/pull/79", status: "landed" },
    ]);
    expect(fleet.held).toEqual([{ label: "Admin redesign", task: "d", detail: "The run failed", repo: "gnm", status: "failed" }]);
    expect(fleet.next).toEqual([{ label: "Add a subtle flat green light to the Flyd icon", task: "flyd-icon-led", status: "queued" }]);
    expect(fleetCounts(fleet)).toEqual({ call: 1, live: 1, ready: 1, landed: 2, waiting: 1, next: 1 });
  });

  it("says firstmate's run notes in plain words", () => {
    expect(plainStep("harness state unavailable (unknown missing)")).toBe("No word from the worker");
    expect(plainStep("ready in branch fm/capfive-lab")).toBe("Ready on branch fm/capfive-lab");
    expect(plainStep("PR https://github.com/GeorgeGally/capfive/pull/3 rebased onto main and pushed; mergeable; …")).toBe("PR #3 rebased onto main and pushed; mergeable…");
    expect(plainStep("76 MERGED green https://github.com/GeorgeGally/flyd/pull/76 | 71 MERGED green https://gith…")).toBe("#76 merged green; #71 merged green…");
    expect(readyStatus("PR https://github.com/x/y/pull/53 checks green")).toBe("checks green");
    expect(readyStatus("branch fm/x (commit d61805e0c) replaces deal auto-load")).toBe("on its branch");
  });

  it("turns a worker's status line into one sentence without file paths", () => {
    const line = "paused [at=1791595000]: captain review done (first-person paragraphs); screenshot /private/tmp/x/card.jpg; waiting on captain";
    expect(statusNote(line)).toBe("Captain review done (first-person paragraphs); waiting on captain");
    expect(statusNote(`working: ${"word ".repeat(60)}`).length).toBeLessThanOrEqual(180);
  });

  it("says plainly when the snapshot is not the expected shape", () => {
    expect(parseBearings({ schema: "something-else" }).unavailable).toContain("something-else");
    expect(parseBearings("not json").unavailable).toBeTruthy();
  });
});

describe("the backlog", () => {
  const BACKLOG = [
    "## In flight",
    "- [ ] jev - Review the Jev decision log: did Jev change or improve firstmate decisions? keep or remove the rule (kind: task) (since 2026-09-25) (hold: Review after ~20 real decisions; captain decides keep or remove) (hold-kind: captain)",
    "- [ ] a - Artefact mode must always show something real, with screenshots and graphs from every task (repo: flyd) (kind: ship)",
    "## Done",
    "- [x] flyd-show-mode - Flyd: visual show mode https://github.com/GeorgeGally/flyd/pull/79 (repo: flyd) (kind: ship) (merged 2026-10-09)",
    "- [x] old - Something long ago (done 2026-09-01)",
  ].join("\n");

  it("reads full titles, a hold's ask and finish days by task id", () => {
    const entries = parseBacklog(BACKLOG);
    expect(entries.get("jev")).toEqual({
      title: "Review the Jev decision log: did Jev change or improve firstmate decisions? keep or remove the rule",
      hold: "Review after ~20 real decisions; captain decides keep or remove",
    });
    expect(entries.get("flyd-show-mode")).toEqual({ title: "Flyd: visual show mode", finished: "2026-10-09" });
  });

  it("says bearings' shortened lines whole and puts the ask under a call", () => {
    const fleet = parseBearings({
      ...BEARINGS,
      decisions_open: [{ id: "jev", summary: "Review the Jev decision log: did Jev change or improve firstmate decisions? keep or remove th…" }],
      in_flight: [{ id: "a", state: "working", repo: "flyd", name: "Artefact mode must always show something real, with screen…", doing: "harness busy" }],
    });
    const extras = new Map([["a", { at: "2026-10-10T01:00:00.000Z", shots: ["shots/after.png"] }]]);
    const whole = enrichFleet(fleet, parseBacklog(BACKLOG), extras);
    expect(whole.calls[0]).toMatchObject({
      label: "Review the Jev decision log: did Jev change or improve firstmate decisions? keep or remove the rule",
      detail: "Review after ~20 real decisions; captain decides keep or remove",
    });
    expect(whole.live[0]).toMatchObject({
      label: "Artefact mode must always show something real, with screenshots and graphs from every task",
      at: "2026-10-10T01:00:00.000Z",
      shots: ["shots/after.png"],
    });
  });

  it("counts what landed on each of the last seven days", () => {
    const days = landedByDay(parseBacklog(BACKLOG), Date.parse("2026-10-10T12:00:00Z"));
    expect(days).toHaveLength(7);
    expect(days.at(-1)).toEqual({ day: "2026-10-10", count: 0 });
    expect(days.find((day) => day.day === "2026-10-09")).toEqual({ day: "2026-10-09", count: 1 });
  });

  it("shows after shots first, then the newest", () => {
    expect(pickShots([
      { path: "shots/before-home.png", mtime: 3 },
      { path: "notes.md", mtime: 9 },
      { path: "shots/after-home.png", mtime: 1 },
      { path: "old.png", mtime: 2 },
      { path: "new.jpg", mtime: 5 },
    ])).toEqual(["shots/after-home.png", "new.jpg", "old.png"]);
  });
});

describe("member reads", () => {
  it("takes the newest open commitment from memory that is still fresh", () => {
    const md = "# Flyd memory\n\n## Commitments\n- George wants Bloom finished, not just launched. <!--p:2026-10-08-->\n- Second one.\n- Stale one. <!--p:2026-09-01-->\n";
    const now = Date.parse("2026-10-10T00:00:00Z");
    expect(memoryHighlights(md, now)).toEqual(["Second one."]);
    expect(memoryHighlights("## Commitments\n- Fresh. <!--p:2026-10-08-->\n- Old. <!--p:2026-09-01-->\n", now)).toEqual(["Fresh."]);
    expect(memoryHighlights("# Flyd memory\n\n## Lately\n- something\n")).toEqual([]);
  });

  it("takes the first relevant news item", () => {
    const edition = { items: [{ kind: "watching", title: "skip" }, { kind: "relevant", title: "Hybrid RAG", url: "https://x.test/1", why: "speaks to your search" }] };
    expect(newsHighlights(edition)).toEqual([{ title: "Hybrid RAG", url: "https://x.test/1", why: "speaks to your search" }]);
  });

  it("reads taste rules, not their quotes", () => {
    const md = "## Everywhere\n\n- No eyebrow/kicker label above a headline. <!--taste:x-->\n  - \"we don't need the eyebrow\" — Claude Code\n- Colour alone marks the active item. <!--taste:y-->\n";
    expect(tasteHighlights(md)).toEqual(["No eyebrow/kicker label above a headline.", "Colour alone marks the active item."]);
  });
});

describe("composeArtefact", () => {
  it("builds one line per input, fleet first, in Flyd's own kinds", () => {
    const items = composeArtefact({
      fleet: parseBearings(BEARINGS),
      memories: ["George wants Bloom finished."],
      news: [{ title: "Hybrid RAG", url: "https://x.test/1", why: "speaks to your search" }],
      taste: ["No eyebrow above a headline."],
    });
    expect(items.map((item) => [item.kind, item.headline])).toEqual([
      ["call", "Review the Jev decision log: keep or remove it?"],
      ["live", "Artefact mode must always show something real"],
      ["ready", "Island filter"],
      ["landed", "Refresh the PR branches"],
      ["landed", "Visual show mode"],
      ["waiting", "Admin redesign"],
      ["next", "Add a subtle flat green light to the Flyd icon"],
      ["news", "George wants Bloom finished."],
      ["news", "Hybrid RAG"],
    ]);
    expect(items[0]!.why).toBe("");
    expect(items[2]).toMatchObject({ project: "flyd", status: "PR open", detail: "PR open; its checks passed" });
    expect(items[4]!.links).toEqual([{ label: "flyd #79", url: "https://github.com/GeorgeGally/flyd/pull/79" }]);
    expect(items[7]).toMatchObject({ why: "from your memory" });
  });

  it("names work by his own project and links its screenshots", () => {
    const fleet = parseBearings(BEARINGS);
    fleet.live[0] = { ...fleet.live[0]!, shots: ["shots/after home.png"] };
    const items = composeArtefact({ fleet, memories: [], news: [], taste: [] }, { project: (repo) => (repo === "flyd" ? "Flyd" : undefined) });
    expect(items[1]).toMatchObject({
      project: "Flyd",
      shots: [{ src: "/api/artefact-shot?task=a&file=shots%2Fafter%20home.png", label: "after home.png" }],
    });
  });

  it("says so plainly when the fleet snapshot could not be read", () => {
    const items = composeArtefact({ fleet: { unavailable: "timed out", calls: [], live: [], ready: [], landed: [], held: [], next: [] }, memories: [], news: [], taste: [] });
    expect(items[0]).toMatchObject({ kind: "news", why: "fleet status unknown" });
    expect(items[0]!.headline).toContain("timed out");
  });
});

describe("ArtefactFeed", () => {
  it("reads memory, news and taste, and reports a missing snapshot honestly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "artefact-feed-"));
    writeFileSync(join(dir, "MEMORY.md"), "## Commitments\n- Ship the artefact panel.\n");
    writeFileSync(join(dir, "edition.json"), JSON.stringify({ items: [{ kind: "relevant", title: "A story" }] }));
    writeFileSync(join(dir, "TASTE.md"), "## Everywhere\n- Plain and spare.\n");
    const feed = new ArtefactFeed({ home: join(dir, "no-firstmate-here"), memoryFile: join(dir, "MEMORY.md"), newsFile: join(dir, "edition.json"), tasteFile: join(dir, "TASTE.md") });
    await feed.refresh();
    const inputs = feed.current();
    expect(inputs.fleet?.unavailable).toBeTruthy();
    expect(inputs.memories).toEqual(["Ship the artefact panel."]);
    expect(inputs.news).toEqual([{ title: "A story", url: undefined, why: undefined }]);
    expect(inputs.taste).toEqual(["Plain and spare."]);
  });

  it("serves only the screenshots it listed for a task", async () => {
    const home = mkdtempSync(join(tmpdir(), "artefact-home-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "state"));
    mkdirSync(join(home, "data", "a", "shots"), { recursive: true });
    writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\necho '${JSON.stringify(BEARINGS)}'\n`, { mode: 0o755 });
    writeFileSync(join(home, "state", "a.status"), "working: building the scene\n");
    writeFileSync(join(home, "data", "a", "shots", "after.png"), "png");
    writeFileSync(join(home, "data", "a", "notes.md"), "notes");
    writeFileSync(join(home, "data", "backlog.md"), "- [x] flyd-show-mode - Flyd: visual show mode (merged 2026-10-09)\n");
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none") });
    await feed.refresh();
    const live = feed.current().fleet!.live[0]!;
    expect(live.shots).toEqual(["shots/after.png"]);
    expect(live.at).toBeTruthy();
    expect(feed.current().landedByDay).toHaveLength(7);
    expect(feed.shotPath("a", "shots/after.png")).toBe(join(home, "data", "a", "shots", "after.png"));
    expect(feed.shotPath("a", "notes.md")).toBeNull();
    expect(feed.shotPath("a", "../../state/a.status")).toBeNull();
    expect(feed.shotPath("b", "shots/after.png")).toBeNull();
  });
});
