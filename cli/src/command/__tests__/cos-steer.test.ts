import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chatToolSet, flydMayAsk, flydMayCall, flydMayRun, turnOwnerOf } from "../../runtime/conversation-responder.js";
import { handOffLiveTask } from "../../runtime/live-task-intake.js";
import { planTurn } from "../../runtime/turn-plan.js";
import { runAssistantTool } from "../../runtime/assistant-tools.js";
import { listObjectives, mutateObjective, openObjective, readObjective } from "../cos/objectives.js";
import type { Dispatch } from "../cos/dispatch.js";
import { flushPendingCorrections, tellWork, workStatus } from "../cos/steer.js";
import { cosTick } from "../cos/tick.js";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import type { sendRunMessage } from "../messages.js";
import { createDomainRun, mutateDomainRun, readDomainRun } from "../store.js";
import type { DomainId, DomainRun } from "../types.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "flyd-cos-steer-"));
  process.env.FLYD_COMMAND_DIR = join(home, "command");
  process.env.FLYD_COS = "1";
});
afterEach(() => {
  delete process.env.FLYD_COMMAND_DIR;
  process.env.FLYD_COS = "0";
  rmSync(home, { recursive: true, force: true });
});

/** An objective under way with one run, as intake and dispatch leave it. */
function underWay(words: string, team: DomainId, result?: DomainRun["result"]): string {
  const objective = openObjective({ words, flydNotes: "", origin: { surface: "chat" } });
  const id = `${objective.id}-r1`;
  const at = new Date().toISOString();
  createDomainRun({
    id, owner: "FirstMate", status: result ? "completed" : "working", createdAt: at, updatedAt: at, transport: { kind: "firstmate", requestId: id },
    request: { id, domain: team, originalMessage: words, intendedOutcome: words, doneWhen: ["done"], createdAt: at, objectiveId: objective.id },
    ...(result ? { result } : {}),
  });
  mutateObjective(objective.id, (current) => current && { ...current, status: "working", runs: [id], brief: { team, outcome: words, doneWhen: ["done"], decisions: { comesBack: [], settledByPolicy: [] } } });
  return objective.id;
}

function recorder() {
  const sent: Array<{ run: string; kind: string; body: string }> = [];
  const send = (async ({ run, kind, body }) => { sent.push({ run: run.id, kind, body }); return { delivered: true, run }; }) as typeof sendRunMessage;
  return { sent, send };
}

describe("tell_work", () => {
  it("does not guess which of two team runs a decision is for", async () => {
    const objective = underWay("Fix the footer", "coding");
    const first = readDomainRun(`${objective}-r1`)!;
    const second = { ...first, id: `${objective}-r2`, request: { ...first.request, id: `${objective}-r2`, intendedOutcome: "Check the design" }, transport: { ...first.transport, requestId: `${objective}-r2` } };
    createDomainRun(second);
    mutateObjective(objective, (current) => current && { ...current, runs: [first.id, second.id] });
    const { sent, send } = recorder();
    expect(await tellWork({ objectiveId: objective, message: "yes", kind: "decision" }, send)).toMatchObject({ delivered: false, reason: "ambiguous" });
    expect(sent).toEqual([]);
  });

  it("delivers a chat decision with no run named to the one run asking for it, once", async () => {
    const objective = underWay("Fix the footer", "coding");
    const coding = readDomainRun(`${objective}-r1`)!;
    mutateDomainRun(coding.id, (current) => current && { ...current, status: "needs_decision" });
    const design = { ...coding, id: `${objective}-r2`, status: "working" as const, request: { ...coding.request, id: `${objective}-r2`, domain: "creative" as const, intendedOutcome: "Design the footer" }, transport: { ...coding.transport, requestId: `${objective}-r2` } };
    createDomainRun(design);
    mutateObjective(objective, (current) => current && { ...current, runs: [coding.id, design.id] });
    const { sent, send } = recorder();
    expect(await tellWork({ objectiveId: objective, message: "go with blue", kind: "decision" }, send)).toMatchObject({ delivered: true });
    expect(sent).toEqual([{ run: coding.id, kind: "decision", body: "go with blue" }]);
    mutateObjective(objective, (current) => current && { ...current, status: "needs_george", waitingOn: { reportId: "q1", kind: "question", question: "Which blue?", at: new Date().toISOString() } });
    expect(await tellWork({ objectiveId: objective, message: "navy", kind: "decision" }, send)).toMatchObject({ delivered: true });
    expect(sent.at(-1)).toEqual({ run: coding.id, kind: "decision", body: "navy" });
  });

  it("keeps an answer to crew work ready for /land on the objective without landing or sending anything", async () => {
    const objective = openObjective({ words: "Fix the footer", flydNotes: "", origin: { surface: "chat" } });
    mutateObjective(objective.id, (current) => current && { ...current, status: "needs_george", runs: ["crew:footer-fix"],
      plan: [{ key: "r1", team: "coding", outcome: "Fix the footer", doneWhen: ["done"], state: "dispatched", attempt: 1, validFor: 0, ref: "crew:footer-fix" }],
      waitingOn: { reportId: `${objective.id}:crew:footer-fix:ready`, kind: "run", question: "Fix the footer is ready for your /land; it has not been merged yet.", at: new Date().toISOString() } });
    const before = readObjective(objective.id)!;
    const { sent, send } = recorder();
    const outcome = await tellWork({ objectiveId: objective.id, expectedReportId: `${objective.id}:crew:footer-fix:ready`, message: "looks good, ship it", kind: "decision" }, send);
    expect(outcome).toMatchObject({ delivered: true, note: expect.stringContaining("/land") });
    expect(sent).toEqual([]);
    const after = readObjective(objective.id)!;
    expect(after.flydNotes).toContain("looks good, ship it");
    expect(after.plan).toEqual(before.plan);
    expect(after.status).toBe("needs_george");
  });

  it("keeps an answer to ready crew work on the objective even while another team's run is still working", async () => {
    const objective = underWay("Fix the footer", "creative");
    const design = `${objective}-r1`;
    const reportId = `${objective}:crew:footer-fix:ready`;
    mutateObjective(objective, (current) => current && { ...current, status: "needs_george", runs: ["crew:footer-fix", design],
      plan: [
        { key: "r1", team: "coding", outcome: "Fix the footer", doneWhen: ["done"], state: "dispatched", attempt: 1, validFor: 0, ref: "crew:footer-fix" },
        { key: "r2", team: "creative", outcome: "Design the footer", doneWhen: ["done"], state: "dispatched", attempt: 1, validFor: 0, ref: design },
      ],
      waitingOn: { reportId, kind: "run", question: "Fix the footer is ready for your /land; it has not been merged yet.", at: new Date().toISOString() } });
    const { sent, send } = recorder();
    const outcome = await tellWork({ objectiveId: objective, expectedReportId: reportId, message: "looks good, ship it", kind: "decision" }, send);
    expect(outcome).toMatchObject({ delivered: true, note: expect.stringContaining("/land") });
    expect(sent).toEqual([]);
    expect(readObjective(objective)!.flydNotes).toContain("looks good, ship it");
  });

  it("delivers an answer naming a design run to that run even while crew work waits for /land", async () => {
    const objective = underWay("Design the footer", "creative");
    const design = `${objective}-r1`;
    mutateDomainRun(design, (current) => current && { ...current, status: "needs_decision" });
    const reportId = `${objective}:crew:footer-fix:ready`;
    mutateObjective(objective, (current) => current && { ...current, status: "needs_george", runs: ["crew:footer-fix", design],
      plan: [
        { key: "r1", team: "coding", outcome: "Fix the footer", doneWhen: ["done"], state: "dispatched", attempt: 1, validFor: 0, ref: "crew:footer-fix" },
        { key: "r2", team: "creative", outcome: "Design the footer", doneWhen: ["done"], state: "dispatched", attempt: 1, validFor: 0, ref: design },
      ],
      waitingOn: { reportId, kind: "run", question: "Fix the footer is ready for your /land; it has not been merged yet.", at: new Date().toISOString() } });
    const { sent, send } = recorder();
    const outcome = await tellWork({ objectiveId: objective, runId: design, message: "go with the serif", kind: "decision" }, send);
    expect(outcome).toMatchObject({ delivered: true });
    expect(outcome.note).toBeUndefined();
    expect(sent).toEqual([{ run: design, kind: "decision", body: "go with the serif" }]);
    expect(readObjective(objective)!.flydNotes).not.toContain("go with the serif");
  });

  it("does not apply an answer to a different, newer objective question", async () => {
    const objective = underWay("Fix the footer", "coding");
    mutateObjective(objective, (current) => current && { ...current, status: "needs_george", waitingOn: { reportId: "new-question", kind: "run", question: "Which colour?", at: new Date().toISOString() } });
    const { sent, send } = recorder();
    expect(await tellWork({ objectiveId: objective, expectedReportId: "old-question", message: "yes", kind: "decision" }, send)).toMatchObject({ delivered: false, reason: "not_steerable" });
    expect(sent).toEqual([]);
  });

  it("delivers a decision to the identified objective run and never a different run", async () => {
    const objective = underWay("Fix the footer", "coding");
    const { sent, send } = recorder();
    expect(await tellWork({ objectiveId: objective, runId: `${objective}-r1`, message: "Use blue", kind: "decision" }, send))
      .toEqual({ delivered: true, objectiveId: objective });
    expect(sent).toEqual([{ run: `${objective}-r1`, kind: "decision", body: "Use blue" }]);
    expect((await tellWork({ objectiveId: objective, runId: "wrong-run", message: "Use blue", kind: "decision" }, send)).delivered).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("retains a correction's attached evidence when steering existing work", async () => {
    const objective = underWay("Fix the footer", "coding");
    const { sent, send } = recorder();
    expect((await tellWork({ objectiveId: objective, message: "Use this reference", contextRefs: ["/tmp/example.png"] }, send)).delivered).toBe(true);
    expect(sent[0]?.body).toContain("Use this reference");
    expect(sent[0]?.body).toContain("/tmp/example.png");
  });

  it("uses a known run identity to steer the right part of a multi-team objective", async () => {
    const objective = underWay("Fix the footer", "coding");
    const runId = `${objective}-r1`;
    mutateObjective(objective, (current) => current && { ...current, plan: [
      { key: "r1", team: "coding", outcome: "Fix the footer", doneWhen: ["done"], state: "dispatched", attempt: 1, validFor: 0, ref: runId },
      { key: "r2", team: "creative", outcome: "Design the footer", doneWhen: ["done"], state: "queued", attempt: 0, validFor: 0 },
    ] });
    const { sent, send } = recorder();
    expect((await tellWork({ objectiveId: objective, runId, message: "Make it blue" }, send)).delivered).toBe(true);
    expect(sent).toEqual([{ run: runId, kind: "correction", body: "Make it blue" }]);
    expect(readObjective(objective)?.corrections?.[0]?.run).toBe("r1");
  });

  it("routes an artefact correction to its recorded objective even when other work is open", async () => {
    underWay("Fix a different footer", "coding");
    const objective = openObjective({ words: "Research pricing", flydNotes: "", origin: { surface: "chat" } });
    const id = `${objective.id}-r1`;
    const at = new Date().toISOString();
    createDomainRun({ id, owner: "Librarian", status: "working", createdAt: at, updatedAt: at,
      transport: { kind: "native", requestId: id },
      request: { id, domain: "knowledge", originalMessage: "Research pricing", intendedOutcome: "Research pricing", doneWhen: ["done"], createdAt: at, objectiveId: objective.id } });
    mutateObjective(objective.id, (current) => current && { ...current, status: "working", runs: [id], brief: { team: "knowledge", outcome: "Research pricing", doneWhen: ["done"], decisions: { comesBack: [], settledByPolicy: [] } } });
    const answer = await runAssistantTool("tell_work", { message: "Use EUR", kind: "correction" }, { targetTaskId: id, userMessage: "Use EUR" });
    expect(answer).toContain("existing work has the instruction");
    expect(readDomainRun(id)?.messages?.[0]).toMatchObject({ kind: "correction", body: "Use EUR" });
    expect(readObjective(objective.id)?.corrections?.[0]?.text).toBe("Use EUR");
  });
  it("steers a directly identified objective without guessing among other objectives", async () => {
    underWay("A different job", "coding");
    const objective = underWay("Research pricing", "knowledge");
    mutateDomainRun(`${objective}-r1`, (current) => current && { ...current, owner: "Librarian", transport: { kind: "native", requestId: current.id } });
    const answer = await runAssistantTool("tell_work", { kind: "correction" }, { targetTaskId: objective, userMessage: "Make it blue" });
    expect(answer).toContain("existing work has the instruction");
    expect(readDomainRun(`${objective}-r1`)?.messages?.[0]).toMatchObject({ kind: "correction", body: "Make it blue" });
  });
  it("delivers to the one matching objective, asks one question when two match, and forwards nothing unrelated", async () => {
    const { sent, send } = recorder();
    expect(await tellWork({ message: "make the header blue" }, send)).toEqual({ delivered: false, reason: "no_active_work" });
    const footer = underWay("Fix the cap5 footer", "coding");
    expect(await tellWork({ message: "make it blue, not grey", kind: "correction" }, send)).toEqual({ delivered: true, objectiveId: footer });
    const research = underWay("Compare Stripe and Paddle", "knowledge");
    const ambiguous = await tellWork({ message: "stop that" }, send);
    expect([ambiguous.reason, ambiguous.ask]).toEqual(["ambiguous", "Which is this for: “Fix the cap5 footer” or “Compare Stripe and Paddle”?"]);
    // The team hint settles it, and a cancel closes the objective.
    expect(await tellWork({ message: "stop that", kind: "cancel", team: "knowledge" }, send)).toEqual({ delivered: true, objectiveId: research });
    expect(readObjective(research)?.status).toBe("cancelled");
    expect(sent).toEqual([
      { run: `${footer}-r1`, kind: "correction", body: "make it blue, not grey" },
      { run: `${research}-r1`, kind: "cancel", body: "stop that" },
    ]);
    // A cancel while the work is still being briefed closes it before anything is dispatched.
    const pricing = openObjective({ words: "Redo the pricing page", flydNotes: "", origin: { surface: "chat" } }).id;
    expect(await tellWork({ message: "never mind", kind: "cancel", objectiveId: pricing }, send)).toEqual({ delivered: true, objectiveId: pricing });
    expect(readObjective(pricing)?.status).toBe("cancelled");
    expect(sent).toHaveLength(2);
  });

  it("never reports a cancel for work it cannot stop, and stops a run dispatched while he cancelled", async () => {
    const { sent, send } = recorder();
    const job = openObjective({ words: "Draft the newsletter", flydNotes: "", origin: { surface: "chat" } }).id;
    mutateObjective(job, (current) => current && { ...current, status: "working", runs: ["job:j1"] });
    expect(await tellWork({ message: "cancel that", kind: "cancel", objectiveId: job }, send)).toEqual({ delivered: false, objectiveId: job, reason: "not_steerable" });
    expect(readObjective(job)?.status).toBe("working");

    const footer = openObjective({ words: "Fix the cap5 footer", flydNotes: "", origin: { surface: "chat" } }).id;
    mutateObjective(footer, (current) => current && { ...current, brief: { team: "coding", outcome: "Fix the footer", doneWhen: ["done"], decisions: { comesBack: [], settledByPolicy: [] } } });
    mutateObjective(job, (current) => current && { ...current, status: "done" });
    const dispatch: Dispatch = async (objective) => {
      await tellWork({ message: "never mind", kind: "cancel", objectiveId: objective.id }, send);
      const at = new Date().toISOString();
      const id = `${objective.id}-r1`;
      createDomainRun({ id, owner: "FirstMate", status: "queued", createdAt: at, updatedAt: at, transport: { kind: "firstmate", requestId: id }, request: { id, domain: "coding", originalMessage: objective.words, intendedOutcome: objective.words, doneWhen: ["done"], createdAt: at, objectiveId: objective.id } });
      return { ref: id };
    };
    await cosTick({ dispatch, send, store: new IntelligenceEventStore({ path: join(home, "intelligence.sqlite") }) });
    expect([readObjective(footer)?.status, readObjective(footer)?.runs, sent.map((m) => [m.run, m.kind])]).toEqual(["cancelled", [`${footer}-r1`], [[`${footer}-r1`, "cancel"]]]);

    const pricing = openObjective({ words: "Redo the pricing page", flydNotes: "", origin: { surface: "chat" } }).id;
    mutateObjective(pricing, (current) => current && { ...current, brief: { team: "coding", outcome: "Redo the pricing page", doneWhen: ["done"], decisions: { comesBack: [], settledByPolicy: [] } } });
    mutateObjective(footer, (current) => current && { ...current, status: "done" });
    const said: unknown[] = [];
    const refuse: Dispatch = async (objective) => {
      await tellWork({ message: "never mind", kind: "cancel", objectiveId: objective.id }, send);
      return { refused: "no team free" };
    };
    await cosTick({ dispatch: refuse, send, say: async (made) => { said.push(made); }, store: new IntelligenceEventStore({ path: join(home, "intelligence.sqlite") }) });
    expect([readObjective(pricing)?.status, said]).toEqual(["cancelled", []]);
  });
});


describe("durable correction delivery", () => {
  it("records a correction before a planned run has an executor, without inventing a pending delivery", async () => {
    const objective = openObjective({ words: "Fix the footer", flydNotes: "", origin: { surface: "chat" } });
    mutateObjective(objective.id, (current) => current && {
      ...current, status: "working", briefRevision: 0,
      plan: [{ key: "build", team: "coding", outcome: "Fix the footer", doneWhen: ["Footer fixed"], state: "queued", attempt: 0, validFor: 0 }],
    });
    const { sent, send } = recorder();
    expect(await tellWork({ objectiveId: objective.id, message: "make it blue", kind: "correction" }, send))
      .toEqual({ delivered: true, objectiveId: objective.id });
    expect(readObjective(objective.id)).toMatchObject({
      briefRevision: 1, pendingCorrections: [],
      corrections: [{ revision: 1, run: "build", text: "make it blue" }],
    });
    expect(sent).toEqual([]);
  });

  it("persists the revision before sending and retries failed sends without losing intent", async () => {
    const id = underWay("Fix the cap5 footer", "coding");
    let attempts = 0;
    const send = (async ({ run }: { run: DomainRun }) => {
      attempts += 1;
      const current = readObjective(id)!;
      expect(current.briefRevision).toBe(1);
      expect(current.pendingCorrections).toEqual([{ revision: 1, runId: run.id, text: "make it blue" }]);
      return { delivered: attempts > 1, run };
    }) as typeof sendRunMessage;
    expect(await tellWork({ message: "make it blue", objectiveId: id }, send)).toEqual({
      delivered: false, objectiveId: id, reason: "delivery_failed",
    });
    expect(readObjective(id)?.pendingCorrections).toHaveLength(1);
    expect(await flushPendingCorrections(id, send)).toBe(true);
    expect(readObjective(id)?.pendingCorrections).toEqual([]);
    expect(attempts).toBe(2);
  });

  it("replays accepted corrections after a simulated restart via the scheduler", async () => {
    const id = underWay("Fix the cap5 footer", "coding");
    const failure = (async ({ run }: { run: DomainRun }) => ({ delivered: false, run })) as typeof sendRunMessage;
    await tellWork({ message: "change spacing", objectiveId: id }, failure);
    const delivered: string[] = [];
    const recovered = (async ({ run, body }: { run: DomainRun; body: string }) => {
      delivered.push(body);
      return { delivered: true, run };
    }) as typeof sendRunMessage;
    const store = new IntelligenceEventStore({ path: join(home, "intelligence.sqlite") });
    await cosTick({ send: recovered, dispatch: async () => ({ unknown: "not dispatched" }), store });
    expect(delivered).toEqual(["change spacing"]);
    expect(readObjective(id)?.pendingCorrections).toEqual([]);
    store.close();
  });
});

describe("work_status", () => {
  it("answers a follow-up from the retained result, dispatching nothing", () => {
    const id = underWay("Compare Stripe and Paddle", "knowledge", {
      format: "structured", brief: "Stripe is cheapest at your volume.", detailedReport: "Stripe 1.5% + 25c; Paddle 5% + 50c.", decisionsMade: [], unresolvedQuestions: [],
      risks: [], evidence: [], artifacts: [], specialistOutputs: [], raw: [], informationLossRisk: "low",
    });
    expect(workStatus()).toContain("“Compare Stripe and Paddle” — under way");
    expect(workStatus(id)).toContain("Detailed report:\nStripe 1.5% + 25c; Paddle 5% + 50c.");
    expect(listObjectives()).toHaveLength(1);
  });
});

describe("Flyd with the Chief of Staff on", () => {
  it("hands work over instead of managing it or changing code on his own turns", () => {
    const names = chatToolSet(null, true).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["hand_off", "tell_work", "work_status", "read_file"]));
    for (const gone of ["edit_file", "write_file", "start_coding_task", "background_task", "domain_work", "crew"]) expect(names).not.toContain(gone);
    // Unattended runs are the work itself and keep their working tools, but start no team work around the Chief of Staff.
    const worker = chatToolSet(null, true, "worker").map((tool) => tool.name);
    expect(worker).toEqual(expect.arrayContaining(["edit_file", "write_file", "bash"]));
    for (const gone of ["start_coding_task", "start_knowledge_task", "start_design_task", "background_task", "pass_on_question", "crew", "hand_off", "tell_work"]) expect(worker).not.toContain(gone);
    // His scheduled ask does its own work too, and hands team work to the Chief of Staff.
    const scheduled = chatToolSet(null, true, "scheduled").map((tool) => tool.name);
    expect(scheduled).toEqual(expect.arrayContaining(["edit_file", "write_file", "hand_off", "tell_work", "work_status"]));
    for (const gone of ["start_coding_task", "start_knowledge_task", "start_design_task", "background_task", "pass_on_question", "crew"]) expect(scheduled).not.toContain(gone);
    expect([turnOwnerOf("agenda-1"), turnOwnerOf("job-1"), turnOwnerOf("window:abcdefgh"), turnOwnerOf(undefined)]).toEqual(["scheduled", "worker", "george", "george"]);
    expect([flydMayCall("start_coding_task", true), flydMayCall("write_file", true), flydMayCall("hand_off", true), flydMayCall("start_coding_task", false), flydMayCall("write_file", false), flydMayCall("hand_off", "scheduled")]).toEqual([false, false, true, false, true, true]);
    expect([flydMayAsk("domain_work", { action: "ask" }, true), flydMayAsk("domain_work", { action: "ask" }, "scheduled"), flydMayAsk("domain_work", { action: "show" }, "worker")]).toEqual([true, false, true]);
    expect([flydMayRun("git status", true), flydMayRun("rm -rf dist", true), flydMayRun("echo hi > notes.txt", true), flydMayRun("rm -rf dist", false), flydMayRun("rm -rf dist", "scheduled")]).toEqual([true, false, false, true, true]);
    process.env.FLYD_COS = "0";
    // The rollback restores every legacy tool on every kind of turn.
    expect([flydMayCall("start_coding_task", "worker"), flydMayCall("start_coding_task", "scheduled"), flydMayAsk("domain_work", { action: "ask" }, "worker")]).toEqual([true, true, true]);
    expect(chatToolSet(null, true, "scheduled").map((tool) => tool.name)).not.toContain("hand_off");
    process.env.FLYD_COS = "1";
    const answer = planTurn({ route: "answer", source: "jev", domain: null })!;
    expect([[...answer.handoffs], answer.instruction.includes("hand it off in this turn with hand_off")]).toEqual([["hand_off", "tell_work"], true]);
    expect([...planTurn({ route: "delegate", source: "jev", domain: "coding" })!.handoffs]).toEqual(["hand_off", "tell_work"]);
    expect([...planTurn({ route: "clarify", source: "jev", domain: null })!.handoffs]).toEqual(["tell_work"]);
  });

  it("hands a LIVE task off as an objective, not a separate task", async () => {
    const response = await handOffLiveTask("fix the flaky checkout test", "/tmp/market", "inv-1");
    const [objective] = listObjectives();
    expect([objective?.words, objective?.origin, objective?.project, response.mode, response.delegatedTask]).toEqual(["fix the flaky checkout test", { surface: "live", turnId: "inv-1" }, { root: "/tmp/market" }, "requires_augment", null]);
  });
});
