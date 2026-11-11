import { describe, expect, it } from "vitest";
import { needsGeorge, readWork, withWorkState, workStateOfRun } from "../work-state.js";
import { PLAY_STATE, playStateOf } from "../state-of-play.js";
import { CARD_STATE, stateOf } from "../../conversation-view/executive.js";
import { OUTCOME_STATE, stateOfItem } from "../../conversation-view/for-george.js";
import { RAIL_STATE, railState } from "../../conversation-view/rail.js";
import { jobRunFromDomain, jobsFrom } from "../../conversation-view/jobs.js";
import type { DomainRun } from "../../command/types.js";
import { GOLDEN } from "./work-state-golden.js";

const answer = (text: string) => ({ id: "a", role: "assistant" as const, text, timestamp: "2026-11-11T00:00:00Z", answers: "q" });

describe("the one work reader, against the golden table", () => {
  for (const row of GOLDEN) {
    it(`${row.state ?? "nothing"}: ${row.sentence}`, () => {
      expect(readWork(row.sentence)).toBe(row.state);
      // Every surface shows the same reading in its own words.
      expect(stateOf(row.sentence)).toBe(row.state ? CARD_STATE[row.state] : null);
      expect(stateOfItem(row.sentence)).toBe(row.state ? OUTCOME_STATE[row.state] : "note");
      expect(playStateOf(row.sentence)).toBe(row.state ? PLAY_STATE[row.state] : undefined);
      const rail = railState({ answer: answer(row.sentence) as never });
      // The rail reads "moving" from an answer's lead only; the golden rows that move say so in their lead.
      expect(rail).toBe(row.state ? RAIL_STATE[row.state] : "done");
    });
  }

  it("has one definition of work that waits on George", () => {
    expect(["moving", "needs_you", "blocked", "ready", "landed", "handled"].filter(needsGeorge)).toEqual(["needs_you", "ready"]);
  });
});

function run(status: DomainRun["status"], brief: string): DomainRun {
  return {
    id: `run-${status}`,
    request: { id: "r", domain: "coding", originalMessage: "fix it", intendedOutcome: "Fix the menu", doneWhen: [], createdAt: "2026-11-11T00:00:00Z" },
    owner: "firstmate",
    status,
    createdAt: "2026-11-11T00:00:00Z",
    updatedAt: "2026-11-11T00:00:00Z",
    transport: { kind: "native", requestId: "r" },
    result: { format: "raw", brief, detailedReport: brief, decisionsMade: [], unresolvedQuestions: [], risks: [], evidence: [], artifacts: [], specialistOutputs: [], raw: [brief], informationLossRisk: "high" },
  };
}

describe("a run's work state", () => {
  it("is read from its judged outcome, with the reply's words for what the outcome alone cannot say", () => {
    expect(workStateOfRun("needs_decision")).toBe("needs_you");
    expect(workStateOfRun("failed")).toBe("blocked");
    expect(workStateOfRun("cancelled")).toBe("handled");
    expect(workStateOfRun("completed", run("completed", "The menu fix is merged.").result)).toBe("landed");
    expect(workStateOfRun("completed", run("completed", "The fix is ready to merge.").result)).toBe("ready");
    expect(workStateOfRun("working", run("working", "Blocked on the Stripe key.").result)).toBe("blocked");
    expect(workStateOfRun("working", run("working", "The fix is under way.").result)).toBe("moving");
  });

  it("is stored with the result, and Jobs reads the stored state", () => {
    const ready = withWorkState(run("completed", "The fix is ready to merge."));
    expect(ready.result?.workState).toBe("ready");
    const blocked = withWorkState(run("working", "Blocked on the Stripe key."));
    expect(jobRunFromDomain(blocked).work).toBe("blocked");
    // Jobs takes what was stored, not a fresh reading of the words.
    const stored = { ...ready, result: { ...ready.result!, workState: "landed" as const } };
    expect(jobRunFromDomain(stored).work).toBe("landed");
  });

  it("puts each run on the Jobs board by its work state", () => {
    const now = Date.parse("2026-11-11T01:00:00Z");
    const board = jobsFrom({
      runs: [withWorkState(run("completed", "The fix is ready to merge.")), withWorkState(run("working", "Blocked on the Stripe key."))].map(jobRunFromDomain),
      now,
    });
    const states = board.jobs.map((job) => [job.group, job.state]);
    expect(states).toEqual(expect.arrayContaining([["needs", "Ready to land"], ["waiting", "Blocked"]]));
  });
});
