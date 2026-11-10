import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chatToolSet, flydMayRun } from "../../runtime/conversation-responder.js";
import { handOffLiveTask } from "../../runtime/live-task-intake.js";
import { planTurn } from "../../runtime/turn-plan.js";
import { listObjectives, mutateObjective, openObjective, readObjective } from "../cos/objectives.js";
import { tellWork, workStatus } from "../cos/steer.js";
import type { sendRunMessage } from "../messages.js";
import { createDomainRun } from "../store.js";
import type { DomainId, DomainRun } from "../types.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "flyd-cos-steer-"));
  process.env.FLYD_COMMAND_DIR = join(home, "command");
  process.env.FLYD_COS = "1";
});
afterEach(() => {
  delete process.env.FLYD_COMMAND_DIR;
  delete process.env.FLYD_COS;
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
    // Unattended runs are the work itself and keep their tools.
    expect(chatToolSet(null, true, false).map((tool) => tool.name)).toEqual(expect.arrayContaining(["edit_file", "write_file"]));
    expect([flydMayRun("git status", true), flydMayRun("rm -rf dist", true), flydMayRun("echo hi > notes.txt", true), flydMayRun("rm -rf dist", false)]).toEqual([true, false, false, true]);
    const answer = planTurn({ route: "answer", source: "jev", domain: null })!;
    expect([[...answer.handoffs], answer.instruction.includes("hand it off in this turn with hand_off")]).toEqual([["hand_off", "tell_work"], true]);
  });

  it("hands a LIVE task off as an objective, not a separate task", async () => {
    const response = await handOffLiveTask("fix the flaky checkout test", "/tmp/market", "inv-1");
    const [objective] = listObjectives();
    expect([objective?.words, objective?.origin, objective?.project, response.mode, response.delegatedTask]).toEqual(["fix the flaky checkout test", { surface: "live", turnId: "inv-1" }, { root: "/tmp/market" }, "requires_augment", null]);
  });
});
