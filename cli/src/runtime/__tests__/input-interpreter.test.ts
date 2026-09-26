import { describe, expect, it } from "vitest";
import { interpretAgentInput } from "../input-interpreter.js";

describe("interpretAgentInput", () => {
  it("interprets only explicit session controls", () => {
    expect(interpretAgentInput("/exit")).toEqual({ kind: "exit" });
    expect(interpretAgentInput("quit")).toEqual({ kind: "exit" });
    expect(interpretAgentInput("/resume")).toEqual({ kind: "resume" });
    expect(interpretAgentInput("/code improve startup speed")).toEqual({ kind: "coding", outcome: "improve startup speed" });
  });

  it.each([
    "implement dark mode",
    "Fix chat so cmd+enter submits",
    "take a look at this skill and implement it: https://github.com/ayghri/i-have-adhd",
    "what's the status of the project",
    "do it",
    "ok implement then",
    "continue.",
    "let's just chat",
    "bring in the coach",
    "add milk to my shopping list",
    "test my knowledge of spanish",
  ])("leaves %j to the model", (text) => {
    expect(interpretAgentInput(text)).toEqual({ kind: "conversation", message: text });
  });
});
