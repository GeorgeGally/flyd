import { describe, expect, it } from "vitest";
import { answerForm, reshapeAnswer } from "../answer-shape.js";
import type { PredicateEvaluation } from "../../cognition/system-one/types.js";

const evaluation = (choice: string, probability: number): PredicateEvaluation => ({
  ok: true,
  evaluator: "jev",
  model: "jev-test",
  rubricVersion: "test",
  projectionHash: "test",
  evaluatedAt: new Date(0).toISOString(),
  latencyMs: 1,
  answers: {
    answer_form: { id: "answer_form", type: "choice", confidence: probability, probability, choice, probabilities: { [choice]: probability } },
  },
});

describe("answerForm", () => {
  it("keeps prose when Jev is off", async () => {
    expect(await answerForm("Why did the screen stay blank?", "The renderer was never called.")).toBeNull();
  });

  it("takes a confident shape and refuses a guess or prose", async () => {
    expect(await answerForm("Why blank?", "Never called.", async () => evaluation("diagnosis", 0.91))).toBe("diagnosis");
    expect(await answerForm("Pink or blue?", "Pink.", async () => evaluation("comparison", 0.82))).toBe("comparison");
    expect(await answerForm("Why blank?", "Never called.", async () => evaluation("diagnosis", 0.55))).toBeNull();
    expect(await answerForm("Why blank?", "Never called.", async () => evaluation("prose", 0.99))).toBeNull();
  });
});

describe("reshapeAnswer", () => {
  const diagnosis = JSON.stringify({
    lead: "The island filter was paused.",
    parts: [
      { label: "Expected", text: "Every item would show." },
      { label: "Observed", text: "The list showed nothing." },
      { label: "Cause", text: "The filter was off on 14 Oct." },
      { label: "Evidence", text: "island-filter.ts" },
      { label: "Next", text: "Turn it back on." },
    ],
  });

  it("takes the shape the model returned, fences and all, keeping its words", async () => {
    const body = await reshapeAnswer("Why is the list empty?", "The filter was paused.", "diagnosis", async () => `\`\`\`json\n${diagnosis}\n\`\`\``);
    expect(body).toMatchObject({ form: "diagnosis", lead: "The island filter was paused." });
    if (body?.form !== "diagnosis") throw new Error("expected a diagnosis");
    expect(body.parts.map((part) => part.label)).toEqual(["Expected", "Observed", "Cause", "Evidence", "Next"]);
    expect(body.parts.at(-1)!.text).toBe("Turn it back on.");
  });

  it("leaves the prose alone when the shape is wrong or unreadable", async () => {
    expect(await reshapeAnswer("Why?", "Because.", "comparison", async () => diagnosis)).toBeNull();
    expect(await reshapeAnswer("Why?", "Because.", "diagnosis", async () => "not json")).toBeNull();
  });
});
