import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { respondToConversation } from "../conversation-responder.js";

beforeEach(() => {
  vi.stubEnv("FLYD_ROOM", "0");
  // The compatibility crew path, so nothing reaches a real FirstMate home.
  vi.stubEnv("FLYD_FIRSTMATE", "0");
});
afterEach(() => { vi.unstubAllEnvs(); });
vi.setConfig({ testTimeout: 20_000 });

const REPLY = '[Captain is replying from Flyd to ask:1795451753594-23670eac — his note: "the hero"; your answer began: "Want the crew to fix the hero spacing?". His reply follows.]\n\nYes';

async function turn(message: string, route: "delegate" | "answer", history: Array<{ role: "user" | "assistant"; content: string }> = []) {
  const seen: { iterations?: number; toolCallBudget?: number; tools: string[]; result?: string } = { tools: [] };
  await respondToConversation({
    message, history, memory: { verdict: "insufficient", matches: [] }, situation: null, onToken: () => undefined,
  }, {
    readOnly: true,
    routeTurn: async () => ({ route, source: "jev", confidence: 0.99, decided: true, needsCode: false, domain: route === "delegate" ? "coding" : "general" }),
    runAgentLoop: async (_system, _prompt, tools, onToolCall, _model, maxIterations, options) => {
      seen.iterations = maxIterations;
      seen.toolCallBudget = options?.toolCallBudget;
      seen.tools = tools.map((tool) => tool.name);
      if (route === "delegate") seen.result = await onToolCall("start_coding_task", { repo: process.cwd(), outcome: "Fix the hero spacing", done_when: ["the hero spacing matches the rest"] });
      return "<final>On it.</final>";
    },
  });
  return seen;
}

describe("a short reply in the conversation", () => {
  it("takes the light path and still hands the work to the crew, as the full loop would", async () => {
    const light = await turn(REPLY, "delegate");
    expect(light.iterations).toBe(2);
    expect(light.toolCallBudget).toBe(1);
    expect(light.tools).toContain("start_coding_task");
    // The hand-off runs (recorded, as this is a read-only evaluation run), not skipped by the plan.
    expect(light.result).not.toMatch(/Skipped/);
    expect(light.result).toMatch(/start_coding_task .*Fix the hero spacing/);
  });

  it("gives a go-ahead to work Flyd just offered the full loop, so the approved work can run", async () => {
    const offered = [{ role: "user" as const, content: "did Sam email about Friday?" }, { role: "assistant" as const, content: "He did. Want me to check your calendar and draft the reply?" }];
    const approved = await turn("go ahead", "answer", offered);
    expect(approved.iterations).toBeGreaterThan(2);
    expect(approved.toolCallBudget).toBeGreaterThan(1);
    const declined = await turn("not now", "answer", offered);
    expect(declined.iterations).toBe(2);
    expect(declined.toolCallBudget).toBe(1);
  });

  it("leaves an ordinary message on the full loop", async () => {
    const full = await turn("what did the crew change on the hero yesterday?", "answer");
    expect(full.iterations).toBeGreaterThan(2);
    expect(full.toolCallBudget).toBeGreaterThan(1);
  });
});
