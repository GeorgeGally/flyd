import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { listObjectives } from "../../command/cos/objectives.js";
import { listDomainRuns } from "../../command/store.js";
import type { CosReport, Objective } from "../../command/cos/types.js";
import type { DomainRun } from "../../command/types.js";
import type { FirstmateChange } from "../../intelligence/executive/firstmate-decision.js";
import { ArtefactFeed, composeArtefact, firstmateChangesFromFleet, parseBearings, projectFleetDecisions, withoutCosFleet } from "../artefact.js";
import { cosJobRuns, cosRequestIds, recentObjectiveWork } from "../cos-jobs.js";
import { jobsFrom } from "../jobs.js";

const unconfirmed = (rows: Array<{ task?: string; ownershipUnconfirmed?: boolean }> | undefined) => (rows ?? []).filter((row) => row.ownershipUnconfirmed).map((row) => row.task);
const decidedTasks = (decide: { mock: { calls: unknown[][] } }) => decide.mock.calls.flatMap((call) => (call[0] as FirstmateChange[]).map((change) => change.taskId));
const feedHome = (prefix: string, script: string, holds: string[] = []) => {
  const home = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(home, "bin"));
  mkdirSync(join(home, "state"));
  mkdirSync(join(home, "data"));
  writeFileSync(join(home, "data", "backlog.md"), holds.map((task) => `- [ ] ${task} - A call (hold: Choose: 1 Red, 2 Blue)\n`).join(""));
  writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), script, { mode: 0o755 });
  return home;
};

describe("CoS fleet provenance", () => {
  it("reports unreadable ownership files rather than treating them as absent", () => {
    const home = mkdtempSync(join(tmpdir(), "flyd-cos-corrupt-"));
    mkdirSync(join(home, "objectives"));
    mkdirSync(join(home, "runs"));
    writeFileSync(join(home, "objectives", "broken.json"), "{");
    writeFileSync(join(home, "runs", "broken.json"), "{");
    expect(() => listObjectives(home, true)).toThrow();
    expect(() => listDomainRuns(home, true)).toThrow();
    writeFileSync(join(home, "objectives", "broken.json"), JSON.stringify({ id: "obj-broken", createdAt: "today", runs: [], reportIds: [], plan: "bad" }));
    writeFileSync(join(home, "runs", "broken.json"), JSON.stringify({ id: "run-broken", createdAt: "today", request: { objectiveId: 7 }, transport: {} }));
    expect(() => listObjectives(home, true)).toThrow();
    expect(() => listDomainRuns(home, true)).toThrow();
  });

  it("keeps unknown and legacy work while hiding only exactly linked worker rows", () => {
    const fleet = parseBearings({
      in_flight: [
        { id: "owned", name: "Page capture", state: "working", request_id: "req-owned" },
        { id: "legacy", name: "Older work", state: "working", request_id: null },
        { id: "unrelated", name: "Other work", state: "working", request_id: "req-other" },
      ],
      decisions_open: [{ id: "owned", summary: "Raw team question", request_id: "req-owned" }, { id: "legacy", summary: "Legacy question", request_id: null }],
      landed: [{ id: "owned", what: "Raw result", request_id: "req-owned" }],
      gates: [{ id: "owned", title: "Raw gate", request_id: "req-owned" }],
    });
    expect(fleet.live[0]).toMatchObject({ task: "owned", requestId: "req-owned" });
    const filtered = withoutCosFleet(fleet, new Set(["req-owned"]));
    expect(filtered.tasks).toEqual(new Set(["owned"]));
    expect(filtered.fleet.live.map((row) => row.task)).toEqual(["legacy", "unrelated"]);
    expect(filtered.fleet.calls.map((row) => row.task)).toEqual(["legacy"]);
    expect(filtered.fleet.landed).toEqual([]);
    expect(filtered.fleet.next).toEqual([]);
    expect(firstmateChangesFromFleet(filtered.fleet).some((change) => change.taskId === "owned")).toBe(false);
  });

  it("shows a row whose snapshot lacks request bindings as ownership unconfirmed instead of blanking the board", () => {
    const fleet = parseBearings({ in_flight: [{ id: "same-name", name: "Page capture", state: "working" }] });
    const shown = withoutCosFleet(fleet, new Set(["req-owned"])).fleet;
    expect(shown.unavailable).toBeFalsy();
    expect(unconfirmed(shown.live)).toEqual(["same-name"]);
    const empty = withoutCosFleet(parseBearings({ schema: "fm-bearings.v1", in_flight: [] }), new Set(["req-owned"])).fleet;
    expect(empty.unavailable).toBeFalsy();
  });

  it("marks rows of an uncertain snapshot while CoS requests exist, and confirms them after recovery", () => {
    const raw = { in_flight: [{ id: "maybe-owned", name: "Uncertain task", state: "working", request_id: null }], decisions_open: [{ id: "maybe-owned", summary: "Uncertain decision", request_id: null }] };
    const uncertain = parseBearings({ ...raw, omitted: [{ surface: "request provenance record(s) unreadable" }] });
    const marked = withoutCosFleet(uncertain, new Set(["req-owned"])).fleet;
    expect(marked.unavailable).toBeFalsy();
    expect(unconfirmed(marked.live)).toEqual(["maybe-owned"]);
    expect(unconfirmed(marked.calls)).toEqual(["maybe-owned"]);
    expect(unconfirmed(withoutCosFleet(uncertain, new Set()).fleet.live)).toEqual([]);
    const recovered = withoutCosFleet(parseBearings(raw), new Set(["req-owned"])).fleet;
    expect(recovered.calls.map((row) => row.task)).toEqual(["maybe-owned"]);
    expect(unconfirmed(recovered.calls)).toEqual([]);
  });

  it("keeps an unattributed secondmate decision in front of him, marked ownership unconfirmed", () => {
    const fleet = parseBearings({ in_flight: [{ id: "mate/child", name: "Child work", state: "working", request_id: null }, { id: "local", name: "Local legacy", state: "working", request_id: null }], decisions_open: [{ id: "mate/child", summary: "Child question", request_id: null }] });
    const filtered = withoutCosFleet(fleet, new Set(["req-owned"])).fleet;
    expect(filtered.live.map((row) => row.task)).toEqual(["mate/child", "local"]);
    expect(filtered.calls.map((row) => row.task)).toEqual(["mate/child"]);
    expect(unconfirmed([...filtered.live, ...filtered.calls])).toEqual(["mate/child", "mate/child"]);
  });

  it("keeps cached rows absent from the current snapshot, marked ownership unconfirmed", () => {
    const current = parseBearings({ in_flight: [{ id: "legacy", name: "Legacy task", state: "working", request_id: null }] });
    const accumulated = { ...current, calls: [{ task: "stale", label: "Cached question" }], live: [...current.live, { task: "stale", label: "Cached worker" }] };
    const filtered = withoutCosFleet(accumulated, new Set(["req-owned"]), current).fleet;
    expect(filtered.live.map((row) => row.task)).toEqual(["legacy", "stale"]);
    expect(unconfirmed([...filtered.live, ...filtered.calls])).toEqual(["stale", "stale"]);
  });

  it("shows uncertain rows during a refresh but never decides, settles or follows them up", async () => {
    const snapshot = JSON.stringify({ omitted: [{ surface: "request provenance unavailable" }], in_flight: [{ id: "uncertain", state: "working", name: "Unknown task", request_id: null }], decisions_open: [{ id: "uncertain", summary: "Unknown decision", request_id: null }] });
    const home = feedHome("flyd-cos-gap-", `#!/bin/sh\nprintf '%s' '${snapshot}'\n`, ["uncertain"]);
    const decideChanges = vi.fn(async (_changes: FirstmateChange[]) => []);
    const settleRuns = vi.fn(async () => {});
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none"), cosRequests: () => new Set(["req-owned"]), decideChanges, settleRuns,
      workers: () => [{ id: "uncertain", name: "Unknown task", state: "working" }] });
    await feed.refresh();
    expect(feed.current().fleet?.unavailable).toBeFalsy();
    expect(feed.current().fleet?.calls.map((row) => row.task)).toEqual(["uncertain"]);
    expect(decidedTasks(decideChanges)).not.toContain("uncertain");
    expect(settleRuns).not.toHaveBeenCalled();
    feed.stop();
  });

  it("keeps fleet records on screen, unconfirmed and undecided, when objective ownership cannot be read", async () => {
    const snapshot = JSON.stringify({ in_flight: [{ id: "work", state: "working", name: "Work", request_id: null }] });
    const home = feedHome("flyd-cos-objectives-", `#!/bin/sh\nprintf '%s' '${snapshot}'\n`);
    const decideChanges = vi.fn(async (_changes: FirstmateChange[]) => []);
    const settleRuns = vi.fn(async () => {});
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none"), cosRequests: () => null, decideChanges, settleRuns });
    await feed.refresh();
    expect(feed.current().fleet?.unavailable).toBeFalsy();
    expect(unconfirmed(feed.current().fleet?.live)).toEqual(["work"]);
    expect(decidedTasks(decideChanges)).not.toContain("work");
    expect(settleRuns).not.toHaveBeenCalled();
    feed.stop();
  });

  it("treats a damaged request binding as unconfirmed ownership, not as legacy work", () => {
    for (const damaged of [42, { id: "req-owned" }, ["req-owned"], true]) {
      const fleet = parseBearings({ in_flight: [{ id: "damaged", name: "Damaged binding", state: "working", request_id: damaged }], decisions_open: [{ id: "damaged", summary: "Damaged question", request_id: damaged }] });
      expect(fleet.provenanceIncomplete).toBe(true);
      const marked = withoutCosFleet(fleet, new Set(["req-owned"])).fleet;
      expect(marked.unavailable).toBeFalsy();
      expect(unconfirmed(marked.calls)).toEqual(["damaged"]);
      // With no objective-owned requests nothing can be misattributed, so the legacy view stays as it is.
      expect(unconfirmed(withoutCosFleet(fleet, new Set()).fleet.calls)).toEqual([]);
    }
  });

  it("stops holding back raw rows for an objective settled more than a week ago, so a secondmate decision today reaches him", async () => {
    const now = Date.parse("2026-11-27T12:00:00Z");
    const old: Objective = { id: "obj-old", revision: 1, createdAt: "2026-11-10T00:00:00Z", updatedAt: "2026-11-19T00:00:00Z", origin: { surface: "chat" }, words: "Old work", flydNotes: "", contextRefs: [], status: "done", runs: ["run-old"], reportIds: [] };
    const oldRun = { id: "run-old", owner: "FirstMate", status: "completed", createdAt: old.createdAt, updatedAt: old.updatedAt, request: { id: "run-old", domain: "coding", originalMessage: "Old", intendedOutcome: "Old", doneWhen: [], createdAt: old.createdAt, objectiveId: "obj-old" }, transport: { kind: "firstmate", requestId: "run-old" } } as DomainRun;
    const work = recentObjectiveWork([oldRun], [old], now);
    expect(cosRequestIds(work.runs, work.objectives)).toEqual(new Set());
    const recentWork = recentObjectiveWork([oldRun], [{ ...old, updatedAt: "2026-11-24T00:00:00Z" }], now);
    expect(cosRequestIds(recentWork.runs, recentWork.objectives)).toEqual(new Set(["run-old"]));
    const snapshot = JSON.stringify({ in_flight: [{ id: "mate/child", state: "working", name: "Child", request_id: null }], decisions_open: [{ id: "header", summary: "Ship the header?", request_id: null }] });
    const home = feedHome("flyd-cos-old-", `#!/bin/sh\nprintf '%s' '${snapshot}'\n`, ["header"]);
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none"), cosRequests: () => cosRequestIds(work.runs, work.objectives) });
    await feed.refresh();
    expect(feed.current().fleet?.calls.map((row) => row.task)).toEqual(["header"]);
    expect(feed.current().fleet?.live.map((row) => row.task)).toEqual(["mate/child"]);
    expect(unconfirmed([...feed.current().fleet!.calls, ...feed.current().fleet!.live])).toEqual([]);
    feed.stop();
  });

  it("keeps a CoS objective's reviewed decision actionable while Firstmate's snapshot carries no request ids", async () => {
    const at = "2026-11-26T00:00:00Z";
    const objective: Objective = { id: "obj-live", revision: 1, createdAt: at, updatedAt: at, origin: { surface: "chat" }, words: "Build the page", flydNotes: "", contextRefs: [], status: "needs_george", runs: ["run-live"], reportIds: ["report-live"], waitingOn: { reportId: "report-live", kind: "run", question: "Which colour?", options: ["Blue", "Green"], at } };
    const report: CosReport = { id: "report-live", objectiveId: "obj-live", kind: "decision", outcome: "A colour needs your choice", detail: "Blue or green.", options: ["Blue", "Green"], evidenceRefs: ["domain-run:run-live"], shape: "words", artefacts: [], urgency: "whenever" };
    const run = { id: "run-live", owner: "FirstMate", status: "needs_decision", createdAt: at, updatedAt: at, request: { id: "run-live", domain: "coding", originalMessage: "Build the page", intendedOutcome: "Raw brief", doneWhen: [], createdAt: at, objectiveId: "obj-live" }, transport: { kind: "firstmate", requestId: "run-live" } } as DomainRun;
    const home = feedHome("flyd-cos-board-", `#!/bin/sh\nprintf '%s' '${JSON.stringify({ in_flight: [{ id: "legacy", state: "working", name: "Legacy" }] })}'\n`);
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none"), cosRequests: () => cosRequestIds([run], [objective]) });
    await feed.refresh();
    expect(feed.current().fleet?.unavailable).toBeFalsy();
    const board = jobsFrom({ runs: cosJobRuns([run], [objective], [report], Date.parse(at)), now: Date.parse(at) });
    expect(board.jobs.find((job) => job.domainRun === "obj-live")).toMatchObject({ group: "needs", ask: "Which colour?", choices: ["Blue", "Green"] });
    feed.stop();
  });

  it("keeps the ledger's rows when a fleet read fails", async () => {
    const home = feedHome("flyd-cos-failed-read-", "#!/bin/sh\n", ["legacy"]);
    const file = join(home, "snapshot.json");
    writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\n[ -f '${file}' ] || exit 1\ncat '${file}'\n`, { mode: 0o755 });
    writeFileSync(file, JSON.stringify({ schema: "fm-bearings.v1", in_flight: [{ id: "legacy", state: "working", name: "Legacy work", request_id: null }], decisions_open: [{ id: "legacy", summary: "Which header should ship?", request_id: null }], gates: [], landed: [] }));
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none"), cosRequests: () => new Set(["req-owned"]) });
    await feed.refresh({ fresh: true });
    expect(feed.current().fleet?.calls.map((row) => row.task)).toEqual(["legacy"]);
    rmSync(file);
    await feed.refresh({ fresh: true });
    expect(feed.current().fleet?.unavailable).toBeFalsy();
    expect(feed.current().fleet?.calls.map((row) => row.task)).toEqual(["legacy"]);
    feed.stop();
  });

  it("separates the work of several objectives from unrelated and legacy work", () => {
    const fleet = parseBearings({
      in_flight: [
        { id: "first", name: "First objective's worker", state: "working", request_id: "req-a" },
        { id: "second", name: "Second objective's worker", state: "working", request_id: "req-b" },
        { id: "other", name: "Firstmate's own work", state: "working", request_id: "req-z" },
        { id: "legacy", name: "Pre-cutover work", state: "working", request_id: null },
      ],
      // The same task's decision, once its worker row names the request, is owned with it.
      decisions_open: [{ id: "second", summary: "Second objective's raw question", request_id: "req-b" }, { id: "legacy", summary: "Legacy question", request_id: null }],
      landed: [{ id: "first", what: "First objective's raw result", request_id: "req-a" }, { id: "other", what: "Other result", request_id: "req-z" }],
      gates: [],
    });
    const filtered = withoutCosFleet(fleet, new Set(["req-a", "req-b"]));
    expect(filtered.tasks).toEqual(new Set(["first", "second"]));
    expect(filtered.fleet.live.map((row) => row.task)).toEqual(["other", "legacy"]);
    expect(filtered.fleet.calls.map((row) => row.task)).toEqual(["legacy"]);
    expect(filtered.fleet.landed.map((row) => row.task)).toEqual(["other"]);
    const changes = firstmateChangesFromFleet(filtered.fleet).map((change) => change.taskId);
    expect(changes).not.toContain("first");
    expect(changes).not.toContain("second");
  });

  it("keeps legacy work and its call through a provenance gap and restores them after recovery", async () => {
    const home = feedHome("flyd-cos-gap-recovery-", "#!/bin/sh\n", ["legacy"]);
    const file = join(home, "snapshot.json");
    const healthy = { schema: "fm-bearings.v1", in_flight: [{ id: "legacy", state: "working", name: "Legacy work", request_id: null }], decisions_open: [{ id: "legacy", summary: "Which header should ship?", request_id: null }], gates: [], landed: [] };
    writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\ncat '${file}'\n`, { mode: 0o755 });
    const decideChanges = vi.fn(async () => []);
    const settleRuns = vi.fn(async () => {});
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none"), cosRequests: () => new Set(["req-owned"]), decideChanges, settleRuns });

    writeFileSync(file, JSON.stringify(healthy));
    await feed.refresh({ fresh: true });
    expect(feed.current().fleet?.unavailable).toBeFalsy();
    expect(feed.current().fleet?.live.map((row) => row.task)).toEqual(["legacy"]);
    expect(decideChanges).toHaveBeenCalledTimes(1);
    expect(settleRuns).toHaveBeenCalledTimes(1);

    // Firstmate cannot read its bindings: the work and its call stay on screen, unconfirmed; nothing is decided, settled or dropped.
    writeFileSync(file, JSON.stringify({ ...healthy, omitted: [{ surface: "request provenance record(s) unreadable" }] }));
    await feed.refresh({ fresh: true });
    expect(feed.current().fleet?.unavailable).toBeFalsy();
    expect(feed.current().fleet?.calls.map((row) => row.task)).toEqual(["legacy"]);
    expect(unconfirmed(feed.current().fleet?.calls)).toEqual(["legacy"]);
    expect((decideChanges.mock.calls[1] as unknown as [unknown[]])[0]).toEqual([]);
    expect(settleRuns).toHaveBeenCalledTimes(1);

    writeFileSync(file, JSON.stringify(healthy));
    await feed.refresh({ fresh: true });
    expect(feed.current().fleet?.unavailable).toBeFalsy();
    expect(feed.current().fleet?.live.map((row) => row.task)).toEqual(["legacy"]);
    expect(decideChanges).toHaveBeenCalledTimes(3);
    // The executive step sees exactly what it saw before the gap: nothing was discarded or promoted meanwhile.
    const seen = (index: number) => (decideChanges.mock.calls[index] as unknown as [Array<{ taskId?: string; kind: string }>])[0].map((change) => `${change.kind}:${change.taskId}`).sort();
    expect(seen(2)).toEqual(seen(0));
    expect(seen(0)).toContain("fleet_state:legacy");
    feed.stop();
  });

  it("does not let an objective's raw decision reach the executive step while its binding is known", async () => {
    const home = mkdtempSync(join(tmpdir(), "flyd-cos-owned-call-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "state"));
    const snapshot = JSON.stringify({ schema: "fm-bearings.v1", in_flight: [{ id: "owned", state: "working", name: "Owned", request_id: "req-owned" }], decisions_open: [{ id: "owned", summary: "Raw worker question", request_id: "req-owned" }], gates: [], landed: [] });
    writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\nprintf '%s' '${snapshot}'\n`, { mode: 0o755 });
    const decideChanges = vi.fn(async (_changes: import("../../intelligence/executive/firstmate-decision.js").FirstmateChange[]) => []);
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none"), cosRequests: () => new Set(["req-owned"]), decideChanges });
    await feed.refresh();
    expect(feed.current().fleet?.unavailable).toBeFalsy();
    expect(feed.current().fleet?.calls).toEqual([]);
    expect(feed.current().fleet?.live).toEqual([]);
    expect(decideChanges.mock.calls.flatMap((call) => call[0]).some((change) => change.taskId === "owned")).toBe(false);
    feed.stop();
  });

  it("keeps a linked worker out of both the executive step and the screen", async () => {
    const home = mkdtempSync(join(tmpdir(), "flyd-cos-fleet-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "state"));
    const snapshot = JSON.stringify({ in_flight: [{ id: "owned", state: "working", name: "Page capture", request_id: "req-owned" }, { id: "legacy", state: "working", name: "Other job", request_id: null }] });
    writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\nprintf '%s' '${snapshot}'\n`, { mode: 0o755 });
    const decideChanges = vi.fn(async (_changes: import("../../intelligence/executive/firstmate-decision.js").FirstmateChange[]) => []);
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none"), cosRequests: () => new Set(["req-owned"]), decideChanges,
      workers: () => [{ id: "owned", name: "Page capture", state: "working" }] });
    await feed.refresh();
    expect(feed.current().fleet?.live.map((row) => row.task)).toEqual(["legacy"]);
    expect(decideChanges.mock.calls.flatMap((call) => call[0]).some((change) => change.taskId === "owned")).toBe(false);
    feed.stop();
  });

  it("says plainly on the card that a row's ownership is unconfirmed", () => {
    const fleet = parseBearings({ in_flight: [{ id: "legacy", name: "Fix the footer spacing", state: "working", request_id: null }, { id: "mate/child", name: "Tidy the gallery grid", state: "working", request_id: null }] });
    const items = composeArtefact({ fleet: withoutCosFleet(fleet, new Set(["req-owned"]), parseBearings({ in_flight: [{ id: "legacy", name: "Fix the footer spacing", state: "working", request_id: null }] })).fleet, memories: [], news: [], taste: [] });
    expect(items.find((item) => item.id.endsWith("mate/child"))?.detail).toContain("ownership unconfirmed");
    expect(items.find((item) => item.id.endsWith("legacy"))?.detail ?? "").not.toContain("ownership unconfirmed");
  });

  it("puts an unconfirmed call's own question to him rather than waiting forever on a restatement", () => {
    const call = { task: "gnm-footer-fix", label: "Rebase the gnm-footer-fix worktree onto local main or hold it?", repo: "gnm" };
    const shown = projectFleetDecisions({ ...parseBearings({}), calls: [{ ...call, ownershipUnconfirmed: true }] }, []).calls;
    expect(shown).toHaveLength(1);
    expect(shown[0]!.label).toBe("Rebase the gnm-footer-fix worktree onto local main or hold it?");
    expect(projectFleetDecisions({ ...parseBearings({}), calls: [call] }, []).calls[0]!.label).toMatch(/getting it restated/);
  });
});
