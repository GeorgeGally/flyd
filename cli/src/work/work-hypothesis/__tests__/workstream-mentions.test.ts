import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { useWorkIndexPath, resetWorkIndexPath, closeDb } from "../../database.js";
import { writePresentModel } from "../store.js";
import {
  alreadyListedWorkstream,
  handleWorkstreamMention,
  parseWorkstreamMention,
} from "../workstream-mentions.js";
import type { WorkHypothesis } from "../types.js";

const NOW = "2026-08-12T12:00:00.000Z";

function belief(streams: string[]): WorkHypothesis {
  return {
    id: "wh-test",
    hypothesisText: `Workstreams: ${streams.join(", ")}.`,
    primaryThreads: [],
    secondaryThreads: [],
    confidence: "low",
    uncertainty: [],
    evidenceRefs: [],
    demotions: [],
    insights: {
      workstreams: streams,
      latestMoves: [],
      tensions: [],
      stalledThreads: [],
      finishedProjects: [],
    },
    revisedAt: NOW,
    generatedAt: NOW,
    fromCache: false,
  };
}

describe("workstream mentions", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-workstream-"));
    useWorkIndexPath(join(dir, "work-index.sqlite"));
  });

  afterEach(() => {
    closeDb();
    resetWorkIndexPath();
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses forgot / aka DIR utterances", () => {
    expect(parseWorkstreamMention("Workstreams u forgot good neighbours")).toEqual({
      name: "good neighbours",
    });
    expect(parseWorkstreamMention("and dead internet radio, aka DIR")).toEqual({
      name: "dead internet radio",
      alias: "DIR",
    });
    expect(parseWorkstreamMention("so how do we fix this?")).toBeNull();
  });

  it("acknowledges a workstream that is already listed", async () => {
    writePresentModel(belief(["Good Neighbours", "CleanX", "Jobs"]));
    const reply = await handleWorkstreamMention("Workstreams u forgot good neighbours", {
      repos: [],
    });
    expect(reply).toMatch(/Already in workstreams: Good Neighbours, CleanX, Jobs/);
  });

  it("promotes DIR from an aka mention", async () => {
    writePresentModel(belief(["Good Neighbours", "CleanX", "Jobs"]));
    const reply = await handleWorkstreamMention("and dead internet radio, aka DIR", {
      repos: [],
    });
    expect(reply).toMatch(/Recorded workstream Dead Internet Radio \(DIR\)/);
    expect(reply).toMatch(/Dead Internet Radio \(DIR\)/);
  });

  it("matches listed names case-insensitively", () => {
    expect(alreadyListedWorkstream("good neighbours", ["Good Neighbours", "CleanX"])).toBe(true);
    expect(alreadyListedWorkstream("DIR", ["CleanX"])).toBe(false);
  });
});
