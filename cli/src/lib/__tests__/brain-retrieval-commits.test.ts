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

  it("passes projectRoot through to buildPresentModel", async () => {
    buildPresentModel.mockResolvedValueOnce(fakePresentModel);

    await retrieveRankedBrainEvidence("what am I working on", {
      searchRaw: async () => [],
      searchWiki: () => [],
      searchGraph: () => [],
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    }, "/Users/george/Projects/CleanX");

    expect(buildPresentModel).toHaveBeenCalledWith(
      process.cwd(),
      undefined,
      expect.any(Number),
      "/Users/george/Projects/CleanX",
    );
  });

  it("adds project-context relevance boost when projectRoot is provided", async () => {
    buildPresentModel.mockResolvedValueOnce(fakePresentModel);

    const result = await retrieveRankedBrainEvidence("what am I working on", {
      searchRaw: async () => [],
      searchWiki: () => [
        { path: "/Users/george/Projects/CleanX/README.md", body: "CleanX project", source: "wiki", score: 50, metadata: {}, staleness: null, librarianScore: 0.5, recencyWeight: 1, reliabilityWeight: 1, interestBoost: 0, corroborationCount: 1, contradictionCount: 0, confidenceProfile: { epistemicConfidence: 0.5, freshness: 1, interestAffinity: 0, retrievalUtility: 0.5, associationStrength: 0 }, isCurrent: false },
      ],
      searchGraph: () => [],
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    }, "/Users/george/Projects/CleanX");

    const wikiEntry = result.entries.find(e => e.path === "/Users/george/Projects/CleanX/README.md");
    expect(wikiEntry).toBeDefined();
    expect(wikiEntry!.librarianScore).toBeGreaterThan(0.5);
  });

  it("does not add project-context boost when no projectRoot is provided", async () => {
    buildPresentModel.mockResolvedValue(fakePresentModel);

    const wikiEntry = { path: "/Users/george/Projects/CleanX/README.md", body: "CleanX project", source: "wiki" as const, score: 50, metadata: {}, staleness: null, librarianScore: 0.5, recencyWeight: 1, reliabilityWeight: 1, interestBoost: 0, corroborationCount: 1, contradictionCount: 0, confidenceProfile: { epistemicConfidence: 0.5, freshness: 1, interestAffinity: 0, retrievalUtility: 0.5, associationStrength: 0 }, isCurrent: false };

    const [resultWithout, resultWith] = await Promise.all([
      retrieveRankedBrainEvidence("what am I working on", {
        searchRaw: async () => [],
        searchWiki: () => [wikiEntry],
        searchGraph: () => [],
        now: () => new Date("2026-07-29T12:00:00.000Z"),
      }),
      retrieveRankedBrainEvidence("what am I working on", {
        searchRaw: async () => [],
        searchWiki: () => [wikiEntry],
        searchGraph: () => [],
        now: () => new Date("2026-07-29T12:00:00.000Z"),
      }, "/Users/george/Projects/CleanX"),
    ]);

    const entryWithout = resultWithout.entries.find(e => e.path === "/Users/george/Projects/CleanX/README.md");
    const entryWith = resultWith.entries.find(e => e.path === "/Users/george/Projects/CleanX/README.md");
    expect(entryWithout).toBeDefined();
    expect(entryWith).toBeDefined();
    expect(entryWith!.librarianScore).toBeGreaterThan(entryWithout!.librarianScore);
  });
});
