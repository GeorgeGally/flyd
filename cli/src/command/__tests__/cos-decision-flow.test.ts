import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import type { ExecutiveDecisionRecord } from "../../intelligence/executive/decision-step.js";
import { mutateObjective, openObjective, readObjective } from "../cos/objectives.js";
import { planOf } from "../cos/plan.js";
import { cosTick } from "../cos/tick.js";
import type { CosReport } from "../cos/types.js";
import type { Dispatch } from "../cos/dispatch.js";
import type { sendRunMessage } from "../messages.js";
import { createDomainRun, readDomainRun, updateDomainRun } from "../store.js";
import type { DomainResult, DomainRun } from "../types.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "flyd-cos-decisions-"));
  process.env.FLYD_COMMAND_DIR = join(home, "command");
});
afterEach(() => {
  delete process.env.FLYD_COMMAND_DIR;
  rmSync(home, { recursive: true, force: true });
});

const result = (question: string): DomainResult => ({
  format: "structured", brief: "Needs a test strategy", detailedReport: "",
  decisionsMade: [], unresolvedQuestions: [question], risks: [],
  evidence: [], artifacts: [], specialistOutputs: [], raw: [], informationLossRisk: "low",
});

function askDecision(question: string): ExecutiveDecisionRecord {
  return {
    schema: "flyd.executive-decision.v1", decisionId: "d1", sourceId: "firstmate.change",
    sourceEventId: "e1", disposition: "ask_george",
    reason: "a source-grounded choice remains George's",
    summary: question, question,
    options: ["Vitest", "Jest"],
    recommendation: { option: "Vitest", rationale: "Already used by the codebase" },
    evidenceRefs: ["domain-run:example"],
    verification: { status: "unknown", evidenceRefs: [] },
    show: true, notify: true, createdAt: "2026-11-13T00:00:00.000Z",
  };
}

function harness(question: string) {
  const store = new IntelligenceEventStore({ path: join(home, "intelligence.sqlite") });
  const said: CosReport[] = [];
  const told: string[] = [];
  const sent: string[] = [];
  const answer = "Use Vitest; carry on. This instruction grants no permission to push.";
  const dispatch: Dispatch = async (objective, brief, requestId) => {
    const existing = readDomainRun(requestId);
    if (existing) return { ref: existing.id };
    const now = new Date().toISOString();
    const run: DomainRun = {
      id: requestId, owner: "FirstMate", status: "working", createdAt: now, updatedAt: now,
      transport: { kind: "native", requestId },
      request: {
        id: requestId, domain: brief.team, originalMessage: objective.words,
        intendedOutcome: brief.outcome, doneWhen: brief.doneWhen, createdAt: now, objectiveId: objective.id,
      },
    };
    return { ref: createDomainRun(run).run.id };
  };
  const send = (async ({ run, body }) => {
    sent.push(body);
    return { delivered: true, run };
  }) as typeof sendRunMessage;
  const deps = {
    store, dispatch, send,
    complete: async () => JSON.stringify({
      team: "coding", outcome: "Fix the component", done_when: ["tests pass"],
      project: { root: home }, decisions: { comes_back: [], settled_by_policy: [] },
    }),
    decide: async () => askDecision(question),
    operationalJudge: async () => ({
      kind: "internal" as const, message: answer, reason: "internal test choice",
    }),
    tell: async () => { told.push("asked"); },
    say: async (report: CosReport) => { said.push(report); },
  };
  return { store, sent, said, told, deps };
}

describe("CoS internal decision flow", () => {
  it("answers a routine code decision and does not send George a question or duplicate the instruction", async () => {
    const question = "Should we use Vitest or Jest for component tests?";
    const h = harness(question);
    const objective = openObjective({ words: "Fix the component", flydNotes: "", origin: { surface: "chat" } });
    await cosTick(h.deps);
    const runId = objective.id + "-r1";
    updateDomainRun(runId, (run) => ({
      ...run, status: "needs_decision", updatedAt: new Date(Date.parse(run.updatedAt) + 1000).toISOString(), result: result(question),
    }));
    await cosTick(h.deps);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toContain("Vitest");
    expect(h.said).toEqual([]);
    expect(h.told).toEqual([]);
    expect(readObjective(objective.id)?.status).toBe("working");
    expect(planOf(readObjective(objective.id)!)[0].operationalQuestionId).toBeTruthy();
    await cosTick(h.deps);
    expect(h.sent).toHaveLength(1);
    expect(h.said).toHaveLength(0);
    h.store.close();
  });

  it("does not manufacture a technical decision if the issue requires actual approval", async () => {
    const question = "Should we deploy to production?";
    const h = harness(question);
    const objective = openObjective({ words: "Fix the component", flydNotes: "", origin: { surface: "chat" } });
    await cosTick(h.deps);
    const runId = objective.id + "-r1";
    updateDomainRun(runId, (run) => ({
      ...run, status: "needs_decision", updatedAt: new Date(Date.parse(run.updatedAt) + 1000).toISOString(), result: result(question),
    }));
    // Use the actual deterministic authority test rather than the routine stub.
    const real = { ...h.deps, operationalJudge: undefined };
    await cosTick(real);
    expect(h.sent).toHaveLength(0);
    expect(h.told).toEqual(["asked"]);
    expect(readObjective(objective.id)?.status).toBe("needs_george");
    h.store.close();
  });
});
