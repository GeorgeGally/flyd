import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import type { ExecutiveDecisionRecord } from "../../intelligence/executive/decision-step.js";
import { dispatchBrief, type Dispatch } from "../cos/dispatch.js";
import { mutateObjective, openObjective, readObjective } from "../cos/objectives.js";
import { planOf } from "../cos/plan.js";
import { plainStatus, tellWork, workStatus } from "../cos/steer.js";
import { cosTick, STUCK_MS, UNCONFIRMED_MS } from "../cos/tick.js";
import type { CosReport, PlannedRun } from "../cos/types.js";
import type { sendRunMessage } from "../messages.js";
import { createDomainRun, readDomainRun, updateDomainRun } from "../store.js";
import type { DomainRun } from "../types.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "flyd-cos-waiting-"));
  process.env.FLYD_COMMAND_DIR = join(home, "command");
  process.env.FLYD_CREW_DIR = join(home, "crew");
  process.env.FLYD_BACKGROUND_JOBS_DIR = join(home, "jobs");
});
afterEach(() => {
  delete process.env.FLYD_COMMAND_DIR;
  delete process.env.FLYD_CREW_DIR;
  delete process.env.FLYD_BACKGROUND_JOBS_DIR;
  rmSync(home, { recursive: true, force: true });
});

const decision = (): ExecutiveDecisionRecord => ({
  schema: "flyd.executive-decision.v1", decisionId: "decision-wait", sourceId: "domain.knowledge", sourceEventId: "event-wait", taskId: "x",
  disposition: "handle_internally", reason: "finished", summary: "Done.", evidenceRefs: [],
  verification: { status: "verified", evidenceRefs: [] }, show: true, notify: true, createdAt: "2026-11-11T00:00:00.000Z",
});

/** Teams that accept each request id once; `firstmate` makes coding runs FirstMate's, chased by its fleet monitor. */
function harness(plan: string) {
  const store = new IntelligenceEventStore({ path: join(home, "intelligence.sqlite") });
  const said: CosReport[] = [];
  const told: string[] = [];
  const asked: Array<{ run: string; kind: string; body: string }> = [];
  let clock = Date.now();
  const dispatch: Dispatch = async (objective, brief, requestId) => {
    if (readDomainRun(requestId)) return { ref: requestId };
    const at = new Date().toISOString();
    const firstmate = brief.team === "coding";
    const run: DomainRun = {
      id: requestId, owner: firstmate ? "FirstMate" : brief.team === "knowledge" ? "Librarian" : "Design Mate", status: "working", createdAt: at, updatedAt: at,
      transport: { kind: firstmate ? "firstmate" : "native", requestId },
      request: { id: requestId, domain: brief.team, originalMessage: objective.words, intendedOutcome: brief.outcome, doneWhen: brief.doneWhen, createdAt: at, objectiveId: objective.id },
    };
    return { ref: createDomainRun(run).run.id };
  };
  const send = (async ({ run, kind, body }) => { asked.push({ run: run.id, kind, body }); return { delivered: true, run }; }) as typeof sendRunMessage;
  const deps = {
    store, dispatch, send,
    complete: async (prompt: string) => (prompt.includes("Flyd handed you this piece") ? plan : JSON.stringify({ met: true })),
    decide: async () => decision(),
    tell: async (_run: DomainRun, _decision: ExecutiveDecisionRecord, key: string) => { told.push(key); },
    say: async (report: CosReport) => { said.push(report); },
    now: () => new Date(clock),
  };
  const finishRun = (id: string, status: DomainRun["status"] = "completed") => updateDomainRun(id, (run) => ({
    ...run, status, updatedAt: new Date(Date.parse(run.updatedAt) + 1_000).toISOString(), ...(status === "failed" ? { failure: "the source site was down" } : {}),
    result: { format: "structured", brief: `${id} done`, detailedReport: "", decisionsMade: [], unresolvedQuestions: [], risks: [], evidence: [], artifacts: [], specialistOutputs: [], raw: [], informationLossRisk: "low" },
  }));
  return { store, said, told, asked, deps, finishRun, later: (ms: number) => { clock += ms; }, clock: () => new Date(clock) };
}

const TWO_RESEARCH = JSON.stringify({
  team: "knowledge", outcome: "Compare the two banks and the two card providers", done_when: ["both compared"],
  runs: [
    { id: "banks", team: "knowledge", outcome: "Compare the two banks", done_when: ["fees sourced"], after: [] },
    { id: "cards", team: "knowledge", outcome: "Compare the two card providers", done_when: ["fees sourced"], after: [] },
  ],
});

describe("snooze", () => {
  it("defers a genuinely user-owned authorization until the chosen time while independent work continues", async () => {
    const h = harness(TWO_RESEARCH);
    const { id } = openObjective({ words: "compare banks and card providers for the shop", flydNotes: "", origin: { surface: "chat" } });
    await cosTick(h.deps);
    // A real personal authorization can be held; routine failure recovery
    // no longer creates this state.
    mutateObjective(id, (current) => current && ({
      ...current, status: "needs_george",
      waitingOn: { reportId: "approval-real", kind: "run", question: "Approve the account authorization?", at: h.clock().toISOString() },
    }));
    const outcome = await tellWork({ message: "remind me tomorrow morning", kind: "snooze", until: "tomorrow_morning" }, h.deps.send, h.clock());
    const today = h.clock();
    expect(outcome).toEqual({ delivered: true, objectiveId: id, until: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 8).toISOString() });
    expect(workStatus()).toContain(`snoozed until ${outcome.until}`);
    h.finishRun(`${id}-r2`);
    h.later(60 * 60_000);
    await cosTick(h.deps);
    expect(h.said).toHaveLength(0);
    h.later(Date.parse(outcome.until!) - h.clock().getTime() + 1_000);
    await cosTick(h.deps);
    await cosTick(h.deps);
    expect(h.said.map((report) => report.outcome)).toEqual(["Back as you asked: Approve the account authorization?"]);
    expect(readObjective(id)?.status).toBe("needs_george");
    h.store.close();
  });

});

describe("stuck work", () => {
  it("chases responsive teams but parks a genuinely unknown quiet job without a user retry choice", async () => {
    const h = harness(JSON.stringify({ team: "knowledge", outcome: "Compare Stripe and Paddle", done_when: ["sourced"] }));
    const chased = openObjective({ words: "stripe or paddle?", flydNotes: "", origin: { surface: "chat" } }).id;
    await cosTick(h.deps);
    h.later(STUCK_MS + 60_000);
    await cosTick(h.deps);
    await cosTick(h.deps);
    expect([h.said, h.asked.map((message) => [message.run, message.kind]), readObjective(chased)?.triage?.map((item) => item.choice)])
      .toEqual([[], [[`${chased}-r1`, "question"]], ["nudge"]]);
    mutateObjective(chased, (current) => current && { ...current, status: "done" });

    const quiet = openObjective({ words: "book the table", flydNotes: "", origin: { surface: "chat" } }).id;
    mutateObjective(quiet, (current) => current && { ...current, status: "working", runs: ["job:j9"] });
    h.later(STUCK_MS + 60_000);
    await cosTick(h.deps);
    await cosTick(h.deps);
    expect(h.said.map((report) => [report.kind, report.options])).toEqual([["blocked", undefined]]);
    expect(readObjective(quiet)?.status).toBe("working");
    expect(readObjective(quiet)?.waitingOn).toBeUndefined();
    expect(readObjective(quiet)?.parked?.reason).toContain("one-off job");
    await cosTick(h.deps);
    expect(h.said).toHaveLength(1);
    h.store.close();
  });

});

describe("every wait carries a question", () => {
  it("writes one when work waits on him with nothing asked, and briefs again from his answer when it couldn't start", async () => {
    const h = harness("{}");
    // Waiting with nothing planned: it never started, so the question asks for more, and his answer briefs it again.
    const silent = openObjective({ words: "sort the invoices", flydNotes: "", origin: { surface: "chat" } }).id;
    mutateObjective(silent, (current) => current && { ...current, status: "needs_george", runs: [], plan: [] });
    await cosTick(h.deps);
    await cosTick(h.deps);
    expect(h.said.map((report) => report.outcome)).toEqual(["I couldn't get “sort the invoices” started; tell me a bit more and I'll set it going."]);
    expect(readObjective(silent)?.waitingOn?.kind).toBe("intake");
    mutateObjective(silent, (current) => current && { ...current, status: "done" });

    // One left waiting with no question recorded (or a stale one): his words still brief it again, never "Which part is this for: ?".
    const stale = openObjective({ words: "tidy the shop listings", flydNotes: "", origin: { surface: "chat" } }).id;
    mutateObjective(stale, (current) => current && { ...current, status: "needs_george" });
    expect(await tellWork({ message: "the Etsy ones, not eBay", kind: "correction", objectiveId: stale }, h.deps.send, h.clock())).toEqual({ delivered: true, objectiveId: stale });
    expect([readObjective(stale)?.status, readObjective(stale)?.flydNotes]).toEqual(["intake", "His answer when asked for more: the Etsy ones, not eBay"]);
    mutateObjective(stale, (current) => current && { ...current, status: "done" });

    // Couldn't start; his answer goes back to intake on the same objective, with his words.
    const vague = openObjective({ words: "do the thing", flydNotes: "", origin: { surface: "chat" } }).id;
    await cosTick(h.deps);
    expect(h.said.at(-1)?.outcome).toBe("I couldn't get “do the thing” started; tell me a bit more and I'll set it going.");
    await tellWork({ message: "compare Stripe and Paddle fees for the print shop", kind: "decision" }, h.deps.send, h.clock());
    expect([readObjective(vague)?.status, readObjective(vague)?.flydNotes]).toEqual(["intake", "His answer when asked for more: compare Stripe and Paddle fees for the print shop"]);
    // Refused again: told again, and it waits on him rather than briefing every tick.
    h.later(1_000);
    await cosTick(h.deps);
    await cosTick(h.deps);
    expect([readObjective(vague)?.status, readObjective(vague)?.waitingOn?.kind, h.said.filter((report) => report.kind === "blocked" && report.objectiveId === vague).length]).toEqual(["needs_george", "intake", 2]);
    h.store.close();
  });
});

describe("a one-off job's retry", () => {
  it("asks before his words alone run it again", async () => {
    const h = harness("{}");
    const id = openObjective({ words: "book the table", flydNotes: "", origin: { surface: "chat" } }).id;
    const plan: PlannedRun[] = [{ key: "r1", team: "life", outcome: "Book the table for Friday", doneWhen: ["booked"], state: "failed", attempt: 1, validFor: 0, ref: "job:j1", reviewed: "job:j1:failed" }];
    mutateObjective(id, (current) => current && {
      ...current, status: "needs_george", runs: ["job:j1"], plan,
      waitingOn: { reportId: `${id}:job:j1:failed`, kind: "retry", question: "Book the table didn't finish.", options: ["Try another way", "Drop it"], at: new Date().toISOString() },
    });
    const before = readObjective(id);
    expect(await tellWork({ message: "try the other restaurant", kind: "decision" }, h.deps.send, h.clock()))
      .toEqual({ delivered: false, objectiveId: id, reason: "not_steerable", ask: "“Book the table for Friday” already ran; run it again with this?", again: "Try another way" });
    expect(readObjective(id)).toEqual(before);
    h.store.close();
  });

  it("re-queues with his words when its dispatch was refused, since it never ran", async () => {
    const h = harness("{}");
    const id = openObjective({ words: "book the table", flydNotes: "", origin: { surface: "chat" } }).id;
    const plan: PlannedRun[] = [{ key: "r1", team: "life", outcome: "Book the table for Friday", doneWhen: ["booked"], state: "failed", attempt: 1, validFor: 0, failure: "refused" }];
    mutateObjective(id, (current) => current && {
      ...current, status: "needs_george", runs: [], plan,
      waitingOn: { reportId: `${id}:dispatch:r1:1`, kind: "retry", question: "I couldn't get it started.", options: ["Try again", "Drop it"], at: new Date().toISOString() },
    });
    expect(await tellWork({ message: "it's at Nando's, 7pm", kind: "decision" }, h.deps.send, h.clock())).toEqual({ delivered: true, objectiveId: id });
    const run = planOf(readObjective(id)!)[0]!;
    expect([readObjective(id)?.status, run.state, run.failure]).toEqual(["working", "queued", "refused. George said: it's at Nando's, 7pm"]);
    h.store.close();
  });
});

describe("plain run statuses", () => {
  it("names how a run went only when there is something to say", () => {
    const run = (extra: Partial<PlannedRun>): PlannedRun => ({ key: "r1", team: "knowledge", outcome: "x", doneWhen: ["y"], state: "dispatched", attempt: 1, validFor: 0, ...extra });
    expect([
      plainStatus(run({}), {}),
      plainStatus(run({ reconciled: true }), {}),
      plainStatus(run({ state: "completed", attempt: 2, failure: "it didn't finish" }), {}),
      plainStatus(run({ state: "queued", prior: ["obj-r1"] }), {}),
      plainStatus(run({ state: "completed", reportedTwice: true }), {}),
    ]).toEqual([null, "interrupted, retrying", "picked up (a retry finished it)", "replaced (a newer revision took over)", "reported twice (one result kept)"]);
  });
});

describe("a result that fell short", () => {
  it("retains a verified acceptance shortfall and parks it after bounded recovery without asking George for testing tactics", async () => {
    const h = harness(JSON.stringify({ team: "knowledge", outcome: "Compare Stripe and Paddle", done_when: ["fees sourced"] }));
    let checks = 0;
    const deps = { ...h.deps, complete: async (prompt: string) => {
      if (prompt.includes("Flyd handed you this piece")) return JSON.stringify({ team: "knowledge", outcome: "Compare Stripe and Paddle", done_when: ["fees sourced"] });
      checks += 1;
      return JSON.stringify({ met: false, missing: "Paddle's payout fees" });
    } };
    const id = openObjective({ words: "stripe or paddle?", flydNotes: "", origin: { surface: "chat" } }).id;
    await cosTick(deps);
    for (const suffix of ["", "-2", "-3"]) {
      h.finishRun(`${id}-r1${suffix}`);
      await cosTick(deps);
    }
    await cosTick(deps);
    expect(checks).toBe(3);
    expect(readObjective(id)?.status).toBe("working");
    expect(readObjective(id)?.parked?.reason).toContain("Paddle's payout fees");
    expect(readObjective(id)?.waitingOn).toBeUndefined();
    expect(h.said.map((report) => report.kind)).toEqual(["blocked"]);
    h.store.close();
  });

});

describe("a hand-over that was never confirmed", () => {
  it("looks up unknown handoffs, then parks without automatically repeating side effects", async () => {
    const h = harness("{}");
    const replays: string[] = [];
    const dispatch: Dispatch = async (objective, brief, requestId, options) => {
      if (options?.replay) { replays.push(requestId); return { unknown: "no one-off job was found for this request" }; }
      return h.deps.dispatch(objective, brief, requestId);
    };
    const deps = { ...h.deps, dispatch };
    const id = openObjective({ words: "book the table", flydNotes: "", origin: { surface: "chat" } }).id;
    const plan: PlannedRun[] = [{ key: "r1", team: "life", outcome: "Book the table for Friday", doneWhen: ["booked"], state: "dispatching", attempt: 1, validFor: 0, dispatching: { pid: 999_999_999, at: h.clock().toISOString() } }];
    mutateObjective(id, (current) => current && { ...current, status: "working", plan, brief: { team: "life", outcome: "Book the table", doneWhen: ["booked"], decisions: { comesBack: [], settledByPolicy: [] } } });
    await cosTick(deps);
    await cosTick(deps);
    expect([planOf(readObjective(id)!)[0]?.state, h.said.length, replays.length]).toEqual(["unknown", 0, 3]);

    h.later(UNCONFIRMED_MS + 1_000);
    await cosTick(deps);
    await cosTick(deps);
    expect(h.said.map((report) => [report.kind, report.options])).toEqual([["blocked", undefined]]);
    expect([readObjective(id)?.status, readObjective(id)?.waitingOn]).toEqual(["working", undefined]);
    expect(readObjective(id)?.parked?.reason).toContain("Unconfirmed handoff");
    expect(planOf(readObjective(id)!)[0]?.state).toBe("unknown");
    h.store.close();
  });

  it("reconciles a late receipt even after CoS parked an uncertain dispatch", async () => {
    const h = harness("{}");
    let found = false;
    const dispatch: Dispatch = async (_objective, _brief, requestId, options) =>
      (options?.replay && found ? { ref: `job:${requestId}` } : { unknown: "not found" });
    const deps = { ...h.deps, dispatch };
    const id = openObjective({ words: "book the table", flydNotes: "", origin: { surface: "chat" } }).id;
    const plan: PlannedRun[] = [{ key: "r1", team: "life", outcome: "Book the table for Friday", doneWhen: ["booked"], state: "unknown", attempt: 1, validFor: 0 }];
    mutateObjective(id, (current) => current && { ...current, status: "working", plan });
    await cosTick(deps);
    h.later(UNCONFIRMED_MS + 1_000);
    await cosTick(deps);
    expect(readObjective(id)?.parked).toBeDefined();
    found = true;
    await cosTick(deps);
    expect([readObjective(id)?.status, planOf(readObjective(id)!)[0]?.state, readObjective(id)?.runs])
      .toEqual(["working", "dispatched", [`job:${id}-r1`]]);
    h.store.close();
  });

  it("never reopens an objective cancelled during reconciliation", async () => {
    const h = harness("{}");
    let id = "";
    let cancelNow = false;
    const dispatch: Dispatch = async (_objective, _brief, requestId, options) => {
      if (!options?.replay || !cancelNow) return { unknown: "not found" };
      mutateObjective(id, (current) => current && { ...current, status: "cancelled" });
      return { ref: `job:${requestId}` };
    };
    const deps = { ...h.deps, dispatch };
    id = openObjective({ words: "book the table", flydNotes: "", origin: { surface: "chat" } }).id;
    const plan: PlannedRun[] = [{ key: "r1", team: "life", outcome: "Book the table for Friday", doneWhen: ["booked"], state: "unknown", attempt: 1, validFor: 0, unknownAt: h.clock().toISOString() }];
    mutateObjective(id, (current) => current && { ...current, status: "working", plan });
    h.later(UNCONFIRMED_MS + 1_000);
    await cosTick(deps);
    cancelNow = true;
    await cosTick(deps);
    expect([readObjective(id)?.status, planOf(readObjective(id)!)[0]?.state]).toEqual(["cancelled", "dispatched"]);
    h.store.close();
  });

  it("finds a one-off job or crew task by the request id it was started under", async () => {
    const objective = openObjective({ words: "book the table", flydNotes: "", origin: { surface: "chat" } });
    const at = new Date().toISOString();
    mkdirSync(join(home, "jobs"), { recursive: true });
    writeFileSync(join(home, "jobs", "j1.json"), JSON.stringify({ id: "j1", contract: { task: "Book", doneWhen: [], objectiveId: objective.id, requestId: `${objective.id}-r1` }, prompt: "", status: "running", pid: 1, startedAt: at, updatedAt: at, progress: "", attempts: 0, checks: [] }));
    const brief = { team: "life" as const, outcome: "Book", doneWhen: [], decisions: { comesBack: [], settledByPolicy: [] } };
    expect(await dispatchBrief(objective, brief, `${objective.id}-r1`, { replay: true })).toEqual({ ref: "job:j1" });
    expect(await dispatchBrief(objective, brief, `${objective.id}-r2`, { replay: true })).toEqual({ unknown: "no one-off job was found for this request" });
  });
});

describe("a run handed to the crew", () => {
  function crewTask(id: string, status: string): void {
    mkdirSync(join(home, "crew", "tasks"), { recursive: true });
    writeFileSync(join(home, "crew", "tasks", `${id}.json`), JSON.stringify({ id, repo: "/tmp/r", outcome: "Fix the footer", branch: "b", baseBranch: "main", baseCommit: "c", worktree: "/tmp/w", status, log: "/tmp/l", createdAt: new Date().toISOString(), summary: "Footer fixed.", ...(status === "failed" ? { failure: "tests failed" } : {}) }));
  }

  it("settles with the crew task and closes its objective without telling him twice", async () => {
    const h = harness("{}");
    const id = openObjective({ words: "fix the footer", flydNotes: "", origin: { surface: "chat" } }).id;
    const plan: PlannedRun[] = [{ key: "r1", team: "coding", outcome: "Fix the footer", doneWhen: ["footer fixed"], state: "dispatched", attempt: 1, validFor: 0, ref: "crew:t1" }];
    mutateObjective(id, (current) => current && { ...current, status: "working", plan, runs: ["crew:t1"] });
    crewTask("t1", "running");
    await cosTick(h.deps);
    expect(readObjective(id)?.status).toBe("working");
    crewTask("t1", "ready");
    await cosTick(h.deps);
    await cosTick(h.deps);
    expect([readObjective(id)?.status, planOf(readObjective(id)!)[0]?.state, h.said.length, readObjective(id)?.reportIds.length]).toEqual(["done", "completed", 0, 1]);
    h.store.close();
  });

  it("parks an unverified failed crew task without rerunning it", async () => {
    const h = harness("{}");
    const id = openObjective({ words: "fix the footer", flydNotes: "", origin: { surface: "chat" } }).id;
    const plan: PlannedRun[] = [{ key: "r1", team: "coding", outcome: "Fix the footer", doneWhen: ["footer fixed"], state: "dispatched", attempt: 1, validFor: 0, ref: "crew:t3" }];
    mutateObjective(id, (current) => current && { ...current, status: "working", plan, runs: ["crew:t3"] });
    crewTask("t3", "failed");
    await cosTick(h.deps);
    await cosTick(h.deps);
    const run = planOf(readObjective(id)!)[0];
    expect([readObjective(id)?.status, readObjective(id)?.waitingOn?.kind, run?.state, run?.attempt, h.said.map((report) => report.options)])
      .toEqual(["working", undefined, "failed", 1, [undefined]]);
    expect(readObjective(id)?.parked).toBeDefined();
    h.store.close();
  });

  it("parks a short crew result without asking George for testing tactics", async () => {
    const h = harness("{}");
    const deps = { ...h.deps, complete: async () => JSON.stringify({ met: false, missing: "the mobile footer is untouched" }) };
    const id = openObjective({ words: "fix the footer", flydNotes: "", origin: { surface: "chat" } }).id;
    const plan: PlannedRun[] = [{ key: "r1", team: "coding", outcome: "Fix the footer", doneWhen: ["footer fixed"], state: "dispatched", attempt: 1, validFor: 0, ref: "crew:t4" }];
    mutateObjective(id, (current) => current && { ...current, status: "working", plan, runs: ["crew:t4"] });
    crewTask("t4", "ready");
    await cosTick(deps);
    await cosTick(deps);
    const run = planOf(readObjective(id)!)[0];
    expect([readObjective(id)?.status, readObjective(id)?.waitingOn?.kind, run?.state, run?.attempt, h.said.map((report) => report.options)])
      .toEqual(["working", undefined, "completed", 1, [undefined]]);
    expect(readObjective(id)?.parked).toBeDefined();
    h.store.close();
  });

  it("closes the objective when he discards the crew task", async () => {
    const h = harness("{}");
    const id = openObjective({ words: "fix the footer", flydNotes: "", origin: { surface: "chat" } }).id;
    const plan: PlannedRun[] = [{ key: "r1", team: "coding", outcome: "Fix the footer", doneWhen: ["footer fixed"], state: "dispatched", attempt: 1, validFor: 0, ref: "crew:t2" }];
    mutateObjective(id, (current) => current && { ...current, status: "working", plan, runs: ["crew:t2"] });
    crewTask("t2", "discarded");
    await cosTick(h.deps);
    await cosTick(h.deps);
    expect([readObjective(id)?.status, planOf(readObjective(id)!)[0]?.state, h.said.length]).toEqual(["cancelled", "cancelled", 0]);
    h.store.close();
  });
});
