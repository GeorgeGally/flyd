import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendJournalTurn } from "../../council/journal.js";
import { saveTask, type CrewTask } from "../crew.js";
import { gatherEvidence, parseImprovement, runSelfImprovement } from "../self-improve.js";

let home: string;
const NOW = new Date("2026-09-27T09:00:00Z");

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "flyd-improve-"));
  process.env.FLYD_SELF_IMPROVE_DIR = join(home, "state");
  process.env.FLYD_CREW_DIR = join(home, "crew");
  process.env.FLYD_JOURNAL_DIR = join(home, "journal");
  process.env.FLYD_ADVISORIES_PATH = join(home, "advisories.jsonl");
  process.env.FLYD_SELF_IMPROVE = "1";
});
afterEach(() => {
  process.env.FLYD_SELF_IMPROVE = "0";
  rmSync(home, { recursive: true, force: true });
});

function seedEvidence() {
  mkdirSync(join(home, "evals", "incidents"), { recursive: true });
  mkdirSync(join(home, "fixes"), { recursive: true });
  writeFileSync(join(home, "fixes", "f1.json"), JSON.stringify({ id: "f1", recordedAt: "2026-09-26T10:00:00Z" }));
  writeFileSync(join(home, "evals", "incidents", "f1.json"), JSON.stringify({
    incidentId: "f1", prompt: "what's on today", rejectedAnswer: "I can help with many things",
    expected: { feedback: "check my calendar", failureClasses: ["missing_tool_use"] },
  }));
  mkdirSync(join(home, "evals", "chat"), { recursive: true });
  writeFileSync(join(home, "evals", "chat", "2026-09-26T14-56-30-926Z.jsonl"), [
    JSON.stringify({ id: "ok-case", passed: true }),
    JSON.stringify({ id: "iq-plain", passed: false, failures: ["judge 4 < 6"], judgeScore: 4, judgeReason: "too long" }),
  ].join("\n"));
  appendJournalTurn({ user: "draft the email to Sam", assistant: "Here is a draft about Tom", at: new Date("2026-09-26T11:00:00Z") });
  appendJournalTurn({ user: "no, I said Sam not Tom", assistant: "Sorry", at: new Date("2026-09-26T11:01:00Z") });
  appendJournalTurn({ user: "nice, thanks", assistant: "👍", at: new Date("2026-09-26T11:02:00Z") });
}

const task = (overrides: Partial<CrewTask> = {}): CrewTask => ({
  id: "t1", repo: "/r", outcome: "x", branch: "flyd/x", baseBranch: "main", baseCommit: "abc", worktree: "/w",
  status: "ready", log: "/l", createdAt: NOW.toISOString(), source: "self-improvement", ...overrides,
});

describe("gatherEvidence", () => {
  it("collects corrections, failed evals, and pushback — not praise or passes", () => {
    seedEvidence();
    const evidence = gatherEvidence({ flydDir: home, now: NOW });
    const kinds = evidence.map((item) => item.kind).sort();
    expect(kinds).toEqual(["eval", "fix", "pushback"]);
    expect(evidence.find((item) => item.kind === "pushback")!.text).toContain("draft the email to Sam");
    expect(evidence.find((item) => item.kind === "eval")!.id).toContain("iq-plain");
  });
});

describe("parseImprovement", () => {
  const evidence = [{ id: "fix:f1", kind: "fix" as const, at: "", text: "" }];
  it("rejects improvements that cite no real evidence", () => {
    expect(parseImprovement(JSON.stringify({ improvement: { title: "t", outcome: "o", evidence: ["made-up"] } }), evidence)).toBeNull();
    expect(parseImprovement(JSON.stringify({ improvement: null }), evidence)).toBeNull();
  });
  it("keeps only evidence ids it was shown", () => {
    const parsed = parseImprovement(JSON.stringify({ improvement: { title: "t", outcome: "o", why: "w", evidence: ["fix:f1", "bogus"] } }), evidence);
    expect(parsed?.evidence).toEqual(["fix:f1"]);
  });
});

describe("runSelfImprovement", () => {
  const complete = vi.fn(async () => JSON.stringify({ improvement: {
    title: "Check the calendar for day questions", outcome: "Add a prompt rule and test", why: "George had to ask twice", evidence: ["fix:f1"],
  } }));

  it("dispatches one evidence-backed fix to the crew, then waits for George", async () => {
    seedEvidence();
    const dispatch = vi.fn(async (repo: string, outcome: string) => {
      const dispatched = task({ repo, outcome, status: "running" });
      saveTask(dispatched);
      return dispatched;
    });
    const notify = vi.fn(async (_title: string, _message: string) => undefined);
    const first = await runSelfImprovement({ complete, dispatch, notify, flydDir: home, repo: "/flyd", now: () => NOW });
    expect(first.status).toBe("dispatched");
    expect(dispatch).toHaveBeenCalledWith("/flyd", expect.stringContaining("what's on today"));
    expect(notify.mock.calls[0][1]).toContain("/land t1");

    // A day later the fix is still waiting on George: nothing new is started.
    const later = () => new Date(NOW.getTime() + 25 * 3_600_000);
    expect((await runSelfImprovement({ complete, dispatch, flydDir: home, now: later })).status).toBe("awaiting_george");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("runs at most daily and never re-reads evidence it already judged", async () => {
    seedEvidence();
    const none = vi.fn(async () => JSON.stringify({ improvement: null }));
    const dispatch = vi.fn();
    expect((await runSelfImprovement({ complete: none, dispatch, flydDir: home, now: () => NOW })).status).toBe("nothing_worth_fixing");
    expect((await runSelfImprovement({ complete: none, dispatch, flydDir: home, now: () => NOW })).status).toBe("not_due");
    const tomorrow = () => new Date(NOW.getTime() + 25 * 3_600_000);
    expect((await runSelfImprovement({ complete: none, dispatch, flydDir: home, now: tomorrow })).status).toBe("no_new_evidence");
    expect(none).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does nothing once George has turned it off", async () => {
    process.env.FLYD_SELF_IMPROVE = "0";
    expect((await runSelfImprovement({ complete, flydDir: home, now: () => NOW })).status).toBe("disabled");
  });
});
