import { describe, expect, it } from "vitest";
import type { DomainResult, DomainRun } from "../../command/types.js";
import type { ExecutiveDecisionRecord } from "../../intelligence/executive/decision-step.js";
import { answerLead, chooseShape, deliver, deliveredPromptBlock, leadLine, reportFromReply, reportFromRun, saidOnce, type Report } from "../delivery.js";

// The oracle is the split plan's Delivery standard: the shape table, the
// 120-character lead line, at most two more lines, and the per-surface rules.

const result = (overrides: Partial<DomainResult>): DomainResult => ({
  format: "structured", brief: "", detailedReport: "", decisionsMade: [], unresolvedQuestions: [], risks: [],
  evidence: [], artifacts: [], specialistOutputs: [], raw: [], informationLossRisk: "low", ...overrides,
});

const run = (overrides: Partial<DomainRun> & { result: DomainResult }): DomainRun => ({
  id: "domain-1",
  request: { id: "request-1", domain: "coding", originalMessage: "fix it", intendedOutcome: "The checkout button works on mobile", doneWhen: [], createdAt: "2026-11-10T00:00:00Z", source: "chat" },
  owner: "firstmate", status: "completed", createdAt: "2026-11-10T00:00:00Z", updatedAt: "2026-11-10T00:00:00Z",
  transport: { kind: "firstmate", requestId: "request-1" },
  ...overrides,
});

const report = (overrides: Partial<Report>): Report => ({
  id: "r", kind: "done", outcome: "", detail: "", evidenceRefs: [], shape: "words", artefacts: [], urgency: "today", ...overrides,
});

describe("chooseShape", () => {
  const base = { kind: "done" as const, outcome: "Done.", artefacts: [] as string[] };

  it("follows the standard's table in order", () => {
    expect(chooseShape({ ...base, artefacts: ["lab/shots/b.png"] })).toBe("picture");
    expect(chooseShape({ ...base, kind: "decision", options: ["Stripe", "Paddle"] })).toBe("decision");
    expect(chooseShape({ ...base, steps: ["a", "b", "c", "d"] })).toBe("steps");
    expect(chooseShape({ ...base, document: "x".repeat(400) })).toBe("document");
    expect(chooseShape({ ...base, outcome: "Merged: the button works.", link: "https://github.com/o/r/pull/8" })).toBe("landed");
    expect(chooseShape(base)).toBe("words");
  });

  it("says a failure in words, never as a card", () => {
    expect(chooseShape({ ...base, kind: "blocked", artefacts: ["shot.png"], steps: ["a", "b", "c", "d"] })).toBe("words");
  });

  it("does not call work landed that has not landed", () => {
    expect(chooseShape({ ...base, outcome: "I'll merge it once green.", link: "https://github.com/o/r/pull/8" })).toBe("words");
    expect(chooseShape({ ...base, outcome: "Merged.", link: "https://example.com" })).toBe("words");
    expect(chooseShape({ ...base, steps: ["a", "b", "c"] })).toBe("words");
  });
});

describe("leadLine", () => {
  it("holds the lead to 120 characters, outcome first", () => {
    const lead = leadLine(`Sir, ${"the pricing comparison is done and Stripe is the cheapest at your volume once Billing and tax are counted ".repeat(2)}`);
    expect(lead.length).toBeLessThanOrEqual(120);
    expect(lead).toMatch(/^The pricing comparison is done/);
  });
});

describe("deliver", () => {
  const long = report({ outcome: "The pricing comparison is done: Stripe is cheapest.", detail: "Paddle handles tax for you. Lemon Squeezy costs more. Xendit is weak on subscriptions.", link: "https://example.com/report" });

  it("puts only the lead line in a notification", () => {
    expect(deliver(long, "notification").text).toBe("The pricing comparison is done: Stripe is cheapest.");
  });

  it("shows the lead and at most two more lines in the window", () => {
    const text = deliver(long, "window").text!;
    expect(text.split("\n")).toEqual(["The pricing comparison is done: Stripe is cheapest.", "Paddle handles tax for you.", "Lemon Squeezy costs more."]);
  });

  it("leaves a line too long to show whole for \"more\", never cut", () => {
    const text = deliver(report({ outcome: "Stripe is the pick.", detail: `${"Paddle costs more but handles sales tax for you as the merchant of record in every country you sell to ".repeat(2)}. Lemon Squeezy costs more.` }), "window").text!;
    expect(text.split("\n")).toEqual(["Stripe is the pick.", "Lemon Squeezy costs more."]);
  });

  it("carries the lead, its two lines and its link into the next turn", () => {
    expect(deliver(long, "context").text).toBe("The pricing comparison is done: Stripe is cheapest. Paddle handles tax for you. Lemon Squeezy costs more. (https://example.com/report)");
  });

  it("never shows a line in the staff's words; finished work falls back to its own name", () => {
    const staff = report({ kind: "decision", outcome: "Waiting on George's three calls recorded in cap5-dash-lab-r5-calls", shape: "decision", options: ["A", "B"] });
    expect(deliver(staff, "notification")).toMatchObject({ text: null, held: expect.arrayContaining(["It shows a task id.", "It talks about him, not to him."]) });
    const done = report({ outcome: "parked at review: 1 finding(s)", work: "The Logan editor drag fix" });
    expect(deliver(done, "notification").text).toBe("The Logan editor drag fix is done.");
  });

  it("falls back to words when the shape's artefact is missing", () => {
    expect(deliver(report({ outcome: "Three versions are ready.", shape: "picture" }), "window").shape).toBe("words");
    expect(deliver(report({ outcome: "Live now.", shape: "landed", link: "https://github.com/o/r/pull/8" }), "window")).toMatchObject({ shape: "landed", text: "Live now. https://github.com/o/r/pull/8" });
  });
});

describe("reportFromRun", () => {
  it("makes a finished lab a picture, led by the outcome", () => {
    const made = reportFromRun(run({ request: { ...run({ result: result({}) }).request, domain: "creative" }, result: result({ brief: "Three hero directions are ready; version B is the pick.", artifacts: ["lab/a.png", "lab/b.png", "lab/c.png"] }) }));
    expect(made).toMatchObject({ kind: "done", shape: "picture", outcome: "Three hero directions are ready; version B is the pick." });
    expect(deliver(made, "window").artefacts).toEqual(["lab/a.png", "lab/b.png", "lab/c.png"]);
  });

  it("makes landed code one line and its link", () => {
    const made = reportFromRun(run({ result: result({ brief: "Merged: the checkout button now works on mobile.", artifacts: ["https://github.com/o/gnm/pull/88"] }) }));
    expect(made).toMatchObject({ shape: "landed", link: "https://github.com/o/gnm/pull/88" });
    expect(deliver(made, "window").text).toBe("Merged: the checkout button now works on mobile. https://github.com/o/gnm/pull/88");
  });

  it("makes a list of more than three a steps artefact", () => {
    const made = reportFromRun(run({ result: result({ brief: "Onboarding is tidied. Seven changes: 1) one welcome screen, 2) plan remembered, 3) Google first, 4) honest progress, 5) skip works, 6) dashboard link, 7) shorter copy." }) }));
    expect(made.shape).toBe("steps");
    expect(made.steps).toHaveLength(7);
    expect(deliver(made, "notification").text).toBe("Onboarding is tidied.");
  });

  it("makes a long report a document behind its lead", () => {
    const made = reportFromRun(run({ result: result({ brief: "Stripe is the best fit for Bloom.", detailedReport: "Compared four providers. ".repeat(40) }) }));
    expect(made.shape).toBe("document");
    expect(made.document).toContain("Compared four providers.");
  });

  it("makes his call a decision with the review step's options and recommendation", () => {
    const decision = {
      schema: "executive.decision.v1", decisionId: "d", sourceId: "s", sourceEventId: "e", reason: "", summary: "", evidenceRefs: ["x"], createdAt: "",
      disposition: "ask_george", show: true, notify: true, question: "Which list should signups go to?", options: ["Buttondown", "Mailchimp", "The site"],
      recommendation: { option: "Buttondown", rationale: "It keeps Logan's subscribers separate." }, verification: { status: "unknown", evidenceRefs: [] },
    } as unknown as ExecutiveDecisionRecord;
    const made = reportFromRun(run({ status: "needs_decision", result: result({}) }), decision);
    expect(made).toMatchObject({ kind: "decision", shape: "decision", outcome: "Which list should signups go to?", options: ["Buttondown", "Mailchimp", "The site"] });
    expect(deliver(made, "window").text).toBe("Which list should signups go to?\nI'd go with Buttondown: It keeps Logan's subscribers separate.");
  });

  it("says a failure as one plain sentence with nothing else", () => {
    const made = reportFromRun(run({ status: "failed", result: result({ brief: "The dashboard isn't live yet. Kinsta needs the new key. Built cleanly.", artifacts: ["shot.png"] }) }));
    expect(made).toMatchObject({ kind: "blocked", shape: "words", detail: "" });
  });

  it("uses the review step's checked line for finished work when there is one", () => {
    const decision = { disposition: "handle_internally", show: true, notify: true, summary: "", evidenceRefs: [], delivery: { line: "The checkout fix is live.", url: "https://github.com/o/r/pull/9" } } as unknown as ExecutiveDecisionRecord;
    expect(reportFromRun(run({ result: result({ brief: "PR merged after checks." }) }), decision)).toMatchObject({ outcome: "The checkout fix is live.", link: "https://github.com/o/r/pull/9" });
  });
});

describe("saidOnce", () => {
  it("says a repeated sentence once", () => {
    expect(saidOnce("Pick a phase. Pick a phase. Pick a phase.")).toBe("Pick a phase.");
  });
});

describe("reportFromReply", () => {
  it("leads with Flyd's reading and takes the shape from the reply", () => {
    const made = reportFromReply({ id: "m", reading: "Yes, the spacing fix is live. Nothing else needed.", reply: "Merged and deployed https://github.com/o/r/pull/91 after 14 checks." });
    expect(made).toMatchObject({ outcome: "Yes, the spacing fix is live.", link: "https://github.com/o/r/pull/91", shape: "landed" });
    expect(reportFromReply({ id: "m", reading: "Stripe or Paddle? I recommend Stripe.", reply: "Stripe or Paddle?", options: ["Stripe", "Paddle"] }).shape).toBe("decision");
  });
});

describe("answerLead", () => {
  it("leaves an answer that already fits whole", () => {
    expect(answerLead("It opens Saturday at 4pm.")).toBeNull();
  });

  it("leads a short answer whose first line runs past 120 characters with its lead line", () => {
    const long = "The Nuanu Christmas market opens on Saturday 12 December from four in the afternoon until ten at night, every weekend.";
    expect(answerLead(`${long} Bring cash.`)).not.toBeNull();
  });

  it("leads a long answer with one short line and two more", () => {
    const lead = answerLead(`${"The market opens on Saturday 12 December at four in the afternoon and runs into the evening with live music. ".repeat(2)}Bring cash. Parking fills early. The food court is at the back.`)!;
    const lines = lead.split("\n");
    expect(lines[0]!.length).toBeLessThanOrEqual(120);
    expect(lines.length).toBeLessThanOrEqual(3);
  });
});

describe("deliveredPromptBlock", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const finished = (id: string, overrides: Partial<DomainRun>) => run({ id, notified: true, updatedAt: "2026-11-10T10:00:00Z", result: result({ brief: `Report ${id} is in.` }), ...overrides });

  it("carries recent finished work he was told into the next turn, newest first", () => {
    const block = deliveredPromptBlock(now, [
      finished("older", { updatedAt: "2026-11-10T09:00:00Z" }),
      finished("newer", {}),
      finished("stale", { updatedAt: "2026-11-07T09:00:00Z" }),
      finished("unsaid", { notified: false }),
      finished("note", { request: { ...run({ result: result({}) }).request, source: "flyd" } }),
    ]);
    expect(block.split("\n").filter((line) => line.startsWith("- "))).toEqual(["- Report newer is in.", "- Report older is in."]);
  });

  it("is empty with nothing to carry", () => {
    expect(deliveredPromptBlock(now, [])).toBe("");
  });
});
