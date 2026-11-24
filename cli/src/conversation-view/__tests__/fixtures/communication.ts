import { communicationContent } from "../../communication.js";

// Synthetic regression: the question and relationships matter, not a kind/layout map.
export const COMMUNICATION_QUESTION = "Why didn’t PR #200 fix generative UI?";
export const COMMUNICATION_CORPUS = "Patch review: PR #200 only changed spacing. The interface still chooses a layout from the investigation kind. The answer needs a communication intent before a manifestation plan. Spacing patch changes appearance but does not choose communication structure. Intent planner changes appearance and chooses communication structure. Criteria: Changes appearance; Chooses communication structure. https://example.test/review/200";
export function diagnosticFacts() {
  return {
    title: "Generative UI review", semantic_kind: "investigation", lead: "The patch changed spacing; it did not change how the answer chooses an interface.",
    claims: [
      { id: "expected", role: "expected", text: "The interface should follow what the answer needs to communicate.", evidenceIds: [] },
      { id: "actual", role: "actual", text: "The interface still chooses a layout from the investigation kind.", evidenceIds: ["review"] },
      { id: "cause", role: "cause", text: "The answer has no communication intent before its manifestation plan.", evidenceIds: ["review"] },
      { id: "fix", role: "fix", text: "The answer needs a communication intent from facts before planning the interface.", evidenceIds: [] },
      { id: "unknown", role: "uncertainty", text: "The installed interface has not been verified.", evidenceIds: [] },
    ],
    evidence: [{ id: "review", label: "Patch review", quote: "PR #200 only changed spacing.", url: "https://example.test/review/200" }],
  };
}
export function comparisonFacts() {
  return {
    ...diagnosticFacts(),
    lead: "The intent planner addresses the missing communication step.",
    claims: [{ id: "recommend", role: "recommendation", text: "The intent planner is the better fix because it changes the presentation decision.", evidenceIds: ["review"] }],
    comparison: { criteria: ["Changes appearance", "Chooses communication structure"], alternatives: [
      { id: "spacing", name: "Spacing patch", values: ["Yes", "No"] },
      { id: "intent", name: "Intent planner", values: ["Yes", "Yes"] },
    ] },
  };
}
export const diagnosticContent = () => communicationContent(diagnosticFacts(), "answer:review:1", COMMUNICATION_CORPUS)!;
export const comparisonContent = () => communicationContent(comparisonFacts(), "answer:review:1", COMMUNICATION_CORPUS)!;
