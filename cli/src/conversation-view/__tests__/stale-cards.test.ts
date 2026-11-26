import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { labAwaitingReview } from "../../command/design.js";
import { firstmateTasksOfRun, retireRun, settleClosedRuns } from "../../command/run-closure.js";
import { readDomainRun, saveDomainRun } from "../../command/store.js";
import type { DomainRun } from "../../command/types.js";
import { sourceEventKey } from "../../intelligence/executive/firstmate-decision.js";
import { ArtefactFeed, callItems, enrichFleet, firstmateChangesFromFleet, parseBacklog, pinnedQuestions, withCurrentCalls, type ArtefactRow, type FleetArtefact } from "../artefact.js";
import { cardSource, fallbackWords, translateCard } from "../card-words.js";
import type { HoldCheck, HoldState } from "../hold-check.js";
import { jobRunFromDomain, jobsFrom } from "../jobs.js";
import { askingRuns, retireCard, shownCalls } from "../retire.js";
import { RetiredCards } from "../retired-cards.js";
import { IslandRung, islandStatusOf } from "../status.js";

// George, 14 Nov 2026: "flyd keeps giving me these cards with jobs that have
// moved on. asking micro decisions." Each case below is one card he was shown
// (firstmate data/stale-cards-why/report.md, examples E1-E8), and what now
// keeps it from him.

const NOW = Date.parse("2026-11-14T12:00:00Z");
const DAY = 86_400_000;
const hold = (text: string) => `fm-hold-v1:${Buffer.from(text).toString("base64")}`;
const emptyFleet = (patch: Partial<FleetArtefact> = {}): FleetArtefact => ({ calls: [], live: [], ready: [], landed: [], held: [], next: [], changes: [], ...patch });

function run(id: string, patch: Partial<DomainRun> = {}, request: Partial<DomainRun["request"]> = {}): DomainRun {
  return {
    id,
    owner: "coding",
    status: "needs_decision",
    createdAt: "2026-10-20T03:00:00Z",
    updatedAt: "2026-10-20T03:36:35Z",
    transport: { kind: "firstmate", requestId: id, externalId: "1792372415-jr6Ysy" },
    request: { id, domain: "coding", originalMessage: "Redesign Held up", intendedOutcome: "The Held up list, one action each", doneWhen: [], createdAt: "2026-10-20T03:00:00Z", source: "chat", ...request },
    result: { format: "structured", brief: "Needs George's decision: the Held up redesign is built and waits for his go-ahead.", detailedReport: "", decisionsMade: [], unresolvedQuestions: ["Go ahead with the Held up redesign?"], risks: [], evidence: [], artifacts: [], specialistOutputs: [], raw: [], informationLossRisk: "low", workState: "needs_you" },
    ...patch,
  };
}

/** A firstmate home whose bearings read lists the given calls, and whose backlog is the given rows. */
function fleetHome(calls: Array<{ id: string; summary: string }>, backlog: string[]): string {
  const home = mkdtempSync(join(tmpdir(), "stale-cards-"));
  mkdirSync(join(home, "bin"));
  mkdirSync(join(home, "data"));
  writeFileSync(join(home, "bearings.json"), JSON.stringify({ decisions_open: calls }));
  writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\ncat '${join(home, "bearings.json")}'\n`, { mode: 0o755 });
  writeFileSync(join(home, "data", "backlog.md"), `${backlog.join("\n")}\n`);
  return home;
}

const feedIn = (home: string, extra: ConstructorParameters<typeof ArtefactFeed>[0] = {}) => new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none"), ...extra });
const holds = (states: Record<string, HoldState>): HoldCheck => ({ state: async (task) => states[task] ?? { state: "unknown" } });
/** The board his screen shows for these calls. */
const boardOf = (fleet: FleetArtefact, now = NOW) => jobsFrom({ now, show: { read: true, items: [], calls: callItems(fleet) } as never }).jobs;

describe("E1: the design-team call re-filed 15 times in new words", () => {
  const backlog = (sibling: string) => parseBacklog([
    `- [ ] flyd-design-team-call - The Flyd design team has mostly failed: cut or keep it (repo: flyd) (kind: captain) (hold: ${hold("Cut or keep the design team: 1 Cut, 2 Keep and fix")}) (hold-kind: captain)`,
    "  Captain hold set: 2026-11-11T04:37:00Z",
    `- [ ] flyd-news-quote - Flyd News: ${sibling} (repo: flyd)`,
  ].join("\n"));
  const decision = (sibling: string, identity?: string) => {
    const fleet = enrichFleet(emptyFleet({ calls: [{ label: "Design team", task: "flyd-design-team-call", ...(identity ? { holdIdentity: identity } : {}) }] }), backlog(sibling), new Map(), NOW, { sourceDetail: true, keepStaleCalls: true });
    return firstmateChangesFromFleet(pinnedQuestions(fleet)).find((change) => change.kind === "decision")!;
  };

  it("is one decision however the rows beside it change", () => {
    const before = decision("quote shown twice");
    const after = decision("quote shown once, fixed in PR #294");
    expect(before.detail).not.toBe(after.detail);
    expect(sourceEventKey(after)).toBe(sourceEventKey(before));
    expect(sourceEventKey(decision("anything", "2026-11-11T04:37:00Z#0"))).toBe(sourceEventKey(decision("else", "2026-11-11T04:37:00Z#0")));
  });

  it("rings once for its hold's lifecycle, in whatever words, and again only when the hold is raised again", () => {
    let clock = NOW;
    const rung = new IslandRung(null, 500, () => clock);
    const ring = (identity: string, question: string) => {
      const fleet = emptyFleet({ calls: [{ label: question, question, task: "flyd-design-team-call", holdIdentity: identity }] });
      return rung.once(islandStatusOf({ working: false }, fleet, boardOf(fleet, clock))).reply;
    };
    expect(ring("2026-11-11T04:37:00Z#0", "Cut or keep the design team?")).toBeDefined();
    // Half an hour later the executive re-files it in new words: the same question, no ring.
    clock += 30 * 60_000;
    expect(ring("2026-11-11T04:37:00Z#0", "Should the design team stay, or go?")).toBeUndefined();
    // Raised again after an answer: a new question, in words it used before, rings once more.
    clock += 30 * 60_000;
    expect(ring("2026-11-20T09:00:00Z#1", "Cut or keep the design team?")).toBeDefined();
  });

  it("is said once per question, not once per wording", () => {
    const identity = "hold:flyd-design-team-call#2026-11-11T04:37:00Z#0";
    const first = cardSource("Flyd", "Needs you", "Cut or keep the design team?", "The design team has mostly failed", ["Cut", "Keep"], { identity, wantsAnswer: true });
    const reworded = cardSource("Flyd", "Needs you", "Should the design team stay?", "Most of the design team's runs failed", ["Cut", "Keep"], { identity, wantsAnswer: true });
    expect(reworded.key).toBe(first.key);
  });
});

describe("E2: Mastercard 'ready for you to review and send', Thursday and again Saturday", () => {
  const board = (at: string) => jobsFrom({
    now: NOW,
    show: { read: true, items: [], ready: [{ id: "ready:mastercard-email", kind: "ready", headline: "Mastercard email", why: "", detail: "Ready for you to review and send", at }] } as never,
  });

  it("waits on his look for a day, then is done work, not his to do", () => {
    expect(board(new Date(NOW - 2 * 3_600_000).toISOString()).jobs[0]).toMatchObject({ group: "needs", state: "Ready for you" });
    const old = board(new Date(NOW - 2 * DAY).toISOString()).jobs[0]!;
    expect(old.group).toBe("done");
    expect(old.state).not.toBe("Ready for you");
  });
});

describe("E3 and E6: Flyd's own runs frozen at needs_decision", () => {
  it("E6: the 20 Oct Held up run settles once firstmate archived the task its note became", () => {
    const dir = mkdtempSync(join(tmpdir(), "stale-cards-runs-"));
    saveDomainRun(run("domain-e36c6408-8c13-44b9-a40c-8bea44019a4e"), dir);
    const entries = parseBacklog([
      "- [x] flyd-held-up-redesign - Flyd Held up modal: plain headlines and one action each (repo: flyd) (kind: ship) (done 2026-10-23)",
      "  mode=no-mistakes; leave unmerged for George's review (request says so). From Flyd inbox request 1792372415-jr6Ysy.",
    ].join("\n"));
    const settled = settleClosedRuns(entries, { dir, now: new Date(NOW) });
    expect(settled.map((item) => item.id)).toEqual(["domain-e36c6408-8c13-44b9-a40c-8bea44019a4e"]);
    const saved = readDomainRun("domain-e36c6408-8c13-44b9-a40c-8bea44019a4e", dir)!;
    expect(saved).toMatchObject({ status: "cancelled", closedBy: { by: "firstmate", evidenceRefs: ["firstmate-task-closed:flyd-held-up-redesign"] }, report: { state: "quiet" } });
    expect(jobsFrom({ now: NOW, runs: [jobRunFromDomain(saved)] }).jobs.filter((job) => job.group === "needs")).toEqual([]);
    expect(settleClosedRuns(entries, { dir, now: new Date(NOW + DAY) })).toEqual([]);
  });

  it("E3: the HFTW hero run settles once the scout row that names it closed; while it is open the run stays", () => {
    const hero = run("domain-45b4d25a-3ac6-44f5-856a-f3207ef3fc24", { updatedAt: "2026-11-11T12:18:22Z", transport: { kind: "firstmate", requestId: "domain-45b4d25a-3ac6-44f5-856a-f3207ef3fc24", externalId: "1794371015-rk7643" } });
    const row = (box: string) => parseBacklog([
      `- [${box}] hftw-hero-images-show - HFTW lab: show the hero images to replace (repo: hftw) (kind: scout)`,
      "  Flyd domain-45b4d25a, inbox 1794398252-wTXd9w (reply at outcome). Codex for image generation.",
    ].join("\n"));
    expect(firstmateTasksOfRun(hero, row(" "))).toEqual(["hftw-hero-images-show"]);
    const dir = mkdtempSync(join(tmpdir(), "stale-cards-runs-"));
    saveDomainRun(hero, dir);
    expect(settleClosedRuns(row(" "), { dir })).toEqual([]);
    expect(settleClosedRuns(row("x"), { dir }).map((item) => item.status)).toEqual(["cancelled"]);
  });

  it("a run's unanswered ask ages out after three days", () => {
    const stuck = jobRunFromDomain(run("flyd-project-threads-1794406370827", { updatedAt: new Date(NOW - 4 * DAY).toISOString() }));
    const fresh = jobRunFromDomain(run("domain-fresh-question", { updatedAt: new Date(NOW - DAY).toISOString() }));
    const groups = jobsFrom({ now: NOW, runs: [stuck, fresh] }).jobs.map((job) => [job.because, job.group]);
    expect(groups).toContainEqual(["Run domain-fresh-question is waiting on a decision", "needs"]);
    expect(groups.find(([because]) => String(because).includes("flyd-project-threads"))).toBeUndefined();
  });
});

describe("E4: 'The picture desk isn't shipping, and I'm replacing it', which asks nothing", () => {
  const NOTICE = "Picture desk not shipping (Flyd today replaces it); finished commit kept on its branch; worker stopped on purpose";

  it("is not a call", () => {
    const entries = parseBacklog(`- [ ] flyd-picture-desk - Flyd picture desk (repo: flyd) (since 2026-11-13) (hold: ${hold(NOTICE)}) (hold-kind: captain)`);
    const fleet = enrichFleet(emptyFleet({ calls: [{ label: "Picture desk", task: "flyd-picture-desk" }] }), entries, new Map(), NOW, { keepStaleCalls: true });
    expect(fleet.calls).toEqual([]);
  });

  it("never reaches Core as a decision", async () => {
    const home = fleetHome([{ id: "flyd-picture-desk", summary: "Picture desk" }], [
      `- [ ] flyd-picture-desk - Flyd picture desk (repo: flyd) (since ${new Date().toISOString().slice(0, 10)}) (hold: ${hold(NOTICE)}) (hold-kind: captain)`,
    ]);
    const decided: string[] = [];
    const feed = feedIn(home, { decideChanges: async (changes) => { decided.push(...changes.filter((change) => change.kind === "decision").map((change) => change.taskId ?? "")); return []; } });
    await feed.refresh();
    expect(feed.current().fleet!.calls).toEqual([]);
    expect(decided).toEqual([]);
  });

  it("an instruction is still his call, even beside a line that reports something", () => {
    for (const reason of [
      "Land PR #312 into main after the visual check", "Merge the redesign once CI is green", "Publish the HFTW launch post",
      "Build done; land PR #312 after the visual check", "Worker stopped; restart it with the new spec", "Hero is live on staging: merge to main",
    ]) {
      const entries = parseBacklog(`- [ ] flyd-instruction - Flyd instruction (repo: flyd) (since 2026-11-14) (hold: ${hold(reason)}) (hold-kind: captain)`);
      const fleet = withCurrentCalls(enrichFleet(emptyFleet({ calls: [{ label: "Instruction", task: "flyd-instruction" }] }), entries, new Map(), NOW, { keepStaleCalls: true }), NOW);
      expect(fleet.calls.map((row) => row.task), reason).toEqual(["flyd-instruction"]);
      expect(firstmateChangesFromFleet(fleet).filter((change) => change.kind === "decision").map((change) => change.taskId), reason).toEqual(["flyd-instruction"]);
      expect(boardOf(fleet).map((job) => job.group), reason).toEqual(["needs"]);
    }
  });

  it("is never turned into a question in his words", async () => {
    const source = cardSource("Flyd", "Needs you", "Picture desk", NOTICE, undefined, { wantsAnswer: true });
    expect(source.asks).toBe(false);
    expect(cardSource("Flyd", "Needs you", "Hero", "Hero is live on staging: merge to main", undefined, { wantsAnswer: true }).asks).toBeUndefined();
    const invented = await translateCard(source, async () => JSON.stringify({ title: "Flyd: the picture desk is on hold", body: "Tell me whether to keep that version or drop it." }));
    expect(invented).toEqual(fallbackWords("Flyd", "needs", "Needs you", false));
    expect(`${invented?.title} ${invented?.body}`).not.toMatch(/tell me whether/i);
    const told = await translateCard(source, async () => JSON.stringify({ title: "Flyd: the picture desk is being replaced", body: "Flyd today takes its place, and the finished version is kept." }));
    expect(told).not.toBeNull();
    expect(fallbackWords("Flyd", "needs", "Needs you", false).body).not.toMatch(/answer|decide\b(?! here)/i);
  });
});

describe("E5: a call shown after firstmate had closed it", () => {
  it("leaves Needs you when firstmate's own predicate says it is closed, even while the read still lists it", async () => {
    const home = fleetHome([{ id: "dir-tracklist-choice", summary: "Which set tracklist to build" }, { id: "dir-controls-lab-choice", summary: "Pick the controls" }], [
      `- [ ] dir-tracklist-choice - Which set tracklist to build (repo: dead-internet-radio) (kind: captain) (hold: ${hold("Which set tracklist should be built for the live player: 1 Set A, 2 Set B")}) (hold-kind: captain)`,
      "  Captain hold set: 2026-11-12T02:36:13Z",
      `- [ ] dir-controls-lab-choice - Pick the controls (repo: dead-internet-radio) (kind: captain) (hold: ${hold("Which controls version to build: 1 V1, 2 V2")}) (hold-kind: captain)`,
      "  Captain hold set: 2026-11-10T12:58:38Z",
    ]);
    const decided: string[] = [];
    const feed = feedIn(home, {
      holds: holds({ "dir-tracklist-choice": { state: "closed" }, "dir-controls-lab-choice": { state: "open", identity: "2026-11-10T12:58:38Z#0" } }),
      decideChanges: async (changes) => { decided.push(...changes.filter((change) => change.kind === "decision").map((change) => change.taskId ?? "")); return []; },
    });
    await feed.refresh();
    expect(feed.current().fleet!.calls.map((row) => row.task)).toEqual(["dir-controls-lab-choice"]);
    expect(decided).toEqual(["dir-controls-lab-choice"]);
  });

  it("leaves Needs you when the same read lists its task as landed", async () => {
    const home = fleetHome([{ id: "dir-tracklist-choice", summary: "Which set tracklist to build" }], [
      `- [ ] dir-tracklist-choice - Which set tracklist to build (repo: dead-internet-radio) (kind: captain) (hold: ${hold("Which set tracklist: 1 Set A, 2 Set B")}) (hold-kind: captain)`,
    ]);
    writeFileSync(join(home, "bearings.json"), JSON.stringify({ decisions_open: [{ id: "dir-tracklist-choice", summary: "Which set tracklist to build" }], landed: [{ id: "dir-tracklist-choice", what: "Tracklist built" }] }));
    const feed = feedIn(home, { holds: holds({ "dir-tracklist-choice": { state: "open", identity: "2026-11-12T02:36:13Z#0" } }) });
    await feed.refresh();
    expect(feed.current().fleet!.calls.filter((row) => !row.ledgerOnly)).toEqual([]);
  });

  it("stays when firstmate cannot say: a call wrongly hidden is worse than one wrongly shown", async () => {
    const home = fleetHome([{ id: "dir-start-board-calls", summary: "Start board calls" }], [
      `- [ ] dir-start-board-calls - Start board calls (repo: dead-internet-radio) (kind: captain) (hold: ${hold("Which start board to build: 1 A, 2 B")}) (hold-kind: captain)`,
    ]);
    const feed = feedIn(home, { holds: holds({ "dir-start-board-calls": { state: "unknown" } }) });
    await feed.refresh();
    expect(feed.current().fleet!.calls.map((row) => row.task)).toEqual(["dir-start-board-calls"]);
  });
});

// 15 Nov: the restored 3-day rule would have hidden two genuinely open calls (the DIR controls lab, the news
// inputs) that firstmate's own predicate still confirmed. Firstmate's call: the rule is for calls it cannot vouch
// for; an old call it confirms open stays listed, quietly, and never rings or comes back as a note.
describe("an old call firstmate still confirms open", () => {
  const OLD = "Choose whether to build edited Live now or another option; confirm removing the arrows";
  const home = () => fleetHome([{ id: "dir-controls-lab-choice", summary: "Pick the controls" }, { id: "old-unconfirmed", summary: "An old ask" }], [
    `- [ ] dir-controls-lab-choice - Pick the controls (repo: dead-internet-radio) (kind: captain) (hold: ${hold(OLD)}) (hold-kind: captain)`,
    "  Captain hold set: 2026-11-01T12:58:38Z",
    `- [ ] old-unconfirmed - An old ask (repo: dead-internet-radio) (kind: captain) (hold: ${hold("Should the old ask go ahead?")}) (hold-kind: captain)`,
    "  Captain hold set: 2026-11-01T12:00:00Z",
  ]);

  it("stays listed quietly, is worded but never acted on, and never rings; one firstmate cannot vouch for goes", async () => {
    const decided: Array<{ taskId?: string; quiet?: boolean }> = [];
    const feed = feedIn(home(), {
      holds: holds({ "dir-controls-lab-choice": { state: "open", identity: "2026-11-01T12:58:38Z#0" }, "old-unconfirmed": { state: "unknown" } }),
      decideChanges: async (changes) => { decided.push(...changes.filter((change) => change.kind === "decision")); return []; },
    });
    await feed.refresh();
    const fleet = feed.current().fleet!;
    expect(fleet.calls.map((row) => [row.task, row.quiet === true])).toEqual([["dir-controls-lab-choice", true]]);
    expect(decided.map((change) => [change.taskId, change.quiet])).toEqual([["dir-controls-lab-choice", true]]);
    expect(islandStatusOf({ working: false }, fleet, boardOf(fleet, Date.now())).reply).toBeUndefined();
    // It never rings again, but an unanswered ask stays on Needs you where he can still answer it.
    expect(boardOf(fleet, Date.now()).map((job) => job.group)).toEqual(["needs"]);
  });

  it("asks him as usual while it is still fresh", async () => {
    const fresh = fleetHome([{ id: "dir-controls-lab-choice", summary: "Pick the controls" }], [
      `- [ ] dir-controls-lab-choice - Pick the controls (repo: dead-internet-radio) (kind: captain) (hold: ${hold(OLD)}) (hold-kind: captain)`,
      `  Captain hold set: ${new Date().toISOString().slice(0, 19)}Z`,
    ]);
    const feed = feedIn(fresh, { holds: holds({ "dir-controls-lab-choice": { state: "open", identity: "now#0" } }) });
    await feed.refresh();
    const fleet = feed.current().fleet!;
    expect(fleet.calls.map((row) => [row.task, row.quiet === true])).toEqual([["dir-controls-lab-choice", false]]);
    expect(islandStatusOf({ working: false }, fleet, boardOf(fleet, Date.now())).reply).toMatchObject({ asks: true, lifecycle: true });
    expect(boardOf(fleet, Date.now()).map((job) => job.group)).toEqual(["needs"]);
  });
});

// E7 (recovery notes for workers stopped on purpose) is report fix F7, its own task (flyd-recovery-notes).

describe("E8: 'This seems like an old note, the site moved on' and 'I'll stop raising it'", () => {
  it("retires the lab he named, so it is never put to him again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stale-cards-runs-"));
    const lab = run("design-lab-hftw-hero", {
      status: "completed",
      owner: "Design Mate",
      result: { format: "structured", brief: "HFTW shop: the hero images currently use product shots", detailedReport: "", decisionsMade: [], unresolvedQuestions: [], risks: [], evidence: [], artifacts: ["/Users/george/.flyd/labs/lab-a2dc0da9-05ac-4a87-9e53-73179ce87f94/index.html"], specialistOutputs: [], raw: [], informationLossRisk: "low", workState: "landed" },
    }, { domain: "creative", intendedOutcome: "HFTW hero lab" });
    saveDomainRun(lab, dir);
    expect(labAwaitingReview(lab, [lab])).toBe(true);
    const said = "About the artefact \"HFTW shop: the hero images currently use product shots\" Page: /rail-file/…/labs/lab-a2dc0da9-05ac-4a87-9e53-73179ce87f94/index.html";
    const reply = await retireCard({ card: said, words: "This seems like an old note, the site moved on since then" }, {
      candidates: () => askingRuns([lab]),
      retired: new RetiredCards(null),
      retireRun: (id, words, options) => retireRun(id, words, { ...options, dir }),
    });
    expect(reply).toMatch(/^Retired /);
    const saved = readDomainRun(lab.id, dir)!;
    expect(saved.closedBy).toMatchObject({ by: "george", reason: "This seems like an old note, the site moved on since then" });
    expect(labAwaitingReview(saved, [saved])).toBe(false);
    expect(askingRuns([saved])).toEqual([]);
  });

  it("retires a call he named for its question, tells the staff with his words, and the feed keeps it off", async () => {
    const home = fleetHome([{ id: "hftw-hero-pick", summary: "Pick keep, A or B per hero" }], [
      `- [ ] hftw-hero-pick - HFTW lab: pick keep, A or B per hero (repo: hftw) (kind: captain) (hold: ${hold("Pick keep, A or B for each hero: 1 Keep, 2 A, 3 B")}) (hold-kind: captain)`,
      "  Captain hold set: 2026-11-11T12:18:21Z",
    ]);
    const retired = new RetiredCards(null);
    const check = holds({ "hftw-hero-pick": { state: "open", identity: "2026-11-11T12:18:21Z#0" } });
    const feed = feedIn(home, { holds: check, retired });
    await feed.refresh();
    const shown = feed.current().fleet!.calls[0]!;
    const told: Array<[string, string]> = [];
    const reply = await retireCard({ card: "hftw-hero-pick", words: "The site is live, this is old" }, {
      candidates: () => [{ kind: "call", id: "hftw-hero-pick", label: shown.label, identity: shown.questionIdentity!, aliases: ["hftw-hero-pick"] }],
      retired,
      tellFirstmate: async (call, words) => { told.push([call.id, words]); },
    });
    expect(reply).toMatch(/staff were told to close it with his words/);
    expect(told).toEqual([["hftw-hero-pick", "The site is live, this is old"]]);
    await feed.refresh();
    expect(feed.current().fleet!.calls.filter((row) => !row.ledgerOnly)).toEqual([]);
    // The same hold raised again is a new question, and asks.
    const reraised = feedIn(home, { holds: holds({ "hftw-hero-pick": { state: "open", identity: "2026-11-20T09:00:00Z#1" } }), retired });
    await reraised.refresh();
    expect(reraised.current().fleet!.calls.map((row) => row.task)).toEqual(["hftw-hero-pick"]);
  });

  it("keeps a retired call off when firstmate cannot say on the next read", async () => {
    const home = fleetHome([{ id: "hftw-hero-pick", summary: "Pick keep, A or B per hero" }], [
      `- [ ] hftw-hero-pick - HFTW lab: pick keep, A or B per hero (repo: hftw) (kind: captain) (hold: ${hold("Pick keep, A or B for each hero: 1 Keep, 2 A, 3 B")}) (hold-kind: captain)`,
      `  Captain hold set: ${new Date().toISOString().slice(0, 19)}Z`,
    ]);
    const states: Record<string, HoldState> = { "hftw-hero-pick": { state: "open", identity: "now#0" } };
    const retired = new RetiredCards(null);
    const feed = feedIn(home, { holds: holds(states), retired });
    await feed.refresh();
    expect(feed.current().fleet!.calls.map((row) => row.task)).toEqual(["hftw-hero-pick"]);
    const reply = await retireCard({ card: "hftw-hero-pick", words: "The site is live, this is old" }, { candidates: () => shownCalls(retired, join(home, "artefacts.json")), retired });
    expect(reply).toMatch(/^Retired /);
    for (const state of [{ state: "unknown" }, { state: "absent" }] as HoldState[]) {
      states["hftw-hero-pick"] = state;
      await feed.refresh();
      expect(feed.current().fleet!.calls.filter((row) => !row.ledgerOnly), state.state).toEqual([]);
    }
  });

  it("lists only the calls on his screen: put to him and not already retired", () => {
    const file = join(mkdtempSync(join(tmpdir(), "stale-cards-shown-")), "artefacts.json");
    const row = (task: string): ArtefactRow => ({ label: `Pick ${task}`, task, questionIdentity: `hold:${task}#2026-11-14T08:00:00Z#0` });
    writeFileSync(file, JSON.stringify({ rows: [
      { field: "calls", row: row("shown-call"), asked: true },
      { field: "calls", row: row("never-asked") },
      { field: "calls", row: row("retired-call"), asked: true },
      { field: "calls", row: row("settled-call"), asked: true, ledgerOnly: true },
    ] }));
    const retired = new RetiredCards(null);
    retired.retire({ task: "retired-call", identity: "hold:retired-call#2026-11-14T08:00:00Z#0", label: "Pick retired-call", words: "old", at: "2026-11-14T12:00:00Z" });
    expect(shownCalls(retired, file).map((call) => call.id)).toEqual(["shown-call"]);
  });

  it("retiring one of Flyd's runs handed to firstmate keeps its task's call off and tells firstmate with his words", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stale-cards-runs-"));
    const asking = run("domain-11aa22bb-3ac6-44f5-856a-f3207ef3fc24", {}, { contextRefs: ["task:hftw-hero-pick"] });
    saveDomainRun(asking, dir);
    const entries = parseBacklog(`- [ ] hftw-hero-pick - HFTW lab: pick keep, A or B per hero (repo: hftw) (kind: captain) (hold: ${hold("Pick keep, A or B for each hero: 1 Keep, 2 A")}) (hold-kind: captain)`);
    const shown: ArtefactRow = { label: "HFTW lab: pick keep, A or B per hero", task: "hftw-hero-pick", holdIdentity: "2026-11-11T12:18:21Z#0" };
    const retired = new RetiredCards(null);
    const told: Array<[string, string]> = [];
    const reply = await retireCard({ card: asking.id, words: "The site is live, this is old" }, {
      candidates: () => [{ kind: "call", id: "hftw-hero-pick", label: shown.label, identity: "hold:hftw-hero-pick#2026-11-11T12:18:21Z#0", aliases: ["hftw-hero-pick"] }, ...askingRuns([asking], entries)],
      retired,
      retireRun: (id, words, options) => retireRun(id, words, { ...options, dir }),
      tellFirstmate: async (call, words) => { told.push([call.id, words]); },
    });
    expect(reply).toMatch(/staff were told to close it with his words/);
    expect(readDomainRun(asking.id, dir)!.closedBy).toMatchObject({ by: "george" });
    expect(told).toEqual([["hftw-hero-pick", "The site is live, this is old"]]);
    expect(retired.has(shown)).toBe(true);
  });

  it("never claims a retirement it could not make", async () => {
    const reply = await retireCard({ card: "the Truchet lab", words: "old" }, { candidates: () => [], retired: new RetiredCards(null) });
    expect(reply).toMatch(/^Nothing retired/);
  });
});
