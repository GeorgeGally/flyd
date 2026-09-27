import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runAgentSession } from "../agent-session.js";
import { createConversationMemorySession, retrieveRecentActionableOutcome } from "../conversation-memory.js";
import type { MemoryEvidence } from "../types.js";

function terminal(answers: string[]) {
  return {
    write: vi.fn(),
    ask: vi.fn(async () => answers.shift() ?? "/exit"),
    confirm: vi.fn(async () => false),
    close: vi.fn(async () => undefined),
    setBusy: vi.fn(),
  };
}

const noMemory: MemoryEvidence = { verdict: "insufficient", matches: [] };
const actionable = (outcome: string) => ({
  outcome,
  sourceSessionId: "previous-session",
  sourceTurn: 0,
  recordedAt: "2026-07-21T01:00:00.000Z",
});

describe("runAgentSession", () => {
  it("splits the FLYD banner green over white and leaves a blank line under it", async () => {
    const ui = terminal(["/exit"]);

    await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
      respond: vi.fn(),
      loadSituation: vi.fn(async () => null),
    });

    const intro = String(ui.write.mock.calls[0]?.[0] ?? "");
    expect(intro).toContain("\u001b[32m███████╗");
    expect(intro).toContain("\u001b[97m╚═╝");
    expect(intro).toMatch(/╚═╝[^\n]*\n\n\s+Good /);
  });

  it("opens with the present briefing, not a git telemetry restatement", async () => {
    const ui = terminal(["/exit"]);

    await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
      respond: vi.fn(),
      loadSituation: vi.fn(async () => ({
        project: "GeorgeGally/flyd",
        branch: "main",
        head: "abc123",
        dirty: false,
        changedFiles: 0,
        latestCommit: "Ship the release",
        outcome: "Ship the release",
        status: "ready",
        nextAction: "Run the focused tests",
      })),
      loadPresentHypothesis: vi.fn(async () =>
        "GNM sponsor outreach is due 5 September. CleanX and Good Neighbours both moved.",
      ),
    });

    const intro = String(ui.write.mock.calls[0]?.[0] ?? "");
    expect(intro).toContain("sponsor outreach is due 5 September");
    expect(intro).not.toContain("It's"); // no weather noise
    expect(intro).not.toContain("Next: Run the focused tests.");
  });

  it("lets the Muse greet in prose and keeps the raw briefing for /brief", async () => {
    const ui = terminal(["/brief", "/exit"]);
    const composeGreeting = vi.fn(async () => "Sam's call is at five; the rest can wait.");

    await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
      respond: vi.fn(),
      loadSituation: vi.fn(async () => null),
      loadBriefing: vi.fn(async () => ["On my mind: Pick one spine for positioning."]),
      composeGreeting,
    });

    const written = ui.write.mock.calls.map((call) => String(call[0]));
    expect(composeGreeting).toHaveBeenCalledWith({ briefing: ["On my mind: Pick one spine for positioning."], hypothesis: null });
    expect(written[0]).not.toContain("Strategist");
    expect(written[1]).toContain("Sam's call is at five");
    expect(written.slice(2).join("")).toContain("On my mind: Pick one spine for positioning.");
  });

  it("copies the last reply with /copy", async () => {
    const ui = terminal(["hello", "/copy", "/exit"]);
    const copyToClipboard = vi.fn(async () => undefined);

    await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
      respond: vi.fn(async () => "Hi George, a reply worth copying."),
      loadSituation: vi.fn(async () => null),
      copyToClipboard,
    });

    expect(copyToClipboard).toHaveBeenCalledWith("Hi George, a reply worth copying.");
  });

  it("renders a value brief on /brief", async () => {
    const ui = terminal(["/brief", "/exit"]);

    await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
      respond: vi.fn(),
      loadSituation: vi.fn(async () => ({
        project: "GeorgeGally/flyd",
        branch: "main",
        head: "abc123",
        dirty: false,
        changedFiles: 0,
        latestCommit: null,
        outcome: null,
        status: null,
        nextAction: "Ship the release",
      })),
    });

    const writes = ui.write.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    expect(writes).toContain("Daily brief");
    expect(writes).toContain("Next: Ship the release.");
  });

  it("answers conversational input without creating or resuming a coding task", async () => {
    const ui = terminal(["let's just chat", "/exit"]);
    const retrieveMemory = vi.fn(async () => noMemory);
    const recordTurn = vi.fn(async () => undefined);
    const respond = vi.fn(async ({ onToken }: { onToken: (token: string) => void }) => {
      onToken("Good. What do you want to think through?");
      return "Good. What do you want to think through?";
    });

    const result = await runAgentSession({
      sessionId: "conversation-session",
      terminal: ui,
      retrieveMemory,
      recoverActionRequest: vi.fn(async () => null),
      recordTurn,
      respond,
      loadSituation: vi.fn(async () => null),
    });

    expect(result).toEqual({ kind: "exit" });
    expect(retrieveMemory).toHaveBeenCalledWith("let's just chat");
    expect(respond).toHaveBeenCalledOnce();
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "conversation-session",
      turnNumber: 1,
    }));
    expect(recordTurn).toHaveBeenCalledWith({
      user: "let's just chat",
      assistant: "Good. What do you want to think through?",
    });
    expect(ui.write).toHaveBeenCalledWith("Good. What do you want to think through?");
    expect(ui.close).toHaveBeenCalledOnce();
  });

  it("reports thinking through the terminal busy signal, not raw escape codes", async () => {
    const ui = terminal(["hello", "/exit"]);

    await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
      respond: vi.fn(async ({ onToken }: { onToken: (token: string) => void }) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        onToken("Hello back.");
        return "Hello back.";
      }),
      loadSituation: vi.fn(async () => null),
    });

    expect(ui.setBusy.mock.calls[0]).toEqual([true]);
    expect(ui.setBusy.mock.calls.at(-1)).toEqual([false]);
    expect(ui.write).toHaveBeenCalledWith("Hello back.");
  });

  it("releases the session when a model turn exceeds its response deadline", async () => {
    const ui = terminal(["hello", "/exit"]);

    await runAgentSession({
      terminal: ui,
      responseTimeoutMs: 1,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
      respond: vi.fn(() => new Promise<string>(() => undefined)),
      loadSituation: vi.fn(async () => null),
    });

    expect(ui.setBusy.mock.calls.at(-1)).toEqual([false]);
    expect(ui.write).toHaveBeenCalledWith(expect.stringContaining("timed out"));
  }, 100);

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
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
      respond,
      loadSituation: vi.fn(async () => null),
    });

    expect(observedHistory[1]).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hello." },
    ]);
  });

  it("repairs the preceding turn with /flyd-fix without invoking another model response", async () => {
    const ui = terminal(["/flyd-fix this was generic and ignored my memory", "/exit"]);
    const repairLastTurn = vi.fn(async () => ({
      id: "fix-1",
      failureClasses: ["memory_authority", "answer_quality"],
    }));
    const respond = vi.fn();
    const retrieveMemory = vi.fn(async () => noMemory);

    const result = await runAgentSession({
      sessionId: "repair-session",
      terminal: ui,
      retrieveMemory,
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
      respond,
      repairLastTurn,
      loadSituation: vi.fn(async () => null),
    });

    expect(result).toEqual({ kind: "exit" });
    expect(repairLastTurn).toHaveBeenCalledWith("this was generic and ignored my memory");
    expect(respond).not.toHaveBeenCalled();
    expect(retrieveMemory).not.toHaveBeenCalled();
    expect(ui.write).toHaveBeenCalledWith(expect.stringContaining("fix-1"));
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
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
      respond,
      loadSituation: vi.fn(async () => null),
    });

    expect(observedHistory.at(-1)).toHaveLength(12);
    expect(observedHistory.at(-1)?.[0]).toEqual({ role: "user", content: "Message 2" });
  });

  it("keeps a contextual action in conversation when no coding referent exists", async () => {
    const ui = terminal(["do it", "/exit"]);
    const respond = vi.fn(async ({ onToken }: { onToken: (token: string) => void }) => {
      const answer = "What should I act on?";
      onToken(answer);
      return answer;
    });

    const result = await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
      respond,
      loadSituation: vi.fn(async () => null),
    });

    expect(result).toEqual({ kind: "exit" });
    expect(respond).toHaveBeenCalledOnce();
  });

  it("does not enter the coding runtime when contextual handoff persistence fails", async () => {
    const ui = terminal(["ok implement then", "/exit"]);
    const respond = vi.fn(async ({ onToken }: { onToken: (token: string) => void }) => {
      onToken("I could not preserve that handoff.");
      return "I could not preserve that handoff.";
    });

    const result = await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => ({
        outcome: "Implement https://github.com/ayghri/i-have-adhd",
        sourceSessionId: "previous-session",
        sourceTurn: 1,
        recordedAt: "2026-07-21T01:00:00.000Z",
      })),
      recordTurn: vi.fn(async (turn) => {
        if ("handoff" in turn) throw new Error("disk unavailable");
      }),
      respond,
      loadSituation: vi.fn(async () => null),
    });

    expect(result).toEqual({ kind: "exit" });
    expect(ui.write).toHaveBeenCalledWith(expect.stringContaining("could not preserve that handoff"));
  });

  it("lets the user explicitly resume unfinished coding work", async () => {
    const ui = terminal(["/resume"]);

    const result = await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
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

  it("keeps natural continuation in the active conversation when history exists", async () => {
    const ui = terminal(["Let's discuss the artwork release", "continue.", "/exit"]);
    const recoverActionRequest = vi.fn(async () => actionable("Fix an older coding task"));
    const respond = vi.fn(async ({ onToken }: { onToken: (token: string) => void }) => {
      onToken("Conversation response");
      return "Conversation response";
    });

    const result = await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest,
      recordTurn: vi.fn(async () => undefined),
      respond,
      loadSituation: vi.fn(async () => null),
    });

    expect(result).toEqual({ kind: "exit" });
    expect(respond).toHaveBeenCalledTimes(2);
    expect(recoverActionRequest).not.toHaveBeenCalled();
  });

  it("shows unfinished work as context without forcing it to resume", async () => {
    const ui = terminal(["What is the risk?", "/exit"]);

    await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
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

    expect(ui.write).not.toHaveBeenCalledWith(expect.stringContaining("Implement continuity"));
    expect(ui.write).not.toHaveBeenCalledWith(expect.stringContaining("Unfinished:"));
    expect(ui.ask).toHaveBeenCalled();
  });

  it("does not repeat unfinished work when outcome and next action are the same", async () => {
    const ui = terminal(["/exit"]);

    await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
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
        nextAction: "Implement continuity",
      })),
    });

    const output = ui.write.mock.calls.map(([value]) => value).join("");
    expect(output).not.toContain("Unfinished:");
    expect(output).not.toContain("Implement continuity — Implement continuity");
  });

  it("does not treat a conversational question as unfinished coding work", async () => {
    const ui = terminal(["/exit"]);

    await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
      respond: vi.fn(),
      loadSituation: vi.fn(async () => ({
        project: "GeorgeGally/flyd",
        branch: "main",
        head: "abc123",
        dirty: false,
        changedFiles: 0,
        latestCommit: "wip",
        outcome: "so how do we fix this?",
        status: "awaiting_grant",
        nextAction: "so how do we fix this?",
      })),
    });

    const output = ui.write.mock.calls.map(([value]) => value).join("");
    expect(output).not.toContain("so how do we fix this?");
    expect(output).not.toContain("Unfinished:");
  });

  it("does not print a completed historical task as an active agenda", async () => {
    const ui = terminal(["/exit"]);

    await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
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

    expect(ui.write).not.toHaveBeenCalledWith(expect.stringContaining("GeorgeGally/flyd · main"));
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
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
      respond: vi.fn(async ({ onToken }: { onToken: (token: string) => void }) => {
        onToken("Answer");
        return "Answer";
      }),
      loadSituation,
    });

    expect(loadSituation).toHaveBeenCalledTimes(3);
  });

  it("keeps 'so how do we fix this?' in conversation instead of a coding grant", async () => {
    const ui = terminal(["so how do we fix this?", "/exit"]);
    const respond = vi.fn(async ({ onToken }: { onToken: (token: string) => void }) => {
      onToken("Stay in chat.");
      return "Stay in chat.";
    });

    const result = await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
      respond,
      loadSituation: vi.fn(async () => null),
    });

    expect(result).toEqual({ kind: "exit" });
    expect(respond).toHaveBeenCalledOnce();
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({
      message: "so how do we fix this?",
    }));
  });

  it("opens with the PA fallback question when there is no signal and no hypothesis", async () => {
    const ui = terminal(["/exit"]);

    await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
      respond: vi.fn(),
      loadSituation: vi.fn(async () => null),
    });

    const intro = String(ui.write.mock.calls[0]?.[0] ?? "");
    expect(intro).toContain("What are we working on today?");
  });

  it("opens with the present hypothesis when nothing is actionable", async () => {
    const ui = terminal(["/exit"]);

    await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
      respond: vi.fn(),
      loadSituation: vi.fn(async () => ({
        project: "GeorgeGally/flyd",
        branch: "main",
        head: "abc123",
        dirty: false,
        changedFiles: 0,
        latestCommit: null,
        outcome: null,
        status: null,
        nextAction: null,
      })),
      loadPresentHypothesis: vi.fn(async () => "CleanX and Good Neighbours both moved."),
    });

    const intro = String(ui.write.mock.calls[0]?.[0] ?? "");
    expect(intro).toContain("CleanX and Good Neighbours both moved.");
  });

  it("appends the briefing even when a git next action exists", async () => {
    const ui = terminal(["/exit"]);

    await runAgentSession({
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => null),
      recordTurn: vi.fn(async () => undefined),
      respond: vi.fn(),
      loadSituation: vi.fn(async () => ({
        project: "GeorgeGally/flyd",
        branch: "main",
        head: "abc123",
        dirty: false,
        changedFiles: 0,
        latestCommit: null,
        outcome: null,
        status: null,
        nextAction: "Run the focused tests",
      })),
      loadPresentHypothesis: vi.fn(async () => "sponsor outreach is due"),
    });

    const intro = String(ui.write.mock.calls[0]?.[0] ?? "");
    expect(intro).toContain("sponsor outreach is due");
    expect(intro).not.toContain("Next: Run the focused tests.");
  });
});

describe("runAgentSession coding handoffs", () => {
  it("hands /code outcomes straight to the supervised runtime", async () => {
    const ui = terminal(["/code Fix the broken chat"]);
    const recordTurn = vi.fn(async () => undefined);
    const respond = vi.fn();
    const result = await runAgentSession({
      sessionId: "direct-session",
      now: () => new Date("2026-07-21T01:00:00.000Z"),
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => null),
      recordTurn,
      respond,
      loadSituation: vi.fn(async () => null),
    });
    expect(result).toEqual({ kind: "coding", outcome: "Fix the broken chat" });
    expect(respond).not.toHaveBeenCalled();
    expect(recordTurn).toHaveBeenCalledWith(expect.objectContaining({ handoff: expect.objectContaining({ outcome: "Fix the broken chat" }) }));
  });

  it("hands off after the turn when the model calls start_coding_task", async () => {
    const lines = ["Implement dark mode across the CLI"];
    // After the first message the user types nothing; the handoff must end the wait.
    const ui = {
      ...terminal([]),
      ask: vi.fn(() => lines.length ? Promise.resolve(lines.shift()!) : new Promise<string>(() => {})),
    };
    const recordTurn = vi.fn(async () => undefined);
    const respond = vi.fn(async (input: { onToken(token: string): void; onCodingHandoff?(outcome: string): void }) => {
      input.onCodingHandoff?.("Dark mode across the CLI, verified");
      const answer = "Starting that in the coding runtime now.";
      input.onToken(answer);
      return answer;
    });
    const result = await runAgentSession({
      sessionId: "s1",
      now: () => new Date("2026-07-21T01:00:00.000Z"),
      terminal: ui,
      retrieveMemory: vi.fn(async () => noMemory),
      recoverActionRequest: vi.fn(async () => null),
      recordTurn,
      respond,
      loadSituation: vi.fn(async () => null),
    });
    expect(result).toEqual({ kind: "coding", outcome: "Dark mode across the CLI, verified" });
    expect(recordTurn).toHaveBeenCalledWith(expect.objectContaining({
      user: "Implement dark mode across the CLI",
      assistant: "Starting that in the coding runtime now.",
      handoff: expect.objectContaining({ outcome: "Dark mode across the CLI, verified", sourceSessionId: "s1" }),
    }));
  });
});
