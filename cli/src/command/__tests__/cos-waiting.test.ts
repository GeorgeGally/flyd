import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import type { ExecutiveDecisionRecord } from "../../intelligence/executive/decision-step.js";
import type { Dispatch } from "../cos/dispatch.js";
import { mutateObjective, openObjective, readObjective } from "../cos/objectives.js";
import { planOf } from "../cos/plan.js";
import { plainStatus, snoozeUntil, tellWork, workStatus } from "../cos/steer.js";
import { cosTick, STUCK_MS } from "../cos/tick.js";
import type { CosReport, PlannedRun } from "../cos/types.js";
import type { sendRunMessage } from "../messages.js";
import { createDomainRun, readDomainRun, updateDomainRun } from "../store.js";
import type { DomainRun } from "../types.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "flyd-cos-waiting-"));
  process.env.FLYD_COMMAND_DIR = join(home, "command");
});
afterEach(() => {
  delete process.env.FLYD_COMMAND_DIR;
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
    expect(outcome).toEqual({ delivered: true, objectiveId: id, until: snoozeUntil("tomorrow_morning", h.clock())!.toISOString() });
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
    expect(await tellWork({ message: "park it, the restaurant hasn't replied", kind: "decision", objectiveId: quiet }, h.deps.send, h.clock())).toEqual({ delivered: true, objectiveId: quiet });
    h.later(3 * STUCK_MS);
    await cosTick(h.deps);
    expect([readObjective(quiet)?.status, readObjective(quiet)?.parked?.reason, h.said.length]).toEqual(["working", "he parked it", 1]);
    h.store.close();
  });
});

describe("every wait carries a question", () => {
  it("writes one when work waits on him with nothing asked, and briefs again from his answer when it couldn't start", async () => {
    const h = harness("{}");
    const silent = openObjective({ words: "sort the invoices", flydNotes: "", origin: { surface: "chat" } }).id;
    mutateObjective(silent, (current) => current && { ...current, status: "needs_george", runs: [], plan: [] });
    await cosTick(h.deps);
    await cosTick(h.deps);
    expect(h.said.map((report) => report.outcome)).toEqual(["“sort the invoices” is waiting on you for a decision."]);
    mutateObjective(silent, (current) => current && { ...current, status: "done" });

    // Couldn't start; his answer goes back to intake on the same objective, with his words.
    const vague = openObjective({ words: "do the thing", flydNotes: "", origin: { surface: "chat" } }).id;
    await cosTick(h.deps);
    expect(h.said.at(-1)?.outcome).toBe("I couldn't get “do the thing” started; tell me a bit more and I'll set it going.");
    await tellWork({ message: "compare Stripe and Paddle fees for the print shop", kind: "decision" }, h.deps.send, h.clock());
    expect([readObjective(vague)?.status, readObjective(vague)?.flydNotes]).toEqual(["intake", "His answer when asked for more: compare Stripe and Paddle fees for the print shop"]);
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
