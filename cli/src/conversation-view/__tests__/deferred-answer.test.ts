import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import type { ExecutiveDecisionRecord } from "../../intelligence/executive/decision-step.js";
import { runRequestId, type Dispatch } from "../../command/cos/dispatch.js";
import { openObjective } from "../../command/cos/objectives.js";
import { cosTick } from "../../command/cos/tick.js";
import { createDomainRun, updateDomainRun } from "../../command/store.js";
import { FlydDesk } from "../flyd-desk.js";

it("delivers a delegated follow-up once to its originating conversation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flyd-deferred-"));
  vi.stubEnv("FLYD_COMMAND_DIR", join(dir, "command"));
  const store = new IntelligenceEventStore({ path: join(dir, "events.sqlite") });
  try {
    const session = "window:abcdefgh";
    let objectiveId = "";
    const desk = new FlydDesk({ dir: join(dir, "asks"), answer: async (_question, _history, _step, turn) => {
      objectiveId = openObjective({ words: "What size is the video?", flydNotes: "", answerTurn: true, origin: { surface: "chat", sessionId: turn!.source.sessionId, turnId: turn!.source.turnId } }).id;
      return "__FLYD_DEFERRED_ANSWER__";
    } });
    desk.ask("What size is the video?", [], session);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(desk.exchanges(session)[0]?.answer).toBeUndefined();
    const dispatch: Dispatch = async (objective, brief) => {
      const id = runRequestId(objective);
      const at = new Date().toISOString();
      createDomainRun({ id, owner: "Librarian", status: "working", createdAt: at, updatedAt: at, transport: { kind: "native", requestId: id }, request: { id, domain: "knowledge", originalMessage: objective.words, intendedOutcome: brief.outcome, doneWhen: brief.doneWhen, createdAt: at, objectiveId: objective.id } });
      return { ref: id };
    };
    const decision: ExecutiveDecisionRecord = { schema: "flyd.executive-decision.v1", decisionId: "d", sourceId: "domain.knowledge", sourceEventId: "e", taskId: "x", disposition: "handle_internally", reason: "finished", summary: "The video is 1920 × 1080.", evidenceRefs: [], verification: { status: "verified", evidenceRefs: [] }, show: true, notify: true, createdAt: new Date().toISOString() };
    const tell = vi.fn(async () => {});
    const deps = { store, dispatch, tell, answerDir: join(dir, "deferred-answers"), decide: async () => decision, complete: async (prompt: string) => prompt.includes("check the finished result") ? JSON.stringify({ met: true }) : JSON.stringify({ team: "knowledge", outcome: "Find the video size", done_when: ["size identified"] }) };
    await cosTick(deps);
    updateDomainRun(runRequestId({ id: objectiveId }), (run) => ({ ...run, status: "completed", result: { format: "structured", brief: "The video is 1920 × 1080.", detailedReport: "", decisionsMade: [], unresolvedQuestions: [], risks: [], evidence: [], artifacts: [], specialistOutputs: [], raw: [], informationLossRisk: "low" } }));
    await cosTick(deps);
    await cosTick(deps);
    expect(desk.exchanges(session)[0]?.answer?.text).toBe("The video is 1920 × 1080.");
    expect(tell).toHaveBeenCalledTimes(1);
    expect(desk.exchanges("window:otherone")).toEqual([]);
  } finally {
    store.close();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
});
