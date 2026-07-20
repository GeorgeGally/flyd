import { describe, expect, it, vi } from "vitest";
import { runAgentSession } from "../agent-session.js";
import type { MemoryEvidence } from "../types.js";

function terminal(answers: string[]) {
  return {
    write: vi.fn(),
    ask: vi.fn(async () => answers.shift() ?? "/exit"),
    close: vi.fn(async () => undefined),
  };
}

const noMemory: MemoryEvidence = { verdict: "insufficient", matches: [] };

describe("runAgentSession", () => {
  it("answers conversational input without creating or resuming a coding task", async () => {
    const ui = terminal(["let's just chat", "/exit"]);
    const retrieveMemory = vi.fn(async () => noMemory);
    const respond = vi.fn(async ({ onToken }: { onToken: (token: string) => void }) => {
      onToken("Good. What do you want to think through?");
      return "Good. What do you want to think through?";
    });

    const result = await runAgentSession({
      terminal: ui,
      retrieveMemory,
      respond,
      loadSituation: vi.fn(async () => null),
    });

    expect(result).toEqual({ kind: "exit" });
    expect(retrieveMemory).toHaveBeenCalledWith("let's just chat");
    expect(respond).toHaveBeenCalledOnce();
    expect(ui.write).toHaveBeenCalledWith("Good. What do you want to think through?");
    expect(ui.close).toHaveBeenCalledOnce();
  });

  it("keeps conversation history inside the active session", async () => {
    const ui = terminal(["Hello", "What did I just say?", "/exit"]);
    const observedHistory: Array<Array<{ role: "user" | "assistant"; content: string }>> = [];
    const respond = vi.fn(async (input: {
      history: Array<{ role: "user" | "assistant"; content: string }>;
      onToken: (token: string) => void;
    }) => {
      observedHistory.push(input.history);
      const answer = observedHistory.length === 1 ? "Hello." : "You said hello.";
      input.onToken(answer);
      return answer;
    });

    await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      respond,
      loadSituation: vi.fn(async () => null),
    });

    expect(observedHistory[1]).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hello." },
    ]);
  });

  it("bounds model history to the most recent twelve turns", async () => {
    const messages = Array.from({ length: 8 }, (_, index) => `Message ${index + 1}`);
    const ui = terminal([ ...messages, "/exit" ]);
    const observedHistory: Array<Array<{ role: "user" | "assistant"; content: string }>> = [];
    const respond = vi.fn(async (input: {
      history: Array<{ role: "user" | "assistant"; content: string }>;
      onToken: (token: string) => void;
    }) => {
      observedHistory.push(input.history);
      input.onToken("Answer");
      return "Answer";
    });

    await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      respond,
      loadSituation: vi.fn(async () => null),
    });

    expect(observedHistory.at(-1)).toHaveLength(12);
    expect(observedHistory.at(-1)?.[0]).toEqual({ role: "user", content: "Message 2" });
  });

  it("hands a concrete coding outcome to the existing supervised runtime", async () => {
    const ui = terminal(["Fix the broken chat"]);

    const result = await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      respond: vi.fn(),
      loadSituation: vi.fn(async () => null),
    });

    expect(result).toEqual({ kind: "coding", outcome: "Fix the broken chat" });
    expect(ui.close).toHaveBeenCalledOnce();
  });

  it("lets the user explicitly resume unfinished coding work", async () => {
    const ui = terminal(["/resume"]);

    const result = await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      respond: vi.fn(),
      loadSituation: vi.fn(async () => ({
        project: "GeorgeGally/flyd",
        branch: "main",
        head: "abc123",
        dirty: false,
        changedFiles: 0,
        latestCommit: "Implement continuity",
        outcome: "Implement continuity",
        status: "ready",
        nextAction: "Run the focused tests",
      })),
    });

    expect(result).toEqual({ kind: "resume" });
  });

  it("shows unfinished work as context without forcing it to resume", async () => {
    const ui = terminal(["What is the risk?", "/exit"]);

    await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      respond: vi.fn(async ({ onToken }: { onToken: (token: string) => void }) => {
        onToken("The current risk is stale state.");
        return "The current risk is stale state.";
      }),
      loadSituation: vi.fn(async () => ({
        project: "GeorgeGally/flyd",
        branch: "main",
        head: "abc123",
        dirty: false,
        changedFiles: 0,
        latestCommit: "Implement continuity",
        outcome: "Implement continuity",
        status: "ready",
        nextAction: "Run the focused tests",
      })),
    });

    expect(ui.write).toHaveBeenCalledWith(expect.stringContaining("Unfinished: Implement continuity"));
    expect(ui.ask).toHaveBeenCalled();
  });

  it("does not print a completed historical task as an active agenda", async () => {
    const ui = terminal(["/exit"]);

    await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      respond: vi.fn(),
      loadSituation: vi.fn(async () => ({
        project: "GeorgeGally/flyd",
        branch: "main",
        head: "abc123",
        dirty: false,
        changedFiles: 0,
        latestCommit: "Finish previous work",
        outcome: "Old completed task",
        status: "completed",
        nextAction: "Start something else",
      })),
    });

    expect(ui.write).toHaveBeenCalledWith("GeorgeGally/flyd · main · clean\n");
    expect(ui.write).not.toHaveBeenCalledWith(expect.stringContaining("Old completed task"));
  });

  it("refreshes current repository truth before each model turn", async () => {
    const ui = terminal(["First question", "Second question", "/exit"]);
    const loadSituation = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      respond: vi.fn(async ({ onToken }: { onToken: (token: string) => void }) => {
        onToken("Answer");
        return "Answer";
      }),
      loadSituation,
    });

    expect(loadSituation).toHaveBeenCalledTimes(3);
  });
});
