import { describe, expect, it } from "vitest";
import cases from "../delivery.json" with { type: "json" };
import { DELIVERY_SHAPES, leadOf, scoreDelivery, type DeliveryCase, type DeliveryObservation } from "../delivery-scoring.js";

const base: DeliveryCase = { id: "t", category: "delivery", origin: "fixture", surface: "notification", expect: {} };

function score(observed: Partial<DeliveryObservation>, testCase: Partial<DeliveryCase> = {}) {
  return scoreDelivery({ ...base, ...testCase, expect: { ...base.expect, ...testCase.expect } }, { text: null, shape: "words", seconds: 1, ...observed });
}

describe("scoreDelivery", () => {
  it("passes one short outcome-first line in the expected shape", () => {
    expect(score({ text: "The checkout button works on mobile now: https://github.com/o/r/pull/88", shape: "landed" }, { expect: { shape: "landed" } }))
      .toEqual({ passed: true, failures: [] });
  });

  it("fails when nothing reached him, and when chatter Flyd should keep did", () => {
    expect(score({ text: null }).failures).toEqual(["nothing reached him"]);
    expect(score({ text: "Tests are running." }, { expect: { delivered: false } }).failures[0]).toMatch(/^told him about work Flyd should keep/);
    expect(score({ text: "" }, { expect: { delivered: false } }).passed).toBe(true);
  });

  it("holds the lead to 120 characters and the whole to three lines", () => {
    const failures = score({ text: `${"a".repeat(130)}\nb\nc\nd` }).failures;
    expect(failures).toContain("lead line 130 chars > 120");
    expect(failures).toContain("4 lines > 3");
  });

  it("names a wrong shape", () => {
    expect(score({ text: "Three versions are ready.", shape: "words" }, { expect: { shape: "picture" } }).failures).toEqual(["delivered as words, expected picture"]);
  });

  it("catches the real deliveries George found poor", () => {
    expect(score({ text: "parked at review: 1 finding(s) · ask-user: authority decision" }).failures).toContain('uses the staff\'s words ("parked at")');
    expect(score({ text: "Pick which phases to start (plan: data/logan-pages-overhaul-plan/report.md)." }).failures).toContain('shows a path ("data/logan-pages-overhaul-plan/report.md")');
    expect(score({ text: "Waiting on George's three calls recorded in cap5-dash-lab-r5-calls" }).failures)
      .toEqual(expect.arrayContaining(['shows a task id ("cap5-dash-lab-r5-calls")', "talks about him, not to him"]));
    expect(score({ text: "Flyd couldn't answer this: no evidence tool succeeded" }).failures).toContain("shows him the error");
    expect(score({ text: "Logan is slow.\nExpected: smooth\nCause: double redraw" }).failures).toContain("shows the diagnosis card's labels");
    expect(score({ text: "Do first: CapFive's cookie consent." }, { previous: ["Do first: CapFive's cookie consent."] }).failures).toContain("tells him what he was already told");
    expect(score({ text: "Pick a phase to start first. Pick a phase to start first." }).failures).toContain("repeats itself");
  });

  it("does not read a link as a path", () => {
    expect(score({ text: "Live now: https://goodneighbours.market/vendors/list.html" }).passed).toBe(true);
  });

  it("applies the judge's minimum", () => {
    expect(score({ text: "Done.", judgeScore: 5, judgeReason: "vague" }, { expect: { judge: "clear" } }).failures).toEqual(["judge 5/10 < 7: vague"]);
    expect(score({ text: "Done." }, { expect: { judge: "clear" } }).failures).toEqual(["judge did not score the delivery"]);
  });

  it("measures what he reads: a link's words, not its address", () => {
    const text = `Yes. The [hero spacing fix](https://github.com/GeorgeGally/gnm/pull/91${"9".repeat(80)}) is live.`;
    expect(leadOf(text)).toBe("Yes. The hero spacing fix is live.");
    expect(score({ text }).passed).toBe(true);
  });

  it("reads the first non-empty line as the lead", () => {
    expect(leadOf("\n  Booked for Friday.\nMore here.")).toBe("Booked for Friday.");
  });
});

describe("delivery cases", () => {
  const all = cases as unknown as DeliveryCase[];

  it("each case is whole for its surface", () => {
    const ids = new Set<string>();
    for (const testCase of all) {
      expect(ids.has(testCase.id), testCase.id).toBe(false);
      ids.add(testCase.id);
      if (testCase.expect.shape) expect(DELIVERY_SHAPES).toContain(testCase.expect.shape);
      if (testCase.surface === "notification") expect(testCase.run, testCase.id).toBeDefined();
      if (testCase.surface === "window") expect(testCase.reply, testCase.id).toBeDefined();
      if (testCase.surface === "answer") expect(testCase.answer, testCase.id).toBeDefined();
      if (testCase.surface === "desk-error") expect(testCase.error, testCase.id).toBeDefined();
      if (testCase.origin === "real") expect(testCase.seen && testCase.source, testCase.id).toBeTruthy();
    }
  });

  it("covers every shape and seeds the real examples from the deep dive", () => {
    const shapes = new Set(all.map((testCase) => testCase.expect.shape).filter(Boolean));
    for (const shape of DELIVERY_SHAPES) expect(shapes, shape).toContain(shape);
    expect(all.filter((testCase) => testCase.origin === "real").length).toBeGreaterThanOrEqual(5);
  });
});
