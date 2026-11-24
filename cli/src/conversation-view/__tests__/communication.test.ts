import { describe, expect, it, vi } from "vitest";
import type { PredicateEvaluation } from "../../cognition/system-one/types.js";
import { answerBody, answerHtml, plainAnswer } from "../answer-form.js";
import { answerWithCommunication, communicationContent, communicationIntent, communicationProjection, manifestationPlan, validateCommunicationPlan } from "../communication.js";
import { COMMUNICATION_CORPUS, COMMUNICATION_QUESTION, comparisonContent, diagnosticContent, diagnosticFacts } from "./fixtures/communication.js";

const uncalibrated = { calibrated: async () => false };
const judged = (choice: string, confidence = .95): PredicateEvaluation => ({ ok: true, evaluator: "jev", rubricVersion: "test", projectionHash: "test", evaluatedAt: new Date().toISOString(), latencyMs: 1,
  answers: { communication_goal: { id: "communication_goal", type: "choice", choice, probability: confidence, confidence } } });

describe("communication intent and native manifestation", () => {
  it("gives two investigations different interfaces and binds evidence, fixes and uncertainty", async () => {
    const diagnostic = diagnosticContent(), comparison = comparisonContent();
    expect(diagnostic.object.kind).toBe(comparison.object.kind);
    const cause = manifestationPlan(diagnostic, await communicationIntent(diagnostic, COMMUNICATION_QUESTION, uncalibrated));
    const choice = manifestationPlan(comparison, await communicationIntent(comparison, "Which fix should we use?", uncalibrated));
    expect(cause.intent.goals).toEqual(["explain_cause", "contrast_expected_actual", "identify_fix", "show_evidence"]);
    expect(choice.intent.goals).toEqual(["compare_options", "recommend", "show_evidence"]);
    expect(answerHtml(cause)).toContain('data-communication="explain_cause"');
    expect(answerHtml(cause)).toContain('data-comm-source="review"');
    expect(answerHtml(cause)).toContain('data-action-id="inspect:review"');
    expect(answerHtml(cause)).toContain("Still uncertain");
    expect(answerHtml(choice)).toContain("<table>");
    expect(answerHtml(choice)).toContain("Recommendation");
    expect(plainAnswer(cause)).toContain("installed interface has not been verified");
    expect(answerBody(cause)).toEqual(cause);
  });

  it("lets calibrated Jev choose the need when the same facts support cause and comparison", async () => {
    const content = { ...diagnosticContent(), comparison: comparisonContent().comparison };
    const evaluate = vi.fn().mockResolvedValueOnce(judged("explain_cause")).mockResolvedValueOnce(judged("compare_options"));
    const options = { evaluate, calibrated: async () => true };
    expect((await communicationIntent(content, "Why?", options)).primary).toBe("explain_cause");
    expect((await communicationIntent(content, "Which fix?", options)).primary).toBe("compare_options");
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(evaluate.mock.calls[0]![1][0]).toMatchObject({ id: "communication_goal" });
    expect(evaluate.mock.calls[0]![3].allowedFields).toEqual(Object.keys(communicationProjection(content, "Why?")));
  });

  it("uses the same structure for different kinds with the same communication need", async () => {
    const content = diagnosticContent();
    const changed = { ...content, object: { ...content.object, kind: "artifact" as const } };
    expect((await communicationIntent(content, "Why?", uncalibrated)).goals).toEqual((await communicationIntent(changed, "Why?", uncalibrated)).goals);
  });

  it("does not send a transcript, sources or executable actions to Jev", () => {
    const content = diagnosticContent();
    const projected = communicationProjection(content, "q".repeat(1200));
    expect(String(projected.question)).toHaveLength(600);
    expect(JSON.stringify(projected)).not.toMatch(/https:|transcript|<table|inspect:review/);
    expect(projected).not.toHaveProperty("layout");
    expect(projected.action_kinds).toEqual(["inspect"]);
  });

  it("rejects invented sources, invalid references and unsafe links while ignoring proposed execution", () => {
    const facts = diagnosticFacts();
    expect(communicationContent(facts, "answer:1", "")).toBeNull();
    expect(communicationContent({ ...facts, evidence: [{ ...facts.evidence[0], url: "javascript:run()" }] }, "answer:1", COMMUNICATION_CORPUS)).toBeNull();
    expect(communicationContent({ ...facts, claims: [{ ...facts.claims[0], evidenceIds: ["invented"] }] }, "answer:1", COMMUNICATION_CORPUS)).toBeNull();
    const accepted = communicationContent({ ...facts, actions: [{ kind: "execute", value: "delete files" }], html: "<script>run()</script>" }, "answer:1", COMMUNICATION_CORPUS)!;
    expect(accepted.object.actions).toEqual([{ id: "inspect:review", kind: "inspect", label: "Patch review", value: "https://example.test/review/200" }]);
  });

  it("keeps uncertain, failed, unsupported and uncalibrated judgments on the factual fallback", async () => {
    const evaluate = vi.fn().mockResolvedValue(judged("compare_options", .2));
    const content = diagnosticContent();
    await communicationIntent(content, "Why?", { ...uncalibrated, evaluate });
    expect(evaluate).not.toHaveBeenCalled();
    const options = { calibrated: async () => true, evaluate };
    expect((await communicationIntent(content, "Why?", options)).source).toBe("structure");
    evaluate.mockResolvedValue(judged("compare_options")); // No comparison relation to render.
    expect((await communicationIntent(content, "Why?", options)).primary).toBe("explain_cause");
    evaluate.mockRejectedValue(new Error("credit failure"));
    expect((await communicationIntent(content, "Why?", options)).primary).toBe("explain_cause");
  });

  it("preserves deferred and ordinary answers, and only structures produced content", async () => {
    await expect(answerWithCommunication("Hello", async () => "Hello.", uncalibrated)).resolves.toBe("Hello.");
    await expect(answerWithCommunication("Why", async (onContent) => { onContent(diagnosticContent()); return { deferred: true }; }, uncalibrated)).resolves.toEqual({ deferred: true });
    await expect(answerWithCommunication("Why", async (onContent) => { onContent(diagnosticContent()); return "The presentation decision is missing."; }, uncalibrated)).resolves.toMatchObject({ form: "communication", intent: { primary: "explain_cause" } });
  });

  it("validates stored data, rebuilds blocks/action targets, and escapes displayed content", async () => {
    const content = diagnosticContent();
    content.claims[0]!.text = '<img src=x onerror="run()">';
    const plan = manifestationPlan(content, await communicationIntent(content, "Why?", uncalibrated));
    expect(answerHtml(plan)).toContain("&lt;img");
    expect(answerHtml(plan)).not.toContain("<img");
    expect(validateCommunicationPlan({ ...plan, blocks: [{ kind: "html", html: "<script>run()</script>" }] })).toEqual(plan);
    expect(validateCommunicationPlan({ ...plan, content: { ...content, sources: {} } })).toBeNull();
    expect(validateCommunicationPlan({ ...plan, content: { ...content, sources: [null] } })).toBeNull();
    const malformed = { ...plan, content: { ...content, sources: {} } } as unknown as typeof plan;
    expect(answerBody(malformed).form).toBe("prose");
    expect(answerHtml(malformed)).toContain("&lt;img");
    expect(plainAnswer(malformed)).toContain("The answer has no communication intent");
    const unsupported = { ...plan, intent: { ...plan.intent, primary: "arbitrary_script" } } as unknown as typeof plan;
    expect(answerHtml(unsupported)).toContain("https://example.test/review/200");
  });
});
