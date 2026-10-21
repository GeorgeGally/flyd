import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntelligenceEventStore } from "../../event-store.js";
import { decideExecutiveStep, HANDLE_IT_YOURSELF, HELD_FOR_ATTENTION, persistExecutiveDecision, RECOVER_IT_YOURSELF, RESTATE_FOR_GEORGE, resolveExecutiveDecision, type ExecutiveDecisionInput } from "../decision-step.js";
import { authorityForStaffRun, processFirstmateChange } from "../firstmate-decision.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const eitherOrProposal = {
  kind: "question" as const,
  summary: "Choose whether to close the review or add the missing tools.",
  question: "Close the review or add the missing tools?",
  questionEvidence: "close it, or bring in the missing editing tools and route checker?",
  options: ["close it", "bring in the missing editing tools and route checker"],
  recommendation: {
    option: "bring in the missing editing tools and route checker",
    rationale: "The request says these tools are the remaining work.",
    evidence: "the missing editing tools and route checker",
  },
  evidenceRefs: ["task:capfive-review"],
};

const eitherOr: ExecutiveDecisionInput = {
  sourceId: "firstmate.status",
  sourceEventId: "task:capfive-review:changed",
  sourceText: "CapFive intranet links (https://github.com/GeorgeGally/capfive/pull/5): close it, or bring in the missing editing tools and route checker?",
  proposal: eitherOrProposal,
  judgment: { route: "ask_george", confidence: 0.94, notable: true },
};

describe("executive decision step", () => {
  it("grants internal staff coordination only for an active FirstMate run under trusted autonomy", () => {
    expect(authorityForStaffRun({ runId: "run-1", firstmate: true, active: true, autonomy: "trusted" })).toEqual([
      { grantId: "firstmate.active-run-coordination.v1", capability: "firstmate.message", target: "run-1" },
    ]);
    expect(authorityForStaffRun({ runId: "run-1", firstmate: true, active: false, autonomy: "trusted" })).toEqual([]);
    expect(authorityForStaffRun({ runId: "run-1", firstmate: false, active: true, autonomy: "trusted" })).toEqual([]);
    expect(authorityForStaffRun({ runId: "run-1", firstmate: true, active: true, autonomy: "ask" })).toEqual([]);
  });

  it("asks George with grounded options and never converts either/or into Yes", () => {
    const decision = decideExecutiveStep(eitherOr);
    expect(decision).toMatchObject({
      disposition: "ask_george",
      question: eitherOrProposal.question,
      options: eitherOrProposal.options,
      recommendation: { option: eitherOrProposal.recommendation.option, rationale: eitherOrProposal.recommendation.rationale },
      notify: true,
    });
    expect(decision).not.toHaveProperty("action");
  });

  it("keeps a raw paused-worker update backstage", () => {
    const decision = decideExecutiveStep({
      sourceId: "firstmate.status",
      sourceEventId: "task:review:paused",
      sourceText: "Paused [at=1792311581]: driving no-mistakes run 01M56X1VHPRFDXWTHCZVTG38VZ",
      proposal: { kind: "routine", summary: "A coding worker is paused.", evidenceRefs: ["task:review"] },
      judgment: { route: "backstage", confidence: 0.98, notable: false },
    });
    expect(decision).toMatchObject({ disposition: "backstage", show: false, notify: false });
  });

  it("does not execute an internal action unless deterministic policy grants its exact target", () => {
    const action = { kind: "request_status" as const, target: "task:review", evidence: "The review was cancelled during recovery" };
    const input: ExecutiveDecisionInput = {
      sourceId: "firstmate.status",
      sourceEventId: "task:review:recovery",
      sourceText: "The review was cancelled during recovery before it reached a verdict.",
      proposal: {
        kind: "internal_action",
        summary: "Ask FirstMate to recover the still-open review and report the result.",
        action,
        evidenceRefs: ["task:review"],
      },
      judgment: { route: "handle_internally", confidence: 0.91, notable: false },
    };
    const denied = decideExecutiveStep(input);
    expect(denied).toMatchObject({ disposition: "backstage", notify: false });
    expect(denied).not.toHaveProperty("action");
    expect(decideExecutiveStep({ ...input, authority: [{ capability: "firstmate.message", target: "task:review", grantId: "staff-coordination" }] }))
      .toMatchObject({ disposition: "handle_internally", action: { capability: "firstmate.message", target: "task:review", grantId: "staff-coordination" }, verification: { status: "pending" }, notify: false });
  });

  it("shows a verified, notable result and persists one idempotent decision event", () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-decision-step-"));
    const store = new IntelligenceEventStore({ path: join(dir, "intelligence.sqlite") });
    const decision = decideExecutiveStep({
      sourceId: "firstmate.status",
      sourceEventId: "task:review:done",
      sourceText: "The review is complete and the requested fix is verified.",
      proposal: { kind: "verified_result", summary: "The requested review is complete.", evidenceRefs: ["task:review"] },
      verification: { status: "verified", evidenceRefs: ["receipt:review-checks"] },
      judgment: { route: "handle_internally", confidence: 0.96, notable: true },
    });
    const first = persistExecutiveDecision(store, decision);
    const second = persistExecutiveDecision(store, decision);

    expect(decision).toMatchObject({ disposition: "handle_internally", show: true, notify: true, verification: { status: "verified" } });
    expect(first?.id).toBe(second?.id);
    expect(store.readSource("executive.cycle")).toHaveLength(1);
  });

  it("closes only an open ask after George's answer is recorded", () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-decision-resolution-"));
    const store = new IntelligenceEventStore({ path: join(dir, "intelligence.sqlite") });
    const decision = decideExecutiveStep(eitherOr);
    persistExecutiveDecision(store, decision);

    const resolved = resolveExecutiveDecision(store, decision.decisionId, "bring in the missing editing tools and route checker", ["domain-message:task:review"]);

    expect(resolved).toMatchObject({ disposition: "ask_george", show: false, notify: false, resolution: { answer: "bring in the missing editing tools and route checker", evidenceRefs: ["domain-message:task:review"] } });
    expect(resolveExecutiveDecision(store, decision.decisionId, "bring in the missing editing tools and route checker", [])).toEqual(resolved);
    expect(store.readSource("executive.cycle")).toHaveLength(2);
    expect(() => resolveExecutiveDecision(store, decision.decisionId, "close it", [])).toThrow(/no longer open/);
  });

  it("combines the LLM interpretation with Jev and records the route before display", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-firstmate-step-"));
    const store = new IntelligenceEventStore({ path: join(dir, "intelligence.sqlite") });
    const complete = vi.fn(async () => JSON.stringify({
      kind: "question",
      summary: "Choose whether to close the review or add the missing tools.",
      question: "Close the review or add the missing tools?",
      questionEvidence: "close it, or bring in the missing editing tools and route checker?",
      options: ["close it", "bring in the missing editing tools and route checker"],
      recommendation: { option: "bring in the missing editing tools and route checker", rationale: "This completes the stated review goal.", evidence: "missing editing tools and route checker" },
      evidenceRefs: ["task:capfive-review"],
    }));
    const calls: string[] = [];
    const decision = await processFirstmateChange({
      eventId: "task:capfive-review:question",
      kind: "reply",
      state: "needs-decision",
      label: "CapFive review",
      detail: "CapFive intranet links (https://github.com/GeorgeGally/capfive/pull/5): close it, or bring in the missing editing tools and route checker?",
      evidenceRefs: ["task:capfive-review"],
    }, {
      store,
      complete,
      jev: {
        apiKey: "test",
        fetchFn: async (_url, init) => {
          calls.push(String(init?.body ?? ""));
          return new Response(JSON.stringify({ model: "jev-test", answers: { executive_change_route: { type: "choice", choice: "ask_george", confidence: 0.96, probabilities: { ask_george: 0.96, handle_internally: 0.02, backstage: 0.01, unclear: 0.01 } } } }), { status: 200 });
        },
      },
      now: () => new Date("2026-10-21T00:00:00Z"),
    });

    expect(decision).toMatchObject({ disposition: "ask_george", notify: true, options: eitherOrProposal.options });
    expect(complete).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain("github.com");
    expect(store.readSource("executive.cycle")).toHaveLength(1);
  });

  it("runs only the exact policy-granted internal action and records its delivery receipt", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-firstmate-action-"));
    const store = new IntelligenceEventStore({ path: join(dir, "intelligence.sqlite") });
    const complete = vi.fn(async () => JSON.stringify({
      kind: "internal_action",
      summary: "Ask the coding boss to recover the still-open review.",
      action: { kind: "request_status", target: "task:review", evidence: "The review was cancelled during routine recovery" },
      evidenceRefs: ["task:review"],
    }));
    const executeInternalAction = vi.fn(async () => ({ status: "verified" as const, evidenceRefs: ["domain-message:task:review:question:1"] }));
    const input = {
      eventId: "task:review:cancelled",
      taskId: "task:review",
      kind: "fleet_state" as const,
      state: "unknown",
      label: "Review the requested fix",
      detail: "The review was cancelled during routine recovery before it reached a verdict.",
      evidenceRefs: ["task:review"],
      authority: [{ grantId: "staff-coordination", capability: "firstmate.message", target: "task:review" }],
    };
    const options = {
      store,
      complete,
      executeInternalAction,
      jev: {
        apiKey: "test",
        fetchFn: async () => new Response(JSON.stringify({ model: "jev-test", answers: { executive_change_route: { type: "choice", choice: "handle_internally", confidence: 0.95, probabilities: { ask_george: 0.02, handle_internally: 0.95, backstage: 0.02, unclear: 0.01 } } } }), { status: 200 }),
      },
    };

    const first = await processFirstmateChange(input, options);
    const replay = await processFirstmateChange(input, options);

    expect(first).toMatchObject({ disposition: "handle_internally", verification: { status: "verified", evidenceRefs: ["domain-message:task:review:question:1"] }, show: false, notify: false });
    expect(replay).toEqual(first);
    expect(complete).toHaveBeenCalledOnce();
    expect(executeInternalAction).toHaveBeenCalledOnce();
    expect(store.readSource("executive.cycle")).toHaveLength(3);
  });
  it("claims an internal action once across simultaneous observers and never retries uncertain delivery", async () => {
    dir = mkdtempSync(join(tmpdir(), "flyd-decision-concurrency-"));
    const store = new IntelligenceEventStore({ path: join(dir, "events.sqlite") });
    const execute = vi.fn(async () => { throw new Error("delivery was interrupted"); });
    const change = { eventId: "cancelled", taskId: "review", kind: "fleet_state" as const, state: "unknown", label: "Review", detail: "Review cancelled before a verdict.", evidenceRefs: ["task:review"], authority: authorityForStaffRun({ runId: "review", firstmate: true, active: true, autonomy: "trusted" }) };
    const options = { store, complete: async () => JSON.stringify({ kind: "internal_action", summary: "Check the review.", action: { kind: "request_status", target: "review", evidence: "Review cancelled" }, evidenceRefs: ["task:review"] }), executeInternalAction: execute,
      jev: { apiKey: "test", fetchFn: async () => new Response(JSON.stringify({ answers: { executive_change_route: { type: "choice", choice: "handle_internally", confidence: 0.95, probabilities: { handle_internally: 0.95 } } } }), { status: 200 }) },
    };
    await Promise.all([processFirstmateChange(change, options), processFirstmateChange(change, options)]);
    const replay = await processFirstmateChange(change, options);
    expect(execute).toHaveBeenCalledOnce();
    expect(replay).toMatchObject({ verification: { status: "unknown" }, show: false, notify: false });
    store.close();
  });

  it("asks the boss to restate a George decision the last output fence holds, instead of dropping it", () => {
    const fenced = { ...eitherOr, proposal: { ...eitherOrProposal, question: "Should FirstMate tell the crewmate to close it?" } };
    expect(decideExecutiveStep(fenced)).toMatchObject({ disposition: "backstage", show: false, notify: false });
    const restated = decideExecutiveStep({ ...fenced, taskId: "review", authority: authorityForStaffRun({ runId: "review", firstmate: true, active: true, autonomy: "trusted" }) });
    expect(restated).toMatchObject({ disposition: "handle_internally", show: false, notify: false, action: { target: "review", text: RESTATE_FOR_GEORGE }, verification: { status: "pending" } });

    const asked = decideExecutiveStep({ ...fenced, taskId: "review", authority: authorityForStaffRun({ runId: "review", firstmate: true, active: true, autonomy: "trusted" }), sentToBoss: [RESTATE_FOR_GEORGE] });
    expect(asked).toMatchObject({ disposition: "ask_george", show: true, notify: true, question: "Should the team tell the team to close it?" });
    expect(asked).not.toHaveProperty("action");
    expect(JSON.stringify([asked.question, asked.options, asked.recommendation])).not.toMatch(/firstmate|crewmate/i);
  });

  it("names only roles in its own words, and never rewrites the work's own mechanics into nonsense", () => {
    const evidence = "Merge fm/fix-island into main, or keep the branch open?";
    const asked = decideExecutiveStep({
      sourceId: "firstmate.status", sourceEventId: "island:merge", taskId: "review", sourceText: `Island fix: ${evidence}`,
      authority: authorityForStaffRun({ runId: "review", firstmate: true, active: true, autonomy: "trusted" }), sentToBoss: [RESTATE_FOR_GEORGE],
      judgment: { route: "ask_george", confidence: 0.95, notable: false },
      proposal: { kind: "question", summary: "Choose whether to merge the island fix now.", question: evidence, questionEvidence: evidence,
        options: ["Merge fm/fix-island into main", "keep the branch open"], evidenceRefs: [] },
    });
    expect(asked).toMatchObject({ disposition: "ask_george", question: "Choose whether to merge the island fix now.", options: [] });
    expect(JSON.stringify(asked)).not.toContain("the team");
  });

  it("drops alternatives it cannot say cleanly when it asks George itself after one restate", () => {
    const promise = { ...eitherOrProposal, question: "Close the review or add the tools?", options: ["close it", "bring in the missing editing tools and route checker"],
      recommendation: { ...eitherOrProposal.recommendation, rationale: "I'll add them next." } };
    const asked = decideExecutiveStep({ ...eitherOr, proposal: promise, taskId: "review", authority: authorityForStaffRun({ runId: "review", firstmate: true, active: true, autonomy: "trusted" }), sentToBoss: [RESTATE_FOR_GEORGE] });
    expect(asked).toMatchObject({ disposition: "ask_george", show: true, question: "Close the review or add the tools?", options: [], recommendation: { rationale: "I recommend clarifying the alternatives before acting." } });
  });

  it("returns a staff question Flyd has not judged George's to its boss once, then brings the next ask to George", () => {
    const authority = authorityForStaffRun({ runId: "review", firstmate: true, active: true, autonomy: "trusted" });
    const { judgment: _judgment, ...withoutJev } = eitherOr;
    for (const input of [{ ...withoutJev, taskId: "review", authority }, { ...eitherOr, taskId: "review", authority, judgment: { route: "handle_internally" as const, confidence: 0.92, notable: false } }]) {
      expect(decideExecutiveStep(input)).toMatchObject({ disposition: "handle_internally", show: false, notify: false, action: { target: "review", text: HANDLE_IT_YOURSELF } });
    }
    expect(decideExecutiveStep({ ...withoutJev, taskId: "review", authority, sentToBoss: [HANDLE_IT_YOURSELF] })).toMatchObject({ disposition: "ask_george", show: true, notify: true });
    expect(decideExecutiveStep({ ...withoutJev, taskId: "review", authority, sentToBoss: [RECOVER_IT_YOURSELF] })).toMatchObject({ action: { text: HANDLE_IT_YOURSELF } });
    expect(decideExecutiveStep({ ...eitherOr, taskId: "review", authority })).toMatchObject({ disposition: "ask_george", show: true });
  });

  it("returns an unconfirmed internal action and failed work to the boss rather than holding them silently", () => {
    const authority = authorityForStaffRun({ runId: "review", firstmate: true, active: true, autonomy: "trusted" });
    const base = { sourceId: "firstmate.status", sourceEventId: "review:cancelled", taskId: "review", authority, sourceText: "The review was cancelled before it reached a verdict." };
    const unconfirmed = decideExecutiveStep({ ...base, proposal: { kind: "internal_action", summary: "Check the review.", action: { kind: "request_status", target: "review", evidence: "The review was cancelled" }, evidenceRefs: [] } });
    expect(unconfirmed).toMatchObject({ disposition: "handle_internally", action: { target: "review", text: RECOVER_IT_YOURSELF }, verification: { status: "pending" } });
    const failed = decideExecutiveStep({ ...base, sourceFailed: true, proposal: { kind: "unclear", summary: "The run failed.", evidenceRefs: [] } });
    expect(failed).toMatchObject({ disposition: "handle_internally", show: false, notify: false, action: { text: RECOVER_IT_YOURSELF } });
    const again = decideExecutiveStep({ ...base, sourceFailed: true, sentToBoss: [RECOVER_IT_YOURSELF], proposal: { kind: "unclear", summary: "The run failed.", evidenceRefs: [] } });
    expect(again).toMatchObject({ disposition: "backstage", show: false, notify: false, reason: HELD_FOR_ATTENTION });
    expect(again).not.toHaveProperty("action");
    expect(decideExecutiveStep({ ...base, proposal: { kind: "routine", summary: "Routine.", evidenceRefs: [] } })).toMatchObject({ disposition: "backstage" });
  });

});

it("keeps an explicit source question answerable when interpretation fails, without inventing Yes/No", async () => {
  dir = mkdtempSync(join(tmpdir(), "flyd-decision-fallback-"));
  const store = new IntelligenceEventStore({ path: join(dir, "events.sqlite") });
  const question = "Close it, or finish the missing tools?";
  const decision = await processFirstmateChange({ eventId: "question", kind: "decision", state: "needs-decision", label: "Review scope", detail: question, evidenceRefs: ["task:scope"] }, {
    store, complete: async () => { throw new Error("provider unavailable"); },
  });
  expect(decision).toMatchObject({ disposition: "ask_george", question, options: [], recommendation: { rationale: "I recommend clarifying the alternatives before acting." }, show: true, notify: true });
  expect(decision).not.toHaveProperty("action");
  store.close();
});

it("holds an unexecuted personal promise at the final output fence", () => {
  const decision = decideExecutiveStep({ ...eitherOr, proposal: { ...eitherOrProposal, question: "I'll decide whether to restart it and let you know." } });
  expect(decision).toMatchObject({ disposition: "backstage", show: false, notify: false });
});
