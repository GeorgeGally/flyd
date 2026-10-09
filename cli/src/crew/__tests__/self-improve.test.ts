import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendJournalTurn } from "../../council/journal.js";
import { saveTask, type CrewTask } from "../crew.js";
import { gatherEvidence, improverPrompt, parseImprovement, runSelfImprovement } from "../self-improve.js";
import { saveDomainRun } from "../../command/store.js";
import type { DomainRun } from "../../command/types.js";

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
    expect(dispatch).toHaveBeenCalledWith("/flyd", expect.stringContaining("what's on today"), ["the diff adds or changes a test that exercises the new behaviour"]);
    expect(notify.mock.calls[0]).toEqual(["Flyd", "I'm teaching myself to check the calendar for day questions. I'll show you before anything changes."]);

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

describe("domain handoffs as improvement evidence", () => {
  it("surfaces failed and unstructured manager handoffs without losing the raw result", () => {
    const base = {
      id: "domain-a",
      request: {
        id: "domain-a", domain: "coding" as const, originalMessage: "fix it", intendedOutcome: "fix it",
        doneWhen: ["works"], createdAt: "2026-09-26T10:00:00Z", source: "chat" as const,
      },
      owner: "FirstMate", createdAt: "2026-09-26T10:00:00Z", updatedAt: "2026-09-26T11:00:00Z",
      transport: { kind: "firstmate" as const, requestId: "domain-a" },
    };
    saveDomainRun({ ...base, status: "failed", failure: "handoff broke" } satisfies DomainRun, join(home, "command"));
    saveDomainRun({
      ...base, id: "domain-b", request: { ...base.request, id: "domain-b" }, status: "completed",
      transport: { kind: "firstmate", requestId: "domain-b" },
      result: {
        format: "raw", brief: "done", detailedReport: "full detail survives here", decisionsMade: [],
        unresolvedQuestions: [], risks: [], evidence: [], artifacts: [], specialistOutputs: [],
        raw: ["full detail survives here"], informationLossRisk: "high",
      },
    } satisfies DomainRun, join(home, "command"));

    const evidence = gatherEvidence({ flydDir: home, now: NOW });
    expect(evidence.find((item) => item.id === "domain:domain-a")?.text).toContain("handoff broke");
    expect(evidence.find((item) => item.id === "domain-result:domain-b")?.text).toContain("unstructured domain handoff");
  });
});

describe("harness failures as evidence", () => {
  it("collects jobs that fell short, crew work a review found short, and loops the harness stopped", () => {
    mkdirSync(join(home, "jobs"), { recursive: true });
    const check = (met: boolean) => ({ criterion: "three mixes exist", met, note: met ? "yes" : "only one" });
    writeFileSync(join(home, "jobs", "a1.json"), JSON.stringify({ id: "a1", status: "short", startedAt: "2026-09-26T10:00:00Z", contract: { task: "new DIR mixes" }, checks: [check(false)] }));
    writeFileSync(join(home, "jobs", "a2.json"), JSON.stringify({ id: "a2", status: "ok", startedAt: "2026-09-26T10:00:00Z", contract: { task: "fine" }, checks: [check(true)] }));
    saveTask(task({ id: "c1", status: "ready", review: [{ criterion: "a test covers it", met: false, note: "no test" }] }));
    saveTask(task({ id: "c2", status: "ready", review: [{ criterion: "ok", met: true, note: "" }] }));
    saveTask(task({ id: "c3", status: "ready", review: [{ criterion: "x", met: false, note: "the review couldn't run", unchecked: true }] }));
    writeFileSync(join(home, "jobs", "a3.json"), JSON.stringify({ id: "a3", status: "interrupted", startedAt: "2026-09-26T10:00:00Z", contract: { task: "cut off" }, checks: [] }));
    mkdirSync(join(home, "turn-receipts", "s1"), { recursive: true });
    writeFileSync(join(home, "turn-receipts", "s1", "1.json"), JSON.stringify({
      recordedAt: "2026-09-26T12:00:00Z", message: "build DIR",
      toolCalls: [{ name: "bash", error: "Skipped: this exact bash call already failed 2 times the same way (Error: exit 1)." }],
    }));
    const evidence = gatherEvidence({ flydDir: home, now: NOW });
    expect(evidence.map((item) => item.id).sort()).toEqual(["crew-review:c1", "job:a1", "job:a3", "loop:s1:1.json"]);
    expect(evidence.find((item) => item.id === "job:a3")!.text).toContain("cut off by a restart");
    expect(evidence.find((item) => item.kind === "job")!.text).toContain("three mixes exist (only one)");
    expect(evidence.find((item) => item.kind === "loop")!.text).toContain("build DIR");
  });

  it("asks for the most durable fix and keeps its class, layer and done_when", () => {
    const prompt = improverPrompt([], [], "2026-09-27");
    expect(prompt).toContain("A prompt rule is the last resort");
    expect(prompt).toContain("repeated_loop");
    const parsed = parseImprovement(JSON.stringify({ improvement: {
      title: "Validate calendar answers", failure_class: "bad_output", layer: "check", outcome: "o", why: "w",
      done_when: ["an answer about today cites a calendar tool call", ""], evidence: ["fix:f1"],
    } }), [{ id: "fix:f1", kind: "fix", at: "", text: "" }]);
    expect(parsed).toMatchObject({ failureClass: "bad_output", layer: "check", doneWhen: ["an answer about today cites a calendar tool call"] });
    expect(parseImprovement(JSON.stringify({ improvement: { title: "t", outcome: "o", failure_class: "vibes", layer: "hope", evidence: ["fix:f1"] } }), [{ id: "fix:f1", kind: "fix", at: "", text: "" }]))
      .toEqual({ title: "t", outcome: "o", why: "", evidence: ["fix:f1"] });
  });

  it("hands the crew done_when, always including a test that fails before the fix", async () => {
    seedEvidence();
    const complete = async () => JSON.stringify({ improvement: {
      title: "Stop retrying", failure_class: "repeated_loop", layer: "check", outcome: "o", why: "w",
      done_when: ["the loop stops"], evidence: ["fix:f1"],
    } });
    const dispatch = vi.fn(async (repo: string, outcome: string, _doneWhen: string[]) => {
      const dispatched = task({ repo, outcome, status: "running" });
      saveTask(dispatched);
      return dispatched;
    });
    await runSelfImprovement({ complete, dispatch, flydDir: home, repo: "/flyd", now: () => NOW });
    expect(dispatch.mock.calls[0][2]).toEqual(["the loop stops", "the diff adds or changes a test that exercises the new behaviour"]);
    expect(dispatch.mock.calls[0][1]).toContain("Failure kind: repeated_loop; fix it at the check layer.");
  });
});
