import { describe, expect, it } from "vitest";
import { gateCurrentness } from "../currentness-gate.js";
import type { ScoredEvidence } from "../librarian.js";
import type { PresentModel } from "../present-model.js";
import type { RecallIntent } from "../recall-intent.js";

function makeEntry(overrides: Partial<ScoredEvidence> & Pick<ScoredEvidence, "path" | "body">): ScoredEvidence {
  return {
    source: "wiki",
    score: 80,
    metadata: {},
    staleness: null,
    librarianScore: 0.8,
    recencyWeight: 0.8,
    reliabilityWeight: 0.8,
    interestBoost: 0,
    corroborationCount: 0,
    contradictionCount: 0,
    confidenceProfile: {
      epistemicConfidence: 0.9,
      freshness: 0.9,
      interestAffinity: 0,
      retrievalUtility: 0.5,
      associationStrength: 0,
    },
    ...overrides,
  };
}

const currentStateIntent: RecallIntent = { kind: "current_state", confidence: 0.9, reasons: [] };
const generalIntent: RecallIntent = { kind: "general", confidence: 0.5, reasons: [] };

describe("gateCurrentness", () => {
  it("the spec regression fixture: an old, semantically-strong project never enters current without live corroboration", () => {
    const presentModel: PresentModel = {
      generatedAt: "2026-07-29T00:00:00.000Z",
      repository: {
        root: "/Users/george/flyd",
        name: "flyd",
        remote: "origin",
        branch: "main",
        head: "abc123",
        dirty: true,
        statusLines: [],
        statusDigest: "digest",
      },
      activeTask: {
        taskKey: "task-1",
        projectName: "flyd",
        status: "running",
        intendedOutcome: "repair memory recall",
        updatedAt: "2026-07-29T00:00:00.000Z",
      },
      recentCommits: [],
      gaps: [],
    };

    const currentProjectMatch = makeEntry({
      path: "wiki/projects/flyd.md",
      body: "flyd is the active agent-native memory and coding platform, currently under heavy development.",
      confidenceProfile: {
        epistemicConfidence: 0.9,
        freshness: 0.95,
        interestAffinity: 0.15,
        retrievalUtility: 0.5,
        associationStrength: 0,
      },
    });

    // Deliberately shares vocabulary ("agent", "interface", "memory") with the
    // current-project entry above, and scores strongly, but has zero live
    // signal — no repo/task corroboration.
    const oldProjectMatch = makeEntry({
      path: "wiki/projects/nimbus-2024.md",
      body: "Nimbus is an agent interface and memory system built in 2024, now dormant.",
      score: 95,
      librarianScore: 0.95,
      confidenceProfile: {
        epistemicConfidence: 0.9,
        freshness: 0.05,
        interestAffinity: 0.15,
        retrievalUtility: 0.5,
        associationStrength: 0,
      },
    });

    const currentPaths = gateCurrentness([currentProjectMatch, oldProjectMatch], presentModel, currentStateIntent);

    expect(currentPaths.has(currentProjectMatch.path)).toBe(true);
    expect(currentPaths.has(oldProjectMatch.path)).toBe(false);
  });

  it("gates nothing when the intent is not current_state or task_resume", () => {
    const presentModel: PresentModel = {
      generatedAt: "2026-07-29T00:00:00.000Z",
      repository: null,
      activeTask: { taskKey: "t", projectName: "flyd", status: "running", intendedOutcome: "x", updatedAt: "now" },
      recentCommits: [],
      gaps: [],
    };
    const entry = makeEntry({ path: "wiki/projects/flyd.md", body: "flyd project notes" });

    expect(gateCurrentness([entry], presentModel, generalIntent).size).toBe(0);
  });

  it("gates nothing when there is no present model", () => {
    const entry = makeEntry({ path: "wiki/projects/flyd.md", body: "flyd project notes" });
    expect(gateCurrentness([entry], null, currentStateIntent).size).toBe(0);
  });

  it("normalizes an owner/repo remote slug to its short name for matching", () => {
    const presentModel: PresentModel = {
      generatedAt: "2026-07-29T00:00:00.000Z",
      repository: {
        root: "/Users/george/flyd",
        name: "GeorgeGally/flyd",
        remote: "git@github.com:GeorgeGally/flyd.git",
        branch: "main",
        head: "abc123",
        dirty: true,
        statusLines: [],
        statusDigest: "digest",
      },
      activeTask: null,
      recentCommits: [],
      gaps: [],
    };
    const entry = makeEntry({ path: "wiki/projects/flyd.md", body: "flyd memory recall repair notes" });

    expect(gateCurrentness([entry], presentModel, currentStateIntent).has(entry.path)).toBe(true);
  });

  it("corroborates via a currently-changed file's basename, even without a project-name match", () => {
    const presentModel: PresentModel = {
      generatedAt: "2026-07-29T00:00:00.000Z",
      repository: {
        root: "/Users/george/flyd",
        name: "flyd",
        remote: null,
        branch: "main",
        head: "abc123",
        dirty: true,
        statusLines: [" M cli/src/resolve.ts", "?? cli/src/lib/recent-commits.ts"],
        statusDigest: "digest",
      },
      activeTask: null,
      recentCommits: [],
      gaps: [],
    };
    // No mention of "flyd" anywhere, but does mention the exact file being edited.
    const entry = makeEntry({
      path: "raw/2026-07-29-notes.md",
      body: "Working through a tricky bug in resolve.ts today.",
    });

    expect(gateCurrentness([entry], presentModel, currentStateIntent).has(entry.path)).toBe(true);
  });

  it("does not corroborate a conversation transcript via project-name mention alone", () => {
    const presentModel: PresentModel = {
      generatedAt: "2026-07-29T00:00:00.000Z",
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
      recentCommits: [],
      gaps: [],
    };
    // Almost any past conversation about this repo will mention "flyd" —
    // that alone must not be enough to call an old transcript current.
    const oldConversation = makeEntry({
      path: "conversations/2026-06-01-old.md",
      body: "George asked about flyd and discussed an unrelated feature idea.",
      metadata: { type: "conversation-index" },
    });

    expect(gateCurrentness([oldConversation], presentModel, currentStateIntent).has(oldConversation.path)).toBe(false);
  });

  it("does corroborate a conversation transcript when it mentions a currently-changed file", () => {
    const presentModel: PresentModel = {
      generatedAt: "2026-07-29T00:00:00.000Z",
      repository: {
        root: "/Users/george/flyd",
        name: "flyd",
        remote: null,
        branch: "main",
        head: "abc123",
        dirty: true,
        statusLines: [" M cli/src/currentness-gate.ts"],
        statusDigest: "digest",
      },
      activeTask: null,
      recentCommits: [],
      gaps: [],
    };
    const conversation = makeEntry({
      path: "conversations/2026-07-29-live.md",
      body: "George discussed changes to currentness-gate.ts.",
      metadata: { type: "conversation-index" },
    });

    expect(gateCurrentness([conversation], presentModel, currentStateIntent).has(conversation.path)).toBe(true);
  });

  it("excludes topically-matching but stale entries even with a live signal", () => {
    const presentModel: PresentModel = {
      generatedAt: "2026-07-29T00:00:00.000Z",
      repository: null,
      activeTask: { taskKey: "t", projectName: "flyd", status: "running", intendedOutcome: "x", updatedAt: "now" },
      recentCommits: [],
      gaps: [],
    };
    const staleMatch = makeEntry({
      path: "wiki/projects/flyd-old-notes.md",
      body: "flyd early planning notes",
      confidenceProfile: {
        epistemicConfidence: 0.9,
        freshness: 0.1,
        interestAffinity: 0,
        retrievalUtility: 0.5,
        associationStrength: 0,
      },
    });

    expect(gateCurrentness([staleMatch], presentModel, currentStateIntent).size).toBe(0);
  });
});
