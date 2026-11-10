import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import type { ExecutiveDecisionRecord } from "../../intelligence/executive/decision-step.js";
import { runAssistantTool } from "../../runtime/assistant-tools.js";
import { chatToolSet } from "../../runtime/conversation-responder.js";
import { planTurn } from "../../runtime/turn-plan.js";
import { runRequestId, type Dispatch } from "../cos/dispatch.js";
import { parseIntake } from "../cos/intake.js";
import { listObjectives, mutateObjective, openObjective, readObjective } from "../cos/objectives.js";
import { cosReports, cosTick } from "../cos/tick.js";
import type { CosReport } from "../cos/types.js";
import { createDomainRun, readDomainRun, updateDomainRun } from "../store.js";
import { firstmateRequestBody } from "../firstmate.js";
import type { DomainRun } from "../types.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "flyd-cos-"));
  process.env.FLYD_COMMAND_DIR = join(home, "command");
});
afterEach(() => {
  delete process.env.FLYD_COMMAND_DIR;
  delete process.env.FLYD_COS;
  rmSync(home, { recursive: true, force: true });
});

const BRIEF = JSON.stringify({
  team: "knowledge", outcome: "Compare Stripe and Paddle fees at his volume", done_when: ["both fee tables are sourced"],
  decisions: { comes_back: ["which provider to sign up with"], settled_by_policy: ["which currency to compare in"] },
});

const decision = (): ExecutiveDecisionRecord => ({
  schema: "flyd.executive-decision.v1", decisionId: "decision-cos", sourceId: "domain.knowledge", sourceEventId: "event-cos", taskId: "x",
  disposition: "handle_internally", reason: "finished", summary: "Stripe is cheapest at your volume.", evidenceRefs: [],
  verification: { status: "verified", evidenceRefs: [] }, show: true, notify: true, createdAt: "2026-11-11T00:00:00.000Z",
});

describe("Chief of Staff intake", () => {
  it("reads the team, brief and decisions field, and refuses a reading it cannot use", () => {
    expect(parseIntake(BRIEF, {})).toEqual({
      team: "knowledge", outcome: "Compare Stripe and Paddle fees at his volume", doneWhen: ["both fee tables are sourced"],
      decisions: { comesBack: ["which provider to sign up with"], settledByPolicy: ["which currency to compare in"] },
    });
    expect(parseIntake(JSON.stringify({ team: "coding", outcome: "Fix it", done_when: ["fixed"] }), {}, () => false)).toEqual({ refused: "code work needs a project folder that exists" });
    expect(parseIntake("not json", {})).toEqual({ refused: "intake did not return a brief" });
    // The decisions reach the team in its brief.
    const body = firstmateRequestBody({ id: "r", domain: "coding", originalMessage: "fix it", intendedOutcome: "Fix it", doneWhen: ["fixed"], createdAt: "", decisions: { comesBack: ["going live"], settledByPolicy: ["naming"] } });
    expect(body).toContain("Bring these calls back to George through Flyd: going live");
  });
});

describe("Chief of Staff tick", () => {
  function harness() {
    const store = new IntelligenceEventStore({ path: join(home, "intelligence.sqlite") });
    const asked: string[] = [];
    const dispatched: string[] = [];
    const told: string[] = [];
    const said: CosReport[] = [];
    const dispatch: Dispatch = async (objective, brief) => {
      const id = runRequestId(objective);
      dispatched.push(id);
      const at = new Date().toISOString();
      const run: DomainRun = {
        id, owner: "Librarian", status: "working", createdAt: at, updatedAt: at, transport: { kind: "native", requestId: id },
        request: { id, domain: brief.team, originalMessage: objective.words, intendedOutcome: brief.outcome, doneWhen: brief.doneWhen, createdAt: at, objectiveId: objective.id },
      };
      return { ref: createDomainRun(run).run.id };
    };
    const deps = {
      store, dispatch,
      complete: async (prompt: string) => { asked.push(prompt); return BRIEF; },
      decide: async () => decision(),
      tell: async (_run: DomainRun, _decision: ExecutiveDecisionRecord, key: string) => { told.push(key); },
      say: async (report: CosReport) => { said.push(report); },
    };
    return { store, asked, dispatched, told, said, deps };
  }

  it("briefs and dispatches once, a restart mid-intake replays the same request, and the finished run is reported once", async () => {
    const h = harness();
    const objective = openObjective({ words: "which is cheaper for me, stripe or paddle?", flydNotes: "He sells prints in EUR", origin: { surface: "chat" } });
    // A restart after the brief was kept but before dispatch: the same brief is dispatched, no second intake.
    mutateObjective(objective.id, (current) => current && { ...current, brief: parseIntake(BRIEF, {}) as never });
    await cosTick(h.deps);
    await cosTick(h.deps);
    expect([h.asked.length, h.dispatched, readObjective(objective.id)?.status, readObjective(objective.id)?.runs]).toEqual([0, [runRequestId(objective)], "working", [runRequestId(objective)]]);

    // The run finishes: reviewed, one report, told once, and the objective is done.
    updateDomainRun(runRequestId(objective), (run) => ({ ...run, status: "completed", result: { format: "structured", brief: "Stripe is cheapest at your volume.", detailedReport: "", decisionsMade: [], unresolvedQuestions: [], risks: [], evidence: [], artifacts: [], specialistOutputs: [], raw: [], informationLossRisk: "low" } }));
    await cosTick(h.deps);
    await cosTick(h.deps);
    const reports = cosReports(objective.id, h.store);
    expect([h.told.length, reports.length, reports[0]?.kind, readObjective(objective.id)?.status]).toEqual([1, 1, "done", "done"]);
    expect(readDomainRun(runRequestId(objective))?.request.objectiveId).toBe(objective.id);
    h.store.close();
  });

  it("turns a refused intake into one blocked report, never a silent failure", async () => {
    const h = harness();
    const objective = openObjective({ words: "do the thing", flydNotes: "", origin: { surface: "chat" } });
    const deps = { ...h.deps, complete: async () => "{}" };
    await cosTick(deps);
    await cosTick(deps);
    expect([h.dispatched.length, h.said.map((report) => report.kind), readObjective(objective.id)?.status]).toEqual([0, ["blocked"], "needs_george"]);
    expect(h.said[0]?.outcome).toBe("I couldn't get “do the thing” started; tell me a bit more and I'll set it going.");
    h.store.close();
  });
});

describe("hand_off", () => {
  it("records his exact words as an objective, only with the Chief of Staff on, and is the delegate route's one tool", async () => {
    const context = { userMessage: "Make me three versions of the gallery page", situation: { project: "cap5", projectRoot: "/tmp/cap5" } };
    expect(await runAssistantTool("hand_off", { words: "three gallery versions", notes: "cap5" }, context)).toMatch(/not available/);
    expect(chatToolSet(null, false).map((tool) => tool.name)).not.toContain("hand_off");
    process.env.FLYD_COS = "1";
    expect(await runAssistantTool("hand_off", { words: "three gallery versions", notes: "He liked the dark one last time", urgency: "today" }, context)).toMatch(/^Handed off/);
    const [objective] = listObjectives();
    expect([objective?.words, objective?.flydNotes, objective?.status, objective?.urgency, objective?.project]).toEqual(["Make me three versions of the gallery page", "He liked the dark one last time", "intake", "today", { name: "cap5", root: "/tmp/cap5" }]);
    expect([...planTurn({ route: "delegate", source: "jev", domain: "creative" })!.handoffs]).toEqual(["hand_off"]);
  });
});
