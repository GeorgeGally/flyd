import { describe, expect, it } from "vitest";
import { resolveStrategicQuestion, strategicPrompt } from "../cos/strategic-judgment.js";
import type { OperationalQuestion } from "../cos/operational-judgment.js";

const question: OperationalQuestion = {
  domain: "coding", goal: "Fix the site navigation",
  question: "Which unit-test framework should the navigation use?",
  options: ["Vitest", "Jest"], recommendation: "Vitest",
  evidenceRefs: ["domain-run:test"],
};

describe("Flyd private executive judgment", () => {
  it("recommends a grounded existing internal option without asking George", async () => {
    const result = await resolveStrategicQuestion(question, "fast model abstained", {
      complete: async () => JSON.stringify({ action: "choose", option: "Vitest", reason: "already used elsewhere" }),
    });
    expect(result.kind).toBe("internal");
    if (result.kind === "internal") expect(result.message).toContain("Vitest");
    expect(strategicPrompt(question, "fast model abstained")).toContain("NOT a conversation");
  });
  it("investigates ambiguous implementation questions instead of asking George", async () => {
    const result = await resolveStrategicQuestion(question, "worker returned the same unresolved question", {
      complete: async () => JSON.stringify({ action: "investigate", instruction: "Read the existing component tests and align the failing case", reason: "missing evidence" }),
    });
    expect(result.kind).toBe("internal");
    if (result.kind === "internal") expect(result.message).toMatch(/investigation/);
  });
  it("fails closed on model-selected options not in source evidence", async () => {
    const result = await resolveStrategicQuestion(question, "uncertain", {
      complete: async () => JSON.stringify({ action: "choose", option: "Delete everything" }),
    });
    expect(result.kind).toBe("hold");
  });
  it("does not allow a model to turn an internal disagreement into a user interruption", async () => {
    const result = await resolveStrategicQuestion(question, "conflicting tests", {
      complete: async () => JSON.stringify({ action: "need_george", reason: "Which test framework do you want?" }),
    });
    expect(result.kind).toBe("hold");
  });
  it("preserves scope restrictions for outward actions", async () => {
    const result = await resolveStrategicQuestion({ ...question, question: "Should we publish or deploy?" }, "uncertain", {
      complete: async () => JSON.stringify({ action: "choose", option: "Vitest" }),
    });
    expect(result.kind).toBe("george");
  });
  it("treats an unavailable or malformed model as a hold, never as permission", async () => {
    const result = await resolveStrategicQuestion(question, "no response", {
      complete: async () => { throw new Error("offline"); },
    });
    expect(result.kind).toBe("hold");
  });
});
