import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentModel } from "../present-model.js";

const buildPresentModel = vi.fn<() => Promise<PresentModel>>();

vi.mock("../present-model.js", () => ({
  get buildPresentModel() {
    return buildPresentModel;
  },
}));

const { retrieveRankedBrainEvidence } = await import("../brain-retrieval.js");

const fakePresentModel: PresentModel = {
  generatedAt: "2026-07-29T12:00:00.000Z",
  repository: {
    root: "/Users/george/flyd",
    name: "flyd",
    remote: null,
    branch: "main",
    head: "abc123",
    dirty: true,
    statusLines: [],
    statusDigest: "digest",
  },
  activeTask: null,
  recentCommits: [
    { hash: "aaa111", shortHash: "aaa", subject: "fix(memory): gate currentness", committedAt: "2026-07-29T11:00:00.000Z" },
  ],
  gaps: [],
};

describe("retrieveRankedBrainEvidence — recent-commit evidence", () => {
  beforeEach(() => {
    buildPresentModel.mockClear();
  });

  it("synthesizes recent commits as isCurrent entries for current_state queries, even with an empty archive", async () => {
    buildPresentModel.mockResolvedValueOnce(fakePresentModel);

    const result = await retrieveRankedBrainEvidence("what am I working on", {
      searchRaw: async () => [],
      searchWiki: () => [],
      searchGraph: () => [],
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].path).toBe("git:commit:aaa");
    expect(result.entries[0].isCurrent).toBe(true);
    expect(result.entries[0].confidenceProfile.epistemicConfidence).toBe(1);
  });

  it("does not synthesize commit entries for non current_state/task_resume queries", async () => {
    const result = await retrieveRankedBrainEvidence("what is my favorite editor", {
      searchRaw: async () => [],
      searchWiki: () => [],
      searchGraph: () => [],
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    expect(buildPresentModel).not.toHaveBeenCalled();
    expect(result.entries).toHaveLength(0);
  });

  it("computes sufficiency from real archive evidence only, not synthetic commit entries", async () => {
    buildPresentModel.mockResolvedValueOnce(fakePresentModel);

    const result = await retrieveRankedBrainEvidence("what am I working on", {
      searchRaw: async () => [],
      searchWiki: () => [],
      searchGraph: () => [],
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    // Empty real archive -> insufficient, regardless of the injected commit.
    expect(result.sufficiency.verdict).toBe("insufficient");
  });
});
