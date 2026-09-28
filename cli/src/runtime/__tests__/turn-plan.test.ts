import { describe, expect, it } from "vitest";
import { offRoute, planBrief, planBudget, planTurn, visibleTools } from "../turn-plan.js";
import { contractError } from "../tool-contracts.js";

const tools = ["read_file", "bash", "edit_file", "write_file", "web_search", "remember", "todos", "background_task", "start_coding_task", "speaking_style"].map((name) => ({ name }));
const names = (plan: ReturnType<typeof planTurn>) => visibleTools(tools, plan).map((tool) => tool.name);

describe("turn plan", () => {
  it("answers change nothing: change-only tools are out of sight and writes are gated", () => {
    const plan = planTurn("answer", ["tomorrow's calendar"]);
    expect(names(plan)).toEqual(["read_file", "bash", "web_search", "todos"]);
    expect(offRoute(plan, "bash", { command: "git log -3" })).toBeNull();
    expect(offRoute(plan, "todos", { action: "list" })).toBeNull();
    expect(offRoute(plan, "bash", { command: "touch x" })).toMatch(/^Skipped \(not this turn\): this turn is for answering/);
    expect(offRoute(plan, "background_task", { task: "keep an eye on the flight" })).toMatch(/^Skipped/);
    expect(planBrief(plan!)).toContain("Your reply must cover, however short it is:\n- tomorrow's calendar");
  });

  it("hands work off at once: only the hand-offs are in reach, the reading is the crewmate's", () => {
    const plan = planTurn("delegate");
    expect(names(plan)).toEqual(["background_task", "start_coding_task"]);
    expect(offRoute(plan, "start_coding_task", { outcome: "clock in the header" })).toBeNull();
    expect(offRoute(plan, "read_file", { path: "screen.ts" })).toMatch(/whoever takes it does the reading/);
    expect(offRoute(plan, "edit_file", { path: "screen.ts" })).toMatch(/^Skipped \(not this turn\)/);
    expect(planBudget({ iterations: 25, toolCalls: 30, answerMs: 1 }, plan)).toEqual({ iterations: 3, toolCalls: 2, answerMs: 1 });
  });

  it("asks back on an unclear request, without researching first", () => {
    const plan = planTurn("clarify");
    expect(plan!.instruction).toContain("Ask one short question");
    expect(planBudget({ iterations: 12, toolCalls: 12 }, plan)).toEqual({ iterations: 3, toolCalls: 2 });
  });

  it("acts with everything; unattended runs and missing readings keep today's behaviour", () => {
    expect(names(planTurn("act"))).toEqual(tools.map((tool) => tool.name));
    expect(offRoute(planTurn("act"), "edit_file", { path: "x" })).toBeNull();
    expect(planBudget({ iterations: 25, toolCalls: 30 }, planTurn("act"))).toEqual({ iterations: 10, toolCalls: 12 });
    expect(planTurn("answer", [], { unattended: true })).toBeNull();
    expect(planTurn(null)).toBeNull();
    expect(planBudget({ iterations: 12, toolCalls: 12 }, planTurn("answer"))).toEqual({ iterations: 12, toolCalls: 12 });
  });
});

describe("tool contracts", () => {
  it("sends a writing-style request to speaking_style, not memory", () => {
    expect(contractError("remember", { text: "George wants Flyd to talk to him in plain, literal simple English" })).toMatch(/speaking_style/);
    expect(contractError("remember", { text: "George's partner is Maya" })).toBeNull();
    expect(contractError("remember", { text: "George is learning plain English grammar for his kid's school" })).toBeNull();
    expect(contractError("speaking_style", { style: "asd-ste100" })).toBeNull();
  });
});
