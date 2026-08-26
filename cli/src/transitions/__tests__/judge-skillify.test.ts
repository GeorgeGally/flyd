import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureSkillifyProposalDirectory,
  listPendingProposals,
} from "../../work-intelligence/skillify/proposal-store.js";
import { configureOutcomeJournalDirectory } from "../../work-intelligence/outcome-journal.js";
import { confirmProposal } from "../../work-intelligence/skillify/confirm.js";
import { configureTransitionStore, recordAction, recordNextState } from "../writer.js";
import { groupNegativeLessons, normalizeLessonKey, resetJudgeAttemptsForTests, runJudgeSweep, stopTransitionJudge } from "../judge.js";
import type { LessonJudgment } from "../judge.js";

const mockConfigState = vi.hoisted(() => ({ keyless: false }));
const skillifyState = vi.hoisted(() => ({ throwOnPropose: false }));

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/config.js")>();
  return {
    ...actual,
    resolveModelConnection: () => {
      if (mockConfigState.keyless) throw new Error("No API key is configured");
      return { model: "test-model", apiKey: "test-key", providerIdentity: "test/test-model" };
    },
  };
});

vi.mock("../../work-intelligence/skillify/propose.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../work-intelligence/skillify/propose.js")>();
  return {
    ...actual,
    proposeFromLearningCandidate: (...args: Parameters<typeof actual.proposeFromLearningCandidate>) => {
      if (skillifyState.throwOnPropose) throw new Error("skillify exploded");
      return actual.proposeFromLearningCandidate(...args);
    },
  };
});

const rootDir = mkdtempSync(join(tmpdir(), "flyd-judge-skillify-"));

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

let flydDir = "";

beforeEach(() => {
  flydDir = join(rootDir, randomUUID());
  process.env.FLYD_DIR = flydDir;
  configureTransitionStore({});
  configureSkillifyProposalDirectory(join(flydDir, "skillify-proposals"));
  configureOutcomeJournalDirectory(join(flydDir, "founder-journal"));
  resetJudgeAttemptsForTests();
  mockConfigState.keyless = false;
  skillifyState.throwOnPropose = false;
});

afterEach(() => {
  delete process.env.FLYD_TRANSITIONS_DISABLED;
  delete process.env.FLYD_DIR;
  configureSkillifyProposalDirectory(undefined);
  stopTransitionJudge();
});

function seedNegativeTransition(sessionId: string, invocationId: string, correction?: string): number {
  const action = recordAction({
    sessionId,
    invocationId,
    surface: "overlay",
    intent: `intent for ${invocationId}`,
  });
  if (!action.ok || !action.event) throw new Error(`seed action failed: ${JSON.stringify(action)}`);
  const outcome = recordNextState({
    invocationId,
    origin: "user",
    signal: "ambiguous",
    ...(correction ? { correction } : {}),
  });
  if (!outcome.ok) throw new Error("seed outcome failed");
  return action.event.sequence;
}

function negativeResponse(seqs: number[], rationale: string): string {
  return JSON.stringify(seqs.map((seq) => ({ seq, verdict: -1, confidence: 0.8, rationale })));
}

describe("groupNegativeLessons", () => {
  it("groups by correction text when present, else rationale, normalized", () => {
    const judgments: LessonJudgment[] = [
      { transitionSeq: 1, rationale: "r1", capturedAt: "2026-08-01T00:00:00Z", correlationId: "a", sessionId: "s1", correction: "Always inspect the repo first!" },
      { transitionSeq: 2, rationale: "r2", capturedAt: "2026-08-02T00:00:00Z", correlationId: "b", sessionId: "s2", correction: "always inspect the repo first" },
      { transitionSeq: 3, rationale: "Check the repo state.", capturedAt: "2026-08-03T00:00:00Z", correlationId: "c", sessionId: "s3", correction: null },
      { transitionSeq: 4, rationale: "check   the repo... state", capturedAt: "2026-08-04T00:00:00Z", correlationId: "d", sessionId: "s4", correction: null },
    ];
    const groups = groupNegativeLessons(judgments);
    expect(groups.size).toBe(2);
    const [first, second] = [...groups.values()];
    expect(first.corrections).toEqual(["Always inspect the repo first!", "always inspect the repo first"]);
    expect(second.corrections).toEqual([]);
    expect(normalizeLessonKey("  Hello, WORLD!! ")).toBe("hello world");
  });
});

describe("judge sweep → skillify bridge", () => {
  it("happy path: three distinct sessions with same lesson create one pending proposal; fourth occurrence dedupes", async () => {
    const seqs = [
      seedNegativeTransition("s1", "inv-1", "Always inspect the repo before proposing a fix"),
      seedNegativeTransition("s2", "inv-2", "always inspect the repo before proposing a fix"),
      seedNegativeTransition("s3", "inv-3", "ALWAYS INSPECT THE REPO BEFORE PROPOSING A FIX"),
    ];

    const result = await runJudgeSweep(
      { modelCall: async () => negativeResponse(seqs, "ignored repository state") },
      { graceMs: 0 },
    );
    expect(result.judged).toBe(3);
    expect(result.proposals).toBe(1);

    const pending = listPendingProposals();
    expect(pending).toHaveLength(1);
    expect(pending[0].kind).toBe("constraint");
    expect(pending[0].targetPath).toBe("constraints/behaviour.md");
    expect(pending[0].body).toContain("Always inspect the repo before proposing a fix");
    const proposalId = pending[0].id;

    const fourth = seedNegativeTransition("s4", "inv-4", "always inspect the repo before proposing a fix");
    const rerun = await runJudgeSweep(
      { modelCall: async () => negativeResponse([fourth], "ignored repository state") },
      { graceMs: 0 },
    );
    expect(rerun.proposals).toBe(0);

    const stillPending = listPendingProposals();
    expect(stillPending).toHaveLength(1);
    expect(stillPending[0].id).toBe(proposalId);
  });

  it("edge case: all occurrences in one session stay below threshold", async () => {
    const seqs = [
      seedNegativeTransition("solo", "inv-a", "Never commit straight to main"),
      seedNegativeTransition("solo", "inv-b", "never commit straight to main"),
      seedNegativeTransition("solo", "inv-c", "never commit straight to main"),
    ];

    const result = await runJudgeSweep(
      { modelCall: async () => negativeResponse(seqs, "skipped review") },
      { graceMs: 0 },
    );
    expect(result.judged).toBe(3);
    expect(result.proposals).toBe(0);
    expect(listPendingProposals()).toHaveLength(0);
  });

  it("integration: created proposal flows through the existing confirm flow", async () => {
    const seqs = [
      seedNegativeTransition("s1", "inv-c1", "Keep headings short"),
      seedNegativeTransition("s2", "inv-c2", "keep headings short!"),
      seedNegativeTransition("s3", "inv-c3", "KEEP HEADINGS SHORT"),
    ];

    await runJudgeSweep({ modelCall: async () => negativeResponse(seqs, "bad structure") }, { graceMs: 0 });

    const [proposal] = listPendingProposals();
    const confirmed = confirmProposal(proposal.id, proposal.revision);
    expect(confirmed.ok).toBe(true);
    expect(confirmed.writtenPath).toBe("constraints/behaviour.md");
    expect(existsSync(join(flydDir, "wiki", "constraints", "behaviour.md"))).toBe(true);
    expect(listPendingProposals()).toHaveLength(0);
  });

  it("error path: skillify throwing does not fail the sweep's remaining work", async () => {
    skillifyState.throwOnPropose = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seqs = [
      seedNegativeTransition("s1", "inv-t1", "Quote sources when summarizing"),
      seedNegativeTransition("s2", "inv-t2", "quote sources when summarizing"),
      seedNegativeTransition("s3", "inv-t3", "quote sources when summarizing"),
    ];

    try {
      const result = await runJudgeSweep(
        { modelCall: async () => negativeResponse(seqs, "unsourced claims") },
        { graceMs: 0 },
      );
      expect(result.judged).toBe(3);
      expect(listPendingProposals()).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        "[transitions/judge] skillify bridge failed:",
        "skillify exploded",
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
