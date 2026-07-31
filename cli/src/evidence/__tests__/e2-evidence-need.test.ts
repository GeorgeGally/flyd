import { describe, expect, it } from "vitest";
import {
  classifyEvidenceNeed,
  parseResolutionEvidenceContext,
} from "../evidence-need.js";

function prompt(intent: string, kind = "ask_answer", context = "- Element value: \"\"\n- Selected text: \"\""): string {
  return `ROUTE DECISION:
- Kind: ${kind}
- Placement: answer_panel
- Scene: concise_answer

CURRENT CONTEXT:
- Application: Browser
${context}
- Sufficiency: semantic

USER INTENT: "${intent}"

RELEVANT USER GOALS:
- none

RESOLUTION RULES:`;
}

describe("E2 evidence need classification", () => {
  it("requires evidence for explicit current external facts", () => {
    const context = parseResolutionEvidenceContext(prompt("What is the latest pricing for Jina AI?"));
    expect(context).not.toBeNull();
    expect(classifyEvidenceNeed(context!).level).toBe("required");
  });

  it("reads a visible URL when the user refers to this", () => {
    const context = parseResolutionEvidenceContext(prompt(
      "Would Flyd be more powerful with this?",
      "ask_answer",
      "- Element value: \"https://github.com/example/reach\"\n- Selected text: \"\"",
    ));
    const decision = classifyEvidenceNeed(context!);
    expect(decision.level).toBe("required");
    expect(decision.locators).toEqual(["https://github.com/example/reach"]);
  });

  it("keeps personal current-state recall on Flyd memory", () => {
    const context = parseResolutionEvidenceContext(prompt("What am I working on currently?"));
    expect(classifyEvidenceNeed(context!).level).toBe("none");
  });

  it("does not research draft routes", () => {
    const context = parseResolutionEvidenceContext(prompt("Write a reply about current pricing", "draft_insert"));
    expect(classifyEvidenceNeed(context!).level).toBe("none");
  });

  it("does not research stable conceptual questions", () => {
    const context = parseResolutionEvidenceContext(prompt("Explain the concept of reciprocal rank fusion"));
    expect(classifyEvidenceNeed(context!).level).toBe("none");
  });

  it("recommends evidence for comparisons and recommendations", () => {
    const context = parseResolutionEvidenceContext(prompt("Which local coding agent is better?"));
    expect(classifyEvidenceNeed(context!).level).toBe("recommended");
  });
});
