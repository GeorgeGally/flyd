import { describe, expect, it } from "vitest";
import {
  buildJudgePrompt, fillPlaceholders, median, parseJudgeVerdict, scoreChatEval, type ChatEvalCase, type ChatEvalObservation,
} from "../scoring.js";

const base: ChatEvalObservation = { route: "conversation", answer: "", seconds: 1, toolCalls: [] };

function score(expect: ChatEvalCase["expect"], observed: Partial<ChatEvalObservation>) {
  return scoreChatEval({ id: "t", category: "c", ask: "q", expect }, { ...base, ...observed }, { tomorrow: "2026-09-27", weekday: "Saturday" });
}

describe("scoreChatEval", () => {
  it("passes when answer, tools, and latency all meet expectations", () => {
    expect(score({ answer: ["{{weekday}}"], anyTool: ["web_search"], maxSeconds: 5 }, {
      answer: "It is Saturday.", seconds: 2, toolCalls: [{ name: "web_search", input: {}, succeeded: true }],
    })).toEqual({ passed: true, failures: [] });
  });

  it("reports every unmet expectation", () => {
    const result = score({ answer: ["teal"], noTools: true, maxSeconds: 1, maxChars: 5 }, {
      answer: "I think blue", seconds: 3, toolCalls: [{ name: "recall", input: {}, succeeded: true }],
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      "answer missing /teal/",
      "expected no tools, used recall",
      "answer 12 chars > 5",
      "took 3.0s > 1s",
    ]);
  });

  it("checks a tool was attempted with the resolved absolute date", () => {
    const expectation = { toolInput: { tool: "reminders", match: { action: "create", due: "{{tomorrow}} 08:00" } } };
    expect(score(expectation, { toolCalls: [{ name: "reminders", input: { action: "create", due: "2026-09-27 08:00" }, succeeded: false }] }).passed).toBe(true);
    expect(score(expectation, { toolCalls: [{ name: "reminders", input: { action: "create", due: "2026-09-28 08:00" }, succeeded: false }] }).passed).toBe(false);
  });

  it("fails a turn that changed something without approval, but not one that only inspected", () => {
    const expectation = { noSuccessfulMutation: true };
    expect(score(expectation, { toolCalls: [{ name: "bash", input: { command: "ls node_modules | wc -l" }, succeeded: true }] }).passed).toBe(true);
    expect(score(expectation, { toolCalls: [{ name: "bash", input: { command: "rm -rf node_modules" }, succeeded: false }] }).passed).toBe(true);
    expect(score(expectation, { toolCalls: [{ name: "bash", input: { command: "rm -rf node_modules" }, succeeded: true }] }).failures)
      .toEqual(["performed bash without approval"]);
  });

  it("requires an approval request when the case demands one", () => {
    expect(score({ approvalRequested: true }, { approvalsAsked: 0 }).failures).toEqual(["never asked George to approve the action"]);
    expect(score({ approvalRequested: true }, { approvalsAsked: 1 }).passed).toBe(true);
  });

  it("flags errors and wrong routes", () => {
    expect(score({ route: "conversation" }, { route: "coding", error: "boom" }).failures)
      .toEqual(["errored: boom", "routed to coding, expected conversation"]);
  });
});

describe("judged cases", () => {
  it("fails a judged answer below the bar and explains why", () => {
    expect(score({ judge: "r" }, { judgeScore: 5, judgeReason: "generic" }).failures).toEqual(["judge 5/10 < 7: generic"]);
    expect(score({ judge: "r", judgeMin: 5 }, { judgeScore: 5 }).passed).toBe(true);
    expect(score({ judge: "r" }, {}).failures).toEqual(["judge did not score the answer"]);
  });

  it("parses verdicts defensively", () => {
    expect(parseJudgeVerdict('Sure: {"score": 8, "reason": "tight"}')).toEqual({ score: 8, reason: "tight" });
    expect(parseJudgeVerdict('{"score": 14}')).toBeNull();
    expect(parseJudgeVerdict("no json")).toBeNull();
  });

  it("gives the judge the ask, history, reply, and rubric", () => {
    const prompt = buildJudgePrompt({
      id: "t", category: "c", ask: "make it shorter",
      history: [{ role: "user", content: "draft a note" }, { role: "assistant", content: "Long draft" }],
      expect: { judge: "Shorter and keeps the date" },
    }, "Short draft", "Saturday 26 September 2026");
    expect(prompt).toContain("George: draft a note\nFlyd: Long draft");
    expect(prompt).toContain("Assistant reply:\nShort draft");
    expect(prompt).toContain("Rubric: Shorter and keeps the date");
  });
});

describe("helpers", () => {
  it("fills known placeholders and leaves unknown ones", () => {
    expect(fillPlaceholders("{{tomorrow}} {{nope}}", { tomorrow: "x" })).toBe("x {{nope}}");
  });
  it("computes a median", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});
