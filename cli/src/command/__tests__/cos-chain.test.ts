import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import type { ExecutiveDecisionRecord } from "../../intelligence/executive/decision-step.js";
import type { Dispatch, SentBrief } from "../cos/dispatch.js";
import { parseIntake } from "../cos/intake.js";
import { mutateObjective, openObjective, readObjective } from "../cos/objectives.js";
import { planOf } from "../cos/plan.js";
import { tellWork } from "../cos/steer.js";
import { cosReports, cosTick } from "../cos/tick.js";
import type { CosReport } from "../cos/types.js";
import type { sendRunMessage } from "../messages.js";
import { createDomainRun, readDomainRun, updateDomainRun } from "../store.js";
import type { DomainResult, DomainRun } from "../types.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "flyd-cos-chain-"));
  process.env.FLYD_COMMAND_DIR = join(home, "command");
});
afterEach(() => {
  delete process.env.FLYD_COMMAND_DIR;
  delete process.env.FLYD_COS_MAX_ACTIVE;
  rmSync(home, { recursive: true, force: true });
});

const decision = (): ExecutiveDecisionRecord => ({
  schema: "flyd.executive-decision.v1", decisionId: "decision-chain", sourceId: "domain.coding", sourceEventId: "event-chain", taskId: "x",
  disposition: "handle_internally", reason: "finished", summary: "The pricing page is on staging.", evidenceRefs: [],
  verification: { status: "verified", evidenceRefs: [] }, show: true, notify: true, createdAt: "2026-11-11T00:00:00.000Z",
});

const result = (brief: string): DomainResult => ({
  format: "structured", brief, detailedReport: "", decisionsMade: [], unresolvedQuestions: [], risks: [], evidence: [], artifacts: [], specialistOutputs: [], raw: [], informationLossRisk: "low",
});

/** Research and a design at once, then a build from both: the plan intake writes for cross-team work. */
function crossTeamPlan(): string {
  return JSON.stringify({
    team: "coding", outcome: "A new pricing page, built from research and a design", done_when: ["the page is on staging"], project: { root: home },
    decisions: { comes_back: ["the price points"], settled_by_policy: ["copy tone"] },
    runs: [
      { id: "research", team: "knowledge", outcome: "Research three competitor pricing pages", done_when: ["three sourced examples"], after: [] },
      { id: "design", team: "creative", outcome: "Design the pricing page", done_when: ["one picked direction"], after: [] },
      { id: "build", team: "coding", outcome: "Build the pricing page", done_when: ["it is on staging"], after: ["research", "design"] },
    ],
  });
}

/** A fake team for every domain: each request id is accepted once, and the same id again is a replay. */
function harness(plan: string, options: { acceptance?: string[] } = {}) {
  const store = new IntelligenceEventStore({ path: join(home, "intelligence.sqlite") });
  const sent: Array<{ id: string; brief: SentBrief; replay: boolean }> = [];
  const told: string[] = [];
  const said: CosReport[] = [];
  const asked: string[] = [];
  const acceptance = [...(options.acceptance ?? [])];
  const dispatch: Dispatch = async (objective, brief, requestId, given = {}) => {
    sent.push({ id: requestId, brief, replay: Boolean(given.replay) });
    if (readDomainRun(requestId)) return { ref: requestId };
    const at = new Date().toISOString();
    const run: DomainRun = {
      id: requestId, owner: "Team", status: "working", createdAt: at, updatedAt: at, transport: { kind: "native", requestId },
      request: { id: requestId, domain: brief.team, originalMessage: objective.words, intendedOutcome: brief.outcome, doneWhen: brief.doneWhen, createdAt: at, objectiveId: objective.id },
    };
    return { ref: createDomainRun(run).run.id };
  };
  const deps = {
    store, dispatch,
    complete: async (prompt: string) => {
      asked.push(prompt);
      if (prompt.includes("Flyd handed you this piece")) return plan;
      if (prompt.includes("writing the brief for the next step")) return JSON.stringify({ brief: "Lead with the annual plan; the picked design's three columns." });
      return acceptance.shift() ?? JSON.stringify({ met: true });
    },
    decide: async () => decision(),
    tell: async (_run: DomainRun, _decision: ExecutiveDecisionRecord, key: string) => { told.push(key); },
    say: async (report: CosReport) => { said.push(report); },
  };
  const finishRun = (id: string, status: DomainRun["status"] = "completed", brief = `${id} done`) =>
    updateDomainRun(id, (run) => ({ ...run, status, updatedAt: new Date(Date.parse(run.updatedAt) + 1_000).toISOString(), result: result(brief), ...(status === "failed" ? { failure: "the source site was down" } : {}) }));
  const ids = () => sent.filter((item) => !item.replay).map((item) => item.id);
  return { store, sent, told, said, asked, deps, finishRun, ids };
}

function messages() {
  const got: Array<{ run: string; kind: string; body: string }> = [];
  const send = (async ({ run, kind, body }) => { got.push({ run: run.id, kind, body }); return { delivered: true, run }; }) as typeof sendRunMessage;
  return { got, send };
}

describe("chains with parallel joins", () => {
  it("runs research and design at once, joins them into one brief for the build, and tells George once", async () => {
    const h = harness(crossTeamPlan());
    const { id } = openObjective({ words: "redo the pricing page like the good ones out there", flydNotes: "", origin: { surface: "chat" } });
    await cosTick(h.deps);
    await cosTick(h.deps);
    expect(h.ids()).toEqual([`${id}-r1`, `${id}-r2`]);
    h.finishRun(`${id}-r1`, "completed", "Three sourced examples: annual plan first.");
    await cosTick(h.deps);
    expect(h.ids()).toHaveLength(2);
    h.finishRun(`${id}-r2`, "completed", "Picked direction: three columns.");
    await cosTick(h.deps);
    const build = h.sent.find((item) => item.id === `${id}-r3`)!;
    expect(build.brief.outcome).toContain("What the work before this found:\nLead with the annual plan; the picked design's three columns.");
    expect(build.brief.outcome).toContain(`Full results: domain-run:${id}-r1, domain-run:${id}-r2`);
    expect(build.brief.contextRefs).toEqual([`domain-run:${id}-r1`, `domain-run:${id}-r2`]);
    expect(readDomainRun(`${id}-r3`)?.request.originalMessage).toBe("redo the pricing page like the good ones out there");
    expect(h.told).toEqual([]);
    h.finishRun(`${id}-r3`);
    await cosTick(h.deps);
    await cosTick(h.deps);
    expect([h.ids(), h.told.length, cosReports(id, h.store).map((report) => report.kind), readObjective(id)?.status]).toEqual([[`${id}-r1`, `${id}-r2`, `${id}-r3`], 1, ["done"], "done"]);
    h.store.close();
  });

  it("with one run active at a time, runs the same plan one by one and still tells George once", async () => {
    process.env.FLYD_COS_MAX_ACTIVE = "1";
    const h = harness(crossTeamPlan());
    const { id } = openObjective({ words: "redo the pricing page", flydNotes: "", origin: { surface: "chat" } });
    await cosTick(h.deps);
    await cosTick(h.deps);
    expect(h.ids()).toEqual([`${id}-r1`]);
    for (const key of ["r1", "r2", "r3"]) {
      h.finishRun(`${id}-${key}`);
      await cosTick(h.deps);
    }
    expect([h.ids(), h.told.length, readObjective(id)?.status]).toEqual([[`${id}-r1`, `${id}-r2`, `${id}-r3`], 1, "done"]);
    h.store.close();
  });

  it("refuses a plan whose runs wait on each other or on a run it doesn't have", () => {
    const plan = (after: Record<string, string[]>) => JSON.stringify({
      team: "knowledge", outcome: "x", done_when: ["y"],
      runs: [{ id: "a", team: "knowledge", outcome: "a", done_when: ["a"], after: after.a }, { id: "b", team: "creative", outcome: "b", done_when: ["b"], after: after.b }],
    });
    expect(parseIntake(plan({ a: ["b"], b: ["a"] }), {})).toEqual({ refused: "intake's plan can't be run: the plan's runs wait on each other in a loop" });
    expect(parseIntake(plan({ a: [], b: ["c"] }), {})).toEqual({ refused: "intake's plan can't be run: run r2 waits on a run the plan doesn't have (c)" });
  });
});

describe("dispatch that may not have happened", () => {
  it("reconciles a run left mid-dispatch by its request id, and leaves one whose executor can't answer unknown, never re-sent", async () => {
    const h = harness(JSON.stringify({ team: "knowledge", outcome: "Compare Stripe and Paddle", done_when: ["sourced"] }));
    // The team saved the request, then Core died before recording the receipt.
    let crashed = false;
    const crashing: Dispatch = async (objective, brief, requestId, given) => {
      const answer = await h.deps.dispatch(objective, brief, requestId, given);
      if (!crashed) { crashed = true; throw new Error("Core killed"); }
      return answer;
    };
    const { id } = openObjective({ words: "stripe or paddle?", flydNotes: "", origin: { surface: "chat" } });
    await cosTick({ ...h.deps, dispatch: crashing });
    expect(planOf(readObjective(id)!)[0]?.state).toBe("dispatching");
    await cosTick({ ...h.deps, dispatch: crashing });
    expect([h.sent.map((item) => [item.id, item.replay]), planOf(readObjective(id)!)[0]?.state, readObjective(id)?.runs]).toEqual([[[`${id}-r1`, false], [`${id}-r1`, true]], "dispatched", [`${id}-r1`]]);

    // An executor that can't answer for the request id: unknown, and never sent again (only looked for again).
    const other = openObjective({ words: "book the table", flydNotes: "", origin: { surface: "chat" } }).id;
    let calls = 0;
    const silent: Dispatch = async (_objective, _brief, _requestId, given) => {
      if (given?.replay) return { unknown: "a one-off job can't answer for a request id" };
      calls += 1;
      throw new Error("Core killed");
    };
    await cosTick({ ...h.deps, dispatch: silent });
    await cosTick({ ...h.deps, dispatch: silent });
    await cosTick({ ...h.deps, dispatch: silent });
    expect([calls, planOf(readObjective(other)!)[0]?.state]).toEqual([1, "unknown"]);
    h.store.close();
  });
});

describe("corrections", () => {
  async function builtUpTo(h: ReturnType<typeof harness>) {
    const { id } = openObjective({ words: "redo the pricing page", flydNotes: "", origin: { surface: "chat" } });
    await cosTick(h.deps);
    h.finishRun(`${id}-r1`);
    h.finishRun(`${id}-r2`);
    await cosTick(h.deps);
    return id;
  }

  it("redoes only the build when he corrects an implementation detail; research and design keep their results", async () => {
    const h = harness(crossTeamPlan());
    const id = await builtUpTo(h);
    const { got, send } = messages();
    expect(await tellWork({ message: "make the buy button green", kind: "correction", objectiveId: id, team: "coding" }, send)).toEqual({ delivered: true, objectiveId: id });
    expect(got).toEqual([{ run: `${id}-r3`, kind: "correction", body: "make the buy button green" }]);
    expect(planOf(readObjective(id)!).map((run) => [run.key, run.validFor])).toEqual([["r1", 1], ["r2", 1], ["r3", 1]]);
    h.finishRun(`${id}-r3`);
    await cosTick(h.deps);
    expect([h.ids(), h.told.length, readObjective(id)?.status]).toEqual([[`${id}-r1`, `${id}-r2`, `${id}-r3`], 1, "done"]);
    h.store.close();
  });

  it("re-runs the research and everything after it when he changes the question, never delivering the stale build", async () => {
    const h = harness(crossTeamPlan());
    const id = await builtUpTo(h);
    const { got, send } = messages();
    await tellWork({ message: "compare against European competitors only", kind: "correction", objectiveId: id, team: "knowledge" }, send);
    expect(got.map((message) => message.run)).toEqual([`${id}-r3`]);
    await cosTick(h.deps);
    const research = h.sent.find((item) => item.id === `${id}-r1-2`)!;
    expect(research.brief.outcome).toContain("George's corrections since he asked:\n- compare against European competitors only");
    expect(research.brief.contextRefs).toEqual([`domain-run:${id}-r1`]);
    // The old build finishes: kept as prior work, never told.
    h.finishRun(`${id}-r3`);
    await cosTick(h.deps);
    expect([h.told, planOf(readObjective(id)!).find((run) => run.key === "r3")?.state]).toEqual([[], "queued"]);
    h.finishRun(`${id}-r1-2`);
    await cosTick(h.deps);
    h.finishRun(`${id}-r3-2`);
    await cosTick(h.deps);
    expect([h.ids(), h.told.length, readObjective(id)?.status]).toEqual([[`${id}-r1`, `${id}-r2`, `${id}-r3`, `${id}-r1-2`, `${id}-r3-2`], 1, "done"]);
    h.store.close();
  });

  it("asks which part a correction is for when it can't tell, changing nothing", async () => {
    const h = harness(crossTeamPlan());
    const id = await builtUpTo(h);
    const { got, send } = messages();
    const outcome = await tellWork({ message: "make it simpler", kind: "correction", objectiveId: id }, send);
    expect([outcome.reason, outcome.ask, got, readObjective(id)?.briefRevision ?? 0])
      .toEqual(["ambiguous", "Which part is this for: “Research three competitor pricing pages” or “Design the pricing page” or “Build the pricing page”?", [], 0]);
    h.store.close();
  });

  it("never re-runs a one-off job that has gone ahead; he is asked instead and nothing changes", async () => {
    const h = harness(JSON.stringify({ team: "life", outcome: "Book a table for four on Friday", done_when: ["booked"] }));
    const { id } = openObjective({ words: "book us a table friday", flydNotes: "", origin: { surface: "chat" } });
    await cosTick(h.deps);
    const before = readObjective(id)!;
    const { got, send } = messages();
    const outcome = await tellWork({ message: "make it Saturday", kind: "correction", objectiveId: id }, send);
    const after = readObjective(id)!;
    expect([outcome, got, after.briefRevision ?? 0, after.plan, after.corrections]).toEqual([
      { delivered: false, objectiveId: id, reason: "not_steerable", ask: "“Book a table for four on Friday” has already gone ahead, so I can't change it. Want it done again with this?" },
      [], 0, before.plan, before.corrections,
    ]);
    h.store.close();
  });
});

describe("adapting before escalating", () => {
  it("recovers failed internal work within a bounded budget, then parks the problem without asking George", async () => {
    const h = harness(JSON.stringify({ team: "knowledge", outcome: "Compare Stripe and Paddle", done_when: ["sourced"] }));
    const once = openObjective({ words: "stripe or paddle?", flydNotes: "", origin: { surface: "chat" } }).id;
    await cosTick(h.deps);
    h.finishRun(`${once}-r1`, "failed");
    await cosTick(h.deps);
    expect(h.sent.find((item) => item.id === `${once}-r1-2`)?.brief.outcome).toContain("Last attempt:");
    expect(readObjective(once)?.adaptations?.map((item) => [item.run, item.action])).toEqual([["r1", "rebrief"]]);
    h.finishRun(`${once}-r1-2`);
    await cosTick(h.deps);
    expect([readObjective(once)?.status, h.said, h.told.length]).toEqual(["done", [], 1]);

    const twice = openObjective({ words: "compare the two banks", flydNotes: "", origin: { surface: "chat" } }).id;
    await cosTick(h.deps);
    h.finishRun(`${twice}-r1`, "failed");
    await cosTick(h.deps);
    h.finishRun(`${twice}-r1-2`, "failed");
    await cosTick(h.deps);
    h.finishRun(`${twice}-r1-3`, "failed");
    await cosTick(h.deps);
    await cosTick(h.deps);
    expect(h.ids().filter((item) => item.startsWith(twice))).toEqual([`${twice}-r1`, `${twice}-r1-2`, `${twice}-r1-3`]);
    expect(h.said.map((report) => report.kind)).toEqual(["blocked"]);
    expect(readObjective(twice)?.status).toBe("working");
    expect(readObjective(twice)?.parked).toBeDefined();
    expect(readObjective(twice)?.waitingOn).toBeUndefined();
    h.store.close();
  });

  it("checks the result against done_when before telling him, and re-briefs once when it falls short", async () => {
    const h = harness(JSON.stringify({ team: "knowledge", outcome: "Compare Stripe and Paddle", done_when: ["both fee tables are sourced"] }), {
      acceptance: [JSON.stringify({ met: false, missing: "Paddle's fee table has no source" })],
    });
    const { id } = openObjective({ words: "stripe or paddle?", flydNotes: "", origin: { surface: "chat" } });
    await cosTick(h.deps);
    h.finishRun(`${id}-r1`);
    await cosTick(h.deps);
    expect([h.told, Boolean(h.sent.find((item) => item.id === `${id}-r1-2`)?.brief.outcome.includes("Shortfall: Paddle's fee table has no source"))]).toEqual([[], true]);
    h.finishRun(`${id}-r1-2`);
    await cosTick(h.deps);
    expect([h.told.length, readObjective(id)?.status]).toEqual([1, "done"]);
    h.store.close();
  });

  it("keeps acceptance failures backstage, recovers within budget, then parks a genuine shortfall", async () => {
    const short = JSON.stringify({ met: false, missing: "Paddle's fee table has no source" });
    const h = harness(JSON.stringify({ team: "knowledge", outcome: "Compare Stripe and Paddle", done_when: ["both fee tables are sourced"] }), { acceptance: [short, short, short] });
    const { id } = openObjective({ words: "stripe or paddle?", flydNotes: "", origin: { surface: "chat" } });
    await cosTick(h.deps);
    h.finishRun(`${id}-r1`);
    await cosTick(h.deps);
    h.finishRun(`${id}-r1-2`);
    await cosTick(h.deps);
    h.finishRun(`${id}-r1-3`);
    await cosTick(h.deps);
    const checks = h.asked.length;
    await cosTick(h.deps);
    await cosTick(h.deps);
    expect(h.asked.length).toBe(checks);
    expect(h.said.map((report) => report.kind)).toEqual(["blocked"]);
    expect(h.told).toEqual([]);
    expect(readObjective(id)?.status).toBe("working");
    expect(readObjective(id)?.parked).toBeDefined();
    h.store.close();
  });

});

describe("the active-run limit", () => {
  it("doesn't count work handed to the crew, which is never settled here", async () => {
    process.env.FLYD_COS_MAX_ACTIVE = "1";
    const h = harness(JSON.stringify({ team: "knowledge", outcome: "Compare Stripe and Paddle", done_when: ["sourced"] }));
    const crewed = openObjective({ words: "fix the footer", flydNotes: "", origin: { surface: "chat" } }).id;
    mutateObjective(crewed, (current) => current && {
      ...current, status: "working", runs: ["crew:footer"],
      plan: [{ key: "r1", team: "coding", outcome: "Fix the footer", doneWhen: ["it is fixed"], state: "dispatched", attempt: 1, ref: "crew:footer", validFor: 0 }],
    });
    const { id } = openObjective({ words: "stripe or paddle?", flydNotes: "", origin: { surface: "chat" } });
    await cosTick(h.deps);
    expect(h.ids()).toEqual([`${id}-r1`]);
    h.store.close();
  });
});

describe("the old one-run objectives", () => {
  it("still follow a run dispatched before plans existed", async () => {
    const h = harness("{}");
    const { id } = openObjective({ words: "stripe or paddle?", flydNotes: "", origin: { surface: "chat" } });
    const at = new Date().toISOString();
    createDomainRun({ id: `${id}-r1`, owner: "Librarian", status: "working", createdAt: at, updatedAt: at, transport: { kind: "native", requestId: `${id}-r1` }, request: { id: `${id}-r1`, domain: "knowledge", originalMessage: "x", intendedOutcome: "x", doneWhen: ["y"], createdAt: at, objectiveId: id } });
    mutateObjective(id, (current) => current && { ...current, status: "working", runs: [`${id}-r1`] });
    h.finishRun(`${id}-r1`);
    await cosTick(h.deps);
    expect([h.sent, h.told.length, readObjective(id)?.status]).toEqual([[], 1, "done"]);
    h.store.close();
  });
});
