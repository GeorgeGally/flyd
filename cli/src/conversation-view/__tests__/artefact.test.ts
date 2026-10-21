import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ArtefactVoice, voiceKey } from "../artefact-voice.js";
import { semanticObjectFromShow } from "../semantic.js";
import {
  ArtefactFeed, composeArtefact, enrichFleet, fleetCounts, holdReason, isCurrentDecision, landedByDay, memoryHighlights, newsHighlights, parseBacklog, parseBearings,
  pickShots, plainStep, readyStatus, statusNote, tasteHighlights, decisionChoices, plainQuestion, recommendedChoice, withVoice, deviceOf, recentlyFinished, landedRows, referencedDirs,
  callItems, doneItems, underwayItems, workerStarted, weekLandedRows,
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
    expect(fleet.live).toEqual([{ label: "Artefact mode must always show something real", task: "a", detail: "A worker is on it", repo: "flyd" }]);
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

describe("what needs him", () => {
  const NOW = Date.parse("2026-10-17T03:00:00Z");
  const fleet = parseBearings({ decisions_open: [
    { id: "fm-handover", summary: "Smoother handover between firstmate sessions" },
    { id: "read-me", summary: "Flyd: what the 3 new commits do (artefact ready to read): Read: what they do" },
    { id: "report", summary: "Flyd: five deep ways to get smarter (report + artefact): Read: five ways" },
    { id: "remind", summary: "Remind captain this afternoon: finish the lab" },
    { id: "pick", summary: "Pick a look" },
  ] });
  const hold = "Captain picks: 1 Evergreen, 2 Fairy-light";
  const backlog = parseBacklog(`- [ ] pick - Pick a look (hold: fm-hold-v1:${Buffer.from(hold).toString("base64")})`);

  it("drops reads, reports, reminders and holds nobody ever reported, which are not decisions", () => {
    const calls = enrichFleet(fleet, backlog, new Map(), NOW).calls.map((row) => row.task);
    expect(calls).not.toContain("read-me");
    expect(calls).not.toContain("report");
    expect(calls).not.toContain("remind");
    // No report time, no backlog date and nothing to answer: not a call, not kept.
    expect(calls).not.toContain("fm-handover");
    expect(calls).toEqual(["pick"]);
  });
  it("drops a call with no time at all unless it has options to answer", () => {
    expect(isCurrentDecision({ label: "No word on it" }, NOW)).toBe(false);
    expect(isCurrentDecision({ label: "No word on it", choices: ["Keep", "Remove"] }, NOW)).toBe(true);
  });
  it("drops an old hold with nothing to answer but keeps an old one with options", () => {
    const old = { at: "2026-10-11T02:44:00Z" };
    const extras = new Map([["fm-handover", old], ["pick", old]]);
    const calls = enrichFleet(fleet, backlog, extras, NOW).calls.map((row) => row.task);
    expect(calls).toEqual(["pick"]);
  });
  it("keeps a recent hold with nothing to answer", () => {
    const extras = new Map([["fm-handover", { at: "2026-10-16T02:44:00Z" }]]);
    expect(enrichFleet(fleet, backlog, extras, NOW).calls.map((row) => row.task)).toContain("fm-handover");
  });
});

describe("the backlog", () => {
  it("keeps the earlier design question answerable beside active Christmas work, without turning a scout report into a new design awaiting landing", () => {
    const question = "Picks the direction (board http://127.0.0.1:4387/session/review): 1 Evergreen luxe (recommended after round 1: green plus luxury), 2 Fairy-light night, 3 Red letter day, 4 Christmas in the tropics, 5 Christmas card, or a mix.";
    const entries = parseBacklog([
      `- [ ] visuals - Choose a Christmas look (repo: good_neighbours) (hold: fm-hold-v1:${Buffer.from(question).toString("base64")})`,
      "- [ ] preview - Find the new Good Neighbours design (repo: good_neighbours) (kind: scout)",
      "- [ ] edits - Good Neighbours Christmas: live edits (repo: good_neighbours)",
      "  Christmas market at Block42, Nuanu, christmas-2026. Preview http://127.0.0.1:8097/ has local edits newer than merged work.",
      "- [x] interface - Christmas site interface (repo: good_neighbours) (merged 2026-10-10)",
    ].join("\n"));
    const fleet = enrichFleet(parseBearings({ decisions_open: [{ id: "visuals", summary: "Pick a look" }], in_flight: [{ id: "preview", name: "Find the new Good Neighbours design", repo: "good_neighbours", kind: "scout", state: "done", doing: "new design is draft PR" }] }), entries);
    expect(fleet.calls).toHaveLength(1);
    expect(fleet.calls[0]!.context).toContain("Block42, Nuanu");
    const busy = enrichFleet(parseBearings({ decisions_open: [{ id: "visuals", summary: "Pick a look" }] }), entries, new Map([["edits", { note: "Recolouring the header" }]]));
    expect(busy.calls[0]!.context).toBe(fleet.calls[0]!.context);
    expect(fleet.ready[0]!.status).toBe("report available");
    expect(fleetCounts(fleet).ready).toBe(0);
    const { unsaid } = withVoice(fleet, () => undefined);
    expect(unsaid.find((row) => row.kind === "report available")!.context).toContain("newer than merged work");
    const items = composeArtefact({ fleet, memories: [], news: [], taste: [] });
    expect(items[0]!.decision).toEqual({ task: "visuals", question, choices: ["Evergreen luxe", "Fairy-light night", "Red letter day", "Christmas in the tropics", "Christmas card"], recommended: "Evergreen luxe" });
    // The question leads in plain words, the options left to the buttons; the work it is about sits under it.
    expect(items[0]!.headline).toBe("Picks the direction");
    expect(items[0]!.detail).toBe("Choose a Christmas look");
    expect(items[0]!.links).toEqual([{ label: "Open design review", url: "http://127.0.0.1:4387/session/review" }]);
    expect(items[1]!.kind).toBe("news");
    expect(decisionChoices("Choose one of five directions")).toEqual([]);
  });
  it("puts a hold's question to him in plain words, with the option it recommends", () => {
    const hold = "Captain picks the Christmas direction for the site from the lab (board http://127.0.0.1:4387/session/a4f0, report data/gnm-christmas-lab/report.md): 1 Evergreen luxe (recommended after round 1: green plus boutique-fair luxury), 2 Fairy-light night, 3 Red letter day, or a mix.";
    expect(plainQuestion(hold)).toBe("Pick the Christmas direction for the site from the lab");
    expect(recommendedChoice(hold)).toBe("Evergreen luxe");
    expect(plainQuestion("Captain chooses: 1 A, 2 B")).toBe("Choose");
    expect(recommendedChoice("1 A, 2 B")).toBeUndefined();
  });
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
      since: "2026-09-25",
    });
    expect(entries.get("flyd-show-mode")).toEqual({ title: "Flyd: visual show mode", url: "https://github.com/GeorgeGally/flyd/pull/79", repo: "flyd", finished: "2026-10-09" });
  });

  it("says bearings' shortened lines whole and puts the ask under a call", () => {
    const fleet = parseBearings({
      ...BEARINGS,
      decisions_open: [{ id: "jev", summary: "Review the Jev decision log: did Jev change or improve firstmate decisions? keep or remove th…" }],
      in_flight: [{ id: "a", state: "working", repo: "flyd", name: "Artefact mode must always show something real, with screen…", doing: "harness busy" }],
    });
    const extras = new Map([["a", { at: "2026-10-10T01:00:00.000Z", shots: ["shots/after.png"] }], ["jev", { at: "2026-10-16T01:00:00.000Z" }]]);
    const whole = enrichFleet(fleet, parseBacklog(BACKLOG), extras, Date.parse("2026-10-17T00:00:00Z"));
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

  it("gives the week's figure every piece of work behind it, uncapped, and none outside the week", () => {
    const rows = weekLandedRows(parseBacklog(BACKLOG), Date.parse("2026-10-10T12:00:00Z"));
    expect(rows).toEqual([{ label: "Flyd: visual show mode", task: "flyd-show-mode", status: "landed", at: "2026-10-09", url: "https://github.com/GeorgeGally/flyd/pull/79", repo: "flyd" }]);
    expect(weekLandedRows(parseBacklog(BACKLOG), Date.parse("2026-10-20T12:00:00Z"))).toEqual([]);
  });

  it("says a captain hold's encoded reason in plain words, never the marker", () => {
    expect(holdReason("fm-hold-v1:Q2FwdGFpbiBwaWNrcyB0aGUgQ2hyaXN0bWFz")).toBe("Captain picks the Christmas");
    expect(holdReason("fm-hold-v1:not base64!")).toBe("");
    expect(holdReason("fm-hold-v1://79")).toBe("");
    expect(holdReason("waiting on the captain")).toBe("waiting on the captain");
    const entries = parseBacklog("- [ ] gnm-lab - Christmas lab direction (hold: fm-hold-v1:Q2FwdGFpbiBwaWNrcyB0aGUgQ2hyaXN0bWFz)\n- [ ] bad - Broken hold (hold: fm-hold-v1:%%%)");
    expect(entries.get("gnm-lab")).toEqual({ title: "Christmas lab direction", hold: "Captain picks the Christmas" });
    expect(entries.get("bad")).toEqual({ title: "Broken hold" });
  });

  it("shows after shots first, then the newest", () => {
    expect(pickShots([
      { path: "shots/before-home.png", mtime: 3 },
      { path: "notes.md", mtime: 9 },
      { path: "shots/after-home.png", mtime: 1 },
      { path: "old.png", mtime: 2 },
      { path: "new.jpg", mtime: 5 },
    ])).toEqual(["shots/after-home.png", "new.jpg", "old.png", "shots/before-home.png"]);
  });

  it("leads with the desktop and phone captures, so the screen can show the pair, and skips icons and what the captain sent in", () => {
    expect(pickShots([
      { path: "ipad.png", mtime: 9, size: 400_000 },
      { path: "phone.png", mtime: 8, size: 300_000 },
      { path: "w-row.png", mtime: 7, size: 300_000 },
      { path: "desktop-1440.png", mtime: 6, size: 900_000 },
      { path: "lab/assets/glint.png", mtime: 10, size: 2_000 },
      { path: "captain-screenshot.png", mtime: 11, size: 500_000 },
    ])).toEqual(["desktop-1440.png", "phone.png", "ipad.png", "w-row.png"]);
    expect(deviceOf("shots/final-phone-invite.png")).toBe("phone");
    expect(deviceOf("days-390.png")).toBe("phone");
    expect(deviceOf("track-desktop-screens.png")).toBe("desktop");
    expect(deviceOf("space-820.png")).toBe("tablet");
    expect(deviceOf("shot-2026-10-10.png")).toBeUndefined();
    expect(deviceOf("after.png")).toBeUndefined();
    // A composite names more than one screen: it is its own picture, never one of them.
    expect(deviceOf("gnm-desktop-and-phone.png")).toBeUndefined();
  });

  it("finds the work that finished in the last few days, newest first, archive rows included", () => {
    const archive = parseBacklog([
      "- [x] gnm-old - Good Neighbours: an old change https://github.com/GeorgeGally/good-neighbours/pull/1 (repo: good_neighbours) (merged 2026-10-01)",
      "- [x] gnm-xmas-map - Good Neighbours: remake the Nuanu map https://github.com/GeorgeGally/good-neighbours/pull/4 (repo: good_neighbours) (merged 2026-10-10)",
      "- [x] gnm-tickets - Good Neighbours: ticket modal https://github.com/GeorgeGally/good-neighbours/pull/14 (repo: good_neighbours) (merged 2026-10-11)",
      "- [x] gnm-slide - Good Neighbours: page slide-in https://github.com/GeorgeGally/good-neighbours/pull/10 (repo: good_neighbours) (merged 2026-10-10)",
    ].join("\n"));
    const now = Date.parse("2026-10-11T12:00:00Z");
    expect(recentlyFinished(archive, now).map(({ task }) => task)).toEqual(["gnm-tickets", "gnm-slide", "gnm-xmas-map"]);
    const rows = landedRows(recentlyFinished(archive, now), new Map([["gnm-tickets", { shots: ["shots/final-phone-invite.png"] }]]));
    expect(rows).toEqual([{ label: "Good Neighbours: ticket modal", task: "gnm-tickets", status: "landed", repo: "good_neighbours", url: "https://github.com/GeorgeGally/good-neighbours/pull/14" }]);
  });

  it("shows a call the pictures its own words point at", () => {
    const hold = Buffer.from("Captain picks the Christmas direction from the lab (report data/gnm-christmas-lab/report.md): 1 Evergreen, 2 Fairy-light").toString("base64");
    const backlog = parseBacklog(`- [ ] gnm-christmas-visuals - Christmas site direction (repo: good_neighbours) (hold: fm-hold-v1:${hold})`);
    expect(referencedDirs(backlog.get("gnm-christmas-visuals")!)).toEqual(["gnm-christmas-lab"]);
    const fleet = parseBearings({ ...BEARINGS, decisions_open: [{ id: "gnm-christmas-visuals", summary: "Christmas site direction" }] });
    const enriched = enrichFleet(fleet, backlog, new Map([["gnm-christmas-lab", { shots: ["lab/evergreen.png"] }]]));
    expect(enriched.calls[0]).toMatchObject({ shots: ["lab/evergreen.png"], shotDir: "gnm-christmas-lab" });
    const items = composeArtefact({ fleet: enriched, memories: [], news: [], taste: [] });
    expect(items[0]!.shots).toEqual([{ src: "/api/artefact-shot?task=gnm-christmas-lab&file=lab%2Fevergreen.png", label: "evergreen.png" }]);
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

  it("shows the newest of an accumulated group, so older rows never push newer ones off", () => {
    const at = (seconds: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, seconds)).toISOString();
    const fleet = {
      calls: [], live: [], ready: [], held: [], next: [],
      landed: Array.from({ length: 9 }, (_, index) => ({ label: `L${index + 1}`, task: `t${index + 1}`, status: "landed", at: at(index) })),
    };
    const items = composeArtefact({ fleet, memories: [], news: [], taste: [] });
    expect(items.map((item) => item.headline)).toEqual(["L9", "L8", "L7", "L6", "L5", "L4", "L3", "L2"]);
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

  it("omits a fleet it could not read, never saying the reason or the command", () => {
    const empty = { calls: [], live: [], ready: [], landed: [], held: [], next: [] };
    const unreachable = composeArtefact({ fleet: { ...empty, unavailable: "Command failed: /x/fm-bearings-snapshot.sh --json" }, memories: [], news: [], taste: [] });
    expect(unreachable).toEqual([]);
  });

  it("never shows a lone memory line as the screen", () => {
    expect(composeArtefact({ memories: ["Ship the artefact panel."], news: [], taste: [] })).toEqual([]);
    const withFleet = composeArtefact({ fleet: { calls: [{ label: "A call" }], live: [], ready: [], landed: [], held: [], next: [] }, memories: ["A note"], news: [], taste: [] });
    expect(withFleet.map((item) => item.why)).toContain("from your memory");
  });
});

describe("the conversation's lists", () => {
  it("knows when a worker started from firstmate's spawn stamp", () => {
    expect(workerStarted("window=x\nspawn_gen=s1791950032.91729.30301\n")).toBe(new Date(1791950032 * 1000).toISOString());
    expect(workerStarted("window=x\n")).toBeUndefined();
  });

  it("lists every job under way, longest running first, and what landed, newest first", () => {
    const fleet = parseBearings({ ...BEARINGS, in_flight: [
      { id: "a", state: "working", repo: "flyd", name: "Flyd: shrink the island", doing: "harness busy" },
      { id: "b", state: "working", repo: "gnm", name: "Good Neighbours: design report", doing: "harness busy" },
      { id: "c", state: "paused", repo: "gnm", name: "Paused work", doing: "paused" },
    ] });
    fleet.live[0]!.started = "2026-10-14T03:50:00Z";
    fleet.live[1]!.started = "2026-10-14T03:10:00Z";
    expect(underwayItems(fleet).map((item) => [item.task, item.started])).toEqual([["b", "2026-10-14T03:10:00Z"], ["a", "2026-10-14T03:50:00Z"]]);
    const landed = { ...fleet, landed: [{ label: "Old", task: "o", at: "2026-10-12T00:00:00Z" }, { label: "New", task: "n", at: "2026-10-14T00:00:00Z" }] };
    expect(doneItems(landed).map((item) => item.headline)).toEqual(["New", "Old"]);
    expect(doneItems(landed, {}, 1)).toHaveLength(1);
    expect(underwayItems({ ...fleet, unavailable: "no snapshot" })).toEqual([]);
  });
});

describe("ArtefactFeed", () => {
  it("reads the fleet again within seconds when a job reports, not at the next tick", async () => {
    const home = mkdtempSync(join(tmpdir(), "artefact-follow-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "state"));
    const snapshot = join(home, "bearings.json");
    writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\ncat '${snapshot}'\n`, { mode: 0o755 });
    writeFileSync(snapshot, JSON.stringify({ in_flight: [] }));
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none") });
    await feed.refresh();
    expect(feed.current().fleet!.live).toEqual([]);
    const refreshed = new Promise<void>((resolve) => feed.onRefresh(resolve));
    feed.followReports();
    try {
      writeFileSync(snapshot, JSON.stringify({ in_flight: [{ id: "new", state: "working", repo: "flyd", name: "A new job", doing: "harness busy" }] }));
      writeFileSync(join(home, "state", "new.meta"), "spawn_gen=s1791950032.1.1\n");
      writeFileSync(join(home, "state", "new.status"), "working: started\n");
      await refreshed;
      expect(feed.current().fleet!.live).toMatchObject([{ task: "new", started: new Date(1791950032 * 1000).toISOString() }]);
    } finally {
      feed.stop();
    }
  }, 30_000);

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
    writeFileSync(join(home, "data", "a", "shots", "after.png"), Buffer.alloc(20_000));
    writeFileSync(join(home, "data", "a", "icon.png"), "png");
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
    expect(feed.shotPath("a", "icon.png")).toBeNull();
    expect(feed.shotPath("a", "../../state/a.status")).toBeNull();
    expect(feed.shotPath("b", "shots/after.png")).toBeNull();
  });

  it("shows work firstmate archived after it landed, with its pictures, and counts it in the week", async () => {
    const home = mkdtempSync(join(tmpdir(), "artefact-archive-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "data", "gnm-tickets", "shots"), { recursive: true });
    writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\necho '${JSON.stringify(BEARINGS)}'\n`, { mode: 0o755 });
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(join(home, "data", "backlog.md"), "# Backlog\n");
    writeFileSync(join(home, "data", "done-archive.md"), [
      `- [x] gnm-tickets - Good Neighbours: ticket modal https://github.com/GeorgeGally/good-neighbours/pull/14 (repo: good_neighbours) (merged ${today})`,
      `- [x] gnm-words - Good Neighbours: copy only (repo: good_neighbours) (merged ${today})`,
    ].join("\n"));
    writeFileSync(join(home, "data", "gnm-tickets", "shots", "final-phone-invite.png"), Buffer.alloc(20_000));
    writeFileSync(join(home, "data", "gnm-tickets", "shots", "final-desktop-invite.png"), Buffer.alloc(20_000));
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none") });
    await feed.refresh();
    const landed = feed.current().fleet!.landed.find((row) => row.task === "gnm-tickets")!;
    expect(landed).toMatchObject({ label: "Good Neighbours: ticket modal", url: "https://github.com/GeorgeGally/good-neighbours/pull/14", shots: ["shots/final-desktop-invite.png", "shots/final-phone-invite.png"] });
    expect(landed.at).toBeTruthy();
    // Finished work with nothing to show stays in the count, not on the screen.
    expect(feed.current().fleet!.landed.some((row) => row.task === "gnm-words")).toBe(false);
    expect(feed.current().landedByDay!.at(-1)).toEqual({ day: today, count: 2 });
    expect(feed.shotPath("gnm-tickets", "shots/final-phone-invite.png")).toBe(join(home, "data", "gnm-tickets", "shots", "final-phone-invite.png"));
  });

  it("keeps the last words on screen while new ones are asked for, and never lets a slow answer bring back an older read", async () => {
    const home = mkdtempSync(join(tmpdir(), "artefact-voiced-"));
    mkdirSync(join(home, "bin"));
    const snapshot = join(home, "bearings.json");
    writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\ncat '${snapshot}'\n`, { mode: 0o755 });
    const read = (name: string, doing: string) => writeFileSync(snapshot, JSON.stringify({ in_flight: [{ id: "a", state: "working", repo: "flyd", name, doing }] }));
    const answers: Array<(raw: string) => void> = [];
    const asked: string[] = [];
    const voice = new ArtefactVoice({
      cacheFile: join(home, "voice.json"),
      profile: () => null,
      complete: (prompt) => {
        asked.push(prompt);
        return new Promise((resolve) => answers.push(resolve));
      },
    });
    const feed = new ArtefactFeed({ home, voice, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none") });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

    read("Drag and drop documents", "harness busy");
    await feed.refresh();
    const first = { kind: "under way", title: "Drag and drop documents", detail: "A worker is on it", project: "flyd" };
    answers.shift()!(JSON.stringify([{ id: voiceKey(first), headline: "Documents will drop straight into the window.", line: "Nothing for you yet." }]));
    await settle();
    expect(feed.current().fleet!.live[0]!.said?.headline).toBe("Documents will drop straight into the window.");

    read("Drag and drop documents, take two", "harness busy");
    await feed.refresh();
    expect(feed.current().fleet!.live[0]).toMatchObject({ label: "Drag and drop documents, take two", said: { headline: "Documents will drop straight into the window." } });

    read("Drag and drop documents, take three", "harness busy");
    await feed.refresh();
    const second = { ...first, title: "Drag and drop documents, take two" };
    answers.shift()!(JSON.stringify([{ id: voiceKey(second), headline: "Second try at dropping documents.", line: "Still nothing for you." }]));
    await settle();
    expect(feed.current().fleet!.live[0]!.label).toBe("Drag and drop documents, take three");
    expect(asked).toHaveLength(2);
  });

  it("reuses the last good snapshot silently while reads fail, and never says a command or a path", async () => {
    const home = mkdtempSync(join(tmpdir(), "artefact-good-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "state"));
    const script = join(home, "bin", "fm-bearings-snapshot.sh");
    const snapshot = join(home, "bearings.json");
    writeFileSync(snapshot, JSON.stringify({ in_flight: [{ id: "a", state: "working", repo: "flyd", name: "Still going", doing: "harness busy" }] }));
    writeFileSync(script, `#!/bin/sh\ncat '${snapshot}'\n`, { mode: 0o755 });
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none") });
    await feed.refresh();
    expect(feed.current().fleet!.live.map((row) => row.task)).toEqual(["a"]);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // The script now fails: the good snapshot is shown as-is, with no reason leaking to the screen.
      writeFileSync(script, `#!/bin/sh\necho 'Command failed: ${script} --json' >&2\nexit 1\n`, { mode: 0o755 });
      await feed.refresh();
      expect(feed.current().fleet!.live.map((row) => row.task)).toEqual(["a"]);
      expect(feed.current().fleet!.unavailable).toBeUndefined();
      // The reason goes to Flyd's own log only, carrying no command and no path.
      const log = warn.mock.calls.flat().join(" ");
      expect(log).toContain("fleet snapshot unreadable");
      expect(log).not.toContain("fm-bearings");
      expect(log).not.toContain(home);
    } finally {
      warn.mockRestore();
    }
  });

  it("omits the fleet entirely before any good read, keeping the reason off the screen", async () => {
    const home = mkdtempSync(join(tmpdir(), "artefact-none-"));
    const feed = new ArtefactFeed({ home: join(home, "no-firstmate-here"), memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none") });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await feed.refresh();
      // No error card, no line: the fleet is simply absent.
      expect(composeArtefact(feed.current())).toEqual([]);
      expect(warn.mock.calls.flat().join(" ")).toContain("fleet snapshot unreadable");
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps an unread fleet marked unread however long reads fail", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const home = mkdtempSync(join(tmpdir(), "artefact-stale-"));
      mkdirSync(join(home, "bin"));
      mkdirSync(join(home, "state"));
      writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
      const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none") });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await feed.refresh();
        expect(feed.current().fleet!.unavailable).toBe("unreadable");
        vi.setSystemTime(Date.now() + 31 * 60 * 1000);
        await feed.refresh();
        expect(feed.current().fleet!.unavailable).toBe("unreadable");
        expect(composeArtefact(feed.current())).toEqual([]);
      } finally {
        warn.mockRestore();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up on a read that overruns its timeout and keeps it off the screen", async () => {
    const home = mkdtempSync(join(tmpdir(), "artefact-timeout-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "state"));
    writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), "#!/bin/sh\nsleep 1\necho '{\"in_flight\":[]}'\n", { mode: 0o755 });
    const feed = new ArtefactFeed({ home, timeoutMs: 50, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none") });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await feed.refresh();
      expect(feed.current().fleet!.unavailable).toBe("unreadable");
      expect(composeArtefact(feed.current())).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  }, 30_000);

  it("keeps the list on disk, so a restart shows the same screen even when the read fails", async () => {
    const home = mkdtempSync(join(tmpdir(), "artefact-ledger-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "state"));
    const script = join(home, "bin", "fm-bearings-snapshot.sh");
    const snapshot = join(home, "bearings.json");
    writeFileSync(script, `#!/bin/sh\ncat '${snapshot}'\n`, { mode: 0o755 });
    writeFileSync(snapshot, JSON.stringify({ in_flight: [{ id: "a", state: "working", repo: "flyd", name: "Keep me", doing: "harness busy" }] }));
    const options = { home, artefactsFile: join(home, "artefacts.json"), memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none") };
    const feed = new ArtefactFeed(options);
    await feed.refresh();
    expect(feed.current().fleet!.live.map((row) => row.task)).toEqual(["a"]);

    // A fresh start reads the list from disk, not a live snapshot: the first screen is the one he last saw.
    writeFileSync(script, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const rebooted = new ArtefactFeed(options);
      await rebooted.refresh();
      expect(rebooted.current().fleet!.live.map((row) => row.task)).toEqual(["a"]);
      expect(rebooted.current().fleet!.unavailable).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it("adds new artefacts, updates one in place and drops none on a failed read", async () => {
    const home = mkdtempSync(join(tmpdir(), "artefact-list-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "state"));
    const script = join(home, "bin", "fm-bearings-snapshot.sh");
    const snapshot = join(home, "bearings.json");
    writeFileSync(script, `#!/bin/sh\ncat '${snapshot}'\n`, { mode: 0o755 });
    writeFileSync(snapshot, JSON.stringify({ in_flight: [{ id: "a", state: "working", repo: "flyd", name: "First", doing: "harness busy" }] }));
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none") });
    await feed.refresh();
    expect(feed.current().fleet!.live.map((row) => row.task)).toEqual(["a"]);

    // A second job is added after the first; the first is updated in place and keeps its place.
    writeFileSync(snapshot, JSON.stringify({ in_flight: [
      { id: "a", state: "working", repo: "flyd", name: "First, renamed", doing: "harness busy" },
      { id: "b", state: "working", repo: "flyd", name: "Second", doing: "harness busy" },
    ] }));
    await feed.refresh();
    expect(feed.current().fleet!.live.map((row) => row.task)).toEqual(["a", "b"]);
    expect(feed.current().fleet!.live[0]!.label).toBe("First, renamed");

    // A failed read leaves the list exactly as it was, with nothing dropped.
    writeFileSync(script, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await feed.refresh();
      expect(feed.current().fleet!.live.map((row) => row.task)).toEqual(["a", "b"]);
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps a call a background refresh no longer reports in place as settled, with nothing to act on", async () => {
    const home = mkdtempSync(join(tmpdir(), "artefact-closed-call-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "data"));
    const script = join(home, "bin", "fm-bearings-snapshot.sh");
    const snapshot = join(home, "bearings.json");
    writeFileSync(script, `#!/bin/sh\ncat '${snapshot}'\n`, { mode: 0o755 });
    writeFileSync(snapshot, JSON.stringify({ decisions_open: [{ id: "x", summary: "Pick one" }] }));
    writeFileSync(join(home, "data", "backlog.md"), "- [ ] x - Pick one (hold: Choose a color: 1 Red, 2 Blue)\n");
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none") });
    await feed.refresh();
    expect(feed.current().fleet!.calls).toMatchObject([{ label: "Pick one", task: "x" }]);
    const before = composeArtefact(feed.current());
    const asked = before.findIndex((item) => item.id === "call:call-x");
    expect(before[asked]).toMatchObject({ kind: "call", decision: { task: "x" } });
    writeFileSync(snapshot, JSON.stringify({ decisions_open: [] }));
    await feed.refresh();
    const fleet = feed.current().fleet!;
    expect(fleet.calls[0]).toMatchObject({ task: "x", ledgerOnly: true });
    expect(fleetCounts(fleet).call).toBe(0);
    expect(callItems(fleet)).toEqual([]);
    const after = composeArtefact(feed.current());
    expect(after.map((item) => item.id)).toEqual(before.map((item) => item.id));
    expect(after[asked]).toMatchObject({ kind: "clear", headline: before[asked]!.headline, detail: "Settled, nothing needed." });
    expect(after[asked]!.decision).toBeUndefined();
    expect(after.some((item) => item.kind === "call")).toBe(false);
  });

  it("keeps a settled call in its place among open calls, past the open-call limit, as resolved work", () => {
    const call = (task: string, at: string, ledgerOnly = false) => ({ label: `Call ${task}`, task, at, choices: ["Red", "Blue"], ...(ledgerOnly ? { ledgerOnly } : {}) });
    const open = ["b", "c", "d"].map((task, index) => call(task, `2026-10-2${index}T00:00:00Z`));
    const inputs = (calls: ReturnType<typeof call>[]) => ({ memories: [], news: [], taste: [], fleet: { calls, live: [], ready: [], landed: [], held: [], next: [] } });
    const before = composeArtefact(inputs([...open, call("a", "2026-10-23T00:00:00Z")]));
    const after = composeArtefact(inputs([...open, call("e", "2026-10-18T00:00:00Z"), call("a", "2026-10-23T00:00:00Z", true)]));
    expect(before.map((item) => item.id)).toEqual(["call:call-a", "call:call-d", "call:call-c", "call:call-b"]);
    expect(after.map((item) => item.id)).toEqual(["call:call-a", "call:call-d", "call:call-c", "call:call-b", "call:call-e"]);
    const settled = after.find((item) => item.id === "call:call-a")!;
    expect(settled).toMatchObject({ kind: "clear", detail: "Settled, nothing needed." });
    expect(settled.decision).toBeUndefined();
    expect(semanticObjectFromShow(settled)).toMatchObject({ lifecycle: "resolved", activity: { phase: "finished" }, actions: [] });
  });

  it("keeps an actionable call on screen after a failed read", async () => {
    const home = mkdtempSync(join(tmpdir(), "artefact-failed-call-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "data"));
    const script = join(home, "bin", "fm-bearings-snapshot.sh");
    const snapshot = join(home, "bearings.json");
    writeFileSync(script, `#!/bin/sh\ncat '${snapshot}'\n`, { mode: 0o755 });
    writeFileSync(snapshot, JSON.stringify({ decisions_open: [{ id: "x", summary: "Pick one" }] }));
    writeFileSync(join(home, "data", "backlog.md"), "- [ ] x - Pick one (hold: Choose a color: 1 Red, 2 Blue)\n");
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none") });
    await feed.refresh();
    expect(feed.current().fleet!.calls).toMatchObject([{ label: "Pick one", task: "x" }]);
    writeFileSync(script, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await feed.refresh();
      const fleet = feed.current().fleet!;
      expect(fleet.calls[0]).toMatchObject({ task: "x" });
      expect(fleet.calls[0]!.ledgerOnly).toBeUndefined();
      expect(fleetCounts(fleet).call).toBe(1);
      expect(callItems(fleet)).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("shows recently finished work even when the fleet read fails", async () => {
    const home = mkdtempSync(join(tmpdir(), "artefact-recent-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "state"));
    mkdirSync(join(home, "data", "t1", "shots"), { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(join(home, "data", "backlog.md"), "# Backlog\n");
    writeFileSync(join(home, "data", "done-archive.md"), `- [x] t1 - Something shipped (merged ${today})\n`);
    writeFileSync(join(home, "data", "t1", "shots", "final.png"), Buffer.alloc(20_000));
    writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none") });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await feed.refresh();
      expect(feed.current().fleet!.landed.map((row) => row.task)).toEqual(["t1"]);
    } finally {
      warn.mockRestore();
    }
  });

  it("never pushes a newly queued item off screen behind older ones", async () => {
    const home = mkdtempSync(join(tmpdir(), "artefact-gates-"));
    mkdirSync(join(home, "bin"));
    const snapshot = join(home, "bearings.json");
    writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\ncat '${snapshot}'\n`, { mode: 0o755 });
    const gates = (ids: string[]) => JSON.stringify({ gates: ids.map((id) => ({ id, title: `Gate ${id}`, blocked_by: "-" })) });
    writeFileSync(snapshot, gates(["g4", "g3", "g2", "g1"]));
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none") });
    await feed.refresh();
    writeFileSync(snapshot, gates(["g5", "g4", "g3", "g2", "g1"]));
    await feed.refresh();
    const next = composeArtefact(feed.current()).filter((item) => item.kind === "next").map((item) => item.headline);
    expect(next).toEqual(["Gate g5", "Gate g4", "Gate g3"]);
  });

  it("keeps an open decision in Needs you when the work it is about has also finished", async () => {
    const home = mkdtempSync(join(tmpdir(), "artefact-collision-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "data"));
    const snapshot = join(home, "bearings.json");
    writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\ncat '${snapshot}'\n`, { mode: 0o755 });
    writeFileSync(snapshot, JSON.stringify({
      decisions_open: [{ id: "x", summary: "Do the thing" }],
      in_flight: [{ id: "x", state: "done", name: "Do the thing", doing: "run passed" }],
    }));
    writeFileSync(join(home, "data", "backlog.md"), "- [ ] x - Do the thing (hold: Pick one: 1 Evergreen, 2 Fairy-light)\n");
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none") });
    await feed.refresh();
    expect(feed.current().fleet!.calls.map((row) => row.task)).toEqual(["x"]);
    expect(feed.current().fleet!.ready.some((row) => row.task === "x")).toBe(false);
  });
});
