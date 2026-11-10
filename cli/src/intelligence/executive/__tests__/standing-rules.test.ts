import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseBearings, projectFleetDecisions } from "../../../conversation-view/artefact.js";
import { IntelligenceEventStore } from "../../event-store.js";
import { bossMessageKind, decideExecutiveStep, notesSentToBoss, persistExecutiveDecision, readExecutiveDecision, RESTATE_FOR_GEORGE, takeBackSettledDecision, tookBackOn, type ExecutiveDecisionInput } from "../decision-step.js";
import { authorityForStaffRun, processFirstmateChange } from "../firstmate-decision.js";
import { plainQuestionFor, showsMachinery, withoutRepeats } from "../plain-question.js";
import { settleCall, STANDING_ANSWER_MARK, STANDING_RULES_POLICY } from "../standing-rules.js";

const PREFERENCES = [
  "- Merge green Flyd PRs without asking — land the work and tell him after, not before. (2026-10-10)",
  "- George expects assistants/agents to take control of situations and solve problems autonomously rather than sending problems back to him. (2026-10-14)",
  "- George does not want to be given extra work or decisions. (2026-10-17)",
].join("\n");

const call = (question: string, taskId = "logan-pages-plan", label = "Logan: plan to overhaul Pages") => ({ taskId, label, question, sourceText: `${label} — ${question}` });

describe("George's standing rules in the review step", () => {
  it("takes the staff's recommended phase when nothing in it is irreversible or costs money", () => {
    const settled = settleCall(call("Pick which Pages overhaul phases to start (plan: data/logan-pages-overhaul-plan/report.md; recommended phase 0+1 first)"), PREFERENCES);
    expect(settled).toMatchObject({ rule: "staff-recommendation", answer: "Go with your recommendation: phase 0+1 first.", line: "Went with the team's recommendation: phase 0+1 first." });
    expect(settled!.note!.startsWith(STANDING_ANSWER_MARK)).toBe(true);
    expect(bossMessageKind(settled!.note!)).toBe("decision");
  });

  it("never takes an option the staff advise against", () => {
    const against = (question: string, sourceText: string) => settleCall({ taskId: "logan-pages-plan", label: "Logan", question, sourceText }, PREFERENCES);
    expect(against("Which phase should we start?", "We do not recommend phase 2 yet; which phase should we start?")).toBeNull();
    expect(against("Which option should we go with?", "We recommend against option B. Which option should we go with?")).toBeNull();
  });

  it("never settles a review gate, even on Flyd's own work: review findings stay with the staff", () => {
    expect(settleCall(call("parked at review: 4 finding(s) · ask-user: authority decision", "flyd-today-build", "Flyd today"), PREFERENCES)).toBeNull();
    expect(settleCall(call("parked at review: 1 finding(s) · ask-user: authority decision", "logan-chat", "Logan chat"), PREFERENCES)).toBeNull();
  });

  it("does not ask twice what is already open for him under another call, and says nothing", () => {
    const settled = settleCall({ ...call("Waiting on George's three calls recorded in cap5-dash-lab-r5-calls.", "cap5-dash-lab-r5"), openCalls: ["cap5-dash-lab-r5-calls"] }, PREFERENCES);
    expect(settled).toMatchObject({ rule: "asked-elsewhere" });
    expect(settled!.note).toBeUndefined();
    expect(settled!.line).toBeUndefined();
  });

  it("holds nothing as asked elsewhere unless that call is open, nor anything destructive", () => {
    expect(settleCall(call("Waiting on George's three calls recorded in cap5-dash-lab-r5-calls.", "cap5-dash-lab-r5"), PREFERENCES)).toBeNull();
    expect(settleCall({ ...call("Pending on fix-login-flow: should I delete the old branch?", "logan-chat"), openCalls: ["fix-login-flow"] }, PREFERENCES)).toBeNull();
  });

  it("never settles what is destructive, costs money, a taste call, his own word, or a stop", () => {
    for (const question of [
      "Which should happen to the lab changes: discard, archive, or land? (recommended archive)",
      "Pick a pricing plan to buy (recommended the yearly plan)",
      "Pick a direction for the logo (recommended direction B)",
      "The server fix list is awaiting George's go-ahead (recommended fix all)",
      "Is George done looking at the preview, so it can be stopped?",
      "Which options do you pick for the five sections: v06 eyebrow wording?",
    ]) expect(settleCall(call(question), PREFERENCES)).toBeNull();
  });

  it("stands only on lines he wrote: without them nothing is settled", () => {
    expect(settleCall(call("Pick which phases to start (recommended phase 0+1 first)"), "- George likes tea.")).toBeNull();
    expect(authorityForStaffRun({ runId: "r", firstmate: true, active: true, autonomy: "trusted", standing: "- George likes tea." }).map((grant) => grant.grantId)).not.toContain(STANDING_RULES_POLICY.id);
    expect(authorityForStaffRun({ runId: "r", firstmate: true, active: true, autonomy: "ask", standing: PREFERENCES })).toEqual([]);
  });
});

describe("a staff question in George's words", () => {
  it("keeps one copy of a passage pasted again and again", () => {
    const once = "Weekly recurring memory refresh; due 2026-10-21";
    expect(withoutRepeats(Array(7).fill(once).join(" ") + " Weekly rec")).toBe(once);
    expect(withoutRepeats("Pick a phase. Pick a phase. Then build it.")).toBe("Pick a phase. Then build it.");
  });

  it("strips paths, task ids and pipeline words, and speaks to him", () => {
    expect(plainQuestionFor("Waiting on George's picks for items 2 and 4 (board http://127.0.0.1:4387/session/dedc9b5c4dff0b4d).", "cleanx-redo")).toBe("Waiting on your picks for items 2 and 4.");
    expect(plainQuestionFor("Is George done looking, so it can be stopped?")).toBe("Are you done looking, so it can be stopped?");
    expect(plainQuestionFor("parked at review: 1 finding(s) · ask-user: authority decision")).toBeNull();
    expect(plainQuestionFor("needs-decision [at=1794019232]: still waiting on server window (wip/logan-pages-p2 a6bc66c…")).toBeNull();
    expect(showsMachinery("Review data/cap5/report.md")).toBe(true);
  });

  it("leaves plain words alone: hyphenated words, common words and possessives read as he would say them", () => {
    expect(plainQuestionFor("Is the end-to-end test suite up-to-date?")).toBe("Is the end-to-end test suite up-to-date?");
    expect(plainQuestionFor("Should the data pipeline run nightly?")).toBe("Should the data pipeline run nightly?");
    expect(showsMachinery("Is the scout backlog deadbeef or 1234567 long?")).toBe(false);
    expect(plainQuestionFor("Is George's call needed on the merge?")).toBe("Is your call needed on the merge?");
    expect(plainQuestionFor("Has George's review finished?")).toBe("Has your review finished?");
  });

  it("strips the fleet's own task ids, even ones without a digit", () => {
    expect(plainQuestionFor("Same calls as recorded in logan-pages-plan: which phase first?", ["logan-chat", "logan-pages-plan"])).toBe("Same calls as: which phase first?");
  });
});

describe("standing answers through the decision step", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
  const question = "Pick which Pages overhaul phases to start (recommended phase 0+1 first)";
  const input: ExecutiveDecisionInput = {
    sourceId: "firstmate.change", sourceEventId: "pages:decision", taskId: "logan-pages-plan", label: "Logan: Pages overhaul",
    sourceText: `Logan: Pages overhaul — ${question}`,
    proposal: { kind: "question", summary: "Pages overhaul phases", question, questionEvidence: question, options: [], evidenceRefs: [] },
    authority: authorityForStaffRun({ runId: "logan-pages-plan", firstmate: true, active: true, autonomy: "trusted", standing: PREFERENCES }),
    standing: PREFERENCES,
  };

  it("answers the call through the boss's note path once, instead of asking him", () => {
    const decided = decideExecutiveStep(input);
    expect(decided).toMatchObject({ disposition: "handle_internally", show: false, notify: false, settled: { rule: "staff-recommendation" }, action: { grantId: STANDING_RULES_POLICY.id, target: "logan-pages-plan" } });
    const again = decideExecutiveStep({ ...input, sentToBoss: [decided.action!.text] });
    expect(again).toMatchObject({ disposition: "backstage", settled: { rule: "staff-recommendation" } });
    expect(notesSentToBoss([{ from: "flyd", body: decided.action!.text, deliveredAt: "2026-11-10T00:00:00Z" }])).toEqual([decided.action!.text]);
  });

  it("answers nothing more for him on a task once he took an answer back", () => {
    const decided = decideExecutiveStep({ ...input, takenBack: true, judgment: { route: "ask_george", confidence: 0.95, notable: false } });
    expect(decided).toMatchObject({ disposition: "ask_george", show: true });
    expect(decided.settled).toBeUndefined();
  });

  it("never shows a pipeline-only question raw: its boss restates it first", () => {
    const raw = "parked at review: 1 finding(s) · ask-user: authority decision";
    const asked = decideExecutiveStep({ ...input, taskId: "pierre-music", sourceText: raw, standing: undefined, judgment: { route: "ask_george", confidence: 0.95, notable: false },
      authority: authorityForStaffRun({ runId: "pierre-music", firstmate: true, active: true, autonomy: "trusted" }),
      proposal: { kind: "question", summary: raw, question: raw, questionEvidence: raw, options: [], evidenceRefs: [] } });
    expect(asked).toMatchObject({ disposition: "handle_internally", action: { text: RESTATE_FOR_GEORGE } });
    const after = decideExecutiveStep({ ...input, taskId: "pierre-music", sourceText: raw, standing: undefined, judgment: { route: "ask_george", confidence: 0.95, notable: false },
      authority: authorityForStaffRun({ runId: "pierre-music", firstmate: true, active: true, autonomy: "trusted" }), sentToBoss: [RESTATE_FOR_GEORGE],
      proposal: { kind: "question", summary: raw, question: raw, questionEvidence: raw, options: [], evidenceRefs: [] } });
    expect(after.show).toBe(false);
  });

  it("shows one quiet handled line in place of the call, and his own answer takes it back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flyd-standing-"));
    dirs.push(dir);
    const store = new IntelligenceEventStore({ path: join(dir, "intelligence.sqlite") });
    try {
      const decided = await processFirstmateChange({
        eventId: "pages", taskId: "logan-pages-plan", kind: "decision", state: "needs-decision", label: "Logan: Pages overhaul", detail: question,
        evidenceRefs: [], authority: input.authority!, standing: PREFERENCES,
      }, { store, complete: async () => "not json", executeInternalAction: async () => ({ status: "verified", evidenceRefs: ["firstmate-note:x"] }) });
      expect(decided.settled?.rule).toBe("staff-recommendation");
      const fleet = parseBearings({ decisions_open: [{ id: "logan-pages-plan", summary: question }] });
      const projected = projectFleetDecisions(fleet, [decided]);
      expect(projected.calls).toEqual([]);
      expect(projected.landed[0]).toMatchObject({ status: "handled", task: "logan-pages-plan", label: "Went with the team's recommendation: phase 0+1 first.", executiveDecisionId: decided.decisionId });

      const taken = takeBackSettledDecision(store, decided.decisionId, "Start with phase 2");
      expect(taken.settled?.takenBack?.answer).toBe("Start with phase 2");
      expect(readExecutiveDecision(store, decided.decisionId)?.settled?.takenBack).toBeTruthy();
      expect(tookBackOn(store, "logan-pages-plan")).toBe(true);
      expect(projectFleetDecisions(fleet, [taken]).landed.filter((row) => row.status === "handled")).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("rewrites a raw call that has no George decision yet, and keeps one with nothing plain left as a held line", () => {
    const fleet = parseBearings({ decisions_open: [
      { id: "cap5-front", summary: "Still open: his picks for the five sections (board http://127.0.0.1:4387/session/abc)" },
      { id: "flyd-ship", summary: "parked at test: 2 finding(s) · ask-user: authority decision" },
    ] });
    const calls = projectFleetDecisions(fleet, []).calls;
    expect(calls.map((row) => row.label)).toEqual(["Still open: your picks for the five sections", "A call on your work is waiting; Flyd is getting it restated."]);
    expect(calls[1]).toMatchObject({ task: "flyd-ship" });
    expect(calls[1]!.question).toBeUndefined();
  });
});

it("keeps a settled record valid at the event-store boundary", () => {
  const dir = mkdtempSync(join(tmpdir(), "flyd-standing-parse-"));
  const store = new IntelligenceEventStore({ path: join(dir, "intelligence.sqlite") });
  try {
    const decided = decideExecutiveStep({ sourceId: "s", sourceEventId: "e", taskId: "x-y", sourceText: "Waiting on the calls recorded in other-task-calls.", label: "x",
      proposal: { kind: "question", summary: "x", question: "Waiting on the calls recorded in other-task-calls.", questionEvidence: "Waiting on the calls recorded in other-task-calls.", options: [], evidenceRefs: [] },
      authority: authorityForStaffRun({ runId: "x-y", firstmate: true, active: true, autonomy: "trusted", standing: PREFERENCES }), standing: PREFERENCES, openCalls: ["other-task-calls"] });
    persistExecutiveDecision(store, decided);
    expect(readExecutiveDecision(store, decided.decisionId)).toMatchObject({ disposition: "backstage", settled: { rule: "asked-elsewhere" } });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
