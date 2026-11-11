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
  it("raises nothing before his time while the rest finishes, comes back once, and his reply resumes the same objective", async () => {
    const h = harness(TWO_RESEARCH);
    const { id } = openObjective({ words: "compare banks and card providers for the shop", flydNotes: "", origin: { surface: "chat" } });
    await cosTick(h.deps);
    h.finishRun(`${id}-r1`, "failed");
    await cosTick(h.deps);
    h.finishRun(`${id}-r1-2`, "failed");
    await cosTick(h.deps);
    expect([readObjective(id)?.status, h.said.map((report) => report.kind)]).toEqual(["needs_george", ["decision"]]);

    const outcome = await tellWork({ message: "remind me tomorrow morning", kind: "snooze", until: "tomorrow_morning" }, h.deps.send, h.clock());
    const today = h.clock();
    expect(outcome).toEqual({ delivered: true, objectiveId: id, until: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 8).toISOString() });
    expect(workStatus()).toContain(`snoozed until ${outcome.until}`);
    // The other branch finishes meanwhile, and nothing is raised again.
    h.finishRun(`${id}-r2`);
    h.later(60 * 60_000);
    await cosTick(h.deps);
    expect([planOf(readObjective(id)!).map((run) => run.state), h.said.length]).toEqual([["failed", "completed"], 1]);

    // His time comes: raised once.
    h.later(Date.parse(outcome.until!) - h.clock().getTime() + 1_000);
    await cosTick(h.deps);
    await cosTick(h.deps);
    expect(h.said.map((report) => report.outcome).slice(1)).toEqual([`Back as you asked: ${h.said[0]!.outcome}`]);

    // His answer resumes this objective: the run is tried again with his words, and he hears once when it's done.
    expect(await tellWork({ message: "try their published fee pages instead", kind: "decision" }, h.deps.send, h.clock())).toEqual({ delivered: true, objectiveId: id });
    await cosTick(h.deps);
    expect(readDomainRun(`${id}-r1-3`)?.request.intendedOutcome).toContain("George said: try their published fee pages instead");
    h.finishRun(`${id}-r1-3`);
    await cosTick(h.deps);
    expect([readObjective(id)?.status, h.said.filter((report) => report.kind === "done").length]).toEqual(["done", 1]);
    h.store.close();
  });
});

describe("stuck work", () => {
  it("chases a quiet run whose owner can be chased without telling George, and asks him once when it can't tell", async () => {
    const h = harness(JSON.stringify({ team: "knowledge", outcome: "Compare Stripe and Paddle", done_when: ["sourced"] }));
    const chased = openObjective({ words: "stripe or paddle?", flydNotes: "", origin: { surface: "chat" } }).id;
    await cosTick(h.deps);
    h.later(STUCK_MS + 60_000);
    await cosTick(h.deps);
    await cosTick(h.deps);
    expect([h.said, h.asked.map((message) => [message.run, message.kind]), readObjective(chased)?.triage?.map((item) => item.choice)])
      .toEqual([[], [[`${chased}-r1`, "question"]], ["nudge"]]);
    expect(workStatus(chased)).toContain("How it went: still finishing (gone quiet; the chaser is on it)");
    mutateObjective(chased, (current) => current && { ...current, status: "done" });

    // A one-off job gone quiet can't be asked where it stands: one decision, and his answer settles it.
    const quiet = openObjective({ words: "book the table", flydNotes: "", origin: { surface: "chat" } }).id;
    mutateObjective(quiet, (current) => current && { ...current, status: "working", runs: ["job:j9"] });
    h.later(STUCK_MS + 60_000);
    await cosTick(h.deps);
    await cosTick(h.deps);
    expect(h.said.map((report) => [report.outcome, report.options])).toEqual([["“book the table” has gone quiet and I can't tell why. Nudge it, park it, or is it meant to keep running?", ["Nudge", "Park it", "It's ongoing"]]]);
    const before = readObjective(quiet);
    const unclear = { delivered: false, objectiveId: quiet, reason: "not_steerable", ask: "Nudge it, park it, or is it meant to keep running?" };
    expect(await tellWork({ message: "hmm, not sure", kind: "decision", objectiveId: quiet }, h.deps.send, h.clock())).toEqual(unclear);
    expect(await tellWork({ message: "don't nudge it, park it", kind: "decision", objectiveId: quiet }, h.deps.send, h.clock())).toEqual(unclear);
    expect(readObjective(quiet)).toEqual(before);
    expect(await tellWork({ message: "the restaurant hasn't replied", choice: "Park it", kind: "decision", objectiveId: quiet }, h.deps.send, h.clock())).toEqual({ delivered: true, objectiveId: quiet });
    h.later(3 * STUCK_MS);
    await cosTick(h.deps);
    expect([readObjective(quiet)?.status, readObjective(quiet)?.parked?.reason, h.said.length]).toEqual(["working", "he parked it", 1]);
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
  it("delivers it once when he takes it as it is, without checking it again", async () => {
    const h = harness(JSON.stringify({ team: "knowledge", outcome: "Compare Stripe and Paddle", done_when: ["fees sourced"] }));
    let checks = 0;
    const deps = { ...h.deps, complete: async (prompt: string) => {
      if (prompt.includes("Flyd handed you this piece")) return JSON.stringify({ team: "knowledge", outcome: "Compare Stripe and Paddle", done_when: ["fees sourced"] });
      checks += 1;
      return JSON.stringify({ met: false, missing: "Paddle's payout fees" });
    } };
    const id = openObjective({ words: "stripe or paddle?", flydNotes: "", origin: { surface: "chat" } }).id;
    await cosTick(deps);
    h.finishRun(`${id}-r1`);
    await cosTick(deps);
    h.finishRun(`${id}-r1-2`);
    await cosTick(deps);
    expect([readObjective(id)?.waitingOn?.kind, readObjective(id)?.waitingOn?.options, checks]).toEqual(["accept", ["Take it as it is", "Try another way"], 2]);

    expect(await tellWork({ message: "that's fine", choice: "Take it as it is", kind: "decision" }, h.deps.send, h.clock())).toEqual({ delivered: true, objectiveId: id });
    await cosTick(deps);
    await cosTick(deps);
    expect([readObjective(id)?.status, readObjective(id)?.waitingOn, h.told.length, checks]).toEqual(["done", undefined, 1, 2]);
    h.store.close();
  });
});

describe("a hand-over that was never confirmed", () => {
  it("looks for it again, then asks once after the bound, and sends it again only on his word", async () => {
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
    // Reconciled, then looked for once more each pass; never sent again, and nothing raised yet.
    expect([planOf(readObjective(id)!)[0]?.state, h.said.length, replays.length]).toEqual(["unknown", 0, 3]);

    // Past the bound: one call, with the two answers it takes.
    h.later(UNCONFIRMED_MS + 1_000);
    await cosTick(deps);
    await cosTick(deps);
    expect(h.said.map((report) => [report.outcome, report.options])).toEqual([["I can't tell whether “Book the table for Friday” was handed over. Send it again, or drop it?", ["Send it again", "Drop it"]]]);
    expect([readObjective(id)?.status, readObjective(id)?.waitingOn?.kind, readObjective(id)?.waitingOn?.options]).toEqual(["needs_george", "unconfirmed", ["Send it again", "Drop it"]]);

    // His words alone never send a one-off job again.
    const before = readObjective(id);
    expect(await tellWork({ message: "hmm, did it go?", kind: "decision" }, h.deps.send, h.clock())).toEqual({ delivered: false, objectiveId: id, reason: "not_steerable", ask: "Send it again, or drop it?" });
    expect(readObjective(id)).toEqual(before);
    expect(await tellWork({ message: "yes", choice: "Send it again", kind: "decision" }, h.deps.send, h.clock())).toEqual({ delivered: true, objectiveId: id });
    await cosTick(deps);
    expect([readObjective(id)?.status, planOf(readObjective(id)!)[0]?.state, planOf(readObjective(id)!)[0]?.ref]).toEqual(["working", "dispatched", `${id}-r1-2`]);
    h.store.close();
  });

  it("settles as dispatched when a later look finds it, ending the wait", async () => {
    const h = harness("{}");
    let found = false;
    const dispatch: Dispatch = async (_objective, _brief, requestId, options) => (options?.replay && found ? { ref: `job:${requestId}` } : { unknown: "not found" });
    const deps = { ...h.deps, dispatch };
    const id = openObjective({ words: "book the table", flydNotes: "", origin: { surface: "chat" } }).id;
    const plan: PlannedRun[] = [{ key: "r1", team: "life", outcome: "Book the table for Friday", doneWhen: ["booked"], state: "unknown", attempt: 1, validFor: 0 }];
    mutateObjective(id, (current) => current && { ...current, status: "working", plan });
    await cosTick(deps);
    expect(planOf(readObjective(id)!)[0]?.unknownAt).toBeTruthy();
    h.later(UNCONFIRMED_MS + 1_000);
    await cosTick(deps);
    expect(readObjective(id)?.waitingOn?.kind).toBe("unconfirmed");
    found = true;
    await cosTick(deps);
    expect([readObjective(id)?.status, readObjective(id)?.waitingOn, planOf(readObjective(id)!)[0]?.state, readObjective(id)?.runs]).toEqual(["working", undefined, "dispatched", [`job:${id}-r1`]]);
    h.store.close();
  });

  it("holds the unconfirmed call while another wait is open, and asks it once that wait is answered", async () => {
    const h = harness("{}");
    const dispatch: Dispatch = async () => ({ unknown: "not found" });
    const deps = { ...h.deps, dispatch };
    const id = openObjective({ words: "book the table and compare banks", flydNotes: "", origin: { surface: "chat" } }).id;
    const old = h.clock().toISOString();
    const plan: PlannedRun[] = [
      { key: "r1", team: "life", outcome: "Book the table for Friday", doneWhen: ["booked"], state: "unknown", attempt: 1, validFor: 0, unknownAt: old },
      { key: "r2", team: "knowledge", outcome: "Compare the banks", doneWhen: ["compared"], state: "failed", attempt: 2, validFor: 0, adapted: true, ref: `${id}-r2-2`, reviewed: "r2-failed" },
    ];
    const retryId = `${id}:r2-failed`;
    mutateObjective(id, (current) => current && {
      ...current, status: "needs_george", plan, reportIds: [retryId],
      waitingOn: { reportId: retryId, kind: "retry", question: "Compare the banks didn't finish.", options: ["Try another way", "Drop it"], at: old },
    });
    h.later(UNCONFIRMED_MS + 1_000);
    await cosTick(deps);
    // The open retry wait stands: nothing overwrites it.
    expect([readObjective(id)?.waitingOn?.kind, h.said.length]).toEqual(["retry", 0]);

    expect(await tellWork({ message: "drop it", choice: "Drop it", kind: "decision" }, h.deps.send, h.clock())).toEqual({ delivered: true, objectiveId: id });
    expect(planOf(readObjective(id)!).map((run) => run.state)).toEqual(["unknown", "dropped"]);
    await cosTick(deps);
    expect([readObjective(id)?.status, readObjective(id)?.waitingOn?.kind, h.said.map((report) => report.options)]).toEqual(["needs_george", "unconfirmed", [["Send it again", "Drop it"]]]);
    h.store.close();
  });

  it("asks the unconfirmed call again when another wait replaced it and the run is still unconfirmed", async () => {
    const h = harness("{}");
    const dispatch: Dispatch = async () => ({ unknown: "not found" });
    const deps = { ...h.deps, dispatch };
    const id = openObjective({ words: "book the table and compare banks", flydNotes: "", origin: { surface: "chat" } }).id;
    const plan: PlannedRun[] = [
      { key: "r1", team: "life", outcome: "Book the table for Friday", doneWhen: ["booked"], state: "unknown", attempt: 1, validFor: 0, unknownAt: h.clock().toISOString() },
      { key: "r2", team: "knowledge", outcome: "Compare the banks", doneWhen: ["compared"], state: "queued", attempt: 0, validFor: 0 },
    ];
    mutateObjective(id, (current) => current && { ...current, status: "working", plan });
    h.later(UNCONFIRMED_MS + 1_000);
    await cosTick(deps);
    expect([readObjective(id)?.waitingOn?.kind, h.said.length]).toEqual(["unconfirmed", 1]);

    // A later wait on another run replaces it.
    const retryId = `${id}:r2-failed`;
    mutateObjective(id, (current) => current && {
      ...current, reportIds: [...current.reportIds, retryId],
      plan: planOf(current).map((run) => run.key === "r2" ? { ...run, state: "failed" as const, attempt: 2, adapted: true, reviewed: "r2-failed" } : run),
      waitingOn: { reportId: retryId, kind: "retry", question: "Compare the banks didn't finish.", options: ["Try another way", "Drop it"], at: h.clock().toISOString() },
    });
    expect(await tellWork({ message: "drop it", choice: "Drop it", kind: "decision" }, h.deps.send, h.clock())).toEqual({ delivered: true, objectiveId: id });
    await cosTick(deps);
    expect([readObjective(id)?.status, readObjective(id)?.waitingOn?.kind, h.said.length]).toEqual(["needs_george", "unconfirmed", 2]);
    await cosTick(deps);
    expect(h.said.length).toBe(2);
    h.store.close();
  });

  it("never reopens an objective he cancelled while the look for its hand-over was under way", async () => {
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
    expect(readObjective(id)?.waitingOn?.kind).toBe("unconfirmed");
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

  it("makes a failed crew task his call, never sent again on its own", async () => {
    const h = harness("{}");
    const id = openObjective({ words: "fix the footer", flydNotes: "", origin: { surface: "chat" } }).id;
    const plan: PlannedRun[] = [{ key: "r1", team: "coding", outcome: "Fix the footer", doneWhen: ["footer fixed"], state: "dispatched", attempt: 1, validFor: 0, ref: "crew:t3" }];
    mutateObjective(id, (current) => current && { ...current, status: "working", plan, runs: ["crew:t3"] });
    crewTask("t3", "failed");
    await cosTick(h.deps);
    await cosTick(h.deps);
    const run = planOf(readObjective(id)!)[0];
    expect([readObjective(id)?.status, readObjective(id)?.waitingOn?.kind, run?.state, run?.attempt, h.said.map((report) => report.options)])
      .toEqual(["needs_george", "retry", "failed", 1, [["Try another way", "Drop it"]]]);
    h.store.close();
  });

  it("makes a ready crew result that falls short his call, never sent again on its own", async () => {
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
      .toEqual(["needs_george", "accept", "completed", 1, [["Take it as it is", "Try another way"]]]);
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
