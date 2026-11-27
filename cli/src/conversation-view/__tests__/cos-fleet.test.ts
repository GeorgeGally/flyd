import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { listObjectives } from "../../command/cos/objectives.js";
import { listDomainRuns } from "../../command/store.js";
import { ArtefactFeed, firstmateChangesFromFleet, parseBearings, withoutCosFleet } from "../artefact.js";

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

  it("does not guess ownership when a snapshot lacks request bindings", () => {
    const fleet = parseBearings({ in_flight: [{ id: "same-name", name: "Page capture", state: "working" }] });
    expect(withoutCosFleet(fleet, new Set(["req-owned"])).fleet.unavailable).toBeTruthy();
  });

  it("treats missing sections in a named Bearings snapshot as incomplete", () => {
    const snapshot = parseBearings({ schema: "fm-bearings.v1", in_flight: [] });
    expect(withoutCosFleet(snapshot, new Set(["req-owned"])).fleet.unavailable).toBeTruthy();
  });

  it("withholds an uncertain snapshot while CoS requests exist and restores it after recovery", () => {
    const raw = { in_flight: [{ id: "maybe-owned", name: "Uncertain task", state: "working", request_id: null }], decisions_open: [{ id: "maybe-owned", summary: "Uncertain decision", request_id: null }] };
    const uncertain = parseBearings({ ...raw, omitted: [{ surface: "request provenance record(s) unreadable" }] });
    const withheld = withoutCosFleet(uncertain, new Set(["req-owned"])).fleet;
    expect(withheld.unavailable).toBeTruthy();
    expect(withheld.live).toEqual([]);
    expect(withheld.calls).toEqual([]);
    expect(withoutCosFleet(uncertain, new Set()).fleet.live).toHaveLength(1);
    const recovered = withoutCosFleet(parseBearings(raw), new Set(["req-owned"])).fleet;
    expect(recovered.live.map((row) => row.task)).toEqual(["maybe-owned"]);
    expect(recovered.calls.map((row) => row.task)).toEqual(["maybe-owned"]);
  });

  it("withholds unattributed secondmate children while objective work is active", () => {
    const fleet = parseBearings({ in_flight: [{ id: "mate/child", name: "Child work", state: "working", request_id: null }, { id: "local", name: "Local legacy", state: "working", request_id: null }], decisions_open: [{ id: "mate/child", summary: "Child question", request_id: null }] });
    const filtered = withoutCosFleet(fleet, new Set(["req-owned"])).fleet;
    expect(filtered.live.map((row) => row.task)).toEqual(["local"]);
    expect(filtered.calls).toEqual([]);
    expect(firstmateChangesFromFleet(filtered).some((change) => change.taskId === "mate/child")).toBe(false);
    expect(withoutCosFleet(fleet, new Set()).fleet.live).toHaveLength(2);
  });

  it("does not promote cached tasks absent from the authoritative snapshot", () => {
    const current = parseBearings({ in_flight: [{ id: "legacy", name: "Legacy task", state: "working", request_id: null }] });
    const accumulated = { ...current, calls: [{ task: "stale", label: "Cached question" }], live: [...current.live, { task: "stale", label: "Cached worker" }] };
    const filtered = withoutCosFleet(accumulated, new Set(["req-owned"]), current).fleet;
    expect(filtered.live.map((row) => row.task)).toEqual(["legacy"]);
    expect(filtered.calls).toEqual([]);
    expect(firstmateChangesFromFleet(filtered).some((change) => change.taskId === "stale")).toBe(false);
  });

  it("does not present or act on uncertain ownership during a refresh", async () => {
    const home = mkdtempSync(join(tmpdir(), "flyd-cos-gap-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "state"));
    const snapshot = JSON.stringify({ omitted: [{ surface: "request provenance unavailable" }], in_flight: [{ id: "uncertain", state: "working", name: "Unknown task", request_id: null }], decisions_open: [{ id: "uncertain", summary: "Unknown decision", request_id: null }] });
    writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\nprintf '%s' '${snapshot}'\n`, { mode: 0o755 });
    const decideChanges = vi.fn(async () => []);
    const settleRuns = vi.fn(async () => {});
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none"), cosRequests: () => new Set(["req-owned"]), decideChanges, settleRuns,
      workers: () => [{ id: "uncertain", name: "Unknown task", state: "working" }] });
    await feed.refresh();
    expect(feed.current().fleet?.unavailable).toBeTruthy();
    expect(feed.current().fleet?.live).toEqual([]);
    expect(feed.current().fleet?.calls).toEqual([]);
    expect(decideChanges).not.toHaveBeenCalled();
    expect(settleRuns).not.toHaveBeenCalled();
    feed.stop();
  });

  it("does not act on fleet records when objective ownership cannot be read", async () => {
    const home = mkdtempSync(join(tmpdir(), "flyd-cos-objectives-"));
    mkdirSync(join(home, "bin"));
    mkdirSync(join(home, "state"));
    const snapshot = JSON.stringify({ in_flight: [{ id: "work", state: "working", name: "Work", request_id: null }] });
    writeFileSync(join(home, "bin", "fm-bearings-snapshot.sh"), `#!/bin/sh\nprintf '%s' '${snapshot}'\n`, { mode: 0o755 });
    const decideChanges = vi.fn(async () => []);
    const settleRuns = vi.fn(async () => {});
    const feed = new ArtefactFeed({ home, memoryFile: join(home, "none"), newsFile: join(home, "none"), tasteFile: join(home, "none"), cosRequests: () => null, decideChanges, settleRuns });
    await feed.refresh();
    expect(feed.current().fleet?.unavailable).toBeTruthy();
    expect(feed.current().fleet?.live).toEqual([]);
    expect(decideChanges).not.toHaveBeenCalled();
    expect(settleRuns).not.toHaveBeenCalled();
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
});
